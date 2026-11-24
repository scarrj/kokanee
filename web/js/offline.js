// offline.js [WS7]: registers sw.js and VERIFIES offline readiness.
const listeners = { status: [] };
let ui = null, badge = null, last = null, running = null;

export function on(evt, cb) { (listeners[evt] ||= []).push(cb); }
let watchdog = null;
const armWatchdog = () => {
  clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    if (last?.state === 'ready') return;
    console.warn('Service worker did not finish installing within 20 s; falling back to verify()');
    run({ full: true });
  }, 20000);
};
const emit = (s) => { if (s.state !== 'downloading') clearTimeout(watchdog); last = s; render(s); (listeners.status || []).forEach((cb) => { try { cb(s); } catch (e) { console.error(e); } }); };

// Fetch a file, backing off on 429/5xx/network errors (GitHub Pages rate-limits bursts). Returns an ok Response or null.
async function fetchBackoff(path, tries = 6) {
  for (let n = 0; n < tries; n++) {
    let wait = 0;
    try {
      const r = await fetch(path, { cache: 'reload' });
      if (r.ok) return r;
      if (r.status !== 429 && r.status < 500) return null;
      wait = (Number(r.headers.get('retry-after')) || 0) * 1000;
    } catch { /* network error: retry */ }
    await new Promise((res) => setTimeout(res, Math.max(wait, Math.min(15000, 400 * 2 ** n))));
  }
  return null;
}

// Run fn over items with at most 4 in flight.
async function pool4(items, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

const mb = (n) => (n / 1048576).toFixed(n > 1e8 ? 0 : 1) + ' MB';

async function findCache() {
  let best = null;
  for (const n of await caches.keys()) {
    if (!n.startsWith('kokanee-')) continue;
    const c = await caches.open(n);
    const m = await c.match('__complete');
    if (m) { const ts = Number(await m.text()) || 0; if (!best || ts > best.ts) best = { c, ts, name: n }; }
  }
  return best && best.c;
}

async function loadManifest(cache) {
  const r = cache && (await cache.match('asset-manifest.json'));
  if (r) return r.json();
  const n = await fetch('asset-manifest.json', { cache: 'no-store' });
  return n.json();
}

// full=true compares byte counts of every file and decodes tiles; otherwise presence only.
export async function verify({ full = true } = {}) {
  const result = { ready: false, missing: [], bytes: 0, persisted: false, manifest: null, problems: [] };
  try {
    if (!('caches' in self)) { result.problems.push('Cache API unavailable'); result.missing = ['(Cache API unavailable)']; return result; }
    const cache = await findCache();
    if (!cache) { result.problems.push('no complete cache'); result.missing = ['(nothing cached yet)']; return result; }
    const m = (result.manifest = await loadManifest(cache));
    const base = decodeURIComponent(new URL('.', document.baseURI).pathname);
    const keys = (await cache.keys()).map((r) => decodeURIComponent(new URL(r.url).pathname));
    const have = new Set(keys);
    for (const f of m.files) if (!have.has(base + f.path)) result.missing.push(f.path);
    if (full) {
      // routes.json may legitimately be newer than the manifest (network-first), so skip its byte check.
      const present = m.files.filter((f) => !result.missing.includes(f.path) && f.path !== 'data/routes.json');
      for (let i = 0; i < present.length; i += 40) {
        await Promise.all(present.slice(i, i + 40).map(async (f) => {
          const r = await cache.match(f.path);
          const size = r ? (await r.blob()).size : -1;
          if (size !== f.bytes) result.missing.push(f.path);
        }));
      }
      // one decodable tile per layer
      let layers = [];
      try { layers = Object.keys((await (await cache.match('tiles/tiles.json'))?.json())?.layers || {}); } catch { /* none */ }
      for (const layer of layers) {
        const k = keys.find((p) => p.includes('/tiles/' + layer + '/') && p.endsWith('.png'));
        if (!k) continue;
        try { await createImageBitmap(await (await cache.match(k.slice(base.length))).blob()); }
        catch { result.missing.push('decode:' + layer); }
      }
      try {
        const r = await cache.match('data/routes.json');
        if (r) JSON.parse(await r.text());
        else if (m.files.some((f) => f.path === 'data/routes.json')) result.missing.push('data/routes.json');
      } catch { result.missing.push('data/routes.json (unparseable)'); }
    }
    result.missing = [...new Set(result.missing)];
    result.bytes = m.total_bytes || 0;
    result.ready = result.missing.length === 0;
  } catch (e) {
    result.problems.push(String(e));
    if (!result.missing.length) result.missing = ['(' + e + ')'];
  }
  try {
    if (navigator.storage?.persist) result.persisted = (await navigator.storage.persisted?.()) || (await navigator.storage.persist());
    const est = await navigator.storage?.estimate?.();
    if (est) result.usage = est.usage;
  } catch { /* ignore */ }
  return result;
}

async function run(opts) {
  if (running) return running;
  running = (async () => {
    const v = await verify(opts);
    const m = v.manifest;
    emit({ state: v.ready ? 'ready' : 'missing', ...v, rev: m?.content_rev, dem: m?.dem_version });
    return v;
  })().finally(() => { running = null; });
  return running;
}

function render(s) {
  if (!badge) return;
  let text, cls;
  if (s.state === 'downloading') { text = `Downloading map… ${s.pct}%`; cls = 'busy'; }
  else if (s.state === 'ready') { text = `Offline ready · rev ${s.rev ?? '?'} · DEM v${s.dem ?? '?'}`; cls = 'ok'; }
  else { text = `Not offline ready — ${s.missing.length} missing`; cls = 'bad'; }
  badge.textContent = text + (s.state === 'ready' && s.usage ? ` · ${mb(s.usage)}${s.persisted ? ' · persisted' : ''}` : '');
  badge.dataset.state = cls;
  badge.style.background = cls === 'ok' ? '#2b8a3e' : cls === 'bad' ? 'var(--danger, #c92a2a)' : '#e8590c';
  badge.title = 'Offline copy of the map. Storage used: ' + (s.usage ? mb(s.usage) : 'unknown') +
    '. Persistent storage: ' + (s.persisted ? 'granted' : 'not granted') +
    '. iOS may evict stored data from sites you have not opened for a while; re-open the app with signal occasionally.';
  if (s.state === 'missing') {
    const b = document.createElement('button');
    b.textContent = 'Retry';
    b.style.cssText = 'margin:-10px -6px -10px 8px;min-height:44px;min-width:44px;padding:0 10px;vertical-align:middle;border:1px solid #fff;background:transparent;color:inherit;border-radius:6px;cursor:pointer';
    b.onclick = retry;
    badge.append(b);
  }
}

// Re-fetch whatever is missing straight into the current cache, then re-verify.
export async function retry() {
  emit({ state: 'downloading', pct: 0, missing: [] });
  try {
    const v = await verify({ full: true });
    let cache = await findCache();
    if (!cache) {
      // No complete cache (e.g. SW active but its install was wiped): rebuild one from the page.
      const m = await loadManifest(null);
      cache = await caches.open('kokanee-' + m.version);
      v.manifest = m;
      v.missing = m.files.map((f) => f.path);
      let n = 0;
      await pool4(m.files, async (f) => {
        try { const r = await fetchBackoff(f.path); if (r) await cache.put(f.path, r); } catch { /* offline */ }
        if (++n % 20 === 0) emit({ state: 'downloading', pct: Math.round((n / m.files.length) * 100), missing: [] });
      });
      await cache.put('asset-manifest.json', new Response(JSON.stringify(m), { headers: { 'content-type': 'application/json' } }));
      await cache.put('__complete', new Response(String(Date.now())));
    } else if (v.manifest) {
      const all = new Set(v.missing.filter((p) => !p.startsWith('decode:') && !p.startsWith('(')));
      if (v.missing.some((p) => p.startsWith('decode:'))) v.manifest.files.filter((f) => /^tiles\/.+\.png$/.test(f.path)).forEach((f) => all.add(f.path));
      let n = 0;
      await pool4([...all], async (p) => {
        try { const r = await fetchBackoff(p); if (r) await cache.put(p, r); } catch { /* offline */ }
        emit({ state: 'downloading', pct: Math.round((++n / all.size) * 100), missing: [] });
      });
    } else (await navigator.serviceWorker?.getRegistration())?.update();
  } catch (e) { console.error(e); }
  return run({ full: true });
}

export async function initOffline(uiApi) {
  ui = uiApi;
  badge = document.getElementById('offline-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'offline-badge';
    badge.setAttribute('role', 'status');
    badge.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:50;padding:4px 10px;border-radius:14px;font:12px system-ui,sans-serif;color:#fff;max-width:80vw';
    document.body.append(badge);
  }
  try {
    ui?.registerMenu?.('offline', [
      { label: 'Re-verify offline data', onClick: () => run({ full: true }) },
      { label: 'Re-download missing files', onClick: () => retry() },
    ]);
  } catch (e) { console.warn('registerMenu failed', e); }

  if (!('serviceWorker' in navigator)) { emit({ state: 'missing', missing: ['(service worker unsupported)'], persisted: false }); return; }
  navigator.serviceWorker.addEventListener('message', (ev) => {
    const d = ev.data || {};
    if (d.type === 'precache-progress') armWatchdog(), emit({ state: 'downloading', pct: Math.round((d.done / Math.max(1, d.total)) * 100), missing: [] });
    else if (d.type === 'precache-done') run({ full: true });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => run({ full: true }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run({ full: last?.state !== 'ready' }); });
  try {
    // Register sw.js?v=<manifest version> so a new deploy changes the script URL and re-installs
    // into a new cache. Offline, fall back to the cached manifest's version (matches the active SW).
    let ver = '';
    try { ver = (await (await fetch('asset-manifest.json', { cache: 'no-store' })).json()).version; }
    catch { try { ver = (await loadManifest(await findCache())).version; } catch { /* first run offline */ } }
    const reg = await navigator.serviceWorker.register('sw.js' + (ver ? '?v=' + ver : ''), { scope: './' });
    reg.addEventListener('updatefound', () => emit({ state: 'downloading', pct: 0, missing: [] }));
    if (!reg.installing && !reg.waiting) await run({ full: true });
    else { emit({ state: 'downloading', pct: 0, missing: [] }); armWatchdog(); }
    reg.update().catch(() => {});
  } catch (e) {
    console.error('SW register failed', e);
    run({ full: true });  // fall back to verifying whatever is cached; shows N missing + Retry
  }
}

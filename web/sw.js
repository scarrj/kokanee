/* Kokanee Topo service worker. Relative paths only (works under /kokanee/).
   Install pulls tiles through ~8 MB packs (packs/*.kpack, see CONTRACTS "Offline packs") and everything
   else file by file. Every request retries 429/5xx/network errors with back-off; concurrency is <= 4
   because GitHub Pages answers a burst of thousands of requests with HTTP 429. */
const PREFIX = 'kokanee-';
const MARKER = '__complete';
const CONCURRENCY = 4;
const MAX_ATTEMPTS = 10;
const BACKOFF_BASE_MS = 400;
const BACKOFF_CAP_MS = 20000;
const RETRY_AFTER_CAP_MS = 60000;
const NETWORK_FIRST = new Set(['data/routes.json', 'asset-manifest.json']);
const scopePath = new URL(self.registration.scope).pathname;

async function broadcast(msg) {
  const cs = await self.clients.matchAll({ includeUncontrolled: true });
  cs.forEach((c) => c.postMessage(msg));
}

async function sha256Hex(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- retrying fetch ---------- */
function retryAfterMs(r) {
  const h = r.headers.get('retry-after');
  if (!h) return 0;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const t = Date.parse(h);
  return Number.isNaN(t) ? 0 : Math.max(0, t - Date.now());
}

/* Runs attempt() until it succeeds. attempt throws an Error with .retryable (and optional .retryAfter ms)
   for transient failures; anything else (404 ...) is final. Network failures (TypeError) are transient. */
async function withRetry(label, attempt) {
  let last;
  for (let n = 0; n < MAX_ATTEMPTS; n++) {
    try { return await attempt(); }
    catch (err) {
      last = err;
      const transient = err && (err.retryable || err instanceof TypeError);
      if (!transient || n === MAX_ATTEMPTS - 1) break;
      const backoff = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** n) * (0.75 + Math.random() * 0.5);
      await sleep(Math.max(backoff, Math.min(RETRY_AFTER_CAP_MS, err.retryAfter || 0)));
    }
  }
  throw new Error('precache ' + label + ': ' + (last && last.message || last));
}

function httpError(label, r) {
  const e = new Error(label + ' HTTP ' + r.status);
  e.retryable = r.status === 429 || r.status >= 500;
  e.retryAfter = retryAfterMs(r);
  return e;
}

/* fetch + status check + retry. Returns an ok Response. */
function fetchRetry(path, opts) {
  return withRetry(path, async () => {
    const r = await fetch(path, opts);
    if (!r.ok) throw httpError(path, r);
    return r;
  });
}

/* Run fn(item) over items with at most `limit` in flight. Stops starting new work after a failure. */
async function pool(items, limit, fn) {
  let i = 0, failed = null;
  const worker = async () => {
    while (!failed && i < items.length) {
      const item = items[i++];
      try { await fn(item); } catch (e) { failed = failed || e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failed) throw failed;
}

/* ---------- previous cache (delta) ---------- */
/* Path -> sha256 of the newest COMPLETE older cache, via the manifest stored in that cache. */
async function previousCache(version) {
  for (const c of await completeCaches()) {
    if (c.name === PREFIX + version) continue;
    try {
      const cache = await caches.open(c.name);
      const mr = await cache.match('asset-manifest.json');
      if (!mr) continue;
      const files = (await mr.json()).files || [];
      return { cache, sha: new Map(files.map((f) => [f.path, f.sha256])) };
    } catch { /* unreadable: try the next one */ }
  }
  return null;
}

/* Copy f from the previous cache when its sha256 is unchanged. Returns true if copied. */
async function copyFromPrevious(prev, cache, f) {
  if (!prev || !f.sha256 || prev.sha.get(f.path) !== f.sha256) return false;
  const r = await prev.cache.match(f.path);
  if (!r) return false;
  // Network-first files (routes.json) can be newer than the old manifest says: hash the real bytes.
  if (NETWORK_FIRST.has(f.path)) {
    if ((await sha256Hex(await r.clone().arrayBuffer())) !== f.sha256) return false;
  }
  await cache.put(f.path, r);
  return true;
}

/* ---------- packs ---------- */
/* Download a whole pack as one Uint8Array, reporting byte progress; retried as a unit (sha256 checked). */
function fetchPack(pack, onBytes) {
  return withRetry(pack.path, async () => {
    const r = await fetch(pack.path, { cache: 'no-store' });
    if (!r.ok) throw httpError(pack.path, r);
    let buf;
    if (r.body && r.body.getReader) {
      const reader = r.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        onBytes(got / pack.bytes);
      }
      buf = new Uint8Array(got);
      let o = 0;
      for (const c of chunks) { buf.set(c, o); o += c.length; }
    } else buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length !== pack.bytes || (await sha256Hex(buf)) !== pack.sha256) {
      const e = new Error(pack.path + ' failed length/sha256 check');
      e.retryable = true;
      throw e;
    }
    return buf;
  });
}

/* Parse a .kpack: [u32 LE header length][JSON header][data]; offsets are relative to the data start. */
function parsePack(buf, pack) {
  const hlen = new DataView(buf.buffer, buf.byteOffset, 4).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + hlen)));
  const base = 4 + hlen;
  const want = new Set(pack.files);
  for (const h of header.files) {
    if (!want.has(h.path) || base + h.offset + h.bytes > buf.length) throw new Error(pack.path + ' header mismatch');
  }
  return { header: header.files, base };
}

async function precache(version, manifest) {
  const cache = await caches.open(PREFIX + version);
  const files = manifest.files;
  const byPath = new Map(files.map((f) => [f.path, f]));
  const total = files.length;
  const prev = await previousCache(version);

  // Resume: skip anything an interrupted earlier attempt already stored.
  const have = new Set();
  for (const r of await cache.keys()) {
    let p = decodeURIComponent(new URL(r.url).pathname);
    p = p.startsWith(scopePath) ? p.slice(scopePath.length) : p.replace(/^\//, '');
    have.add(p);
  }

  let done = 0, copied = 0, requests = 1;  // 1 = the manifest
  const credit = new Set();  // fractional progress of packs in flight: {n: files}
  let lastReport = 0;
  const report = async (force) => {
    const now = Date.now();
    if (!force && now - lastReport < 120) return;
    lastReport = now;
    let frac = 0;
    for (const c of credit) frac += c.n;
    await broadcast({ type: 'precache-progress', version, done: Math.min(total, Math.floor(done + frac)), total });
  };

  const packs = (manifest.packs || []).filter((p) => p.files.every((x) => byPath.has(x)));
  const packed = new Set();
  for (const p of packs) for (const x of p.files) packed.add(x);

  for (const f of files) if (have.has(f.path)) done++;
  await report(true);

  // Individual (non-pack) files: copy from the previous cache when unchanged, otherwise fetch.
  const singles = files.filter((f) => !packed.has(f.path) && !have.has(f.path));
  await pool(singles, CONCURRENCY, async (f) => {
    let ok = false;
    try { ok = await copyFromPrevious(prev, cache, f); } catch { ok = false; }
    if (ok) copied++;
    else {
      requests++;
      await cache.put(f.path, await fetchRetry(f.path, { cache: 'reload' }));
    }
    done++;
    await report(false);
  });

  // Packs: copy from the previous cache when every file matches by sha256, otherwise fetch the pack.
  const packTodo = packs.filter((p) => p.files.some((x) => !have.has(x)));
  await pool(packTodo, CONCURRENCY, async (pack) => {
    const need = pack.files.filter((x) => !have.has(x));
    const c = { n: 0 };
    credit.add(c);
    try {
      if (prev && pack.files.every((x) => prev.sha.get(x) === byPath.get(x).sha256)) {
        let ok = true, n = 0;
        for (const x of need) {
          try { ok = await copyFromPrevious(prev, cache, byPath.get(x)); } catch { ok = false; }
          if (!ok) break;
          c.n = ++n;
          await report(false);
        }
        if (ok) { copied += need.length; return; }
        c.n = 0;
      }
      requests++;
      const buf = await fetchPack(pack, (frac) => { c.n = 0.5 * need.length * frac; report(false); });
      c.n = 0.5 * need.length;
      const { header, base } = parsePack(buf, pack);
      const needSet = new Set(need);
      let k = 0;
      for (const h of header) {
        if (!needSet.has(h.path)) continue;
        const body = buf.slice(base + h.offset, base + h.offset + h.bytes);
        await cache.put(h.path, new Response(body, { status: 200, headers: { 'content-type': h.type, 'content-length': String(h.bytes) } }));
        c.n = 0.5 * need.length + 0.5 * ++k;
        if (k % 25 === 0) await report(false);
      }
    } finally {
      credit.delete(c);
      done += need.length;
      await report(true);
    }
  });

  await cache.put('asset-manifest.json', new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } }));
  await cache.put(MARKER, new Response(String(Date.now())));
  await broadcast({ type: 'precache-done', version, done, total, copied, requests });
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const r = await withRetry('asset-manifest.json', async () => {
      const x = await fetch('asset-manifest.json', { cache: 'no-store' });
      if (!x.ok) throw httpError('asset-manifest.json', x);
      return x;
    });
    const manifest = await r.json();
    await precache(manifest.version, manifest);
    await self.skipWaiting();
  })());
});

/* The newest complete cache; incomplete ones (no marker) are never current. */
async function completeCaches() {
  const out = [];
  for (const n of await caches.keys()) {
    if (!n.startsWith(PREFIX)) continue;
    const m = await (await caches.open(n)).match(MARKER);
    if (m) out.push({ name: n, ts: Number(await m.text()) || 0 });
  }
  return out.sort((a, b) => b.ts - a.ts);
}
let currentName = null;
async function current() {
  if (!currentName) currentName = (await completeCaches())[0]?.name || null;
  return currentName;
}

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    currentName = null;
    const keep = (await completeCaches())[0]?.name;
    if (keep) {
      for (const n of await caches.keys()) if (n.startsWith(PREFIX) && n !== keep) await caches.delete(n);
      currentName = keep;
    }
    await self.clients.claim();
  })());
});

function relPath(url) {
  let p = decodeURIComponent(url.pathname);
  if (p.startsWith(scopePath)) p = p.slice(scopePath.length);
  else p = p.replace(/^\//, '');
  return p === '' || p.endsWith('/') ? p + 'index.html' : p;
}

async function fromCache(path) {
  const n = await current();
  if (n) { const r = await (await caches.open(n)).match(path); if (r) return r; }
  return caches.match(path);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const path = relPath(url);
  if (NETWORK_FIRST.has(path)) {
    e.respondWith((async () => {
      try {
        const r = await fetch(req, { cache: 'no-store' });
        // asset-manifest.json is never written to a cache: each version's cache keeps its own manifest.
        if (r.ok && path !== 'asset-manifest.json') {
          const n = await current();
          if (n) (await caches.open(n)).put(path, r.clone());
        }
        return r;
      } catch (err) {
        const c = await fromCache(path);
        if (c) return c;
        throw err;
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const c = await fromCache(path);
    if (c) return c;
    return fetch(req);
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

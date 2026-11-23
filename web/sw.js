/* Kokanee Topo service worker. Relative paths only (works under /kokanee/). */
const PREFIX = 'kokanee-';
const MARKER = '__complete';
const BATCH = 20;
const NETWORK_FIRST = new Set(['data/routes.json', 'asset-manifest.json']);
const scopePath = new URL(self.registration.scope).pathname;

async function broadcast(msg) {
  const cs = await self.clients.matchAll({ includeUncontrolled: true });
  cs.forEach((c) => c.postMessage(msg));
}

async function precache(version, manifest) {
  const cache = await caches.open(PREFIX + version);
  const files = manifest.files;
  let done = 0;
  const total = files.length;
  const todo = [];
  for (const f of files) if (!(await cache.match(f.path))) todo.push(f); else done++;
  await broadcast({ type: 'precache-progress', version, done, total });
  for (let i = 0; i < todo.length; i += BATCH) {
    await Promise.all(todo.slice(i, i + BATCH).map(async (f) => {
      const r = await fetch(f.path, { cache: 'reload' });
      if (!r.ok) throw new Error('precache ' + f.path + ' ' + r.status);
      await cache.put(f.path, r);
      done++;
    }));
    await broadcast({ type: 'precache-progress', version, done, total });
  }
  await cache.put('asset-manifest.json', new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } }));
  await cache.put(MARKER, new Response(String(Date.now())));
  await broadcast({ type: 'precache-done', version, done, total });
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const r = await fetch('asset-manifest.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('manifest ' + r.status);
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
        if (r.ok) {
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

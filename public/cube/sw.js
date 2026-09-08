// sw.js: the app shell is served network first with a cached fallback, so the client opens
// offline and updates fast; images from anywhere are cached first-hit and trimmed to a few hundred,
// which is what makes scrolling back feel pre-loaded.
const V = 'cube-shell-v1', MEDIA = 'cube-media';
const SHELL = ['/cube/', '/cube/index.html', '/cube/app.js', '/cube/worker.js', '/theme.css', '/vendor/nostr-tools-2.25.2.bundle.js', '/favicon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== V && k !== MEDIA).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (!url.pathname.startsWith('/cube/') && !SHELL.includes(url.pathname)) return;
    e.respondWith(fetch(req).then(r => { if (r.ok) caches.open(V).then(c => c.put(req, r.clone())); return r; }).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  if (req.destination === 'image') {
    e.respondWith(caches.open(MEDIA).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      try { const r = await fetch(req); if (r.ok || r.type === 'opaque') { c.put(req, r.clone()); trim(c); } return r; } catch (err) { return hit || Response.error(); }
    }));
  }
});
let trimming = false;
async function trim(c) { if (trimming) return; trimming = true; try { const keys = await c.keys(); if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) await c.delete(k); } finally { trimming = false; } }

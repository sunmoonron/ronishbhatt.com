// sw.js: the shell pin. On a navigation to the page this worker fetches the
// shell from the network, hashes the exact bytes, compares them with the hash
// it pinned on this browser's first visit, and writes both verdict and hash
// into two meta tags for the page to judge against the manifest the site key
// signed. It never blocks: any failure hands the network response through as
// it is. Nothing else on the origin is touched.
const SHELLS = new Set(['/', '/index.html', '/strict.html']);
const CACHE = 'rb-shell-pin';
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('message', e => { if (e.data && typeof e.data.pin === 'string' && /^[0-9a-f]{64}$/.test(e.data.pin)) e.waitUntil(caches.open(CACHE).then(c => c.put('/pin', new Response(e.data.pin)))); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.mode !== 'navigate' || u.origin !== self.location.origin || !SHELLS.has(u.pathname)) return;
  e.respondWith((async () => {
    const net = await fetch(e.request.url, { cache: 'no-store', credentials: 'same-origin' });
    try {
      if (!(net.headers.get('content-type') || '').includes('text/html')) return net;
      const bytes = await net.clone().arrayBuffer(), h = hex(await crypto.subtle.digest('SHA-256', bytes));
      const c = await caches.open(CACHE), pinned = await (await c.match('/pin'))?.text();
      let state = 'same'; if (!pinned) { state = 'pinned-now'; await c.put('/pin', new Response(h)); } else if (pinned !== h) state = 'changed';
      const html = new TextDecoder().decode(bytes).replace('<head>', `<head><meta name="shell-sha256" content="${h}"><meta name="shell-pin" content="${state}${state === 'changed' ? ':' + pinned : ''}">`);
      const headers = new Headers(net.headers); headers.delete('content-length'); headers.delete('content-encoding');
      return new Response(html, { status: net.status, statusText: net.statusText, headers });
    } catch { return net; }
  })());
});

// strict.js: the strict entry. The shell it arrived in carried no content:
// the site key, the relay list, the icon and this script, all under integrity
// hashes, and nothing else. Everything visible is fetched from the relays as
// signed events, verified in this browser, unveiled with the icon's key, and
// rendered as it arrives. The relays are asked here, before the crypto has
// loaded, so the handshake overlaps the download; what they send is buffered
// and verified the moment nostr-tools lands. The wild terminal narrates it.
import { progress, LOG } from './store.js';
const meta = n => document.querySelector(`meta[name="${n}"]`)?.content?.trim() || '';
const SITE = meta('site-pubkey'), RELAYS = [meta('site-relay'), ...meta('site-backups').split(',').map(s => s.trim()).filter(Boolean)];
const wild = /[?&]wild/.test(location.search) || (localStorage.getItem('rb.wild') !== '0' && !/[?&]calm/.test(location.search));
progress('shell', { bytes: document.documentElement.outerHTML.length, scripts: document.querySelectorAll('script[src]').length });
const pre = { events: new Map(), sockets: [], onEvent: null, done: false };
for (const url of RELAYS) {
  let ws; try { ws = new WebSocket(url); } catch { continue; }
  pre.sockets.push(ws);
  ws.onopen = () => { progress('relay', { url, open: true, early: true }); ws.send(JSON.stringify(['REQ', 'strict', { authors: [SITE], kinds: [1, 5, 30078], limit: 300 }])); };
  ws.onerror = ws.onclose = () => { if (!ws.closing) progress('relay', { url, open: false, early: true }); };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m[0] === 'EVENT' && m[2]?.pubkey === SITE) { const ev = m[2]; if (pre.events.has(ev.id)) return; pre.events.set(ev.id, ev);
      if (pre.onEvent) pre.onEvent(ev, url); else progress('raw', { id: ev.id, kind: ev.kind, bytes: ev.content.length, url }); }
    if (m[0] === 'EOSE') { progress('eose-raw', { url, n: pre.events.size }); setTimeout(() => { ws.closing = true; try { ws.close(); } catch {} }, 2500); } }; // the pool's own socket has taken over by then
  setTimeout(() => { if (ws.readyState !== 1) { ws.closing = true; try { ws.close(); } catch {} } }, 12000); // never leave a half-open early socket behind
}
window.__strict = { log: LOG, pre, marks: () => performance.getEntriesByType('mark').filter(m => m.name.startsWith('rb:')).map(m => [m.name.slice(3), Math.round(m.startTime)]) };
if (wild) import('./wild.js').then(m => m.start({ live: true })).catch(e => console.error('wild failed', e));
document.addEventListener('click', e => { if (e.target.closest?.('#wildpill')) { localStorage.setItem('rb.wild', wild ? '0' : '1'); location.href = location.pathname; } });
import('./app.js').then(m => m.start({ strict: true, prefetch: pre })).catch(e => { console.error('strict boot failed', e); progress('error', { message: e.message }); });

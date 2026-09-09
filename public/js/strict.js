// strict.js: the strict entry. The shell it arrived in carried no content:
// the site key, the relay list, the icon and this script, all under integrity
// hashes, and nothing else. Everything visible is fetched from the relays as
// signed events, verified in this browser, unveiled with the icon's key, and
// rendered as it arrives. The relays are asked here, before the crypto has
// loaded, so the handshake overlaps the download; what they send is buffered
// and verified the moment nostr-tools lands. A service worker pins the shell's
// bytes after the first visit and the page checks them against the list the
// site key signed. The wild terminal narrates all of it.
import { progress, LOG, sel, onChange, store, env, meta as blockMeta } from './store.js';
const meta = n => document.querySelector(`meta[name="${n}"]`)?.content?.trim() || '';
const SITE = meta('site-pubkey'), RELAYS = [meta('site-relay'), ...meta('site-backups').split(',').map(s => s.trim()).filter(Boolean)];
const wild = /[?&]wild/.test(location.search) || (localStorage.getItem('rb.wild') !== '0' && !/[?&]calm/.test(location.search));
progress('shell', { bytes: document.documentElement.outerHTML.length, scripts: document.querySelectorAll('script[src]').length });

// ---- the shell's own bytes: the worker hashed what it served and left the verdict in two meta tags ----
const shellHash = meta('shell-sha256'), [pinState, pinnedHash] = (meta('shell-pin') || 'uncontrolled').split(':');
progress('shell-pin', { hash: shellHash, state: shellHash ? pinState : 'uncontrolled', pinned: pinnedHash });
if ('serviceWorker' in navigator) {
  if (meta('sw') === 'off') navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {}); // kill switch: a shell that says so retires the worker
  else navigator.serviceWorker.register('/sw.js').then(r => { if (r.installing) progress('sw', { on: true }); }, e => progress('sw', { on: false, why: e.message })); // one line on the visit that installs it; later visits get the pin line instead
}
// the manifest is a block like any other: {slug:'shell', shells:[sha256...]} signed by the site key; once it is in the store, judge this shell by it
let judged = false;
const judge = () => { if (judged || !env.NT) return; let m = null; try { m = sel.section('shell'); } catch { return; }
  if (m) { judged = true; const list = blockMeta(m)?.shells || [], ok = !!shellHash && list.includes(shellHash);
    progress(ok ? 'shell-signed' : 'shell-unsigned', { hash: shellHash, pinned: pinnedHash, state: pinState, none: false });
    if (ok && pinState === 'changed') navigator.serviceWorker?.controller?.postMessage({ pin: shellHash }); }
  else if (store.ready) { judged = true; progress('shell-unsigned', { hash: shellHash, pinned: pinnedHash, state: shellHash ? pinState : 'uncontrolled', none: true }); } };
onChange(judge);

// ---- ask the relays now, before the crypto exists; buffer until it does ----
const pre = { events: new Map(), sockets: [], onEvent: null, maxAt: 0 };
pre.primaryEose = new Promise(res => { pre.resolvePrimary = res; }); // resolves with the newest created_at once my relay says EOSE, or null if it never does
for (const url of RELAYS) {
  let ws; try { ws = new WebSocket(url); } catch { continue; }
  pre.sockets.push(ws);
  ws.onopen = () => { progress('relay', { url, open: true, early: true }); ws.send(JSON.stringify(['REQ', 'strict', { authors: [SITE], kinds: [1, 5, 30078], limit: 300 }])); };
  ws.onerror = ws.onclose = () => { if (!ws.closing) progress('relay', { url, open: false, early: true }); if (url === RELAYS[0]) pre.resolvePrimary(null); };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m[0] === 'EVENT' && m[2]?.pubkey === SITE) { const ev = m[2]; if (pre.events.has(ev.id)) return; pre.events.set(ev.id, ev); if (ev.created_at > pre.maxAt) pre.maxAt = ev.created_at;
      if (pre.onEvent) pre.onEvent(ev, url); else progress('raw', { id: ev.id, kind: ev.kind, bytes: ev.content.length, url }); }
    if (m[0] === 'EOSE') { progress('eose-raw', { url, n: pre.events.size }); if (url === RELAYS[0]) pre.resolvePrimary(pre.maxAt); setTimeout(() => { ws.closing = true; try { ws.close(); } catch {} }, 2500); } }; // the pool's own socket has taken over by then
  setTimeout(() => { if (ws.readyState !== 1) { ws.closing = true; try { ws.close(); } catch {} } }, 12000); // never leave a half-open early socket behind
}
window.__strict = { log: LOG, pre, store, marks: () => performance.getEntriesByType('mark').filter(m => m.name.startsWith('rb:')).map(m => [m.name.slice(3), Math.round(m.startTime)]) };
if (wild) import('./wild.js').then(m => m.start({ live: true })).catch(e => console.error('wild failed', e));
document.addEventListener('click', e => { if (e.target.closest?.('#wildpill')) { localStorage.setItem('rb.wild', wild ? '0' : '1'); location.href = location.pathname; } });
import('./app.js').then(m => m.start({ strict: true, prefetch: pre })).catch(e => { console.error('strict boot failed', e); progress('error', { message: e.message }); });

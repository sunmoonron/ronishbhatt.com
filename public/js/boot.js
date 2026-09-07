// boot.js: the only script a visitor runs. No imports, no libraries.
// The page arrived pre-rendered; this asks the relays whether anything is
// newer than what was baked, lights the relay dots, and wires the chat, the
// unlock link and the paper previews. Each of those hands off to the full
// app (/js/app.js and the libraries) the first time it is actually used.
const meta = n => document.querySelector(`meta[name="${n}"]`)?.content?.trim() || '';
const SITE = meta('site-pubkey'), RELAYS = [meta('site-relay'), ...meta('site-backups').split(',').map(s => s.trim()).filter(Boolean)];
let snap = { baked_at: 0, ids: [] }; try { snap = JSON.parse(document.getElementById('snapshot').textContent); } catch {}
const known = new Set(snap.ids);
const $ = s => document.querySelector(s);

let upgrading = null;
const upgrade = opts => upgrading ||= import('./app.js').then(m => { for (const ws of sockets) try { ws.close(); } catch {} return m.start(opts); })
  .catch(e => { console.error('upgrade failed', e); upgrading = null; });

// ---- relays: raw WebSockets are enough to ask a Nostr relay a question ----
const sockets = [];
let seen = 0, closed = 0;
const say = t => { const el = $('footer .status span:last-child'); if (el) el.textContent = t; };
for (const url of RELAYS) {
  let ws; try { ws = new WebSocket(url); } catch { continue; }
  sockets.push(ws);
  const dot = document.querySelector(`[data-relay="${url}"] .dot`);
  ws.onopen = () => { dot?.classList.add('open'); dot?.classList.remove('err');
    ws.send(JSON.stringify(['REQ', 'boot', { authors: [SITE], kinds: [1, 5, 30078], limit: 300 }])); };
  ws.onerror = ws.onclose = () => { dot?.classList.remove('open'); dot?.classList.add('err'); if (++closed === sockets.length && !upgrading) say(`${known.size} signed events, relays unreachable`); };
  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m[0] === 'EVENT' && m[2]?.pubkey === SITE) {
      if (known.has(m[2].id)) { if (url === RELAYS[0]) seen++; }
      else upgrade({ reason: 'relay has something newer' }); // the full app verifies before it renders anything
    }
    if (m[0] === 'EOSE' && url === RELAYS[0] && !upgrading) say(seen === known.size && known.size ? `${known.size} signed events, all found on ${url.replace(/^wss?:\/\//, '')}` : `${known.size} signed events`);
  };
}

// ---- hand-offs ----
const chat = $('#chat');
const returning = localStorage.getItem('rb.visitor.nsec') || localStorage.getItem('bottlechat_visitor_nsec') || localStorage.getItem('dash.nsec') || sessionStorage.getItem('dash.nsec');
if (returning) upgrade({ reason: 'returning' });
for (const ev of ['focusin', 'pointerdown', 'keydown']) chat?.addEventListener(ev, () => upgrade({ focus: 'chat' }), { once: true });
chat?.querySelector('form')?.addEventListener('submit', e => { e.preventDefault(); upgrade({ focus: 'chat', send: true }); });
chat?.querySelector('.keys')?.addEventListener('click', e => { if (e.target.tagName === 'BUTTON') upgrade({ focus: 'chat' }); });
for (const b of document.querySelectorAll('.pills button.lnk, footer button.lnk')) b.addEventListener('click', () => upgrade({ unlock: true }));
// wild mode is the default; "calm" is a per-browser preference (rb.wild=0) or ?calm for one load
const wild = /[?&]wild/.test(location.search) || (localStorage.getItem('rb.wild') !== '0' && !/[?&]calm/.test(location.search));
document.addEventListener('click', e => { if (e.target.closest?.('#wildpill')) { localStorage.setItem('rb.wild', wild ? '0' : '1'); location.href = location.pathname; } }); // delegated: survives the app re-rendering the header
if (wild) import('./wild.js').then(m => m.start()).catch(e => console.error('wild failed', e));
for (const ev of ['focusin', 'pointerdown']) $('#garden')?.addEventListener(ev, () => upgrade({ reason: 'garden' }), { once: true });

// papers: the thumbnail opens the PDF right there; without this script it is a plain link
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-preview]'); if (!a) return;
  e.preventDefault();
  const host = a.closest('li')?.querySelector('.b') || a.parentElement, old = host.querySelector('iframe.preview');
  if (old) { old.remove(); return; }
  const f = document.createElement('iframe'); f.className = 'preview'; f.src = a.href; f.title = a.getAttribute('aria-label') || 'preview'; host.append(f);
});

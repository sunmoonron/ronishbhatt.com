// worker.js: the part of the client that never touches the screen. It owns the relay sockets,
// checks every signature before the page sees an event, keeps an IndexedDB copy so the next open
// paints from disk before the first socket answers, and hands the page batches instead of drips.
self.window = self; importScripts('/vendor/nostr-tools-2.25.2.bundle.js');
const NT = self.NostrTools;
const post = m => self.postMessage(m);
let db = null, relays = [], profileRelays = [];
const sockets = new Map(); // url -> { ws, open, tries }
const subs = new Map();    // id -> { filters, live, relays, timer }
const seen = new Set();    // ids already delivered (bounded)
let batch = new Map(), flushTimer = 0, writes = 0;

// ---- store ----------------------------------------------------------------------------------------
function openDB() { return new Promise(res => { let r; try { r = indexedDB.open('cube', 1); } catch { return res(null); } r.onupgradeneeded = () => { const d = r.result; const ev = d.createObjectStore('events', { keyPath: 'id' }); ev.createIndex('t', 'created_at'); ev.createIndex('pk', 'pubkey'); d.createObjectStore('profiles', { keyPath: 'pubkey' }); }; r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null); }); }
const tx = (store, mode, fn) => new Promise(res => { if (!db) return res(null); let t; try { t = db.transaction(store, mode); } catch { return res(null); } const out = fn(t.objectStore(store)); t.oncomplete = () => res(out?.result ?? out); t.onerror = () => res(null); t.onabort = () => res(null); });
function putEvent(ev) { if (!db) return; tx('events', 'readwrite', s => s.put(ev)); if (++writes % 400 === 0) evict(); }
function putProfile(p) { if (db) tx('profiles', 'readwrite', s => s.put(p)); }
function latest(limit) { return new Promise(res => { if (!db) return res([]); const out = []; let req; try { req = db.transaction('events').objectStore('events').index('t').openCursor(null, 'prev'); } catch { return res([]); } req.onsuccess = () => { const c = req.result; if (!c || out.length >= limit) return res(out); if (c.value.kind === 1 || c.value.kind === 6) out.push(c.value); c.continue(); }; req.onerror = () => res(out); }); }
function allProfiles() { return new Promise(res => { if (!db) return res([]); const req = db.transaction('profiles').objectStore('profiles').getAll(); req.onsuccess = () => res(req.result || []); req.onerror = () => res([]); }); }
function getEvents(ids) { return Promise.all(ids.map(id => new Promise(res => { if (!db) return res(null); const req = db.transaction('events').objectStore('events').get(id); req.onsuccess = () => res(req.result || null); req.onerror = () => res(null); }))); }
function getProfiles(pks) { return Promise.all(pks.map(pk => new Promise(res => { if (!db) return res(null); const req = db.transaction('profiles').objectStore('profiles').get(pk); req.onsuccess = () => res(req.result || null); req.onerror = () => res(null); }))); }
async function evict() { if (!db) return; const n = await new Promise(res => { const r = db.transaction('events').objectStore('events').count(); r.onsuccess = () => res(r.result); r.onerror = () => res(0); }); if (n <= 6000) return; let drop = n - 5000; const t = db.transaction('events', 'readwrite'); const req = t.objectStore('events').index('t').openCursor(); req.onsuccess = () => { const c = req.result; if (!c || drop-- <= 0) return; c.delete(); c.continue(); }; }

// ---- sockets --------------------------------------------------------------------------------------
function connect(url) {
  if (sockets.has(url) && sockets.get(url).ws && sockets.get(url).ws.readyState < 2) return;
  const s = sockets.get(url) || { ws: null, open: false, tries: 0 }; sockets.set(url, s);
  let ws; try { ws = new WebSocket(url); } catch { return retry(url); } s.ws = ws;
  ws.onopen = () => { s.open = true; s.tries = 0; post({ type: 'relay', url, open: true }); for (const [id, sub] of subs) if (wants(sub, url)) ws.send(JSON.stringify(['REQ', id, ...sub.filters])); };
  ws.onclose = () => { s.open = false; post({ type: 'relay', url, open: false }); retry(url); };
  ws.onerror = () => { try { ws.close(); } catch {} };
  ws.onmessage = ({ data }) => { let m; try { m = JSON.parse(data); } catch { return; } if (!Array.isArray(m)) return;
    if (m[0] === 'EVENT' && subs.has(m[1])) onEvent(m[2], m[1], url);
    else if (m[0] === 'EOSE') post({ type: 'eose', sub: m[1], url });
    else if (m[0] === 'OK') post({ type: 'ok', id: m[1], ok: !!m[2], msg: m[3] || '', url });
    else if (m[0] === 'CLOSED') post({ type: 'closed', sub: m[1], msg: m[2] || '', url }); };
}
function retry(url) { const s = sockets.get(url); if (!s || s.gone) return; s.tries++; setTimeout(() => connect(url), Math.min(30000, 1500 * 2 ** Math.min(s.tries, 4)) + Math.random() * 800); }
const wants = (sub, url) => !sub.relays || sub.relays.includes(url);
function ensure(urls) { for (const u of urls) if (!sockets.has(u)) connect(u); }

// ---- events: verify, store, batch to the page ----------------------------------------------------
function onEvent(ev, sub, url) {
  if (!ev || typeof ev.id !== 'string' || typeof ev.sig !== 'string' || !Number.isInteger(ev.created_at)) return;
  const key = ev.id + ':' + sub; if (seen.has(key)) return;
  let ok = false; try { ok = NT.verifyEvent(ev); } catch { ok = false; } if (!ok) return;
  seen.add(key); if (seen.size > 40000) { let n = 0; for (const k of seen) { seen.delete(k); if (++n > 10000) break; } }
  if (ev.kind === 0) { const p = parseProfile(ev); if (p) { putProfile(p); post({ type: 'profile', profile: p }); } return; }
  if (ev.kind === 1 || ev.kind === 6 || ev.kind === 3) putEvent(ev);
  let b = batch.get(sub); if (!b) batch.set(sub, b = []); b.push(ev);
  if (!flushTimer) flushTimer = setTimeout(flush, 60);
}
function flush() { flushTimer = 0; for (const [sub, events] of batch) post({ type: 'events', sub, events }); batch = new Map(); }
function parseProfile(ev) { try { const c = JSON.parse(ev.content || '{}'); return { pubkey: ev.pubkey, t: ev.created_at, name: String(c.display_name || c.name || c.username || '').slice(0, 60), pic: /^https?:\/\//.test(c.picture || '') ? c.picture : '', about: String(c.about || '').slice(0, 500), nip05: String(c.nip05 || '').slice(0, 80), lud16: String(c.lud16 || '').slice(0, 80) }; } catch { return null; } }

// ---- requests from the page ---------------------------------------------------------------------
const pending = new Map(); // short-lived subs: id -> timer
self.onmessage = async ({ data: m }) => {
  if (m.type === 'start') { relays = m.relays; profileRelays = m.profileRelays || []; db = db || await openDB(); ensure(relays); const [events, profiles] = await Promise.all([latest(400), allProfiles()]); post({ type: 'cached', events, profiles }); return; }
  if (m.type === 'sub') { if (subs.has(m.id)) closeSub(m.id); const sub = { filters: m.filters, live: !!m.live, relays: m.relays || null }; subs.set(m.id, sub); if (sub.relays) ensure(sub.relays); for (const [url, s] of sockets) if (s.open && wants(sub, url)) s.ws.send(JSON.stringify(['REQ', m.id, ...m.filters])); if (!sub.live) sub.timer = setTimeout(() => closeSub(m.id), m.timeout || 15000); return; }
  if (m.type === 'unsub') { closeSub(m.id); return; }
  if (m.type === 'publish') { let n = 0; for (const [, s] of sockets) if (s.open) { s.ws.send(JSON.stringify(['EVENT', m.event])); n++; } if (m.event.kind === 1 || m.event.kind === 6 || m.event.kind === 3) putEvent(m.event); post({ type: 'sent', id: m.event.id, relays: n }); return; }
  if (m.type === 'profiles') { const have = await getProfiles(m.pks); const missing = []; have.forEach((p, i) => { if (p) post({ type: 'profile', profile: p }); else missing.push(m.pks[i]); }); if (missing.length) { const id = 'p' + Math.random().toString(36).slice(2, 8); const sub = { filters: [{ kinds: [0], authors: missing.slice(0, 300) }], live: false, relays: [...new Set([...profileRelays, ...relays])] }; subs.set(id, sub); ensure(sub.relays); for (const [url, s] of sockets) if (s.open && wants(sub, url)) s.ws.send(JSON.stringify(['REQ', id, ...sub.filters])); sub.timer = setTimeout(() => closeSub(id), 10000); } return; }
  if (m.type === 'get') { const have = await getEvents(m.ids); const missing = []; have.forEach((e, i) => { if (e) post({ type: 'events', sub: 'get', events: [e] }); else missing.push(m.ids[i]); }); if (missing.length) { const id = 'g' + Math.random().toString(36).slice(2, 8); const sub = { filters: [{ ids: missing.slice(0, 100) }], live: false, relays: null }; subs.set(id, sub); for (const [url, s] of sockets) if (s.open) s.ws.send(JSON.stringify(['REQ', id, ...sub.filters])); sub.timer = setTimeout(() => closeSub(id), 10000); } return; }
  if (m.type === 'relays') { relays = m.relays; for (const [url, s] of sockets) if (!relays.includes(url) && !profileRelays.includes(url)) { s.gone = true; try { s.ws.close(); } catch {} sockets.delete(url); } ensure(relays); return; }
  if (m.type === 'wipe') { for (const [, s] of sockets) { s.gone = true; try { s.ws.close(); } catch {} } sockets.clear(); subs.clear(); if (db) { db.close(); db = null; } await new Promise(res => { const r = indexedDB.deleteDatabase('cube'); r.onsuccess = r.onerror = r.onblocked = () => res(); }); post({ type: 'wiped' }); return; }
};
function closeSub(id) { const sub = subs.get(id); if (!sub) return; clearTimeout(sub.timer); subs.delete(id); for (const [url, s] of sockets) if (s.open && wants(sub, url)) { try { s.ws.send(JSON.stringify(['CLOSE', id])); } catch {} } }

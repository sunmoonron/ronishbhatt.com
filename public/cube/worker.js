// worker.js: the part of the client that never touches the screen. It owns the relay sockets,
// checks every signature before the page sees an event, keeps an IndexedDB copy so the next open
// paints from disk, and hands the page batches instead of drips.
//
// v3 speaks the outbox model (NIP-65): it fetches people's relay lists, reads each author from the
// relays they write to, publishes to your write relays plus the read relays of whoever you address,
// and remembers which relay every event was first seen on. A socket budget keeps it polite.
self.window = self; importScripts('/vendor/nostr-tools-2.25.2.bundle.js');
const NT = self.NostrTools;
const post = m => self.postMessage(m);
const INDEXERS = ['wss://purplepag.es', 'wss://relay.nostr.band', 'wss://relay.damus.io'];
const MAX_SOCKETS = 16, PER_AUTHOR = 2;
let db = null, relays = [], me = null;
const sockets = new Map();    // url -> { ws, open, tries, last, down }
const subs = new Map();       // id -> { filters, live, relays, perRelay, timer, outbox }
const seen = new Set();       // id:sub already delivered (bounded)
const seenOn = new Map();     // id -> [urls] (bounded)
const relayLists = new Map(); // pubkey -> { read, write, t }
const wantLists = new Set(); let listTimer = 0;
let batch = new Map(), flushTimer = 0, writes = 0;
const norm = u => { try { const x = new URL(String(u).trim()); if (x.protocol !== 'wss:' && x.protocol !== 'ws:') return null; if (/localhost|127\.0\.0\.1|\.onion$/.test(x.hostname)) return null; return (x.protocol + '//' + x.host + x.pathname).replace(/\/$/, ''); } catch { return null; } };

// ---- store --------------------------------------------------------------------------------------------
function openDB() { return new Promise(res => { let r; try { r = indexedDB.open('cube', 2); } catch { return res(null); } r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('events')) { const ev = d.createObjectStore('events', { keyPath: 'id' }); ev.createIndex('t', 'created_at'); ev.createIndex('pk', 'pubkey'); } if (!d.objectStoreNames.contains('profiles')) d.createObjectStore('profiles', { keyPath: 'pubkey' }); if (!d.objectStoreNames.contains('relaylists')) d.createObjectStore('relaylists', { keyPath: 'pubkey' }); }; r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null); }); }
const tx = (store, mode, fn) => new Promise(res => { if (!db) return res(null); let t; try { t = db.transaction(store, mode); } catch { return res(null); } const out = fn(t.objectStore(store)); t.oncomplete = () => res(out?.result ?? out); t.onerror = () => res(null); t.onabort = () => res(null); });
function putEvent(ev) { if (!db) return; const { seenOn: _s, ...clean } = ev; tx('events', 'readwrite', s => s.put(clean)); if (++writes % 400 === 0) evict(); }
function putProfile(p) { if (db) tx('profiles', 'readwrite', s => s.put(p)); }
function putRelayList(l) { if (db) tx('relaylists', 'readwrite', s => s.put(l)); }
function getAll(store) { return new Promise(res => { if (!db) return res([]); try { const req = db.transaction(store).objectStore(store).getAll(); req.onsuccess = () => res(req.result || []); req.onerror = () => res([]); } catch { res([]); } }); }
function latest(limit) { return new Promise(res => { if (!db) return res([]); const out = []; let req; try { req = db.transaction('events').objectStore('events').index('t').openCursor(null, 'prev'); } catch { return res([]); } req.onsuccess = () => { const c = req.result; if (!c || out.length >= limit) return res(out); if (c.value.kind === 1 || c.value.kind === 6) out.push(c.value); c.continue(); }; req.onerror = () => res(out); }); }
function getEvents(ids) { return Promise.all(ids.map(id => new Promise(res => { if (!db) return res(null); const req = db.transaction('events').objectStore('events').get(id); req.onsuccess = () => res(req.result || null); req.onerror = () => res(null); }))); }
function getProfiles(pks) { return Promise.all(pks.map(pk => new Promise(res => { if (!db) return res(null); const req = db.transaction('profiles').objectStore('profiles').get(pk); req.onsuccess = () => res(req.result || null); req.onerror = () => res(null); }))); }
async function evict() { if (!db) return; const n = await new Promise(res => { const r = db.transaction('events').objectStore('events').count(); r.onsuccess = () => res(r.result); r.onerror = () => res(0); }); if (n <= 6000) return; let drop = n - 5000; const t = db.transaction('events', 'readwrite'); const req = t.objectStore('events').index('t').openCursor(); req.onsuccess = () => { const c = req.result; if (!c || drop-- <= 0) return; c.delete(); c.continue(); }; }

// ---- sockets, with a budget ---------------------------------------------------------------------------
function connect(url) {
  const s = sockets.get(url) || { ws: null, open: false, tries: 0, last: Date.now(), down: 0 }; sockets.set(url, s);
  if (s.ws && s.ws.readyState < 2) return; if (s.down > Date.now()) return;
  let ws; try { ws = new WebSocket(url); } catch { return retry(url); } s.ws = ws;
  ws.onopen = () => { s.open = true; s.tries = 0; s.last = Date.now(); post({ type: 'relay', url, open: true }); for (const [id, sub] of subs) { const f = filtersFor(sub, url); if (f) ws.send(JSON.stringify(['REQ', id, ...f])); } };
  ws.onclose = () => { s.open = false; post({ type: 'relay', url, open: false }); retry(url); };
  ws.onerror = () => { try { ws.close(); } catch {} };
  ws.onmessage = ({ data }) => { let m; try { m = JSON.parse(data); } catch { return; } if (!Array.isArray(m)) return; s.last = Date.now();
    if (m[0] === 'EVENT' && subs.has(m[1])) onEvent(m[2], m[1], url);
    else if (m[0] === 'EOSE') post({ type: 'eose', sub: m[1], url });
    else if (m[0] === 'OK') post({ type: 'ok', id: m[1], ok: !!m[2], msg: m[3] || '', url });
    else if (m[0] === 'CLOSED') post({ type: 'closed', sub: m[1], msg: m[2] || '', url }); };
}
function retry(url) { const s = sockets.get(url); if (!s || s.gone) return; s.tries++; if (s.tries > 4) { s.down = Date.now() + 10 * 60000; return; } setTimeout(() => connect(url), Math.min(30000, 1500 * 2 ** Math.min(s.tries, 4)) + Math.random() * 800); }
function ensure(urls) { for (const u of urls) { if (!sockets.has(u)) { budget(); connect(u); } else connect(u); } }
function budget() { if (sockets.size < MAX_SOCKETS) return; const inUse = new Set(); for (const sub of subs.values()) { if (sub.relays) sub.relays.forEach(u => inUse.add(u)); if (sub.perRelay) for (const u of sub.perRelay.keys()) inUse.add(u); } const idle = [...sockets.entries()].filter(([u]) => !relays.includes(u) && !inUse.has(u)).sort((a, b) => a[1].last - b[1].last); for (const [u, s] of idle.slice(0, 3)) { s.gone = true; try { s.ws?.close(); } catch {} sockets.delete(u); } }
function filtersFor(sub, url) { if (sub.perRelay) return sub.perRelay.get(url) || (sub.relays && sub.relays.includes(url) ? sub.filters : null); if (sub.relays) return sub.relays.includes(url) ? sub.filters : null; return relays.includes(url) ? sub.filters : null; }

// ---- outbox: who writes where ------------------------------------------------------------------------------
function parseList(ev) { const read = [], write = []; for (const t of ev.tags) { if (t[0] !== 'r') continue; const u = norm(t[1]); if (!u) continue; const m = t[2]; if (!m || m === 'read') read.push(u); if (!m || m === 'write') write.push(u); } return { pubkey: ev.pubkey, t: ev.created_at, read: read.slice(0, 8), write: write.slice(0, 8) }; }
function needRelayLists(pks) { for (const pk of pks) if (!relayLists.has(pk) && !wantLists.has(pk)) wantLists.add(pk); if (wantLists.size && !listTimer) listTimer = setTimeout(fetchLists, 120); }
function fetchLists() { listTimer = 0; const pks = [...wantLists].slice(0, 300); wantLists.clear(); if (!pks.length) return; for (const pk of pks) relayLists.set(pk, relayLists.get(pk) || null); const id = 'rl' + Math.random().toString(36).slice(2, 8); const sub = { filters: [{ kinds: [10002], authors: pks }], live: false, relays: INDEXERS }; subs.set(id, sub); ensure(INDEXERS); for (const [url, s] of sockets) if (s.open && INDEXERS.includes(url)) s.ws.send(JSON.stringify(['REQ', id, ...sub.filters])); sub.timer = setTimeout(() => { closeSub(id); reroute(); }, 8000); }
// split an authors filter across the relays those authors write to, greedy set cover under the budget
function route(sub) {
  const byRelay = new Map(); const uncovered = new Set();
  for (const f of sub.filters) { if (!f.authors) continue; for (const pk of f.authors) { const l = relayLists.get(pk); const w = (l?.write || []).filter(u => !(sockets.get(u)?.down > Date.now())).slice(0, PER_AUTHOR); if (!w.length) { uncovered.add(pk); continue; } for (const u of w) { if (!byRelay.has(u)) byRelay.set(u, new Set()); byRelay.get(u).add(pk); } } }
  const chosen = new Map(); const covered = new Set(); const cands = [...byRelay.entries()].sort((a, b) => b[1].size - a[1].size);
  for (const [u, pks] of cands) { if (chosen.size >= 10) break; const fresh = [...pks].filter(pk => !covered.has(pk)); if (!fresh.length) continue; chosen.set(u, new Set(pks)); pks.forEach(pk => covered.add(pk)); }
  for (const f of sub.filters) if (f.authors) for (const pk of f.authors) if (!covered.has(pk)) uncovered.add(pk);
  const perRelay = new Map();
  const narrow = (pks) => sub.filters.map(f => f.authors ? { ...f, authors: f.authors.filter(pk => pks.has(pk)) } : f).filter(f => !f.authors || f.authors.length);
  for (const [u, pks] of chosen) perRelay.set(u, narrow(pks));
  if (uncovered.size || !chosen.size) for (const u of relays) perRelay.set(u, narrow(uncovered.size ? uncovered : new Set(sub.filters.flatMap(f => f.authors || []))));
  sub.perRelay = perRelay; ensure([...perRelay.keys()]);
}
function reroute() { for (const [id, sub] of subs) { if (!sub.outbox || !sub.live) continue; const before = sub.perRelay ? [...sub.perRelay.keys()].join() : ''; route(sub); if ([...sub.perRelay.keys()].join() === before) continue; for (const [url, s] of sockets) if (s.open) { const f = filtersFor(sub, url); if (f) s.ws.send(JSON.stringify(['REQ', id, ...f])); else s.ws.send(JSON.stringify(['CLOSE', id])); } } }

// ---- events: verify, remember where it came from, store, batch ---------------------------------------------
function onEvent(ev, sub, url) {
  if (!ev || typeof ev.id !== 'string' || typeof ev.sig !== 'string' || !Number.isInteger(ev.created_at)) return;
  let on = seenOn.get(ev.id); if (!on) { if (seenOn.size > 20000) seenOn.clear(); seenOn.set(ev.id, on = []); } if (!on.includes(url) && on.length < 4) { on.push(url); if (on.length > 1) post({ type: 'seen', id: ev.id, url }); }
  const key = ev.id + ':' + sub; if (seen.has(key)) return;
  let ok = false; try { ok = NT.verifyEvent(ev); } catch { ok = false; } if (!ok) return;
  seen.add(key); if (seen.size > 40000) { let n = 0; for (const k of seen) { seen.delete(k); if (++n > 10000) break; } }
  if (ev.kind === 0) { const p = parseProfile(ev); if (p) { putProfile(p); post({ type: 'profile', profile: p }); } return; }
  if (ev.kind === 10002) { const l = parseList(ev); const old = relayLists.get(ev.pubkey); if (!old || old.t < l.t) { relayLists.set(ev.pubkey, l); putRelayList(l); post({ type: 'relaylist', list: l }); } return; }
  if (ev.kind === 1 || ev.kind === 6 || ev.kind === 3) putEvent(ev);
  ev.seenOn = on.slice(); let b = batch.get(sub); if (!b) batch.set(sub, b = []); b.push(ev);
  if (!flushTimer) flushTimer = setTimeout(flush, 60);
}
function flush() { flushTimer = 0; for (const [sub, events] of batch) post({ type: 'events', sub, events }); batch = new Map(); }
function parseProfile(ev) { try { const c = JSON.parse(ev.content || '{}'); return { pubkey: ev.pubkey, t: ev.created_at, name: String(c.display_name || c.name || c.username || '').slice(0, 60), pic: /^https?:\/\//.test(c.picture || '') ? c.picture : '', about: String(c.about || '').slice(0, 500), nip05: String(c.nip05 || '').slice(0, 80), lud16: String(c.lud16 || '').slice(0, 80) }; } catch { return null; } }

// ---- requests from the page ---------------------------------------------------------------------------------
self.onmessage = async ({ data: m }) => {
  if (m.type === 'start') { relays = (m.relays || []).map(norm).filter(Boolean); me = m.me || null; db = db || await openDB(); for (const l of await getAll('relaylists')) relayLists.set(l.pubkey, l); ensure(relays); if (me) needRelayLists([me]); const [events, profiles] = await Promise.all([latest(400), getAll('profiles')]); post({ type: 'cached', events, profiles }); return; }
  if (m.type === 'sub') { if (subs.has(m.id)) closeSub(m.id); const sub = { filters: m.filters, live: !!m.live, relays: m.relays ? m.relays.map(norm).filter(Boolean) : null, outbox: !!m.outbox }; subs.set(m.id, sub);
    if (sub.outbox) { const authors = [...new Set(sub.filters.flatMap(f => f.authors || []))]; needRelayLists(authors); route(sub); }
    else if (sub.relays) ensure(sub.relays);
    if (m.inbox && me && relayLists.get(me)?.read?.length) { sub.relays = [...new Set([...(sub.relays || relays), ...relayLists.get(me).read.slice(0, 3)])]; ensure(sub.relays); }
    for (const [url, s] of sockets) if (s.open) { const f = filtersFor(sub, url); if (f) s.ws.send(JSON.stringify(['REQ', m.id, ...f])); }
    if (!sub.live) sub.timer = setTimeout(() => closeSub(m.id), m.timeout || 15000); return; }
  if (m.type === 'unsub') { closeSub(m.id); return; }
  if (m.type === 'publish') { const ev = m.event; let targets;
    if (m.relays) targets = m.relays.map(norm).filter(Boolean);
    else { targets = new Set(relays); const mine = me && relayLists.get(me); if (mine) mine.write.forEach(u => targets.add(u)); for (const t of ev.tags || []) if (t[0] === 'p' && relayLists.get(t[1])) relayLists.get(t[1]).read.slice(0, 2).forEach(u => targets.add(u)); targets = [...targets].slice(0, 12); }
    ensure(targets); let n = 0; const send = () => { for (const u of targets) { const s = sockets.get(u); if (s?.open) { s.ws.send(JSON.stringify(['EVENT', ev])); n++; } } }; send(); if (n < targets.length) setTimeout(() => { const before = n; n = 0; send(); post({ type: 'sent', id: ev.id, relays: Math.max(before, n), late: true }); }, 1500);
    if (ev.kind === 1 || ev.kind === 6 || ev.kind === 3) putEvent(ev); post({ type: 'sent', id: ev.id, relays: n }); return; }
  if (m.type === 'profiles') { const have = await getProfiles(m.pks); const missing = []; have.forEach((p, i) => { if (p) post({ type: 'profile', profile: p }); else missing.push(m.pks[i]); }); if (missing.length) { const id = 'p' + Math.random().toString(36).slice(2, 8); const sub = { filters: [{ kinds: [0], authors: missing.slice(0, 300) }], live: false, relays: [...new Set([...INDEXERS, ...relays])] }; subs.set(id, sub); ensure(sub.relays); for (const [url, s] of sockets) if (s.open && sub.relays.includes(url)) s.ws.send(JSON.stringify(['REQ', id, ...sub.filters])); sub.timer = setTimeout(() => closeSub(id), 10000); } return; }
  if (m.type === 'get') { const have = await getEvents(m.ids); const missing = []; have.forEach((e, i) => { if (e) post({ type: 'events', sub: 'get', events: [e] }); else missing.push(m.ids[i]); }); if (missing.length) { const id = 'g' + Math.random().toString(36).slice(2, 8); const sub = { filters: [{ ids: missing.slice(0, 100) }], live: false, relays: null }; subs.set(id, sub); for (const [url, s] of sockets) if (s.open && relays.includes(url)) s.ws.send(JSON.stringify(['REQ', id, ...sub.filters])); sub.timer = setTimeout(() => closeSub(id), 10000); } return; }
  if (m.type === 'relaylists') { needRelayLists(m.pks || []); for (const pk of m.pks || []) { const l = relayLists.get(pk); if (l) post({ type: 'relaylist', list: l }); } return; }
  if (m.type === 'relays') { relays = m.relays.map(norm).filter(Boolean); ensure(relays); return; }
  if (m.type === 'wipe') { for (const [, s] of sockets) { s.gone = true; try { s.ws.close(); } catch {} } sockets.clear(); subs.clear(); if (db) { db.close(); db = null; } await new Promise(res => { const r = indexedDB.deleteDatabase('cube'); r.onsuccess = r.onerror = r.onblocked = () => res(); }); post({ type: 'wiped' }); return; }
};
function closeSub(id) { const sub = subs.get(id); if (!sub) return; clearTimeout(sub.timer); subs.delete(id); for (const [url, s] of sockets) if (s.open && filtersFor(sub, url)) { try { s.ws.send(JSON.stringify(['CLOSE', id])); } catch {} } }

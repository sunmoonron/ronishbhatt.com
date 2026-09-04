// store.js — the page's content model.
//
// Everything on ronishbhatt.com is a signed Nostr event by the site key:
//   kind 0      the header (name, about, picture)
//   kind 30078  layout + theme (which sections, in what order, accent colour, links)
//   kind 30023  sections, project cards, writing — Markdown, readable in any Nostr client
//   kind 1      notes
//   kind 5      deletions
// This module owns the relay pool, verifies every event, keeps the newest
// version of each replaceable one, caches to localStorage and exposes
// selectors. Load order: snapshot baked into the HTML → localStorage →
// the personal relay → public backups. No content lives in the code.

const meta = n => document.querySelector(`meta[name="${n}"]`)?.content?.trim() || '';
export const NT = window.NostrTools;
export const SITE = meta('site-pubkey').toLowerCase();
export const PRIMARY = meta('site-relay');
export const BACKUPS = meta('site-backups').split(',').map(s => s.trim()).filter(Boolean);
export const RELAYS = [PRIMARY, ...BACKUPS];
export const TAG = 'ronishbhatt.com';      // t tag that marks an article as part of this page
export const CONFIG_D = 'ronishbhatt.com'; // d tag of the kind-30078 layout event
export const K = { profile: 0, note: 1, del: 5, wrap: 1059, article: 30023, config: 30078 };
export const DEFAULT_CFG = {
  title: 'Ronish Bhatt', accent: '#7dd3a8', chat: true,
  sections: ['about', 'projects', 'writing', 'now', 'chat', 'colophon'],
  links: [{ label: 'GitHub', url: 'https://github.com/sunmoonron' }, { label: 'résumé', url: '/resume/' }, { label: 'everything else', url: '/directory.html' }],
};

export const now = () => Math.floor(Date.now() / 1000);
export const tag = (ev, n) => ev?.tags?.find(t => t[0] === n)?.[1];
export const tagsOf = (ev, n) => (ev?.tags || []).filter(t => t[0] === n).map(t => t[1]);
export const dTag = ev => tag(ev, 'd') ?? '';
const replaceable = k => k === 0 || k === 3 || (k >= 10000 && k < 20000) || (k >= 30000 && k < 40000);
export const addrOf = ev => `${ev.kind}:${ev.pubkey}:${dTag(ev)}`;
export const keyOf = ev => !replaceable(ev.kind) ? ev.id : ev.kind >= 30000 ? addrOf(ev) : `${ev.kind}:${ev.pubkey}`;

// ---- state + change notification --------------------------------------------
export const store = { events: new Map(), dels: [], ready: false, status: new Map() };
const listeners = new Set();
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
let queued = false;
export const notify = () => {
  if (queued) return; queued = true;
  queueMicrotask(() => { queued = false; listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } }); });
};

// NIP-09: a deletion covers an id, or an address up to the deletion's own timestamp.
const deletedBy = ev => store.dels.some(d => tagsOf(d, 'e').includes(ev.id) ||
  (ev.kind >= 30000 && d.created_at >= ev.created_at && tagsOf(d, 'a').includes(addrOf(ev))));

// Feed one event in. Returns true if it changed what the page shows.
export function apply(ev, { verified = false, draft = false } = {}) {
  if (!ev || ev.pubkey !== SITE) return false;
  if (!draft && !verified && !NT.verifyEvent(ev)) return false;
  if (ev.kind === K.del) {
    if (store.dels.some(d => d.id === ev.id)) return false;
    store.dels.push(ev);
    for (const [k, e] of store.events) if (deletedBy(e)) store.events.delete(k);
    notify(); return true;
  }
  if (deletedBy(ev)) return false;
  const k = keyOf(ev), cur = store.events.get(k);
  if (draft) { if (cur) return false; store.events.set(k, { ...ev, draft: true }); notify(); return true; }
  if (cur && !cur.draft && (cur.created_at > ev.created_at || (cur.created_at === ev.created_at && cur.id <= ev.id))) return false;
  store.events.set(k, ev); notify(); return true;
}

// ---- selectors ----------------------------------------------------------------
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 1e9; };
const pubAt = e => +tag(e, 'published_at') || e.created_at;
const isPage = e => e.kind === K.article && tagsOf(e, 't').includes(TAG);
export const sel = {
  profile: () => store.events.get(`0:${SITE}`),
  profileData: () => { try { return JSON.parse(sel.profile()?.content || '{}'); } catch { return {}; } },
  configEvent: () => store.events.get(`${K.config}:${SITE}:${CONFIG_D}`),
  config: () => { try { const e = sel.configEvent(); return e ? JSON.parse(e.content) : null; } catch { return null; } },
  articles: type => [...store.events.values()].filter(e => isPage(e) && (!type || tagsOf(e, 't').includes(type)))
    .sort((a, b) => num(tag(a, 'order')) - num(tag(b, 'order')) || pubAt(b) - pubAt(a)),
  section: d => { const e = store.events.get(`${K.article}:${SITE}:${d}`); return e && isPage(e) ? e : null; },
  notes: () => [...store.events.values()].filter(e => e.kind === K.note).sort((a, b) => b.created_at - a.created_at),
  drafts: () => [...store.events.values()].filter(e => e.draft),
};

// ---- localStorage cache: instant paint on repeat visits -----------------------
const CACHE = 'rb.events.v1';
export function loadCache() { try { for (const e of JSON.parse(localStorage.getItem(CACHE) || '[]')) apply(e); } catch {} }
let saveTimer;
onChange(() => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try {
  const evs = [...store.events.values()].filter(e => !e.draft).concat(store.dels);
  let s = JSON.stringify(evs);
  if (s.length > 500000) s = JSON.stringify(evs.filter(e => e.kind !== K.note));
  localStorage.setItem(CACHE, s);
} catch {} }, 500); });

// ---- snapshot: signed events baked into the HTML, plus unsigned drafts ---------
export async function loadSnapshot() {
  let snap = null;
  try { const t = document.getElementById('snapshot')?.textContent.trim(); if (t) snap = JSON.parse(t); } catch {}
  if (!snap) try { snap = await (await fetch('/site.json', { cache: 'no-cache' })).json(); } catch {}
  if (!snap) return;
  for (const e of snap.events || []) apply(e);
  for (const d of snap.drafts || []) {
    const ev = { ...d, pubkey: SITE, created_at: d.created_at || 0, sig: '' };
    ev.id = 'draft:' + keyOf(ev);
    apply(ev, { draft: true });
  }
}

// ---- relays ------------------------------------------------------------------
export const pool = new NT.SimplePool({ enableReconnect: true });
pool.trackRelays = true;
export const seenOn = ev => [...(pool.seenOn.get(ev.id) || [])].map(r => r.url);

function pollStatus() {
  let changed = false;
  for (const [url, open] of pool.listConnectionStatus()) {
    const key = url.replace(/\/$/, ''); // the pool normalises URLs with a trailing slash
    const s = open ? 'open' : 'closed';
    if (store.status.get(key) !== s) { store.status.set(key, s); changed = true; }
  }
  if (changed) notify();
}

export function connect() {
  pool.subscribe(RELAYS, { authors: [SITE], kinds: [K.profile, K.note, K.del, K.article, K.config], limit: 300 }, {
    label: 'site',
    onevent: ev => apply(ev, { verified: true }), // the pool verified the signature already
    oneose: () => { store.ready = true; notify(); },
  });
  pollStatus(); setInterval(pollStatus, 3000);
}

// Publish to a set of relays; resolves with one row per relay, never throws.
export async function publish(ev, relays = RELAYS) {
  const results = await Promise.allSettled(pool.publish(relays, ev, { maxWait: 8000 }));
  return relays.map((url, i) => ({ url, ok: results[i].status === 'fulfilled',
    msg: results[i].status === 'fulfilled' ? (results[i].value || 'ok') : String(results[i].reason?.message || results[i].reason || 'failed') }));
}

// NIP-13 proof of work, mined off the main thread on every core: each worker
// walks its own stride of nonces, the first hit wins, the rest are killed.
// The workers never see a key — they get an unsigned event and hand it back.
const CORES = Math.min(navigator.hardwareConcurrency || 2, 8);
export function mine(event, bits) {
  if (!bits) return Promise.resolve(event);
  return new Promise((resolve, reject) => {
    const workers = []; let done = false;
    const finish = (err, ev) => { if (done) return; done = true; workers.forEach(w => w.terminate()); err ? reject(err) : resolve(ev); };
    for (let i = 0; i < CORES; i++) {
      const w = new Worker('/js/pow-worker.js'); workers.push(w);
      w.onmessage = ({ data }) => data.error ? finish(new Error(data.error)) : finish(null, data.event);
      w.onerror = e => finish(new Error(e.message || 'worker failed'));
      w.postMessage({ event: structuredClone(event), bits, start: i + 1, step: CORES });
    }
  });
}

// ---- the owner: one key, the same one the relay and the console trust --------
export const owner = { sk: null };
const STORAGE_KEY = 'dash.nsec'; // shared with /dash.html so one unlock opens both
export function unlock(raw, remember = false) {
  raw = String(raw || '').trim(); let sk;
  if (raw.startsWith('nsec1')) sk = NT.nip19.decode(raw).data;
  else if (/^[0-9a-f]{64}$/i.test(raw)) sk = NT.utils.hexToBytes(raw.toLowerCase());
  else throw new Error('paste an nsec1… or a 64-character hex key');
  if (NT.getPublicKey(sk) !== SITE) throw new Error('that key is not this site\'s key');
  owner.sk = sk;
  const j = JSON.stringify(raw);
  sessionStorage.setItem(STORAGE_KEY, j);
  if (remember) localStorage.setItem(STORAGE_KEY, j); else localStorage.removeItem(STORAGE_KEY);
  notify();
}
export function lock() { owner.sk = null; sessionStorage.removeItem(STORAGE_KEY); localStorage.removeItem(STORAGE_KEY); notify(); }
export function restoreUnlock() {
  try { const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY) || 'null'); if (raw) unlock(raw, !!localStorage.getItem(STORAGE_KEY)); }
  catch { localStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem(STORAGE_KEY); }
}
export const sign = tmpl => NT.finalizeEvent({ created_at: now(), tags: [], content: '', ...tmpl }, owner.sk);

// A link that proves the point: every component is an event you can open elsewhere.
export const njump = ev => { try {
  if (ev.kind >= 30000) return 'https://njump.me/' + NT.nip19.naddrEncode({ kind: ev.kind, pubkey: ev.pubkey, identifier: dTag(ev), relays: [PRIMARY] });
  if (ev.kind === 0) return 'https://njump.me/' + NT.nip19.nprofileEncode({ pubkey: ev.pubkey, relays: [PRIMARY] });
  return 'https://njump.me/' + NT.nip19.neventEncode({ id: ev.id, author: ev.pubkey, relays: [PRIMARY] });
} catch { return null; } };

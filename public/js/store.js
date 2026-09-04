// store.js: the page's content model. Every visible thing is a signed Nostr
// event by the site key: kind 30078 app data (the header too, as the 'profile' block) with a hashed identifier and a
// NIP-44 body under the page secret, so relays and clients see noise while
// anyone holding the page can read it. Kind 1 notes and kind 5 deletions
// stay plain. DOM-free, so tools/bake.mjs renders the same page in Node.
export const K = { profile: 0, note: 1, del: 5, wrap: 1059, block: 30078 };
export const env = { NT: null, SITE: '', PRIMARY: '', BACKUPS: [], VEIL: null, get RELAYS() { return [this.PRIMARY, ...this.BACKUPS]; } };
export const init = ({ site, relay, backups, veil, NT }) => { env.SITE = site.toLowerCase(); env.PRIMARY = relay; env.BACKUPS = backups; if (NT) env.NT = NT; if (veil && /^[0-9a-f]{64}$/i.test(veil)) env.VEIL = Uint8Array.from(veil.match(/../g).map(x => parseInt(x, 16))); };
export const DEFAULT_CFG = { title: 'Ronish Bhatt', chat: true, sections: ['courses', 'projects', 'writing', 'chat', 'archive', 'colophon'],
  links: [{ label: 'GitHub', url: 'https://github.com/sunmoonron' }, { label: 'résumé', url: '/resume/' }] };

export const now = () => Math.floor(Date.now() / 1000);
export const tag = (ev, n) => ev?.tags?.find(t => t[0] === n)?.[1];
export const tagsOf = (ev, n) => (ev?.tags || []).filter(t => t[0] === n).map(t => t[1]);
export const dTag = ev => tag(ev, 'd') ?? '';
const replaceable = k => k === 0 || k === 3 || (k >= 10000 && k < 20000) || (k >= 30000 && k < 40000);
export const addrOf = ev => `${ev.kind}:${ev.pubkey}:${dTag(ev)}`;
export const keyOf = ev => !replaceable(ev.kind) ? ev.id : ev.kind >= 30000 ? addrOf(ev) : `${ev.kind}:${ev.pubkey}`;
// identifiers are hashes of the slug and the site key, so a relay learns nothing from the d tag
export const h = slug => env.NT.getEventHash({ kind: 0, pubkey: env.SITE, created_at: 0, tags: [], content: `ronishbhatt.com:${slug}` }).slice(0, 16);
export const veil = text => env.NT.nip44.v2.encrypt(text, env.VEIL);
const unveil = text => env.NT.nip44.v2.decrypt(text, env.VEIL);
export const text = ev => ev.plain ?? ev.content;
export const meta = ev => { if (ev.meta === undefined) { try { ev.meta = JSON.parse(text(ev)); } catch { ev.meta = null; } } return ev.meta; };

export const store = { events: new Map(), dels: [], ready: false, status: new Map(), drafts: [] };
const listeners = new Set(); let queued = false;
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const notify = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }); };

const deletedBy = ev => store.dels.some(d => tagsOf(d, 'e').includes(ev.id) || (ev.kind >= 30000 && d.created_at >= ev.created_at && tagsOf(d, 'a').includes(addrOf(ev))));
const verify = ev => !env.NT || env.NT.verifyEvent(ev);

export function apply(ev, { verified = false, draft = false } = {}) {
  if (!ev || ev.pubkey !== env.SITE) return false;
  if (!draft && !verified && !verify(ev)) return false;
  if (ev.kind === K.del) {
    if (store.dels.some(d => d.id === ev.id)) return false;
    store.dels.push(ev);
    for (const [k, e] of store.events) if (!e.draft && deletedBy(e)) store.events.delete(k);
    for (const d of store.drafts) apply(d, { draft: true }); // a deleted block falls back to its seed draft
    notify(); return true;
  }
  if (!draft && ev.kind === K.block && ev.plain === undefined) { try { ev.plain = unveil(ev.content); } catch { ev.plain = ev.content; } } // plain 30078s still read
  const k = keyOf(ev), cur = store.events.get(k);
  if (draft) { if (!store.drafts.includes(ev)) store.drafts.push(ev); if (cur) return false; store.events.set(k, { ...ev, draft: true }); notify(); return true; }
  if (deletedBy(ev)) return false;
  if (cur && !cur.draft && (cur.created_at > ev.created_at || (cur.created_at === ev.created_at && cur.id <= ev.id))) return false;
  store.events.set(k, ev); notify(); return true;
}
export function reverify() { for (const [k, e] of store.events) if (!e.draft && !env.NT.verifyEvent(e)) store.events.delete(k); store.dels = store.dels.filter(d => env.NT.verifyEvent(d)); notify(); }

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 1e9; };
const RESERVED = new Set(['layout', 'css', 'profile']);
const blocks = () => [...store.events.values()].filter(e => e.kind === K.block && meta(e)?.slug && !RESERVED.has(meta(e).slug));
export const sel = {
  profile: () => store.events.get(`${K.block}:${env.SITE}:${h('profile')}`),
  profileData: () => { const e = sel.profile(); return (e && meta(e)) || {}; },
  layoutEvent: () => store.events.get(`${K.block}:${env.SITE}:${h('layout')}`),
  config: () => { try { const e = sel.layoutEvent(); return e ? { ...DEFAULT_CFG, ...JSON.parse(text(e)) } : DEFAULT_CFG; } catch { return DEFAULT_CFG; } },
  cssEvent: () => store.events.get(`${K.block}:${env.SITE}:${h('css')}`),
  css: () => { const e = sel.cssEvent(); return e ? text(e) : ''; },
  articles: type => blocks().filter(e => meta(e).type === type).sort((a, b) => num(meta(a).order) - num(meta(b).order) || (+meta(b).published_at || b.created_at) - (+meta(a).published_at || a.created_at)),
  section: slug => { const e = store.events.get(`${K.block}:${env.SITE}:${h(slug)}`); return e && meta(e)?.slug ? e : null; },
  notes: () => [...store.events.values()].filter(e => e.kind === K.note).sort((a, b) => b.created_at - a.created_at),
  drafts: () => [...store.events.values()].filter(e => e.draft),
  signed: () => [...store.events.values()].filter(e => !e.draft).length,
};

// ---- snapshot: signed events from the relay plus the seed drafts ----------------
// A seed draft is {kind, d?, content} in plain text; it gets a hashed d and the site key here.
export function loadSnapshot(snap) {
  for (const e of snap?.events || []) apply(e, { verified: true });
  for (const d of snap?.drafts || []) {
    const ev = { kind: d.kind, pubkey: env.SITE, created_at: 0, tags: d.d ? [['d', h(d.d)]] : [], content: d.content, sig: '', plain: d.content };
    ev.id = 'draft:' + keyOf(ev); apply(ev, { draft: true });
  }
}
const CACHE = 'rb.events.v2';
export function loadCache() { try { for (const e of JSON.parse(localStorage.getItem(CACHE) || '[]')) apply(e, { verified: true }); } catch {} }
let saveTimer;
export function keepCache() { onChange(() => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try {
  const evs = [...store.events.values()].filter(e => !e.draft).map(({ plain, meta, ...e }) => e).concat(store.dels);
  let s = JSON.stringify(evs); if (s.length > 500000) s = JSON.stringify(evs.filter(e => e.kind !== K.note));
  localStorage.setItem(CACHE, s);
} catch {} }, 500); }); }

// ---- relays ---------------------------------------------------------------------
export let pool = null;
export const seenOn = ev => pool ? [...(pool.seenOn.get(ev.id) || [])].map(r => r.url) : [];
function pollStatus() {
  let changed = false;
  for (const [url, open] of pool.listConnectionStatus()) {
    const key = url.replace(/\/$/, ''), s = open ? 'open' : 'closed'; // the pool normalises URLs with a trailing slash
    if (store.status.get(key) !== s) { store.status.set(key, s); changed = true; }
  }
  if (changed) notify();
}
export function connect() {
  pool = new env.NT.SimplePool({ enableReconnect: true }); pool.trackRelays = true;
  pool.subscribe(env.RELAYS, { authors: [env.SITE], kinds: [K.note, K.del, K.block], limit: 300 },
    { label: 'site', onevent: ev => apply(ev, { verified: true }), oneose: () => { store.ready = true; notify(); } });
  pollStatus(); setInterval(pollStatus, 3000);
}
export async function publish(ev, relays = env.RELAYS) {
  const results = await Promise.allSettled(pool.publish(relays, ev, { maxWait: 8000 }));
  return relays.map((url, i) => ({ url, ok: results[i].status === 'fulfilled',
    msg: results[i].status === 'fulfilled' ? (results[i].value || 'ok') : String(results[i].reason?.message || results[i].reason || 'failed') }));
}

// NIP-13 work, mined on every core: each worker walks its own nonce stride,
// the first hit wins. Workers get an unsigned event and never see a key.
const CORES = () => Math.min(navigator.hardwareConcurrency || 2, 8);
export function mine(event, bits) {
  if (!bits) return Promise.resolve(event);
  return new Promise((resolve, reject) => {
    const n = CORES(), workers = []; let done = false;
    const finish = (err, ev) => { if (done) return; done = true; workers.forEach(w => w.terminate()); err ? reject(err) : resolve(ev); };
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./pow-worker.js', import.meta.url)); workers.push(w);
      w.onmessage = ({ data }) => data.error ? finish(new Error(data.error)) : finish(null, data.event);
      w.onerror = e => finish(new Error(e.message || 'worker failed'));
      w.postMessage({ event: structuredClone(event), bits, start: i + 1, step: n });
    }
  });
}

// ---- the owner: one key, the relay's, the console's, this page's ------------------
export const owner = { sk: null };
const KEY = 'dash.nsec'; // shared with /dash.html: one unlock opens both
export const storedKey = () => { try { return JSON.parse(localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || 'null'); } catch { return null; } };
export function unlock(raw, remember = false) {
  const NT = env.NT; raw = String(raw || '').trim(); let sk;
  if (raw.startsWith('nsec1')) sk = NT.nip19.decode(raw).data;
  else if (/^[0-9a-f]{64}$/i.test(raw)) sk = NT.utils.hexToBytes(raw.toLowerCase());
  else throw new Error('paste an nsec1… or a 64-character hex key');
  if (NT.getPublicKey(sk) !== env.SITE) throw new Error("that key is not this site's key");
  owner.sk = sk;
  const j = JSON.stringify(raw); sessionStorage.setItem(KEY, j);
  if (remember) localStorage.setItem(KEY, j); else localStorage.removeItem(KEY);
  notify();
}
export function restore() { const raw = storedKey(); if (raw) unlock(raw, !!localStorage.getItem(KEY)); }
export function lock() { owner.sk = null; sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); notify(); }
export const sign = tmpl => env.NT.finalizeEvent({ created_at: now(), tags: [], content: '', ...tmpl }, owner.sk);

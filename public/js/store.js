// store.js: the page's content model. Every visible thing is a signed Nostr
// event by the site key: kind 30078 app data (the header too, as the 'profile' block) with a hashed identifier and a
// NIP-44 body under the page secret, so relays and clients see noise while
// anyone holding the page can read it. Kind 1 notes and kind 5 deletions
// stay plain. DOM-free, so tools/bake.mjs renders the same page in Node.
export const K = { profile: 0, note: 1, del: 5, wrap: 1059, block: 30078 };
// The icon is the key: its 64 squares, read row by row in 16 greens, are the
// 32 bytes that unveil the relay. Nothing else on the page knows the secret.
export const PALETTE = ['#0b1a12', '#10261a', '#153223', '#1a3f2c', '#1f4c35', '#255a3f', '#2b6849', '#327754', '#3a865f', '#43956b', '#4ea477', '#5ab384', '#68c291', '#79d09f', '#8dddae', '#a4e9bf'];
export const decodeIcon = svg => { const n = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map(m => PALETTE.indexOf(m[1].toLowerCase())).filter(i => i >= 0); if (n.length !== 64) throw new Error('the icon is not a key'); return n.map(i => i.toString(16)).join(''); };
export const env = { NT: null, SITE: '', PRIMARY: '', BACKUPS: [], VEIL: null, ICON: '/favicon.svg', ASSETS: {}, SRI: {}, get RELAYS() { return [this.PRIMARY, ...this.BACKUPS]; } };
export const init = ({ site, relay, backups, veil, NT, icon, assets, sri }) => {
  if (site) env.SITE = site.toLowerCase(); if (relay) env.PRIMARY = relay; if (backups) env.BACKUPS = backups; if (NT) env.NT = NT;
  if (icon) env.ICON = icon; if (assets) env.ASSETS = assets; if (sri) env.SRI = sri;
  if (veil && /^[0-9a-f]{64}$/i.test(veil)) env.VEIL = Uint8Array.from(veil.match(/../g).map(x => parseInt(x, 16)));
};
// the rules the mural, garden and story need: appended to whatever stylesheet is live so a
// signed stylesheet that predates an experiment can never leave it unstyled
export const COMPONENT_CSS = ".tiny{margin-left:.5rem;font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);border-radius:999px;padding:0 .4rem}.mural{padding:.25rem 1rem 1rem}.mural svg{width:100%;height:auto;display:block;border-radius:8px;background:var(--soft)}.garden{padding:.25rem 1rem 1rem}.words{display:flex;flex-wrap:wrap;gap:.35rem;margin:.25rem 0 .75rem}.word{font-size:.8rem;padding:.2rem .55rem;border-radius:999px;background:color-mix(in srgb,var(--accent) 12%,transparent);border:1px solid color-mix(in srgb,var(--accent) 30%,transparent)}.plantform{display:flex;gap:.5rem;flex-wrap:wrap}.plantform input{max-width:14rem}.story{margin:.75rem 0 0;font-size:.95rem;line-height:1.7}.story .mem{color:var(--mint);font-weight:600}.legend{font-size:.72rem;color:var(--mute);margin:.6rem 0 0}.empty{color:var(--mute);font-size:.9rem;margin:0}.presence-layer{position:absolute;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:30}.presence-dot{position:absolute;left:0;top:0;width:0;height:0;opacity:0;transition:transform 1.6s cubic-bezier(.4,0,.2,1),opacity .6s}.presence-dot.on{opacity:.92}.presence-dot i{position:absolute;left:-6px;top:-6px;width:12px;height:12px;border-radius:50%;background:hsl(var(--h) 70% 55%);box-shadow:0 0 0 2px var(--bg),0 0 14px hsl(var(--h) 80% 60% / .8);animation:presence-breathe 3s ease-in-out infinite}.presence-dot.owner i{left:-12px;top:-12px;width:24px;height:24px;background:var(--card);box-shadow:0 0 0 2px var(--accent),0 0 18px var(--accent);overflow:hidden}.presence-dot.owner img{width:24px;height:24px;display:block}.presence-dot.owner b{position:absolute;left:16px;top:-8px;font:600 .7rem var(--mono);color:var(--accent);white-space:nowrap;text-shadow:0 0 6px var(--bg)}@keyframes presence-breathe{50%{transform:scale(1.18)}}.presence-chip{position:fixed;top:.6rem;right:.6rem;z-index:62;display:inline-flex;align-items:center;gap:.4rem;padding:.25rem .65rem;border:1px solid var(--line);border-radius:999px;background:color-mix(in srgb,var(--card) 88%,transparent);color:var(--mute);font:.72rem var(--mono);cursor:pointer;backdrop-filter:blur(6px)}.presence-chip i{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 8px var(--accent)}.presence-chip.alone i{background:var(--mute);box-shadow:none}.presence-panel{position:fixed;top:2.7rem;right:.6rem;z-index:62;width:min(23rem,calc(100vw - 1.2rem));padding:.85rem .95rem;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--fg);font-size:.82rem;line-height:1.45;box-shadow:0 10px 30px rgba(0,0,0,.25)}.presence-panel p{margin:0 0 .55rem}.presence-panel p:last-child{margin:0}.presence-panel small{color:var(--mute)}.presence-panel b{color:var(--accent);font-weight:600;margin-right:.3rem}.presence-panel label{display:flex;gap:.45rem;align-items:flex-start;color:var(--mute);font-size:.78rem;margin:0 0 .55rem}.whisper{position:fixed;left:1rem;right:1rem;bottom:1rem;margin:0 auto;width:fit-content;max-width:30rem;transform:translateY(8px);z-index:62;padding:.5rem .95rem;border:1px solid var(--line);border-radius:999px;background:color-mix(in srgb,var(--card) 92%,transparent);color:var(--fg);font-size:.8rem;line-height:1.4;opacity:0;pointer-events:none;transition:opacity .5s,transform .5s;backdrop-filter:blur(6px);text-align:center}.whisper.on{opacity:1;transform:none;pointer-events:auto;cursor:pointer}@media (max-width:640px){.whisper{bottom:3.4rem}.presence-chip{top:.45rem;right:.45rem}}html.wild .presence-chip,html.wild .presence-panel,html.wild .whisper{font-family:var(--mono)}";
export const DEFAULT_CFG = { title: 'Ronish Bhatt', chat: true, experiments: ['mural', 'garden'], sections: ['courses', 'projects', 'writing', 'chat', 'archive', 'colophon'],
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
export const unveil = text => env.NT.nip44.v2.decrypt(text, env.VEIL);
export const text = ev => ev.plain ?? ev.content;
export const meta = ev => { if (ev.meta === undefined) { try { ev.meta = JSON.parse(text(ev)); } catch { ev.meta = null; } } return ev.meta; };

export const store = { events: new Map(), dels: [], ready: false, status: new Map(), drafts: [], wraps: new Map(), words: new Map() };
// ---- progress: what the strict entry did and when. Kept in LOG so a late listener (the wild terminal) can replay it. ----
export const LOG = [];
export function progress(stage, detail = {}) {
  const d = { stage, t: Math.round(typeof performance !== 'undefined' ? performance.now() : 0), ...detail }; LOG.push(d);
  try { performance.mark('rb:' + stage); } catch {}
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('rb:progress', { detail: d }));
}
// Experiments. The mural needs only ids: leading zero bits and a time, nothing decrypted, nobody named.
export const powBits = id => { let b = 0; for (const ch of id) { const n = parseInt(ch, 16); if (Number.isNaN(n)) return b; if (n === 0) { b += 4; continue; } return b + Math.clz32(n) - 28; } return b; };
export function applyWrap(ev) { if (ev?.kind !== K.wrap || store.wraps.has(ev.id)) return false; store.wraps.set(ev.id, { id: ev.id, created_at: ev.created_at, bits: powBits(ev.id) }); notify(); return true; }
export const WORD = /^[\p{L}\p{N}'-]{1,24}$/u; // the garden's word door, mirrored by the relay policy
export function applyWord(ev) { if (ev?.kind !== K.note || store.words.has(ev.id) || !WORD.test(ev.content || '') || !(ev.tags || []).some(t => t[0] === 't' && t[1] === 'plant')) return false; store.words.set(ev.id, { id: ev.id, word: ev.content, created_at: ev.created_at, pubkey: ev.pubkey }); notify(); return true; }
export const recentWords = (n = 40) => [...store.words.values()].sort((a, b) => b.created_at - a.created_at).slice(0, n);
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
  themeCss: () => sel.css() + COMPONENT_CSS,
  articles: type => blocks().filter(e => meta(e).type === type).sort((a, b) => num(meta(a).order) - num(meta(b).order) || (+meta(b).published_at || b.created_at) - (+meta(a).published_at || a.created_at)),
  section: slug => { const e = store.events.get(`${K.block}:${env.SITE}:${h(slug)}`); return e && meta(e)?.slug ? e : null; },
  notes: () => [...store.events.values()].filter(e => e.kind === K.note).sort((a, b) => b.created_at - a.created_at),
  drafts: () => [...store.events.values()].filter(e => e.draft),
  signed: () => [...store.events.values()].filter(e => !e.draft).length,
  // The section list actually rendered: the layout's order, plus the experiments the
  // layout has not turned off, slotted in before the archive fold (or at the end).
  sections: () => { const cfg = sel.config(), list = [...(cfg.sections || [])], exp = Array.isArray(cfg.experiments) ? cfg.experiments : DEFAULT_CFG.experiments;
    for (const x of exp) if (!list.includes(x)) { const at = list.indexOf('archive'); at >= 0 ? list.splice(at, 0, x) : list.push(x); } return list; },
};

// ---- deploy-time work the owner signs with one click ----------------
// A seed marked {update: true} in drafts.json is a change the deployer wants published over the live block:
// only those, and only while they still differ, so nothing the owner edited by hand is ever clobbered.
export function pendingUpdates(snap) {
  const out = [];
  for (const s of snap?.drafts || []) {
    let d = s; if (typeof s === 'string') { try { d = JSON.parse(unveil(s)); } catch { continue; } }
    if (!d.update || d.kind !== K.block) continue;
    let seed; try { seed = JSON.parse(d.content); } catch { continue; }
    const live = sel.section(d.d); if (!live) continue; // no signed version: that is a draft, not an update
    const lm = meta(live) || {}, diff = Object.keys(seed).filter(k => JSON.stringify(seed[k]) !== JSON.stringify(lm[k]));
    if (diff.length) out.push({ slug: d.d, live, seed, diff });
  }
  return out;
}
// Notes by the site key that nothing renders: garden words it planted while testing, and plain notes when the layout shows no notes section.
export function prunable() {
  const shown = (sel.config().sections || []).includes('notes');
  return [...store.events.values()].filter(e => !e.draft && e.kind === K.note && (e.tags.some(t => t[0] === 't' && t[1] === 'plant') || !shown));
}

// ---- snapshot: signed events from the relay plus the seed drafts ----------------
// A seed draft is {kind, d?, content} in plain text; it gets a hashed d and the site key here.
export function loadSnapshot(snap) {
  for (const e of snap?.events || []) apply(e, { verified: true });
  for (const s of snap?.drafts || []) {
    let d = s; if (typeof s === 'string') { try { d = JSON.parse(unveil(s)); } catch { continue; } } // baked seeds arrive veiled
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
export function connect(opts = {}) {
  pool = new env.NT.SimplePool({ enableReconnect: true }); pool.trackRelays = true;
  const filter = { authors: [env.SITE], kinds: [K.note, K.del, K.block], limit: 300 }; if (opts.since) filter.since = opts.since; // strict: the early sockets already fetched history, the pool only needs what is newer
  for (const url of env.RELAYS) pool.ensureRelay(url, { connectionTimeout: 8000 }).then(() => progress('relay', { url, open: true }), e => progress('relay', { url, open: false, why: e?.message || 'closed' }));
  pool.subscribe(env.RELAYS, filter,
    { label: 'site',
      onevent: ev => { store.live = (store.live || 0) + 1; const fresh = apply(ev, { verified: true }); if (fresh) progress('event', { id: ev.id, kind: ev.kind, bytes: ev.content.length, veiled: ev.kind === K.block, sample: ev.kind === K.block ? ev.content.slice(0, 240) : '', fresh }); },
      oneose: () => { store.ready = true; progress('eose', { n: sel.signed() }); notify(); } });
  pollStatus(); setInterval(pollStatus, 3000);
}
let wrapsSub = false, wordsSub = false;
export function subscribeWraps() { if (wrapsSub || !pool) return; wrapsSub = true; pool.subscribe([env.PRIMARY], { kinds: [K.wrap], '#p': [env.SITE], limit: 300 }, { label: 'mural', onevent: applyWrap }); }
export function subscribeWords() { if (wordsSub || !pool) return; wordsSub = true; pool.subscribe([env.PRIMARY], { kinds: [K.note], '#t': ['plant'], limit: 60 }, { label: 'garden', onevent: applyWord }); }
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
    const n = CORES(), workers = []; let done = false, hashes = 0, best = 0;
    const tell = extra => { try { document.dispatchEvent(new CustomEvent('pow', { detail: { hashes, best, bits, ...extra } })); } catch {} };
    const finish = (err, ev) => { if (done) return; done = true; workers.forEach(w => w.terminate()); tell({ done: true }); err ? reject(err) : resolve(ev); };
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./pow-worker.js', import.meta.url)); workers.push(w);
      w.onmessage = ({ data }) => { if (data.progress) { hashes += data.progress; if (data.best > best) best = data.best; } if (data.error) return finish(new Error(data.error)); if (data.event) return finish(null, data.event); tell({}); };
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

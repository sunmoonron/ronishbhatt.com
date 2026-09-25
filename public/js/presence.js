// presence.js: who else is on this page right now, what this browser remembers
// about its own visits, and the few quiet lines those two things earn.
//
// Presence is an ephemeral event (kind 20718; relays hand it on and drop it)
// sent through the public relays every twenty seconds from a key made for this
// page load: a section id, a position inside it, a hue. No name, no message,
// nothing stored anywhere. The visit counter is one addressable note per
// browser on my relay (kind 30078, d = rb.visit, sixteen bits of work) that the
// relay's write policy has to admit; until it does, the counter is this
// browser's own memory only. Whispers: at most two a visit, ninety seconds
// apart, each one once per browser, never while someone is typing.
import { env, pool, publish, mine, owner, store, onChange } from './store.js';

const KIND = 20718, TAG = 'rb.presence', BEAT = 20, TTL = 60;
const VISIT_KIND = 30078, VISIT_D = 'rb.visit', VISIT_POW = 16;
const YOU = 'rb.you', BEACON_KEY = 'rb.beacon.nsec', BEACON_OFF = 'rb.beacon.off', OWNER_ON = 'rb.presence.owner';
const NAME = { me: 'the top', courses: 'the course list', projects: 'the projects', writing: 'the paper', chat: 'the chat', mural: 'the mural', garden: 'the garden', archive: 'the archive', colophon: 'the colophon', notes: 'the notes' };
const now = () => Math.floor(Date.now() / 1000), day = () => new Date().toISOString().slice(0, 10);
const clamp = v => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; (parent || document.body).append(e); return e; };
const ago = ts => { const s = now() - ts; return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][Math.min(n % 10, 4)] || 'th');

let you = null, mySk = null, myPk = null, hue = 0, sub = null, layer, chip, panel, whisper;
let peers = new Map(), lastBeat = 0, lastSection = '', pointerX = 0.5, started = false;
let visitStart = Date.now(), lastInput = Date.now(), hiddenAt = 0, dwell = 0, depth = 0, keys = '', global = null, globalAt = 0;

// ---- what this browser remembers, on this side only -----------------------------
function loadYou() { try { you = JSON.parse(localStorage.getItem(YOU) || 'null'); } catch { you = null; } if (!you || typeof you !== 'object') you = { v: 0, first: now(), last: 0, eggs: {}, flips: 0, w: { n: 0, at: 0 } }; you.eggs ||= {}; you.w ||= { n: 0, at: 0 }; }
function saveYou() { try { localStorage.setItem(YOU, JSON.stringify(you)); } catch {} }
function beginVisit() {
  const gap = you.last ? now() - you.last : 0, fresh = !you.last || gap > 1800;
  you.gapDays = fresh && you.last ? Math.floor(gap / 86400) : 0;
  if (fresh) { you.v = (you.v || 0) + 1; you.w = { n: 0, at: 0 }; you.fresh = true; } else you.fresh = false;
  you.last = now(); saveYou();
  setInterval(() => { you.last = now(); saveYou(); }, 60000);
}
const messaged = () => { try { return (JSON.parse(localStorage.getItem('rb.chat.visitor.v1') || '[]')).some(t => (t.msgs || []).some(m => m.mine)); } catch { return false; } };
const refHost = () => { try { return document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch { return ''; } };

// ---- where this reader is, as a section and a fraction of it ----------------------
const sections = () => [...document.querySelectorAll('main > header.me, main section.c, main details.fold')];
const idOf = e => e.id || (e.matches('header.me') ? 'me' : '');
function where() {
  const vh = innerHeight, mid = vh / 2; let best = null, bestVis = 0;
  for (const e of sections()) { const r = e.getBoundingClientRect(), vis = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)); if (vis > bestVis) { bestVis = vis; best = { e, r }; } }
  if (!best) return null;
  return { s: idOf(best.e), y: clamp((mid - best.r.top) / Math.max(1, best.r.height)), x: pointerX };
}

// ---- the heartbeat out, the others in -------------------------------------------
const asOwner = () => !!(owner.sk && sessionStorage.getItem(OWNER_ON) === '1');
function beat(force) {
  if (!pool || !env.NT || document.hidden) return;
  const w = where(); if (!w) return;
  const due = now() - lastBeat >= BEAT, moved = w.s !== lastSection && now() - lastBeat >= 4;
  if (!force && !due && !moved) return;
  lastBeat = now(); lastSection = w.s;
  const tmpl = { kind: KIND, created_at: now(), tags: [['t', TAG], ['expiration', String(now() + TTL + 30)]], content: JSON.stringify({ v: 1, s: w.s, y: +w.y.toFixed(3), x: +w.x.toFixed(3), h: hue }) };
  try { const ev = env.NT.finalizeEvent(tmpl, asOwner() ? owner.sk : mySk); publish(ev, asOwner() ? env.RELAYS : env.BACKUPS).catch(() => {}); } catch {}
}
function bye() { if (!pool || !env.NT) return; try { const ev = env.NT.finalizeEvent({ kind: KIND, created_at: now(), tags: [['t', TAG]], content: JSON.stringify({ v: 1, gone: 1 }) }, asOwner() ? owner.sk : mySk); publish(ev, asOwner() ? env.RELAYS : env.BACKUPS).catch(() => {}); } catch {} }
function listen() { if (sub || !pool) return; sub = pool.subscribe(env.RELAYS, { kinds: [KIND], '#t': [TAG], since: now() - TTL }, { label: 'presence', onevent: onBeat }); }
function onBeat(ev) {
  if (ev.pubkey === myPk || (asOwner() && ev.pubkey === env.SITE)) return;
  if (ev.created_at < now() - TTL || ev.created_at > now() + 120) return;
  let d; try { d = JSON.parse(ev.content); } catch { return; }
  if (!d || typeof d !== 'object') return;
  if (d.gone) { const p = peers.get(ev.pubkey); if (p) { p.el?.remove(); peers.delete(ev.pubkey); } return count(); }
  if (typeof d.s !== 'string') return;
  const isOwner = ev.pubkey === env.SITE && env.NT.verifyEvent(ev);
  const p = peers.get(ev.pubkey) || { pk: ev.pubkey, el: null };
  Object.assign(p, { seen: now(), s: d.s.slice(0, 40), y: clamp(+d.y), x: clamp(+d.x), h: Math.abs(+d.h || 0) % 360, owner: isOwner });
  peers.set(ev.pubkey, p); draw(); count();
  if (isOwner) poke('ronish'); if (peers.size >= 3) poke('busy');
}
function prune() { let gone = false; for (const [k, p] of peers) if (p.seen < now() - TTL) { p.el?.remove(); peers.delete(k); gone = true; } if (gone) count(); }

// ---- dots on the page, one per reader, where they are -----------------------------
function draw() {
  for (const p of peers.values()) {
    if (!p.el) {
      p.el = el('span', 'presence-dot' + (p.owner ? ' owner' : ''), layer); p.el.style.setProperty('--h', p.h);
      const i = el('i', '', p.el); if (p.owner) { const img = el('img', '', i); img.src = env.ICON; img.alt = ''; el('b', '', p.el).textContent = 'Ronish'; }
      requestAnimationFrame(() => p.el.classList.add('on'));
    }
    const target = document.getElementById(p.s) || (p.s === 'me' ? document.querySelector('main > header.me') : null);
    let X, Y;
    if (target) { const r = target.getBoundingClientRect(); X = r.left + scrollX + p.x * r.width; Y = r.top + scrollY + p.y * r.height; }
    else { X = scrollX + innerWidth - 18; Y = scrollY + p.y * innerHeight; }
    p.el.style.transform = `translate(${Math.round(X)}px, ${Math.round(Y)}px)`;
  }
}
function count() {
  const n = peers.size, ownerHere = [...peers.values()].some(p => p.owner);
  chip.classList.toggle('alone', n === 0);
  chip.textContent = ''; el('i', '', chip); chip.append(n === 0 ? 'just you' : ownerHere ? (n === 1 ? 'Ronish is here' : `Ronish + ${n - 1}`) : `${n} reading`);
  chip.title = n === 0 ? 'nobody else is on this page right now' : 'who else is reading this page';
  if (!panel.hidden) fill();
}
async function fill() {
  const groups = {}; for (const p of peers.values()) groups[p.s] = (groups[p.s] || 0) + 1;
  const list = Object.entries(groups).map(([s, n]) => `${n} on ${NAME[s] || s}`).join(', ');
  const lines = [];
  lines.push(peers.size ? `<p><b>right now</b> ${peers.size} other${peers.size > 1 ? 's' : ''} reading: ${list}.</p>` : '<p><b>right now</b> nobody else. the dots appear where other readers are on the page.</p>');
  lines.push(`<p><b>you</b> ${you.v <= 1 ? 'first time here' : `${ordinal(you.v)} visit, first on ${new Date(you.first * 1000).toISOString().slice(0, 10)}`}${you.gapDays >= 2 ? `, last time ${you.gapDays} days ago` : ''}. remembered by this browser only.</p>`);
  if (global && global.unique) lines.push(`<p><b>everyone</b> ${global.unique} browser${global.unique > 1 ? 's' : ''} left a visit note on my relay since ${new Date(global.first * 1000).toISOString().slice(0, 10)}, ${global.visits} visits in all, the last one ${ago(global.last)}.</p>`);
  if (owner.sk) lines.push(`<label><input type="checkbox" id="presence-owner" ${asOwner() ? 'checked' : ''}> appear to visitors as Ronish (a beat signed by the site key every ${BEAT} s while this tab is open)</label>`);
  lines.push('<p><small>presence is an ephemeral event through the public relays: no name, nothing stored, a fresh key per page load.</small></p>');
  panel.innerHTML = lines.join('');
  panel.querySelector('#presence-owner')?.addEventListener('change', e => { sessionStorage.setItem(OWNER_ON, e.target.checked ? '1' : '0'); beat(true); });
  if (!global || now() - globalAt > 60) fetchGlobal().then(g => { if (g) { global = g; globalAt = now(); if (!panel.hidden) fill(); } });
}

// ---- the visit counter on my relay, if its policy lets a browser in ---------------
async function fetchGlobal() {
  if (!pool || typeof pool.querySync !== 'function') return null;
  try {
    const evs = await pool.querySync([env.PRIMARY], { kinds: [VISIT_KIND], '#d': [VISIT_D], limit: 1000 }, { maxWait: 6000 });
    const rows = evs.filter(e => e.pubkey !== env.SITE); if (!rows.length) return null;
    return { unique: new Set(rows.map(e => e.pubkey)).size, visits: rows.reduce((a, e) => a + (parseInt(e.content, 10) || 1), 0), first: Math.min(...rows.map(e => e.created_at)), last: Math.max(...rows.map(e => e.created_at)) };
  } catch { return null; }
}
async function beacon() {
  if (!you.fresh || owner.sk || !env.NT || localStorage.getItem(BEACON_OFF) === day()) return;
  let sk; try { const raw = localStorage.getItem(BEACON_KEY); sk = raw ? env.NT.nip19.decode(raw).data : null; } catch { sk = null; }
  if (!sk) { sk = env.NT.generateSecretKey(); try { localStorage.setItem(BEACON_KEY, env.NT.nip19.nsecEncode(sk)); } catch {} }
  try {
    const tmpl = { kind: VISIT_KIND, pubkey: env.NT.getPublicKey(sk), created_at: now(), tags: [['d', VISIT_D]], content: String(you.v) };
    const ev = env.NT.finalizeEvent(await mine(tmpl, VISIT_POW), sk);
    const res = await publish(ev, [env.PRIMARY]);
    if (!res[0]?.ok && /restricted|blocked/.test(res[0]?.msg || '')) localStorage.setItem(BEACON_OFF, day()); // the door is closed today; try again tomorrow
  } catch {}
}

// ---- whispers -----------------------------------------------------------------------
const H = () => new Date().getHours(), DOW = () => new Date().getDay(), onPage = () => (Date.now() - visitStart) / 1000;
const TZ = () => new Date().getTimezoneOffset(), toronto = () => [240, 300].includes(TZ());
const mq = q => typeof matchMedia === 'function' && matchMedia(q).matches, touch = mq('(pointer: coarse)'), reduced = mq('(prefers-reduced-motion: reduce)');
const EGGS = [
  { id: 'ref-github', when: () => refHost() === 'github.com', text: 'came in from github. the code for this page lives in the same account.' },
  { id: 'ref-paper', when: () => /openreview\.net|arxiv\.org|zenodo\.org|doi\.org/.test(refHost()), text: 'came in from the paper. the pdf here is the same build, thirty pages.' },
  { id: 'ref-linkedin', when: () => /linkedin\.com/.test(refHost()), text: 'from linkedin. this is the version with the negative results left in.' },
  { id: 'ref-nostr', when: () => /njump\.me|primal\.net|damus|nostr/.test(refHost()), text: 'came through nostr. every block on this page is an event, so you are home.' },
  { id: 'longgap', when: () => you.v > 1 && you.gapDays >= 30, text: () => `welcome back after ${you.gapDays} days. the relay kept everything for you.` },
  { id: 'ronish', once: 'day', when: () => [...peers.values()].some(p => p.owner), text: 'Ronish is on this page right now. say hi in the chat and it reaches him within seconds.' },
  { id: 'busy', once: 'day', when: () => peers.size >= 3, text: () => `busy today: ${peers.size} others are reading right now.` },
  { id: 'first', when: () => you.v === 1 && onPage() >= 25, text: 'first time here. hover any · event link and you will see the signed event behind the block.' },
  { id: 'back2', when: () => you.v === 2, text: 'second visit. this page remembers you on your side only; nothing about you leaves this browser.' },
  { id: 'back3', when: () => you.v >= 3 && !messaged(), text: 'third visit and no hello yet? the box on the right needs no account, only a moment of proof of work.' },
  { id: 'regular', when: () => you.v >= 5, text: () => `visit number ${you.v}. at this point we are basically colleagues.` },
  { id: 'late', once: 'day', when: () => H() >= 1 && H() <= 4, text: () => `it is ${H()} in the morning where you are. the relay never sleeps either.` },
  { id: 'early', once: 'day', when: () => H() >= 5 && H() <= 6, text: 'up early. the relay was up all night, and nothing changed.' },
  { id: 'friday', once: 'day', when: () => DOW() === 5 && H() >= 17, text: 'friday evening on a personal website. respect.' },
  { id: 'sunday', once: 'day', when: () => DOW() === 0, text: 'sunday reading. the garden is the quiet part of this page.' },
  { id: 'halloween', once: 'day', when: () => /-10-31$/.test(day()), text: 'happy halloween. the rain is the same colour as always, sorry.' },
  { id: 'newyear', once: 'day', when: () => /-01-01$/.test(day()), text: 'happy new year. the timechain does not do years, only blocks.' },
  { id: 'far', when: () => Math.abs(TZ() - 270) >= 480, text: 'you are a long way from toronto. the relay is here in the same city, so hello from it.' },
  { id: 'toronto', when: () => toronto() && (navigator.language || '').startsWith('en'), text: 'toronto? the skating card is live city data, in season.' },
  { id: 'lang', when: () => !(navigator.language || 'en').startsWith('en'), text: 'the page is in english only, but the events do not care what language you read.' },
  { id: 'mobile', when: () => touch && innerWidth < 700, text: 'on a phone the chat works fine; the 3d chain in the archive wants a bigger screen.' },
  { id: 'wide', when: () => innerWidth >= 2400, text: 'that is a wide screen. the rain likes it.' },
  { id: 'narrow', when: () => innerWidth < 360, text: 'tight fit. the page reflows down to 320 pixels and no further.' },
  { id: 'reduced', when: () => reduced, text: 'reduced motion respected: no rain, no drifting dots.' },
  { id: 'paper', when: () => dwell >= 40, text: 'the honest part of the paper is where the method loses. it is in the results, not tucked in an appendix.' },
  { id: 'pdf', text: 'that pdf is thirty pages. the audit tables are the appendices.' },
  { id: 'bottom', when: () => depth >= 0.98 && onPage() >= 8, text: 'you reached the bottom. the colophon explains how the page checks its own integrity.' },
  { id: 'bottomfast', when: () => depth >= 0.98 && onPage() < 8, text: 'that was quick. the good bits are in the middle.' },
  { id: 'colophon', text: 'yes, the favicon really is the key. the colophon tells you how to decode it.' },
  { id: 'mural', text: 'every tile is proof of work that someone\'s browser did. yours would take about a second.' },
  { id: 'garden', text: 'plant a word and Bip, a seven-million-parameter model, works it into a story.' },
  { id: 'planted', text: 'eighteen bits later, your word is on my relay. it stays.' },
  { id: 'eventlink', text: 'that is the raw event on a public relay. this page is only a renderer for it.' },
  { id: 'npub', text: 'that key signs every block here. compare it with the favicon, pixel by pixel.' },
  { id: 'flips', when: () => you.flips >= 2, text: 'cannot decide? me neither. calm prints better, wild boots faster.' },
  { id: 'copy', text: 'copied. if it is from the paper, the doi is on the writing card.' },
  { id: 'print', text: 'printing this page? the résumé page has a print stylesheet; this one just goes dark on paper.' },
  { id: 'idle', once: 'day', when: () => !document.hidden && Date.now() - lastInput > 180000, text: 'still there? the page keeps its subscriptions open; anything new shows up by itself.' },
  { id: 'away', once: 'day', text: 'welcome back. nothing changed, or the relay would have said so.' },
  { id: 'long', once: 'day', when: () => onPage() >= 1200, text: 'twenty minutes here. that is longer than most reviewers spend on a paper.' },
  { id: 'konami', text: 'konami. nothing unlocks, but you found the one thing on this page that is not signed.' },
  { id: 'hi', text: 'hi. the chat box is on the right, and it does not need a name.' },
  { id: 'relay', once: 'day', text: 'one relay is down. the others carry the page; that is the point of having four.' },
  { id: 'offline', once: 'day', text: 'you are offline. what you see is what this browser verified earlier.' },
];
const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.isContentEditable); };
const done = e => e.once === 'day' ? you.eggs[e.id] === day() : !!you.eggs[e.id];
function canWhisper() { return whisper && !whisper.classList.contains('on') && you.w.n < 2 && Date.now() - (you.w.at || 0) > 90000 && onPage() >= 25 && !typing(); }
function say(e) {
  const text = typeof e.text === 'function' ? e.text() : e.text; if (!text) return;
  you.eggs[e.id] = e.once === 'day' ? day() : 1; you.w = { n: (you.w.n || 0) + 1, at: Date.now() }; saveYou();
  whisper.textContent = text; whisper.classList.add('on');
  clearTimeout(whisper._t); whisper._t = setTimeout(() => whisper.classList.remove('on'), 9000);
}
function poke(id) { const e = EGGS.find(x => x.id === id); if (e && !done(e) && canWhisper() && (!e.when || e.when())) say(e); }
function ambient() { if (!canWhisper()) return; for (const e of EGGS) if (e.when && !done(e)) { let ok = false; try { ok = e.when(); } catch {} if (ok) return say(e); } }

// ---- wiring ---------------------------------------------------------------------------
function ready() { return new Promise(res => { const t = setInterval(() => { if (pool && env.NT) { clearInterval(t); res(); } }, 300); setTimeout(() => { clearInterval(t); res(); }, 20000); }); }
export async function start() {
  if (started) return; started = true;
  loadYou(); beginVisit();
  layer = el('div', 'presence-layer'); chip = el('button', 'presence-chip alone'); chip.type = 'button'; panel = el('div', 'presence-panel'); panel.hidden = true; whisper = el('div', 'whisper');
  chip.onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) fill(); };
  whisper.onclick = () => whisper.classList.remove('on');
  document.addEventListener('click', e => { if (!panel.hidden && !panel.contains(e.target) && e.target !== chip) panel.hidden = true; });
  await ready(); if (!env.NT) return;
  mySk = env.NT.generateSecretKey(); myPk = env.NT.getPublicKey(mySk); hue = parseInt(myPk.slice(0, 4), 16) % 360;
  count(); listen(); beat(true);
  setInterval(() => { beat(false); prune(); draw(); ambient(); }, 5000);
  setInterval(() => { if (where()?.s === 'writing') dwell += 5; }, 5000);
  setTimeout(beacon, 15000);
  addEventListener('pointermove', e => { pointerX = clamp(e.clientX / innerWidth); lastInput = Date.now(); }, { passive: true });
  addEventListener('scroll', () => { lastInput = Date.now(); depth = (scrollY + innerHeight) / Math.max(1, document.documentElement.scrollHeight); draw(); beat(false); if (depth >= 0.98) poke(onPage() < 8 ? 'bottomfast' : 'bottom'); }, { passive: true });
  addEventListener('resize', draw); addEventListener('touchstart', () => { lastInput = Date.now(); }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { hiddenAt = Date.now(); bye(); } else { lastBeat = 0; beat(true); if (hiddenAt && Date.now() - hiddenAt > 600000) poke('away'); } });
  addEventListener('pagehide', bye);
  document.addEventListener('toggle', e => { const d = e.target; if (d?.tagName === 'DETAILS' && d.open) { draw(); if (['colophon', 'mural', 'garden'].includes(d.id)) poke(d.id); } }, true);
  document.addEventListener('click', e => { const a = e.target.closest?.('a, button'); if (!a) return;
    if (a.matches('a.ev')) poke('eventlink'); else if (a.matches('a.pill[href*="njump.me/npub"]')) poke('npub');
    else if (a.matches('a[href*="doi.org"], a[href$=".pdf"]')) poke('pdf'); else if (a.id === 'wildpill') { you.flips = (you.flips || 0) + 1; saveYou(); poke('flips'); } });
  document.addEventListener('copy', () => poke('copy')); addEventListener('beforeprint', () => poke('print')); addEventListener('offline', () => poke('offline'));
  document.addEventListener('pow', e => { if (e.detail?.done && e.detail.bits === 18) poke('planted'); });
  document.addEventListener('keydown', e => { lastInput = Date.now(); if (typing() || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; keys = (keys + '\u0001' + k).slice(-160);
    const seq = keys.split('\u0001').slice(1);
    if (seq.slice(-10).join(',') === 'ArrowUp,ArrowUp,ArrowDown,ArrowDown,ArrowLeft,ArrowRight,ArrowLeft,ArrowRight,b,a') poke('konami');
    const word = seq.filter(x => x.length === 1).slice(-5).join(''); if (/(^|[^a-z])(hi|hello)$/.test(word)) poke('hi'); });
  onChange(() => { for (const u of env.RELAYS) if (store.status.get(u) === 'closed') return poke('relay'); });
}

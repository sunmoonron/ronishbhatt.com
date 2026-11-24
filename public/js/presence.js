// presence.js: who else is on this page right now, what this browser remembers
// about its own visits, and the achievements those two things unlock.
//
// Presence is an ephemeral event (kind 20718; relays hand it on and drop it)
// sent through the public relays every twenty seconds: a section id, a position
// inside it, a hue. No name, no message, nothing stored anywhere. The key that
// signs it lives in this tab's session storage, so a reload is the same reader
// rather than a second one; a duplicated tab, which copies session storage,
// notices the clash over a BroadcastChannel and takes a fresh key. Other
// readers orbit the key: in wild mode around the icon in the orbit HUD,
// otherwise around the icon in the header, so phones get them too. The orbit is
// a CSS animation; the only script work is deciding which icon to circle.
// The visit counter is one addressable note per browser on my relay (kind
// 30078, d = rb.visit, sixteen bits of work) that the relay's write policy has
// to admit. Each fresh visit first sends the note unmined: a refusal that asks
// for work means the door is open and the note gets mined, any other refusal
// means it is closed, and then this browser does no work at all that day.
// Achievements: ninety-nine of them, in the spirit of jmtb02's Achievement
// Unlocked. The ones you cause appear at once at the top of the screen and
// stack; the ones the page notices on its own wait 25 seconds, keep a minute
// apart and stop at three a visit; none interrupts typing, they wait for the
// pause. Each unlocks once per browser, and nothing about any of it leaves it.
import { env, withPool, publish, mine, owner, store, onChange } from './store.js';

const KIND = 20718, TAG = 'rb.presence', BEAT = 20, TTL = 60;
const VISIT_KIND = 30078, VISIT_D = 'rb.visit', VISIT_POW = 16;
const YOU = 'rb.you', ME = 'rb.presence.sk', BEACON_KEY = 'rb.beacon.nsec', BEACON_OFF = 'rb.beacon.off', OWNER_ON = 'rb.presence.owner', SOUND = 'rb.ach.sound';
const NAME = { me: 'the top', courses: 'the course list', projects: 'the projects', writing: 'the paper', chat: 'the chat', archive: 'the archive', colophon: 'the colophon', notes: 'the notes' };
const now = () => Math.floor(Date.now() / 1000), day = () => new Date().toISOString().slice(0, 10);
const clamp = v => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; (parent || document.body).append(e); return e; };
const ago = ts => { const s = now() - ts; return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][Math.min(n % 10, 4)] || 'th');
const mq = q => typeof matchMedia === 'function' && matchMedia(q).matches;
const hexOf = b => [...b].map(x => x.toString(16).padStart(2, '0')).join(''), bytesOf = h => Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16)));

let P = null, you = null, mySk = null, myPk = null, hue = 0, sub = null, tabs = null, io = null, orbitEl, ring, mode = '', chip, panel, stack;
let peers = new Map(), lastBeat = 0, lastSection = '', pointerX = 0.5, started = false, global = null, globalAt = 0;
const TAB = Math.random().toString(36).slice(2), watched = new WeakSet();
// this page load only
const S = { t0: Date.now(), input: Date.now(), keyAt: 0, hiddenAt: 0, dwell: 0, depth: 0, bottomed: false, keys: '', mouse: 0, lastX: null, lastY: null, scrollY: 0, dir: 0, turns: 0, firstScroll: 0,
  burst: [], quietUntil: Date.now() + 1500, arrows: new Set(), esc: 0, tabs: 0, hadPeers: false, mining: false, lastAction: 0, hoverT: 0, wasOpen: new Set(), pending: [], backForward: false };

// ---- what this browser remembers, on this side only -----------------------------
function loadYou() { try { you = JSON.parse(localStorage.getItem(YOU) || 'null'); } catch { you = null; } if (!you || typeof you !== 'object') you = { v: 0, first: now(), last: 0 }; for (const k of ['eggs', 'seen', 'folds']) you[k] ||= {}; you.w ||= { n: 0, at: 0 }; you.loads ||= []; you.days ||= []; for (const k of ['flips', 'clicks', 'scrollPx']) you[k] ||= 0; }
function saveYou() { try { localStorage.setItem(YOU, JSON.stringify(you)); } catch {} }
function beginVisit() {
  const gap = you.last ? now() - you.last : 0, fresh = !you.last || gap > 1800;
  you.gapDays = fresh && you.last ? Math.floor(gap / 86400) : 0;
  if (fresh) { you.v = (you.v || 0) + 1; you.w = { n: 0, at: 0 }; you.fresh = true; } else you.fresh = false;
  you.loads = you.loads.filter(t => now() - t < 900).concat(now()).slice(-12);
  if (!you.days.includes(day())) you.days = you.days.concat(day()).slice(-14);
  you.last = now(); saveYou();
  setInterval(() => { you.last = now(); saveYou(); }, 60000);
}
const chatCache = () => { try { return JSON.parse(localStorage.getItem('rb.chat.visitor.v1') || '[]'); } catch { return []; } };
const messaged = () => chatCache().some(t => (t.msgs || []).some(m => m.mine));
const replied = () => chatCache().some(t => (t.msgs || []).some(m => !m.mine));
const refHost = () => { try { return document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch { return ''; } };
const streak = n => { const d = you.days.map(s => Date.parse(s) / 86400000); let run = 1; for (let i = d.length - 1; i > 0 && run < n; i--) { if (d[i] - d[i - 1] === 1) run++; else break; } return run >= n; };

// ---- where this reader is, as a section and a fraction of it ----------------------
const sections = () => [...document.querySelectorAll('main > header.me, main section.c, main details.fold')];
const idOf = e => e.id || (e.matches('header.me') ? 'me' : '');
function where() {
  const vh = innerHeight, mid = vh / 2; let best = null, bestVis = 0;
  for (const e of sections()) { const r = e.getBoundingClientRect(), vis = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)); if (vis > bestVis) { bestVis = vis; best = { e, r }; } }
  if (!best) return null;
  return { s: idOf(best.e), y: clamp((mid - best.r.top) / Math.max(1, best.r.height)), x: pointerX };
}
// a section counts as seen when half of it, or half the screen, was it: small folds and the header count too
function watchSections() {
  if (typeof IntersectionObserver !== 'function') return;
  io ||= new IntersectionObserver(es => { for (const x of es) { const id = idOf(x.target); if (id && (x.intersectionRatio >= 0.5 || x.intersectionRect.height >= 0.5 * innerHeight)) you.seen[id] = 1; } }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
  for (const e of sections()) if (!watched.has(e)) { watched.add(e); io.observe(e); }
}

// ---- one presence key per tab: a reload is the same reader ------------------------
function myKey(fresh) {
  let sk = null;
  if (!fresh) try { const h = sessionStorage.getItem(ME) || ''; if (/^[0-9a-f]{64}$/.test(h)) sk = bytesOf(h); } catch {}
  if (!sk) { sk = env.NT.generateSecretKey(); try { sessionStorage.setItem(ME, hexOf(sk)); } catch {} }
  mySk = sk; myPk = env.NT.getPublicKey(sk); hue = parseInt(myPk.slice(0, 4), 16) % 360; peers.delete(myPk);
}
function siblings() { // other tabs of this page in this browser; a duplicated tab copied my session key, so the newcomer moves
  if (typeof BroadcastChannel !== 'function') return;
  tabs = new BroadcastChannel('rb.presence');
  tabs.onmessage = ({ data: m }) => { if (!m || m.tab === TAB) return;
    if (m.t === 'hello') tabs.postMessage({ t: 'here', tab: TAB, pk: myPk });
    if (m.t === 'here' && m.pk === myPk) { myKey(true); lastBeat = 0; beat(true); }
    poke('doppelganger', 'event'); };
  tabs.postMessage({ t: 'hello', tab: TAB, pk: myPk });
}

// ---- the heartbeat out, the others in -------------------------------------------
const asOwner = () => !!(owner.sk && sessionStorage.getItem(OWNER_ON) === '1');
function beat(force) {
  if (!P || !env.NT || !mySk || document.hidden) return;
  const w = where(); if (!w) return;
  const due = now() - lastBeat >= BEAT, moved = w.s !== lastSection && now() - lastBeat >= 4;
  if (!force && !due && !moved) return;
  lastBeat = now(); lastSection = w.s;
  const tmpl = { kind: KIND, created_at: now(), tags: [['t', TAG], ['expiration', String(now() + TTL + 30)]], content: JSON.stringify({ v: 1, s: w.s, y: +w.y.toFixed(3), x: +w.x.toFixed(3), h: hue }) };
  try { const ev = env.NT.finalizeEvent(tmpl, asOwner() ? owner.sk : mySk); publish(ev, asOwner() ? env.RELAYS : env.BACKUPS).catch(() => {}); } catch {}
}
function bye() { if (!P || !env.NT || !mySk) return; try { const ev = env.NT.finalizeEvent({ kind: KIND, created_at: now(), tags: [['t', TAG]], content: JSON.stringify({ v: 1, gone: 1 }) }, asOwner() ? owner.sk : mySk); publish(ev, asOwner() ? env.RELAYS : env.BACKUPS).catch(() => {}); } catch {} }
function listen() { if (sub || !P) return; sub = P.subscribe(env.RELAYS, { kinds: [KIND], '#t': [TAG], since: now() - TTL }, { label: 'presence', onevent: onBeat }); }
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
  peers.set(ev.pubkey, p); S.hadPeers = true; draw(); count();
  if (isOwner) poke('ronish', 'event'); if (peers.size >= 3) poke('busy', 'event');
}
function prune() { let gone = false; for (const [k, p] of peers) if (p.seen < now() - TTL) { p.el?.remove(); peers.delete(k); gone = true; } if (gone) count(); }

// ---- readers orbit the key: a CSS animation inside the HUD, or around the header icon -----
function draw() {
  for (const p of peers.values()) {
    if (p.el) continue;
    const n = parseInt(p.pk.slice(4, 10), 16);
    p.el = el('span', 'presence-dot' + (p.owner ? ' owner' : ''), orbitEl);
    p.el.style.setProperty('--h', p.h); p.el.style.setProperty('--dur', `${12 + n % 11}s`); p.el.style.setProperty('--delay', `-${n % 23}s`); p.el.style.setProperty('--dir', n % 2 ? 'reverse' : 'normal');
    const i = el('i', '', p.el); if (p.owner) { const img = el('img', '', i); img.src = env.ICON; img.alt = ''; el('b', '', i).textContent = 'Ronish'; }
    requestAnimationFrame(() => p.el.classList.add('on'));
  }
}
function mount() { // which icon to circle: the HUD's canvas when it is on screen, the header's image otherwise
  const c = document.querySelector('#orbit canvas'), cr = c && c.getBoundingClientRect();
  if (cr && cr.width > 0) {
    const k = cr.width / 240; // the canvas is 240 x 150 units; the relays ride R = 42 + 14 i squashed by 0.55, so readers take R = 98
    if (mode !== 'hud') { mode = 'hud'; c.parentElement.append(orbitEl); ring.hidden = false; }
    orbitEl.style.transform = `translate(${(c.offsetLeft + cr.width / 2).toFixed(1)}px, ${(c.offsetTop + cr.height / 2).toFixed(1)}px) scale(${k.toFixed(4)}, ${(0.55 * k).toFixed(4)})`;
    orbitEl.style.setProperty('--r', '98px'); orbitEl.style.setProperty('--isx', (1 / k).toFixed(4)); orbitEl.style.setProperty('--isy', (1 / (0.55 * k)).toFixed(4));
    return;
  }
  const img = document.querySelector('main > header.me img'), ir = img && img.getBoundingClientRect();
  if (!ir || !ir.width) return;
  if (mode !== 'head') { mode = 'head'; document.body.append(orbitEl); ring.hidden = true; }
  orbitEl.style.transform = `translate(${(ir.left + scrollX + ir.width / 2).toFixed(1)}px, ${(ir.top + scrollY + ir.height / 2).toFixed(1)}px) scale(0.7, 0.86)`;
  orbitEl.style.setProperty('--r', `${ir.width.toFixed(1)}px`); orbitEl.style.setProperty('--isx', (1 / 0.7).toFixed(4)); orbitEl.style.setProperty('--isy', (1 / 0.86).toFixed(4));
}
function count() {
  const n = peers.size, ownerHere = [...peers.values()].some(p => p.owner);
  chip.classList.toggle('alone', n === 0);
  chip.textContent = ''; el('i', '', chip); chip.append(n === 0 ? 'just you' : ownerHere ? (n === 1 ? 'Ronish is here' : `Ronish + ${n - 1}`) : `${n} reading`);
  chip.title = n === 0 ? 'nobody else is on this page right now' : 'who else is reading this page';
  const hud = document.getElementById('orbit');
  if (hud) { let cap = hud.querySelector('.presence-cap'); if (!cap) cap = el('div', 'presence-cap', hud); cap.textContent = n === 0 ? 'readers: just you' : `readers: you and ${n} other${n > 1 ? 's' : ''}`; }
  if (!panel.hidden) fill();
}
function fill() {
  const groups = {}; for (const p of peers.values()) groups[p.s] = (groups[p.s] || 0) + 1;
  const list = Object.entries(groups).map(([s, n]) => `${n} on ${NAME[s] || s}`).join(', ');
  const got = A.filter(e => you.eggs[e.id]), lines = [];
  lines.push(peers.size ? `<p><b>right now</b> ${peers.size} other${peers.size > 1 ? 's' : ''} reading: ${list}. they orbit the key ${mode === 'hud' ? 'in the corner' : 'at the top'}.</p>` : '<p><b>right now</b> nobody else. other readers orbit the key while they are here.</p>');
  lines.push(`<p><b>you</b> ${you.v <= 1 ? 'first time here' : `${ordinal(you.v)} visit, first on ${new Date(you.first * 1000).toISOString().slice(0, 10)}`}${you.gapDays >= 2 ? `, last time ${you.gapDays} days ago` : ''}. remembered by this browser only.</p>`);
  lines.push(`<p><b>achievements</b> ${got.length} of ${A.length}${got.length ? ': ' + got.slice(-40).map(e => `<span class="got" title="${(typeof e.text === 'function' ? '' : e.text).replace(/"/g, '&quot;')}">${e.icon} ${e.title}</span>`).join(' ') + (got.length > 40 ? ` and ${got.length - 40} more` : '') : ''}.</p>`);
  if (global && global.unique) lines.push(`<p><b>everyone</b> ${global.unique} browser${global.unique > 1 ? 's' : ''} left a visit note on my relay since ${new Date(global.first * 1000).toISOString().slice(0, 10)}, ${global.visits} visits in all, the last one ${ago(global.last)}.</p>`);
  lines.push(`<label><input type="checkbox" id="ach-sound" ${localStorage.getItem(SOUND) !== '0' ? 'checked' : ''}> a small chime when you unlock one</label>`);
  if (owner.sk) lines.push(`<label><input type="checkbox" id="presence-owner" ${asOwner() ? 'checked' : ''}> appear to visitors as Ronish (a beat signed by the site key every ${BEAT} s while this tab is open)</label>`);
  lines.push('<p><small>presence is an ephemeral event through the public relays: no name, nothing stored, one key per tab that goes when the tab does.</small></p>');
  panel.innerHTML = lines.join('');
  panel.querySelector('#ach-sound')?.addEventListener('change', e => { try { localStorage.setItem(SOUND, e.target.checked ? '1' : '0'); } catch {} });
  panel.querySelector('#presence-owner')?.addEventListener('change', e => { sessionStorage.setItem(OWNER_ON, e.target.checked ? '1' : '0'); beat(true); });
  if (!global || now() - globalAt > 60) fetchGlobal().then(g => { if (g) { global = g; globalAt = now(); if (!panel.hidden) fill(); } });
}

// ---- the visit counter on my relay, if its policy lets a browser in ---------------
async function fetchGlobal() {
  if (!P || typeof P.querySync !== 'function') return null;
  try {
    const evs = await P.querySync([env.PRIMARY], { kinds: [VISIT_KIND], '#d': [VISIT_D], limit: 1000 }, { maxWait: 6000 });
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
    // ask before working: the unmined note is refused either for want of work (the door is open) or outright (it is not)
    const probe = (await publish(env.NT.finalizeEvent({ ...tmpl, tags: [['d', VISIT_D], ['nonce', '0', String(VISIT_POW)]] }, sk), [env.PRIMARY]))[0];
    if (probe?.ok) return; // one in 65,536 probes carries the work by luck: that is the note
    if (!/^pow/.test(probe?.msg || '')) { localStorage.setItem(BEACON_OFF, day()); return; }
    S.mining = true; const mined = await mine(tmpl, VISIT_POW); S.mining = false;
    await publish(env.NT.finalizeEvent(mined, sk), [env.PRIMARY]);
  } catch { S.mining = false; }
}

// ---- ninety-nine achievements ------------------------------------------------------------
const H = () => new Date().getHours(), DOW = () => new Date().getDay(), onPage = () => (Date.now() - S.t0) / 1000;
const TZ = () => new Date().getTimezoneOffset(), toronto = () => [240, 300].includes(TZ());
const reduced = mq('(prefers-reduced-motion: reduce)');
const fullscreen = () => !!document.fullscreenElement || mq('(display-mode: fullscreen)') || (screen.width - innerWidth < 4 && screen.height - innerHeight < 4 && innerWidth > 0);
const unlocked = () => A.filter(e => you.eggs[e.id]).length;
// `when`: the page can notice it on its own; without, something you do pokes it; `meta` ones follow other unlocks
const A = [
  { id: 'first', icon: '🌱', title: 'First Visit', when: () => you.v === 1, text: 'first time here. every block has a ⌁ event link: that is the signed event behind it.' },
  { id: 'back2', icon: '🔁', title: 'Came Back', when: () => you.v === 2, text: 'second visit. this page remembers you on your side only; nothing about you leaves this browser.' },
  { id: 'back3', icon: '🤔', title: 'Third Time, No Hello', when: () => you.v >= 3 && !messaged(), text: 'third visit and no hello yet? the chat box needs no account, only a moment of proof of work.' },
  { id: 'regular', icon: '☕', title: 'Regular', when: () => you.v >= 5, text: () => `visit number ${you.v}. at this point we are basically colleagues.` },
  { id: 'seven', icon: '🎰', title: 'Lucky Seven', when: () => you.v >= 7, text: 'seven visits. the relay has seen you more often than most of my friends have.' },
  { id: 'twenty', icon: '🔟', title: 'Twenty Visits', when: () => you.v >= 20, text: 'twenty visits. you could probably reproduce the paper from memory by now.' },
  { id: 'longgap', icon: '🕰️', title: 'Long Time No See', when: () => you.v > 1 && you.gapDays >= 30, text: () => `welcome back after ${you.gapDays} days. the relay kept everything for you.` },
  { id: 'streak3', icon: '🔥', title: 'Three Days Running', when: () => streak(3), text: 'three days in a row. nothing changes that fast here, but thank you.' },
  { id: 'reload5', icon: '♻️', title: 'Refresh Enjoyer', when: () => you.loads.length >= 5, text: 'five loads in fifteen minutes. the relay would have told the page if anything had changed.' },
  { id: 'ref-github', icon: '🐙', title: 'Came From the Source', when: () => refHost() === 'github.com', text: 'came in from github. the code for this page lives in the same account.' },
  { id: 'ref-paper', icon: '📄', title: 'Read the Paper First', when: () => /openreview\.net|arxiv\.org|zenodo\.org|doi\.org/.test(refHost()), text: 'came in from the paper. the pdf here is the same build, thirty pages.' },
  { id: 'ref-linkedin', icon: '👔', title: 'Escaped LinkedIn', when: () => /linkedin\.com/.test(refHost()), text: 'from linkedin. this is the version with the negative results left in.' },
  { id: 'ref-nostr', icon: '🟣', title: 'Came Through the Relay', when: () => /njump\.me|primal\.net|damus|nostr/.test(refHost()), text: 'came through nostr. every block on this page is an event, so you are home.' },
  { id: 'ref-search', icon: '🔎', title: 'Searched', when: () => /google\.|bing\.com|duckduckgo|kagi\.com|yandex|baidu/.test(refHost()), text: 'a search engine sent you. it indexed the pre-rendered copy; you are reading the live one.' },
  { id: 'lost-found', icon: '🧭', title: 'Lost and Found', when: () => refHost() === location.hostname && location.hash === '#archive', text: 'you hit a page that does not exist and found the archive. that is the right instinct.' },
  { id: 'deep-link', icon: '🔗', title: 'Deep Link', when: () => location.hash.length > 1, text: 'arrived by a deep link. the page opened the fold for you.' },
  { id: 'time-travel', icon: '⏪', title: 'Time Traveller', when: () => S.backForward || performance.getEntriesByType?.('navigation')?.[0]?.type === 'back_forward', text: 'back button. the page rebuilt itself from what your browser had already verified.' },
  { id: 'late', icon: '🦉', title: 'Night Owl', when: () => H() >= 1 && H() <= 4, text: () => `it is ${H()} in the morning where you are. the relay never sleeps either.` },
  { id: 'early', icon: '🌅', title: 'Early Bird', when: () => H() >= 5 && H() <= 6, text: 'up early. the relay was up all night, and nothing changed.' },
  { id: 'midnight', icon: '🕛', title: 'Midnight', when: () => H() === 0, text: 'midnight. the timechain has a new block about every ten minutes regardless.' },
  { id: 'monday', icon: '😩', title: 'Monday', when: () => DOW() === 1 && H() < 10, text: 'monday morning on a personal website. we all cope differently.' },
  { id: 'friday', icon: '🍻', title: 'Friday Evening', when: () => DOW() === 5 && H() >= 17, text: 'friday evening on a personal website. respect.' },
  { id: 'sunday', icon: '🛋️', title: 'Sunday Reader', when: () => DOW() === 0, text: 'sunday reading. the archive is the quiet part of this page.' },
  { id: 'halloween', icon: '🎃', title: 'Spooky', when: () => /-10-31$/.test(day()), text: 'happy halloween. the rain is the same colour as always, sorry.' },
  { id: 'newyear', icon: '🎆', title: 'New Year', when: () => /-01-01$/.test(day()), text: 'happy new year. the timechain does not do years, only blocks.' },
  { id: 'far', icon: '🌍', title: 'Far From Toronto', when: () => Math.abs(TZ() - 270) >= 480, text: 'you are a long way from toronto. the relay is here in the same city, so hello from it.' },
  { id: 'toronto', icon: '🍁', title: 'Toronto', when: () => toronto(), text: 'toronto? the skating card is live city data, in season.' },
  { id: 'lang', icon: '🌐', title: 'Polyglot', when: () => !(navigator.language || 'en').startsWith('en'), text: 'the page is in english only, but the events do not care what language you read.' },
  { id: 'mobile', icon: '📱', title: 'Small Screen', when: () => innerWidth < 700, text: 'under 700 pixels wide. the page folds into one column and the chat moves up to meet you.' },
  { id: 'wide', icon: '🖥️', title: 'Big Screen', when: () => innerWidth >= 2400, text: 'that is a wide screen. the rain likes it.' },
  { id: 'narrow', icon: '🔬', title: 'Tiny Screen', when: () => innerWidth < 360, text: 'tight fit. the page reflows down to 320 pixels and no further.' },
  { id: 'reduced', icon: '🧘', title: 'Still Waters', when: () => reduced, text: 'reduced motion respected: no rain, and the readers barely drift.' },
  { id: 'calm', icon: '🍃', title: 'Calm', when: () => !document.documentElement.classList.contains('wild'), text: 'calm mode. the same signed events, without the weather.' },
  { id: 'paper', icon: '🔍', title: 'Close Reader', when: () => S.dwell >= 40, text: 'the honest part of the paper is where the method loses. it is in the results, not tucked in an appendix.' },
  { id: 'bottom', icon: '🏁', title: 'Reached the Bottom', when: () => S.depth >= 0.98 && onPage() >= 8, text: 'you reached the bottom. the colophon explains how the page checks its own integrity.' },
  { id: 'bottomfast', icon: '🏎️', title: 'Speedrun', when: () => S.depth >= 0.98 && onPage() < 8, text: 'that was quick. the good bits are in the middle.' },
  { id: 'full-circle', icon: '⭕', title: 'Full Circle', text: 'bottom, then all the way back up. the header did not change while you were gone.' },
  { id: 'instant', icon: '⚡', title: 'Impatient', when: () => S.firstScroll > 0 && S.firstScroll < 1.2, text: 'scrolled within a second of arriving. same.' },
  { id: 'grand-tour', icon: '🗺️', title: 'Grand Tour', when: () => { const s = sections(); return s.length > 0 && s.every(e => you.seen[idOf(e)]); }, text: 'every section, seen. the folds count too.' },
  { id: 'all-folds', icon: '📂', title: 'Opened Everything', when: () => { const d = [...document.querySelectorAll('main details')]; return d.length > 0 && d.every(x => you.folds[x.id || 'x']); }, text: 'every fold on the page, opened. nothing was hidden, but now you know.' },
  { id: 'ping-pong', icon: '🏓', title: 'Ping Pong', when: () => S.turns >= 20, text: 'twenty changes of direction. the page does not mind being reread.' },
  { id: 'rollercoaster', icon: '🎢', title: 'Rollercoaster', when: () => you.scrollPx >= 10 * Math.max(3000, document.documentElement.scrollHeight), text: 'you have scrolled this page ten times over, across visits. that is a lot of residual stream.' },
  { id: 'speed-scroller', icon: '🚀', title: 'Speed Scroller', text: 'five thousand pixels a second. the rain could not keep up.' },
  { id: 'mouse-marathon', icon: '🐭', title: 'Mouse Marathon', when: () => S.mouse >= 50000, text: 'fifty thousand pixels of cursor travel in one visit. a small marathon.' },
  { id: 'statue', icon: '🗿', title: 'Statue', when: () => !document.hidden && Date.now() - S.input > 60000, text: 'a full minute without moving. the page stayed subscribed the whole time.' },
  { id: 'idle', icon: '💤', title: 'Deep Idle', when: () => !document.hidden && Date.now() - S.input > 180000, text: 'still there? the page keeps its subscriptions open; anything new shows up by itself.' },
  { id: 'long', icon: '⏳', title: 'Twenty Minutes', when: () => onPage() >= 1200, text: 'twenty minutes here. that is longer than most reviewers spend on a paper.' },
  { id: 'hour', icon: '⏰', title: 'An Hour', when: () => onPage() >= 3600, text: 'an hour on one page. i hope the chat was involved.' },
  { id: 'alone', icon: '🏝️', title: 'Alone', when: () => onPage() >= 600 && !S.hadPeers, text: 'ten minutes and nobody else came. it is a personal website; that is normal.' },
  { id: 'busy', icon: '🎉', title: 'Crowd', when: () => peers.size >= 3, text: () => `busy right now: ${peers.size} others are reading.` },
  { id: 'doppelganger', icon: '🪞', title: 'Doppelgänger', text: 'this page in two tabs at once. presence counts you twice now, which is technically correct.' },
  { id: 'ronish', icon: '👋', title: 'Ronish Is Here', when: () => [...peers.values()].some(p => p.owner), text: 'Ronish is on this page right now. say hi in the chat and it arrives within seconds.' },
  { id: 'four-relays', icon: '🛰️', title: 'All Relays Green', when: () => env.RELAYS.length > 0 && env.RELAYS.every(u => store.status.get(u) === 'open'), text: 'all four relays connected at once. redundancy is the whole point of four.' },
  { id: 'relay', icon: '📡', title: 'Relay Down', text: 'a relay dropped. the others carry the page; that is the point of having four.' },
  { id: 'offline', icon: '✈️', title: 'Offline Mode', text: 'you are offline. what you see is what this browser verified earlier.' },
  { id: 'pdf', icon: '📚', title: 'Thirty Pages', text: 'that pdf is thirty pages. the audit tables are the appendices.' },
  { id: 'resume', icon: '📄', title: 'Read the Résumé', text: 'the résumé is a plain page, so it prints. everything else here is signed events.' },
  { id: 'github', icon: '🐙', title: 'Went to GitHub', text: 'github. the paper\'s code, this site, and a proof-of-work relay policy live there.' },
  { id: 'colophon', icon: '🔑', title: 'Found the Key', text: 'yes, the favicon really is a key. the colophon says what it unlocks.' },
  { id: 'courses', icon: '🎓', title: 'Checked the Transcript', text: 'forty courses. the grades are not there; the code is.' },
  { id: 'terminal', icon: '📟', title: 'Read the Logs', text: 'the terminal is not decoration: every line is something that actually happened on the way here.' },
  { id: 'unlock', icon: '🔒', title: 'Not the Owner', text: 'that box wants the site\'s private key. it would never leave your browser, but it is not yours to type.' },
  { id: 'nickname', icon: '🏷️', title: 'Named Yourself', text: 'a nickname. it travels inside the encrypted message, so the relays never see it.' },
  { id: 'sent', icon: '✉️', title: 'Said Hello Properly', text: 'message sealed and sent. it is encrypted to my key and mined for the relay; i will see it soon.' },
  { id: 'reply', icon: '📬', title: 'Got a Reply', text: 'a reply came back through the relay. same browser, same key, same conversation.' },
  { id: 'empty-send', icon: '📭', title: 'Sent Nothing', text: 'you pressed send on an empty box. the relay is spared.' },
  { id: 'keyfold', icon: '🗝️', title: 'Peeked at Your Key', text: 'that key was minted in this browser. export it to carry the conversation elsewhere.' },
  { id: 'exported', icon: '🔐', title: 'Took the Key', text: 'key copied. keep it private; it is the whole conversation.' },
  { id: 'eventlink', icon: '🧾', title: 'Looked Behind the Curtain', text: 'that is the raw event on a public relay. this page is only a renderer for it.' },
  { id: 'npub', icon: '🖋️', title: 'Checked the Signature', text: 'that key signs every block here. the icon is a different key: the one that unveils them.' },
  { id: 'hover-key', icon: '👁️', title: 'Stared at the Key', text: 'four seconds on the icon. sixty-four squares, thirty-two bytes: the key that unveils every block here.' },
  { id: 'curious', icon: '👀', title: 'Curious', text: 'you opened the readers panel. everything in it stays on your side.' },
  { id: 'flips', icon: '🎚️', title: 'Indecisive', when: () => you.flips >= 2, text: 'cannot decide? me neither. calm prints better, wild boots faster.' },
  { id: 'sound', icon: '🔊', title: 'Sound On', text: 'sound on. the blips are the relays talking.' },
  { id: 'copy', icon: '📋', title: 'Copied', text: 'copied. if it is from the paper, the doi is on the writing card.' },
  { id: 'cite', icon: '📝', title: 'Cited', text: 'you copied a doi. the concept doi always points at the latest version.' },
  { id: 'selected', icon: '✂️', title: 'Selected Text', text: 'a selection. everything here is plain text under the hood, no images of words.' },
  { id: 'select-all', icon: '🧲', title: 'Select All', text: 'select all. it is about eleven thousand words if you count the courses.' },
  { id: 'rightclick', icon: '🖱️', title: 'Right Click', text: 'right click. nothing here objects to view source.' },
  { id: 'double-name', icon: '✌️', title: 'Double Take', text: 'double-clicked the name. it is real, and so is the signature under it.' },
  { id: 'drag', icon: '🧤', title: 'Dragged Something', text: 'you dragged something. it goes nowhere, but it was a good drag.' },
  { id: 'print', icon: '🖨️', title: 'Print Enthusiast', text: 'printing this page? the résumé page has a print stylesheet; this one just goes dark on paper.' },
  { id: 'fullscreen', icon: '🖼️', title: 'Full Screen', when: () => fullscreen(), text: 'full screen. the rain reaches the edges now.' },
  { id: 'rotate', icon: '🔄', title: 'Turned the Screen', text: 'portrait to landscape, or back. the page reflowed and the readers kept orbiting.' },
  { id: 'zoom', icon: '🔍', title: 'Zoomed', text: 'zoomed. the icon is a 64-square mosaic, and every square is a hex digit.' },
  { id: 'arrows', icon: '🧭', title: 'All Four Arrows', text: 'all four arrow keys. nothing moves, but the konami code is now a third of the way done.' },
  { id: 'konami', icon: '🕹️', title: 'Konami', text: 'konami. nothing unlocks, but you found the one thing on this page that is not signed.' },
  { id: 'escape', icon: '🚪', title: 'Escape Artist', text: 'five escapes. there is nothing to escape from; the page has no modals worth the name.' },
  { id: 'tab-nav', icon: '⌨️', title: 'Keyboard Navigator', text: 'ten tabs. every control here is reachable without a mouse.' },
  { id: 'devtools', icon: '🛠️', title: 'Looked Under the Hood', text: 'devtools. the interesting tab is network: one small shell, modules under integrity hashes, and four relay sockets.' },
  { id: 'hi', icon: '💬', title: 'Said Hi', text: 'hi. the chat box is right there, and it does not need a name.' },
  { id: 'typed-name', icon: '🪪', title: 'Knows My Name', text: 'you typed my name. the key under it is the one that counts.' },
  { id: 'sudo', icon: '🧙', title: 'Sudo', text: 'sudo. permission denied, politely; the owner form wants a key, not a password.' },
  { id: 'dismissed', icon: '🙈', title: 'Not Impressed', text: 'you dismissed an achievement. this one is for that.' },
  { id: 'first-ach', icon: '🎁', title: 'Achievement Unlocked', meta: true, when: () => unlocked() >= 1, text: 'an achievement for unlocking an achievement. this is how it starts.' },
  { id: 'ten', icon: '🏅', title: 'Collector', meta: true, when: () => unlocked() >= 10, text: 'ten achievements. the panel under the chip keeps the list.' },
  { id: 'twentyfive', icon: '🎖️', title: 'Hoarder', meta: true, when: () => unlocked() >= 25, text: 'twenty-five. you are now the second most dedicated reader of this page.' },
  { id: 'half', icon: '🌗', title: 'Halfway', meta: true, when: () => unlocked() >= 50, text: 'halfway. the rest are the silly ones.' },
  { id: 'all', icon: '👑', title: 'Completionist', meta: true, when: () => unlocked() >= A.length - 1, text: 'every achievement on this page. i genuinely do not know what to say. thank you.' },
];
export const ACHIEVEMENTS = A.map(({ id, title }) => ({ id, title }));
const inField = () => { const a = document.activeElement; return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit)$/.test(a.type)) || a.isContentEditable); };
const busyTyping = () => inField() && Date.now() - S.keyAt < 2500;
const done = e => !!you.eggs[e.id];
const ambientOK = () => you.w.n < 3 && Date.now() - (you.w.at || 0) > 60000 && onPage() >= 25 && !busyTyping();
let ac = null;
function chime() { if (localStorage.getItem(SOUND) === '0') return; try { ac ||= new (window.AudioContext || window.webkitAudioContext)(); const t = ac.currentTime; [[880, 0], [1318.5, 0.11]].forEach(([f, d]) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.07, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.28); o.connect(g).connect(ac.destination); o.start(t + d); o.stop(t + d + 0.3); }); } catch {} }
function unlock(e, gesture) {
  if (done(e)) return false;
  const text = typeof e.text === 'function' ? e.text() : e.text; if (!text) return false;
  you.eggs[e.id] = 1; saveYou();
  const card = el('div', 'ach', stack); el('span', 'ico', card).textContent = e.icon; const body = el('span', 'body', card);
  el('span', 't', body).textContent = `achievement unlocked · ${unlocked()} of ${A.length}`; el('span', 'n', body).textContent = e.title; el('span', 'd', body).textContent = text;
  card.onclick = () => { card.remove(); poke('dismissed'); };
  requestAnimationFrame(() => card.classList.add('on'));
  while (stack.children.length > 3) stack.firstChild.remove();
  setTimeout(() => { card.classList.add('out'); setTimeout(() => card.remove(), 500); }, 8000);
  if (gesture) chime();
  if (!panel.hidden) fill();
  setTimeout(() => { for (const m of A) if (m.meta && !done(m) && m.when()) { unlock(m, false); break; } }, 700);
  return true;
}
// how: 'act' something you did (now, with a chime), 'event' something that happened (now, quietly),
// 'notice' something the page noticed (only when the ambient budget allows; the 5 s check retries it anyway)
function poke(id, how = 'act') {
  const e = A.find(x => x.id === id); if (!e || done(e)) return;
  if (e.when) { let ok = false; try { ok = e.when(); } catch {} if (!ok) return; }
  if (how === 'notice') { if (ambientOK()) { you.w = { n: you.w.n + 1, at: Date.now() }; unlock(e, false); } return; }
  if (busyTyping() || Date.now() - S.lastAction < 1200) { if (!S.pending.includes(id)) S.pending.push(id); return; } // never mid-sentence, never two at once: it waits its turn
  S.lastAction = Date.now(); unlock(e, how === 'act');
}
function flush() { if (!S.pending.length || busyTyping() || Date.now() - S.lastAction < 1200) return; const e = A.find(x => x.id === S.pending.shift()); if (e && !done(e)) { S.lastAction = Date.now(); unlock(e, false); } }
function ambient() { if (!ambientOK()) return; for (const e of A) if (e.when && !e.meta && !done(e)) { let ok = false; try { ok = e.when(); } catch {} if (ok) { you.w = { n: you.w.n + 1, at: Date.now() }; unlock(e, false); return; } } }
function tick() {
  beat(false); prune(); draw(); count(); watchSections();
  const w = where(); if (w?.s === 'writing') S.dwell += 5;
  if (replied()) poke('reply', 'event');
  ambient();
}
export const presenceDebug = () => ({ pk: myPk, peers: [...peers.keys()], pending: [...S.pending], seen: Object.keys(you?.seen || {}) });

// ---- wiring ---------------------------------------------------------------------------
export async function start() {
  if (started) return; started = true;
  loadYou(); beginVisit();
  orbitEl = el('div', 'presence-orbit'); ring = el('span', 'presence-ring', orbitEl); ring.hidden = true;
  chip = el('button', 'presence-chip alone'); chip.type = 'button'; panel = el('div', 'presence-panel'); panel.hidden = true; stack = el('div', 'achs');
  chip.onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) { fill(); poke('curious'); } };
  document.addEventListener('click', e => { if (!panel.hidden && !panel.contains(e.target) && e.target !== chip) panel.hidden = true; });
  await new Promise(res => withPool(p => { P = p; res(); }));
  if (!env.NT) return;
  myKey(false); siblings();
  mount(); count(); listen(); beat(true); watchSections();
  setInterval(mount, 2000); setInterval(tick, 5000); setInterval(flush, 1500);
  setTimeout(beacon, 15000);
  if (you.flips >= 2) poke('flips', 'event'); // the flip reloaded the page, so it is counted then and announced now
  addEventListener('resize', () => { mount(); if (fullscreen()) poke('fullscreen', 'act');
    if (Number.isInteger(devicePixelRatio) && (outerWidth - innerWidth > 200 || outerHeight - innerHeight > 300)) poke('devtools', 'event'); });
  const watchZoom = () => { const m = typeof matchMedia === 'function' && matchMedia(`(resolution: ${devicePixelRatio}dppx)`); m?.addEventListener?.('change', () => { poke('zoom'); watchZoom(); }, { once: true }); }; watchZoom();
  if (typeof matchMedia === 'function') matchMedia('(orientation: portrait)').addEventListener?.('change', () => { mount(); poke('rotate'); });
  addEventListener('pointermove', e => { pointerX = clamp(e.clientX / innerWidth); S.input = Date.now(); if (S.lastX !== null) S.mouse += Math.hypot(e.clientX - S.lastX, e.clientY - S.lastY); S.lastX = e.clientX; S.lastY = e.clientY; }, { passive: true });
  addEventListener('hashchange', () => { S.quietUntil = Date.now() + 1500; });
  addEventListener('scroll', () => { const t = Date.now(), dy = scrollY - S.scrollY; S.input = t; if (!S.firstScroll) S.firstScroll = onPage();
    you.scrollPx += Math.abs(dy); const dir = Math.sign(dy); if (dir && S.dir && dir !== S.dir) S.turns++; if (dir) S.dir = dir; S.scrollY = scrollY;
    // speed: 2,500 px within half a second over several scroll events; a jump to an anchor is one event and does not count
    S.burst = S.burst.filter(b => t - b.t < 500).concat({ t, dy: Math.abs(dy) });
    if (t > S.quietUntil && S.burst.length >= 4 && S.burst.reduce((a, b) => a + b.dy, 0) >= 2500) poke('speed-scroller');
    S.depth = (scrollY + innerHeight) / Math.max(1, document.documentElement.scrollHeight); beat(false);
    if (S.depth >= 0.98) { S.bottomed = true; poke(onPage() < 8 ? 'bottomfast' : 'bottom'); }
    if (S.bottomed && scrollY < 40) poke('full-circle'); }, { passive: true });
  addEventListener('touchstart', () => { S.input = Date.now(); }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { S.hiddenAt = Date.now(); bye(); } else { lastBeat = 0; beat(true); mount(); } });
  addEventListener('pagehide', () => { saveYou(); bye(); });
  addEventListener('pageshow', e => { if (e.persisted) { S.backForward = true; poke('time-travel', 'event'); } });
  document.addEventListener('toggle', e => { const d = e.target; if (d?.tagName !== 'DETAILS' || !d.open) return; you.folds[d.id || 'x'] = 1; watchSections(); if (['colophon', 'courses'].includes(d.id)) poke(d.id); }, true);
  document.addEventListener('click', e => { you.clicks++; S.input = Date.now();
    if (e.target.closest?.('.term') && !e.target.closest('button')) return poke('terminal');
    const a = e.target.closest?.('a, button, summary'); if (!a) return;
    if (a.matches('a.ev')) poke('eventlink'); else if (a.matches('a.pill[href*="njump.me/npub"]')) poke('npub');
    else if (a.matches('a[href*="weight_dictionary"], a[href*="zenodo.22749478"]')) poke('pdf'); else if (a.matches('a.pill[href="/resume/"]')) poke('resume'); else if (a.matches('a.pill[href*="github.com"]')) poke('github');
    else if (a.id === 'wildpill') { you.flips++; saveYou(); } else if (a.tagName === 'BUTTON' && a.textContent.trim() === 'sound') poke('sound');
    else if (a.tagName === 'BUTTON' && a.closest('header.me') && a.textContent.trim() === 'unlock') poke('unlock');
    else if (a.closest('#chat') && a.type === 'submit' && !(document.querySelector('#chat textarea')?.value || '').trim()) poke('empty-send');
    else if (a.closest('#chat') && a.textContent.trim() === 'export') poke('exported'); else if (a.tagName === 'SUMMARY' && a.closest('details.keys')) poke('keyfold'); });
  document.addEventListener('change', e => { if (e.target.matches?.('#chat .who input') && e.target.value.trim()) poke('nickname'); });
  document.addEventListener('dblclick', e => { if (e.target.closest?.('header.me h1')) poke('double-name'); });
  document.addEventListener('pointerover', e => { if (e.target.closest?.('main > header.me img')) { clearTimeout(S.hoverT); S.hoverT = setTimeout(() => poke('hover-key'), 4000); } });
  document.addEventListener('pointerout', e => { if (e.target.closest?.('main > header.me img')) clearTimeout(S.hoverT); });
  document.addEventListener('contextmenu', () => poke('rightclick')); document.addEventListener('dragstart', () => poke('drag'));
  document.addEventListener('selectionchange', () => { const s = String(getSelection?.() || ''); if (s.length > 20 && !inField()) poke('selected'); });
  document.addEventListener('copy', () => poke(/doi\.org|zenodo/.test(String(getSelection?.() || '')) ? 'cite' : 'copy'));
  addEventListener('beforeprint', () => poke('print')); document.addEventListener('fullscreenchange', () => { if (fullscreen()) poke('fullscreen'); });
  addEventListener('offline', () => poke('offline', 'event'));
  document.addEventListener('pow', e => { const d = e.detail; if (d?.done && !S.mining && d.bits === 16) poke('sent'); });
  document.addEventListener('keydown', e => { S.input = Date.now(); if (inField()) S.keyAt = Date.now();
    if (e.key === 'Enter' && !e.shiftKey && e.target.matches?.('#chat textarea') && !e.target.value.trim()) poke('empty-send');
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '-' || e.key === '+')) poke('zoom');
    if (e.key === 'F12' || ((e.ctrlKey || e.metaKey) && (e.altKey || e.shiftKey) && /^[ijc]$/i.test(e.key))) poke('devtools');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !inField()) poke('select-all');
    if (e.key === 'Tab' && ++S.tabs >= 10) poke('tab-nav');
    if (inField() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape' && ++S.esc >= 5) poke('escape');
    if (/^Arrow/.test(e.key)) { S.arrows.add(e.key); if (S.arrows.size >= 4) poke('arrows'); }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; S.keys = (S.keys + '\u0001' + k).slice(-200);
    const seq = S.keys.split('\u0001').slice(1);
    if (seq.slice(-10).join(',') === 'ArrowUp,ArrowUp,ArrowDown,ArrowDown,ArrowLeft,ArrowRight,ArrowLeft,ArrowRight,b,a') poke('konami');
    const word = seq.filter(x => x.length === 1).slice(-8).join('');
    if (/(hi|hello)$/.test(word)) poke('hi'); if (/ronish$/.test(word)) poke('typed-name'); if (/sudo$/.test(word)) poke('sudo'); });
  // a relay that was open and then closed; the first seconds of every load show them all closed while they connect
  onChange(() => { let open = 0; for (const u of env.RELAYS) { const s = store.status.get(u); if (s === 'open') { open++; S.wasOpen.add(u); } else if (s === 'closed' && S.wasOpen.has(u)) poke('relay', 'event'); }
    if (open && open === env.RELAYS.length) poke('four-relays', 'notice'); });
}

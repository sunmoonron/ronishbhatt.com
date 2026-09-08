// score.js: a Nostr feed read like a score. Every person you follow is a stave, time runs left to
// right across the whole viewport, notes are notes, replies are ties between staves, and the world
// runs underneath as foam. Everything comes live from the relays; nothing is simulated. Nothing on
// this page asks who you are: two people on the same feed differ only by what their own device
// holds, the last moment they read to, whom they follow, whom they muted, how they like to read.
const $ = id => document.getElementById(id);
const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
const PROFILE_RELAYS = ['wss://purplepag.es', 'wss://relay.damus.io', 'wss://nos.lol'];
const THIN = !!(navigator.connection && (navigator.connection.saveData || /(^|-)2g$/.test(navigator.connection.effectiveType || '')));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const now = () => Math.floor(Date.now() / 1000);
const HEX = /^[0-9a-f]{64}$/;
const CARD_W = 230, CHIP_W = 120, RIGHT_PAD = 90, WHO_W = () => innerWidth <= 640 ? 110 : 170, RULER_H = 22;
const PALETTE = ['#b4f5d1', '#7dd3a8', '#5fc9c4', '#b9e26b', '#3aa876', '#8dddae', '#9be7c0', '#6fd6b0', '#c5f0a4', '#79c9b5'];

// ---- device state, per feed --------------------------------------------------------------------
const S = {
  source: 'world', me: null, follows: [], local: new Set(), muted: new Set(),
  events: new Map(), byAuthor: new Map(), profiles: new Map(), pending: new Map(),
  staves: [], candidates: new Map(), seen: 0, first: false,
  window: 10800, pps: 0, t1: 0, pinned: true, tRender: 0, loadedFrom: Infinity,
  merged: false, depth: !REDUCED, text: THIN, subs: [], focus: null, unread: 0, toMe: 0,
};
const K = name => `score.${name}.${S.source}`;
const get = (name, d) => { try { const v = localStorage.getItem(K(name)); return v == null ? d : JSON.parse(v); } catch { return d; } };
const put = (name, v) => { try { if (v == null) localStorage.removeItem(K(name)); else localStorage.setItem(K(name), JSON.stringify(v)); } catch {} };
function loadState() {
  S.local = new Set(get('follows', [])); S.muted = new Set(get('muted', []));
  const seen = get('seen', null); S.first = seen == null; S.seen = S.first ? now() : Number(seen); if (S.first) put('seen', S.seen);
}

// ---- relays: one socket per subscription, live ones reconnect and resume ----------------------
function sub(url, filters, { onEvent, onEose, live = false, timeout = 10000 } = {}) {
  let ws = null, stopped = false, last = 0, timer = 0; const id = 's' + Math.random().toString(36).slice(2, 9);
  const open = () => {
    if (stopped) return; try { ws = new WebSocket(url); } catch { return; }
    ws.onopen = () => { const f = filters.map(x => live && last ? { ...x, since: Math.max(x.since || 0, last - 60) } : x); ws.send(JSON.stringify(['REQ', id, ...f])); if (!live) timer = setTimeout(() => stop(), timeout); };
    ws.onmessage = ({ data }) => { let m; try { m = JSON.parse(data); } catch { return; } if (m[0] === 'EVENT' && m[1] === id && m[2]) { last = Math.max(last, m[2].created_at || 0); onEvent?.(m[2], url); } else if (m[0] === 'EOSE' && m[1] === id) { onEose?.(url); if (!live) stop(); } else if (m[0] === 'CLOSED' && m[1] === id) { if (!live) stop(); } };
    ws.onclose = () => { if (!stopped && live) setTimeout(open, 3000 + Math.random() * 2000); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  };
  const stop = () => { stopped = true; clearTimeout(timer); try { ws?.send(JSON.stringify(['CLOSE', id])); ws?.close(); } catch {} };
  open(); const h = { stop }; S.subs.push(h); return h;
}
const stopAll = () => { for (const h of S.subs) h.stop(); S.subs = []; };
const fanout = (relays, filters, opts) => relays.forEach(r => sub(r, filters, opts));

// ---- ingest: NIP-10 threading, media, mentions, credit to targets even when they arrive later --
const IMG = /https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif)(?:\?\S*)?/gi;
function ingest(ev) {
  if (!ev || typeof ev.id !== 'string' || !HEX.test(ev.id) || !HEX.test(ev.pubkey || '') || S.events.has(ev.id)) return;
  if (ev.kind === 0) { profile(ev); return; }
  if (![1, 6, 7, 9735].includes(ev.kind)) return;
  const tags = Array.isArray(ev.tags) ? ev.tags.filter(t => Array.isArray(t)) : [];
  const es = tags.filter(t => t[0] === 'e' && HEX.test(t[1] || ''));
  let target = null;
  if (ev.kind === 1) { const m = es.find(t => t[3] === 'reply') || es.find(t => t[3] === 'root'); target = m ? m[1] : es.length ? es[es.length - 1][1] : null; }
  else target = es.length ? es[es.length - 1][1] : null;
  const e = { id: ev.id, pk: ev.pubkey, t: Number(ev.created_at) || 0, kind: ev.kind, text: ev.kind === 1 ? String(ev.content || '') : ev.kind === 6 ? 'repost' : ev.kind === 7 ? (ev.content || '+') : 'zap', target, media: [], replies: 0, hearts: 0, zaps: 0, live: false };
  if (e.t > now() + 900 || e.t < 1500000000) return; // clocks from the future and the far past are noise
  if (e.kind === 1) { e.text = e.text.replace(IMG, m => { if (e.media.length < 4) e.media.push(m); return ''; }).replace(/nostr:(npub|nprofile|note|nevent|naddr)1[0-9a-z]+/g, m => '@' + m.slice(6, 14) + '…').replace(/\s+/g, ' ').trim().slice(0, 600); }
  S.events.set(e.id, e);
  const place = key => { let a = S.byAuthor.get(key); if (!a) S.byAuthor.set(key, a = []); let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid].t <= e.t) lo = mid + 1; else hi = mid; } a.splice(lo, 0, e); if (a.length > 4000) a.shift(); };
  if (e.kind === 1 || e.kind === 6) { place(e.pk); if (e.kind === 1) place('world'); }
  if (target) { const T = S.events.get(target); if (T) credit(T, e); else { const p = S.pending.get(target) || []; p.push(e); S.pending.set(target, p); } }
  const p = S.pending.get(e.id); if (p) { for (const x of p) credit(e, x); S.pending.delete(e.id); }
  if (e.kind === 1 && !S.staveOf(e.pk)) noticed(e);
  dirty();
}
const botlike = e => { const t = e.text || ''; if (!t) return e.media.length === 0; if (/^[\[{]/.test(t) || /channel:__|"type":|\[broadcast:|#\d{4,}\]/.test(t)) return true; const letters = (t.match(/\p{L}/gu) || []).length; if (letters < t.length * 0.4) return true; if (/[0-9a-f]{32,}/i.test(t)) return true; return false; };
const cadence = pk => { const a = S.byAuthor.get(pk) || []; if (a.length < 5) return false; const last = a.slice(-5); return last[4].t - last[0].t < 600; }; // five notes in ten minutes is a machine
function credit(T, e) { if (e.kind === 1) T.replies++; else if (e.kind === 7) T.hearts++; else if (e.kind === 9735) T.zaps++; if (S.me && T.pk === S.me && e.pk !== S.me) { e.toMe = true; T.answered = (T.answered || 0) + 1; } }
function profile(ev) { try { const c = JSON.parse(ev.content || '{}'); const old = S.profiles.get(ev.pubkey); if (old && old.t > ev.created_at) return; S.profiles.set(ev.pubkey, { t: ev.created_at, name: String(c.display_name || c.name || c.username || '').slice(0, 40), pic: !THIN && /^https?:\/\//.test(c.picture || '') ? c.picture : '' }); dirty(); } catch {} }
const nameOf = pk => pk === 'world' ? 'the world' : S.profiles.get(pk)?.name || (pk === S.me ? 'you' : pk.slice(0, 8));
const wantProfiles = new Set(); let profileTimer = 0;
function needProfile(pk) { if (pk === 'world' || S.profiles.has(pk) || wantProfiles.has(pk)) return; wantProfiles.add(pk); clearTimeout(profileTimer); profileTimer = setTimeout(() => { const pks = [...wantProfiles].slice(0, 200); wantProfiles.clear(); fanout(PROFILE_RELAYS, [{ kinds: [0], authors: pks }], { onEvent: ingest, timeout: 8000 }); }, 300); }
S.staveOf = pk => S.staves.find(s => s.pk === pk);
// someone who is not on a stave keeps showing up: count them, and after three notes offer a stave
function noticed(e) {
  const inFollows = S.follows.includes(e.pk) || S.local.has(e.pk); if (inFollows) return;
  let c = S.candidates.get(e.pk); if (!c) S.candidates.set(e.pk, c = { pk: e.pk, n: 0, answered: false, first: e.t });
  if (botlike(e) || cadence(e.pk)) { c.bot = true; return; } c.n++; if (e.toMe || (e.target && S.follows.includes(S.events.get(e.target)?.pk))) c.answered = true;
  if (!c.bot && (c.n >= (S.source === 'world' ? 2 : 3) || c.answered) && !c.offered && S.candidateCount() < 6) { c.offered = true; S.candidateCount(1); rebuildStaves(); needProfile(e.pk); }
}
let candidateN = 0; S.candidateCount = d => (d ? (candidateN += d) : candidateN);

// ---- staves: who gets a line. Order by latest activity, stable while you read ------------------
function rebuildStaves() {
  const keep = new Map(S.staves.map(s => [s.pk, s])); const list = [];
  const add = (pk, kind) => { if (S.muted.has(pk)) return; const s = keep.get(pk) || { pk, kind, color: PALETTE[list.length % PALETTE.length], el: null }; s.kind = kind; list.push(s); };
  if (S.me) add(S.me, 'me'); else add('world', 'world');
  for (const pk of S.follows) if (pk !== S.me) add(pk, 'follow');
  for (const pk of S.local) if (pk !== S.me && !S.follows.includes(pk)) add(pk, 'follow');
  for (const c of S.candidates.values()) if (c.offered && !S.local.has(c.pk) && !S.follows.includes(c.pk)) add(c.pk, 'candidate');
  const last = s => { const a = S.byAuthor.get(s.pk); return a && a.length ? a[a.length - 1].t : 0; };
  const order = new Map(S.staves.map((s, i) => [s.pk, i]));
  const rank = s => s.kind === 'me' || s.kind === 'world' ? 0 : s.kind === 'candidate' ? 2 : 1;
  list.sort((a, b) => { const ra = rank(a), rb = rank(b); if (ra !== rb) return ra - rb; const oa = order.get(a.pk), ob = order.get(b.pk); if (oa != null && ob != null) return oa - ob; if (oa != null) return -1; if (ob != null) return 1; return last(b) - last(a); });
  S.staves = list; for (const s of list) needProfile(s.pk); dirty(true);
}
function follow(pk, on) { if (on) S.local.add(pk); else { S.local.delete(pk); S.follows = S.follows.filter(p => p !== pk); } put('follows', [...S.local]); const c = S.candidates.get(pk); if (c) { c.offered = false; S.candidateCount(-1); } if (on && S.source === 'world') fanout(RELAYS, [{ kinds: [1, 6, 7], authors: [pk], since: Math.min(S.loadedFrom, now() - S.window * 2), limit: 200 }], { onEvent: ingest, live: true }); rebuildStaves(); }
function mute(pk) { S.muted.add(pk); put('muted', [...S.muted]); rebuildStaves(); }

// ---- opening a feed -----------------------------------------------------------------------------
function reset() { stopAll(); S.events.clear(); S.byAuthor.clear(); S.pending.clear(); S.candidates.clear(); candidateN = 0; S.staves = []; S.follows = []; S.loadedFrom = Infinity; S.focus = null; $('panel').hidden = true; $('foamList').textContent = ''; }
function openWorld() {
  reset(); S.source = 'world'; S.me = null; loadState(); rebuildStaves();
  const since = now() - S.window * 1.5; S.loadedFrom = since;
  fanout(RELAYS, [{ kinds: [1], limit: 150 }], { onEvent: ingest, live: true });
  if (S.local.size) fanout(RELAYS, [{ kinds: [1, 6, 7], authors: [...S.local], since, limit: 400 }], { onEvent: ingest, live: true });
  note(S.local.size ? `<b>no key</b> · ${S.local.size} people you pulled out of the world are staves of yours · everyone else stays on the world line` : `<b>no key, first look</b> · one stave, the world, everyone at once. People who repeat get offered a stave of their own; "+" keeps them, on this device. Or open with your npub`);
}
async function openNpub(text) {
  let hex; try { const d = window.NostrTools.nip19.decode(text.trim()); hex = d.type === 'npub' ? d.data : d.data.pubkey; } catch { note('that is not an npub'); return; }
  reset(); S.source = hex.slice(0, 12); S.me = hex; loadState(); note('reading the follow list…');
  let fl = null; await new Promise(res => { let n = 0; const done = () => { if (++n === RELAYS.length) res(); }; RELAYS.forEach(r => sub(r, [{ kinds: [3], authors: [hex], limit: 1 }], { onEvent: ev => { if (!fl || ev.created_at > fl.created_at) fl = ev; }, onEose: done, timeout: 6000 })); setTimeout(res, 6500); });
  if (S.me !== hex) return;
  S.follows = fl ? [...new Set(fl.tags.filter(t => t[0] === 'p' && HEX.test(t[1] || '')).map(t => t[1]))].slice(0, 150) : [];
  rebuildStaves();
  const since = now() - S.window * 1.5; S.loadedFrom = since;
  const authors = [hex, ...S.follows]; for (let i = 0; i < authors.length; i += 25) fanout(RELAYS, [{ kinds: [1, 6, 7], authors: authors.slice(i, i + 25), since, limit: 300 }], { onEvent: ingest, live: true });
  fanout(RELAYS, [{ kinds: [1, 7, 9735], '#p': [hex], since, limit: 200 }], { onEvent: ingest, live: true });
  fanout(RELAYS, [{ kinds: [1], limit: 30 }], { onEvent: ingest, live: true });
  note(`<b>${S.follows.length}</b> follows become staves · answers to you tie into the top stave in amber · the world runs underneath${S.first ? ' · <b>first look on this device: nothing is owed, the line marks when you arrived</b>' : ''}`);
}
// zooming or panning past what was loaded pulls the missing span once
function ensure(since) {
  if (since >= S.loadedFrom || S.staves.length === 0) return; const until = S.loadedFrom; S.loadedFrom = since;
  const authors = S.source === 'world' ? [...S.local] : [S.me, ...S.follows]; if (!authors.length) return;
  for (let i = 0; i < authors.length; i += 25) fanout(RELAYS, [{ kinds: [1, 6, 7], authors: authors.slice(i, i + 25), since, until, limit: 400 }], { onEvent: ingest, timeout: 12000 });
}

// ---- time and layout ----------------------------------------------------------------------------
const stageW = () => Math.max(200, $('score').clientWidth - WHO_W());
const x = t => stageW() - RIGHT_PAD - (S.tRender - t) * S.pps;
const mode = () => S.pps >= 0.16 ? 'read' : S.pps >= 0.02 ? 'chip' : 'strip';
function setWindow(w, keepRight) { S.window = Math.max(300, Math.min(31 * 86400, w)); S.pps = stageW() / S.window; document.querySelectorAll('[data-zoom]').forEach(b => b.classList.toggle('on', Number(b.dataset.zoom) === S.window)); if (!keepRight) { S.pinned = true; S.t1 = now() + RIGHT_PAD / S.pps; } ensure(S.t1 - S.window * 1.6); dirty(true); }
let dirtyFlag = false, fullFlag = false, raf = 0, fallback = 0;
function dirty(full) { dirtyFlag = true; if (full) fullFlag = true; if (!raf) { raf = requestAnimationFrame(frame); clearTimeout(fallback); fallback = setTimeout(() => { if (raf) { cancelAnimationFrame(raf); frame(); } }, 300); } } // a background tab never gets a frame; the timer keeps the score honest
function frame() { raf = 0; clearTimeout(fallback); if (S.text) { if (dirtyFlag) renderText(); dirtyFlag = fullFlag = false; return; } if (fullFlag || Math.abs(S.t1 - S.tRender) * S.pps > stageW() * 0.35) render(); else shift(); dirtyFlag = fullFlag = false; }
setInterval(() => { if (S.pinned) { S.t1 = now() + RIGHT_PAD / S.pps; dirty(); } else dirty(); }, 1000);

// the whole score, from the loaded events: staves, cards or chips or ticks, ties, unread, ruler
function render() {
  S.tRender = S.t1; const W = stageW(), tB = S.t1, tA = tB - W / S.pps, mA = tA - (tB - tA) * 0.6, mB = tB + (tB - tA) * 0.3, m = mode(), root = $('staves');
  const seen = S.seen, positions = new Map(); let y = 0, unread = 0, toMe = 0;
  const frag = document.createDocumentFragment();
  if (S.merged) { renderMerged(); return; }
  // living staves first, in their remembered order; quiet ones (nothing in the window, something loaded) as hairlines; silent ones as one row
  const living = [], quiet = [], silent = []; const back = (tB - tA) * 0.5;
  const eventsOf = s => { const all = S.byAuthor.get(s.pk) || []; return s.kind === 'world' ? all.filter(e => !S.staveOf(e.pk)) : all; };
  for (const s of S.staves) { const all = eventsOf(s); if (!all.length && s.kind !== 'world') { silent.push(s); continue; } const n = lower(all, tB) - lower(all, tA - back); (n || s.kind === 'me' || s.kind === 'candidate' || s.kind === 'world' ? living : quiet).push(s); }
  for (const s of [...living, ...quiet]) {
    const all = eventsOf(s), lo = lower(all, mA), hi = lower(all, mB);
    const visible = all.slice(lower(all, tA), lower(all, tB)).length, isQuiet = quiet.includes(s); const h = isQuiet ? 16 : m === 'read' ? (visible ? 82 : 30) : m === 'chip' ? 30 : 24;
    const el = s.el || (s.el = staveEl(s)); el.className = `stave ${s.kind}${isQuiet ? ' quiet' : ''}`; el.style.height = h + 'px';
    const un = all.filter(e => e.t > seen).length; unread += un; el.querySelector('.u').textContent = un ? String(un) : ''; el.querySelector('.n').textContent = nameOf(s.pk); const av = el.querySelector('.av'); const p = S.profiles.get(s.pk); if (p?.pic && av.tagName !== 'IMG') { const img = document.createElement('img'); img.className = 'av'; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.src = p.pic; av.replaceWith(img); } else if (av.tagName === 'I') av.textContent = nameOf(s.pk)[0] || '?';
    el.querySelector('.who').title = s.kind === 'candidate' ? 'keeps showing up in the foam; + makes this a stave of yours' : s.kind === 'me' ? 'you' : s.kind === 'world' ? 'everyone not on a stave of their own; people peel off as they repeat or as you follow them' : 'followed';
    el.querySelector('.f').textContent = s.kind === 'candidate' ? '+' : s.kind === 'me' || s.kind === 'world' ? '' : '·mute';
    const C = el.querySelector('.cards'); C.textContent = ''; C.style.transform = '';
    if (m !== 'strip') {
      const w = m === 'read' ? CARD_W : CHIP_W; let i = lo;
      while (i < hi) { // stack notes that would overlap at this zoom
        const first = all[i], x0 = x(first.t); let j = i + 1; while (j < hi && x(all[j].t) - x0 < w + 6) j++;
        const group = all.slice(i, j), face = [...group].reverse().find(g => !botlike(g)) || group[group.length - 1]; const node = m === 'read' ? card(face, group) : chip(face, group);
        node.style.left = x0 + 'px'; C.append(node); for (const g of group) positions.set(g.id, { x: x0 + w / 2, y: y + h / 2, stave: s, el: node }); if (face.toMe || group.some(g => g.answered)) toMe += group.filter(g => g.answered).length; i = j;
      }
    } else for (let i = lo; i < hi; i++) positions.set(all[i].id, { x: x(all[i].t), y: y + h / 2, stave: s, tick: true, e: all[i] });
    frag.append(el); y += h + 1;
  }
  if (silent.length) { const row = document.createElement('div'); row.className = 'stave silent'; row.style.height = '24px'; row.innerHTML = `<div class="who" style="grid-column:1 / -1;border-right:0"><span class="n" style="color:var(--mute)">${silent.length} ${S.source === 'world' ? 'people' : 'follows'} silent in everything loaded (${Math.round((now() - S.loadedFrom) / 3600)} h) · zoom out to widen the pull</span></div>`; frag.append(row); y += 25; }
  root.textContent = ''; root.append(frag); pullTargets(); root.style.minHeight = Math.max(y, $('score').clientHeight - RULER_H - 4) + 'px';
  S.positions = positions; S.unread = unread; S.rowsH = y;
  drawTicks(positions, y); drawTies(positions, y); drawRuler(); drawBands();
  $('unread').innerHTML = S.first ? 'first look: nothing owed' : unread ? `<b>${unread}</b> unread` : 'caught up'; $('readBtn').disabled = !unread && !S.first;
  if (!S.staves.length) root.innerHTML = `<div style="padding:2rem 1rem;color:var(--mute);font-size:.72rem;max-width:40rem;line-height:1.6">Nothing here yet.</div>`;
  shift();
}
function lower(a, t) { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid].t < t) lo = mid + 1; else hi = mid; } return lo; }
const wantTargets = new Set();
function pullTargets() { // replies whose target was never fetched: pull the targets in one batch, so ties and threads have both ends
  const ids = []; for (const e of S.events.values()) { if (e.kind === 1 && e.target && !S.events.has(e.target) && !wantTargets.has(e.target)) { wantTargets.add(e.target); ids.push(e.target); } } if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 50) fanout(RELAYS.slice(0, 2), [{ ids: ids.slice(i, i + 50) }], { onEvent: ev => { ingest(ev); needProfile(ev.pubkey); }, timeout: 8000 });
}
function staveEl(s) { const el = document.createElement('div'); el.setAttribute('role', 'row'); el.innerHTML = `<div class="who"><i class="av"></i><span class="n"></span><span class="u"></span><button class="f" type="button"></button></div><div class="cards" role="gridcell"></div>`; el.querySelector('.f').addEventListener('click', ev => { ev.stopPropagation(); if (s.kind === 'candidate') follow(s.pk, true); else if (s.kind !== 'me') mute(s.pk); }); el.querySelector('.who').addEventListener('click', () => { if (s.pk !== 'world') openPerson(s.pk); }); return el; }
function card(e, group) {
  const d = document.createElement('div'); const p = S.profiles.get(e.pk); const z = Math.min(48, 6 * (e.replies + e.hearts + e.zaps));
  d.className = `card${e.t > S.seen && !S.first ? ' unread' : ''}${e.answered ? ' tome' : ''}${e.target && e.kind === 1 ? ' reply' : ''}${e.kind === 6 ? ' repost' : ''}${group.length > 1 ? ' stack' : ''}`; d.tabIndex = -1; d.dataset.id = e.id; d.style.setProperty('--z', z); if (group.length > 1) d.dataset.n = '+' + (group.length - 1);
  const pic = e.media[0] && !THIN ? `<img class="pic" alt="" loading="lazy" referrerpolicy="no-referrer" src="${esc(e.media[0])}">` : '';
  const target = e.target ? S.events.get(e.target) : null;
  const who = S.staveOf(e.pk) ? '' : `<b>${esc(nameOf(e.pk))}</b> `;
  d.innerHTML = `${pic}<div class="t">${who}${esc(e.text || (e.media.length ? '[image]' : ''))}</div><div class="m"><span>${clock(e.t)}</span>${target ? `<span>→ <b>${esc(nameOf(target.pk))}</b></span>` : e.target ? '<span>→ …</span>' : ''}${e.replies ? `<span>↩ ${e.replies}</span>` : ''}${e.hearts ? `<span>♥ ${e.hearts}</span>` : ''}${e.zaps ? `<span>⚡ ${e.zaps}</span>` : ''}${e.answered ? `<b>${e.answered} to you</b>` : ''}</div>`;
  d.setAttribute('aria-label', `${nameOf(e.pk)}, ${clock(e.t)}${group.length > 1 ? `, ${group.length} notes` : ''}: ${e.text.slice(0, 120)}`);
  d.addEventListener('click', () => openThread(e, group)); return d;
}
function chip(e, group) { const d = document.createElement('div'); d.className = `chip${e.t > S.seen && !S.first ? ' unread' : ''}${e.answered ? ' tome' : ''}`; d.tabIndex = -1; d.dataset.id = e.id; d.textContent = (group.length > 1 ? `+${group.length - 1} · ` : '') + (S.staveOf(e.pk) ? '' : nameOf(e.pk) + ': ') + (e.text || (e.media.length ? '[image]' : e.kind === 6 ? 'repost' : '')); d.title = `${nameOf(e.pk)} · ${clock(e.t)}`; d.addEventListener('click', () => openThread(e, group)); return d; }
function shift() { const dx = -(S.t1 - S.tRender) * S.pps; for (const s of S.staves) if (s.el) s.el.querySelector('.cards').style.transform = `translateX(${dx}px)`; $('ties').style.transform = $('ticks').style.transform = `translateX(${dx}px)`; drawBands(); drawRuler(); }
function drawBands() { const W = stageW(), xs = x(S.seen) - (S.t1 - S.tRender) * S.pps, xn = x(now()) - (S.t1 - S.tRender) * S.pps, who = WHO_W(); const b = $('seenBand'); b.hidden = S.first || xs >= W; if (!b.hidden) { b.style.left = who + Math.max(0, xs) + 'px'; b.style.right = '0'; b.style.height = (S.rowsH || 0) + RULER_H + 'px'; } const n = $('nowLine'); n.style.left = who + xn + 'px'; n.style.height = (S.rowsH || 0) + RULER_H + 'px'; n.hidden = xn < 0 || xn > W; }
function drawRuler() { const R = $('ruler'), W = stageW(), tB = S.t1, tA = tB - W / S.pps, span = tB - tA; const steps = [60, 300, 900, 1800, 3600, 3 * 3600, 6 * 3600, 12 * 3600, 86400, 2 * 86400, 7 * 86400]; const step = steps.find(s => span / s <= 9) || 7 * 86400; R.textContent = ''; const tz = new Date().getTimezoneOffset() * 60; for (let t = Math.ceil((tA - tz) / step) * step + tz; t <= tB; t += step) { const sp = document.createElement('span'); sp.style.left = (W - RIGHT_PAD - (tB - t) * S.pps) + 'px'; const d = new Date(t * 1000); sp.textContent = step >= 86400 ? d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) : step >= 3600 && d.getHours() === 0 ? d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); R.append(sp); } }
function drawTicks(pos, H) { const c = $('ticks'), W = stageW() * 2; sizeCanvas(c, W, H); const g = c.getContext('2d'); g.clearRect(0, 0, W, H); if (mode() !== 'strip') return; for (const p of pos.values()) { if (!p.tick) continue; const e = p.e; g.fillStyle = e.answered ? '#e9c46a' : e.t > S.seen && !S.first ? p.stave.color : 'rgba(125,211,168,.45)'; const hgt = 4 + Math.min(14, 3 * (e.replies + e.hearts + e.zaps)); g.fillRect(p.x, p.y - hgt / 2, Math.max(1.5, S.pps * 60), hgt); } }
function drawTies(pos, H) { const c = $('ties'), W = stageW() * 2; sizeCanvas(c, W, H); const g = c.getContext('2d'); g.clearRect(0, 0, W, H); g.lineWidth = 1;
  for (const [id, p] of pos) { const e = p.e || S.events.get(id); if (!e || e.kind !== 1 || !e.target) continue; const q = pos.get(e.target); const un = e.t > S.seen && !S.first; if (q) { g.strokeStyle = e.answered || e.toMe ? '#e9c46a' : p.stave.color; g.globalAlpha = un ? 0.85 : 0.3; g.beginPath(); g.moveTo(p.x, p.y); const mx = (p.x + q.x) / 2, lift = Math.min(60, Math.abs(p.y - q.y) * 0.4 + 12); g.bezierCurveTo(mx, p.y - lift, mx, q.y - lift, q.x, q.y); g.stroke(); } else { const T = S.events.get(e.target); if (!T) continue; g.strokeStyle = e.toMe ? '#e9c46a' : 'rgba(125,211,168,.5)'; g.globalAlpha = un ? 0.6 : 0.25; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - 14, p.y + (T.t < e.t ? 10 : -10)); g.stroke(); } }
  g.globalAlpha = 1; }
function sizeCanvas(c, w, h) { const dpr = Math.min(2, devicePixelRatio || 1); if (c.width !== Math.floor(w * dpr) || c.height !== Math.floor(h * dpr)) { c.width = Math.floor(w * dpr); c.height = Math.floor(h * dpr); c.style.width = w + 'px'; c.style.height = h + 'px'; } c.style.top = RULER_H + 'px'; c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); }
// the flat feed is the score with every stave merged: the same notes, one column, newest first
function renderMerged() { const root = $('staves'); root.textContent = ''; const all = []; for (const s of S.staves) for (const e of S.byAuthor.get(s.pk) || []) all.push(e); all.sort((a, b) => b.t - a.t); const list = document.createElement('div'); list.style.cssText = 'padding:.6rem;display:grid;gap:.4rem;max-width:44rem'; for (const e of all.slice(0, 200)) { const d = card(e, [e]); d.style.cssText = 'position:static;width:auto'; d.querySelector('.m').insertAdjacentHTML('afterbegin', `<b>${esc(nameOf(e.pk))}</b>`); list.append(d); } root.append(list); $('unread').innerHTML = `${all.filter(e => e.t > S.seen).length} unread · flat`; drawTicks(new Map(), 0); drawTies(new Map(), 0); $('seenBand').hidden = true; $('nowLine').hidden = true; $('ruler').textContent = ''; }

// ---- reading: a thread panel, a person panel, the foam ------------------------------------------
function esc(s) { return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]); }
const clock = t => new Date(t * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const when = t => new Date(t * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function article(e, cls = '') { const T = e.target ? S.events.get(e.target) : null; return `<article class="${cls}"><div class="h"><b>${esc(nameOf(e.pk))}</b> · ${when(e.t)}${T ? ` · → ${esc(nameOf(T.pk))}` : e.target ? ' · → …' : ''}${e.replies ? ` · ↩ ${e.replies}` : ''}${e.hearts ? ` · ♥ ${e.hearts}` : ''}${e.zaps ? ` · ⚡ ${e.zaps}` : ''}</div>${esc(e.text || (e.kind === 6 ? 'repost' : ''))}${e.media.map(u => THIN ? ` <a href="${esc(u)}" rel="noopener" target="_blank">[image]</a>` : `<img alt="" loading="lazy" referrerpolicy="no-referrer" src="${esc(u)}">`).join('')}</article>`; }
function openThread(e, group = [e]) {
  const P = $('panel'); P.hidden = false; const T = e.target ? S.events.get(e.target) : null;
  const replies = [...S.events.values()].filter(r => r.kind === 1 && r.target === e.id).sort((a, b) => a.t - b.t);
  P.innerHTML = `<h3>${group.length > 1 ? `${group.length} notes from ${esc(nameOf(e.pk))}` : 'thread'}<span class="x" role="button" tabindex="0">✕ esc</span></h3>` + (group.length > 1 ? group.slice().reverse().map(g => article(g)).join('') : (T ? article(T) : e.target ? '<p style="color:var(--mute);font-size:.66rem">the note this answers is not loaded yet; pulling it</p>' : '') + article(e) + replies.map(r => article(r, 'reply')).join(''));
  P.querySelector('.x').addEventListener('click', () => { P.hidden = true; }); for (const r of replies) needProfile(r.pk);
  if (e.target && !T) fanout(RELAYS, [{ ids: [e.target] }], { onEvent: ev => { ingest(ev); needProfile(ev.pubkey); if (!$('panel').hidden) openThread(e, group); }, timeout: 6000 });
  if (!e.threadPulled) { e.threadPulled = true; fanout(RELAYS, [{ kinds: [1, 7, 9735], '#e': [e.id], limit: 100 }], { onEvent: ev => { ingest(ev); needProfile(ev.pubkey); }, onEose: () => { if (!$('panel').hidden) openThread(e, group); }, timeout: 8000 }); }
}
function openPerson(pk) { const P = $('panel'); P.hidden = false; const all = (S.byAuthor.get(pk) || []).slice(-40).reverse(); const s = S.staveOf(pk); P.innerHTML = `<h3>${esc(nameOf(pk))} · ${all.length} recent${s && s.kind !== 'me' ? ` <button class="mb" id="pf">${S.local.has(pk) || S.follows.includes(pk) ? 'unfollow here' : 'follow here'}</button>` : ''}<span class="x" role="button" tabindex="0">✕ esc</span></h3>` + all.map(e => article(e)).join(''); P.querySelector('.x').addEventListener('click', () => { P.hidden = true; }); P.querySelector('#pf')?.addEventListener('click', () => { follow(pk, !(S.local.has(pk) || S.follows.includes(pk))); openPerson(pk); }); }
let foamN = 0;
function foam(e) { if (e.kind !== 1 || S.staveOf(e.pk) || botlike(e)) return; const L = $('foamList'); const c = S.candidates.get(e.pk); const p = document.createElement('p'); p.className = c && c.n >= 2 ? 'cand' : ''; p.innerHTML = `<b>${esc(nameOf(e.pk))}</b>${c && c.n >= 2 ? ` <small>×${c.n}</small>` : ''}: ${esc((e.text || '[image]').slice(0, 160))} <button type="button" title="make this person a stave, on this device">+</button>`; p.querySelector('button').addEventListener('click', () => follow(e.pk, true)); p.querySelector('b').addEventListener('click', () => openPerson(e.pk)); L.append(p); while (L.children.length > 9) L.firstChild.remove(); if (++foamN % 25 === 0) $('foamNote').textContent = `${foamN} lines so far · ${S.candidates.size} people seen more than once`; if (c && c.n === 2) needProfile(e.pk); }
// live events reach the foam and the score through the same ingest; the foam is a side effect of new notes
const _ingest = ingest; ingest = function (ev) { const fresh = !S.events.has(ev?.id); _ingest(ev); if (fresh && ev && ev.kind === 1 && S.events.has(ev.id) && ev.created_at > now() - 3600) foam(S.events.get(ev.id)); };

// ---- text mode: the same score as a table, hours across, staves down. Chosen by itself on a thin link
function renderText() { const T = $('text'); const cols = S.window >= 7 * 86400 ? 7 : S.window >= 86400 ? 24 : 12, step = S.window >= 7 * 86400 ? 86400 : S.window >= 86400 ? 3600 : Math.round(S.window / 12); const tB = now(), tA = tB - cols * step; let h = `<table><thead><tr><th>stave</th><th>unread</th>${Array.from({ length: cols }, (_, i) => `<th>${step >= 86400 ? new Date((tA + i * step) * 1000).toLocaleDateString(undefined, { weekday: 'short' }) : new Date((tA + i * step) * 1000).getHours() + 'h'}</th>`).join('')}<th>latest</th></tr></thead><tbody>`; for (const s of S.staves) { const all = S.byAuthor.get(s.pk) || []; const cells = Array.from({ length: cols }, (_, i) => all.slice(lower(all, tA + i * step), lower(all, tA + (i + 1) * step)).length); const last = all[all.length - 1]; h += `<tr><th>${esc(nameOf(s.pk))}${s.kind === 'candidate' ? ' (foam)' : ''}</th><td class="c">${all.filter(e => e.t > S.seen).length || ''}</td>${cells.map(n => `<td class="c" style="background:rgba(125,211,168,${Math.min(.8, n * .12)})">${n || ''}</td>`).join('')}<td class="last">${last ? esc(last.text || '[image]') : ''}</td></tr>`; } T.innerHTML = h + '</tbody></table>' + (S.staves.length ? '' : '<p style="color:var(--mute)">no staves yet</p>'); }

// ---- controls -----------------------------------------------------------------------------------
function note(html) { $('note').innerHTML = html; }
$('loadBtn').addEventListener('click', () => { const v = $('npub').value.trim(); if (v) openNpub(v); else openWorld(); });
$('npub').addEventListener('keydown', e => { if (e.key === 'Enter') $('loadBtn').click(); });
$('worldBtn').addEventListener('click', () => { $('npub').value = ''; openWorld(); });
document.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => setWindow(Number(b.dataset.zoom))));
$('nowBtn').addEventListener('click', () => { S.pinned = true; S.t1 = now() + RIGHT_PAD / S.pps; dirty(true); });
$('readBtn').addEventListener('click', () => { S.seen = now(); S.first = false; put('seen', S.seen); dirty(true); });
$('mergeBtn').addEventListener('click', () => { S.merged = !S.merged; $('mergeBtn').classList.toggle('on', S.merged); dirty(true); });
$('depthBtn').addEventListener('click', () => { S.depth = !S.depth; put('depth', S.depth); applyModes(); });
$('textBtn').addEventListener('click', () => { S.text = !S.text; try { localStorage.setItem('score.text', S.text ? '1' : '0'); } catch {} applyModes(); dirty(true); });
$('forgetBtn').addEventListener('click', () => { for (const k of ['seen', 'follows', 'muted', 'depth']) put(k, null); try { localStorage.removeItem('score.text'); } catch {} S.text = THIN; loadState(); S.local = new Set(); S.muted = new Set(); applyModes(); rebuildStaves(); note('this device forgot the feed: first look again, nothing owed, no local follows, nothing muted'); });
function applyModes() { $('score').classList.toggle('depth', S.depth); $('depthBtn').classList.toggle('on', S.depth); $('textBtn').classList.toggle('on', S.text); $('text').hidden = !S.text; $('score').hidden = S.text; $('foam').hidden = S.text; }
// pan by drag, zoom by ctrl+wheel or pinch, plain wheel scrolls the staves and shift+wheel pans time
const sc = $('score'); let drag = null, pinch = null;
sc.addEventListener('pointerdown', e => { if (e.target.closest('.who, button, #panel')) return; if (pinch) return; drag = { x: e.clientX, y: e.clientY, t1: S.t1, top: sc.scrollTop, moved: false, id: e.pointerId }; sc.setPointerCapture(e.pointerId); });
sc.addEventListener('pointermove', e => { if (!drag || e.pointerId !== drag.id) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; if (drag.moved) { S.t1 = drag.t1 - dx / S.pps; S.pinned = S.t1 >= now() + RIGHT_PAD / S.pps - 1; sc.scrollTop = drag.top - dy; ensure(S.t1 - S.window * 1.6); dirty(); } });
const endDrag = e => { if (drag && drag.moved) { const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); sc.removeEventListener('click', swallow, true); }; sc.addEventListener('click', swallow, true); setTimeout(() => sc.removeEventListener('click', swallow, true), 50); } drag = null; };
sc.addEventListener('pointerup', endDrag); sc.addEventListener('pointercancel', endDrag);
sc.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); const f = Math.exp(e.deltaY * 0.0025); const px = e.clientX - sc.getBoundingClientRect().left - WHO_W(); const tAt = S.t1 - (stageW() - px) / S.pps; setWindow(S.window * f, true); S.t1 = tAt + (stageW() - px) / S.pps; S.pinned = false; dirty(true); } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { e.preventDefault(); S.t1 += (e.deltaX || e.deltaY) / S.pps; S.pinned = false; ensure(S.t1 - S.window * 1.6); dirty(); } }, { passive: false });
sc.addEventListener('touchstart', e => { if (e.touches.length === 2) pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), w: S.window }; }, { passive: true });
sc.addEventListener('touchmove', e => { if (pinch && e.touches.length === 2) { e.preventDefault(); const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); setWindow(pinch.w * pinch.d / Math.max(20, d), true); dirty(true); } }, { passive: false });
sc.addEventListener('touchend', () => { pinch = null; });
// keyboard: arrows walk the score, enter opens, escape closes, r marks read, n returns to now
sc.addEventListener('keydown', e => {
  if (e.target.closest('input')) return; const cards = [...sc.querySelectorAll('.card, .chip')]; if (!cards.length && e.key !== 'Escape') return;
  const cur = document.activeElement?.closest?.('.card, .chip') || null; const rect = el => el.getBoundingClientRect();
  const focus = el => { cards.forEach(c => c.tabIndex = -1); el.tabIndex = 0; el.focus({ preventScroll: false }); };
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); if (!cur) return focus(cards[cards.length - 1]); const row = cur.closest('.stave'), sib = [...row.querySelectorAll('.card, .chip')], i = sib.indexOf(cur); const j = i + (e.key === 'ArrowRight' ? 1 : -1); if (sib[j]) focus(sib[j]); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!cur) return focus(cards[cards.length - 1]); const rows = [...sc.querySelectorAll('.stave')], r = rows.indexOf(cur.closest('.stave')); let k = r + (e.key === 'ArrowDown' ? 1 : -1); while (rows[k] && !rows[k].querySelector('.card, .chip')) k += (e.key === 'ArrowDown' ? 1 : -1); if (!rows[k]) return; const cx = rect(cur).left; const best = [...rows[k].querySelectorAll('.card, .chip')].sort((a, b) => Math.abs(rect(a).left - cx) - Math.abs(rect(b).left - cx))[0]; if (best) focus(best); }
  else if (e.key === 'Enter' && cur) { cur.click(); }
  else if (e.key === 'Escape') { $('panel').hidden = true; }
  else if (e.key === 'r') $('readBtn').click(); else if (e.key === 'n') $('nowBtn').click();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('panel').hidden = true; });
// hover in strip mode: the tick under the pointer becomes a tooltip
sc.addEventListener('mousemove', e => { const tip = $('tip'); if (mode() !== 'strip' || !S.positions) { tip.classList.remove('on'); return; } const r = sc.getBoundingClientRect(); const px = e.clientX - r.left - WHO_W() + (S.t1 - S.tRender) * S.pps, py = e.clientY - r.top + sc.scrollTop - RULER_H; let best = null, bd = 9; for (const p of S.positions.values()) { if (!p.tick) continue; const d = Math.abs(p.x - px) + Math.abs(p.y - py) * 0.5; if (d < bd) { bd = d; best = p; } } if (!best) { tip.classList.remove('on'); return; } tip.innerHTML = `<b>${esc(nameOf(best.e.pk))}</b> · ${when(best.e.t)}<br>${esc(best.e.text.slice(0, 160) || '[image]')}`; tip.style.left = Math.min(e.clientX + 12, innerWidth - 330) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; tip.classList.add('on'); });
sc.addEventListener('mouseleave', () => $('tip').classList.remove('on'));
sc.addEventListener('click', e => { if (mode() !== 'strip' || !S.positions || e.target.closest('.who, button')) return; const r = sc.getBoundingClientRect(); const px = e.clientX - r.left - WHO_W() + (S.t1 - S.tRender) * S.pps, py = e.clientY - r.top + sc.scrollTop - RULER_H; let best = null, bd = 9; for (const p of S.positions.values()) { if (!p.tick) continue; const d = Math.abs(p.x - px) + Math.abs(p.y - py) * 0.5; if (d < bd) { bd = d; best = p; } } if (best) openThread(best.e); });
window.addEventListener('resize', () => { setWindow(S.window, !S.pinned); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) dirty(true); });
window.score = S; S.render = render; S.frame = frame; S.rebuildStaves = rebuildStaves;

// ---- go -----------------------------------------------------------------------------------------
try { S.text = localStorage.getItem('score.text') == null ? THIN : localStorage.getItem('score.text') === '1'; S.depth = localStorage.getItem('score.depth.world') == null ? !REDUCED : localStorage.getItem('score.depth.world') === 'true'; } catch {}
applyModes(); setWindow(10800);
const q = new URLSearchParams(location.search); if (q.get('npub')) { $('npub').value = q.get('npub'); openNpub(q.get('npub')); } else openWorld();

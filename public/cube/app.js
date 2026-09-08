// app.js: cube, a Nostr client. One page, phones and desks. The world in every language, media
// that loads ahead of you and stays cached, translation on tap, a profile, replies, reposts,
// likes, threads, search, mentions. And a cube that is you: it asks your name once, shrinks into
// the corner, and the people in view spawn as small cubes tied to yours; a like pulses along the
// tie, a follow pulls the cube into your cluster.
//
// Everything expensive is off the main thread or bounded: the worker owns sockets, signatures
// and the store; the list keeps at most a window of notes in the DOM; the cubes layer does O(5)
// work per scroll frame; profiles are fetched in batches of hundreds; media loads a screen ahead.
const $ = id => document.getElementById(id);
const NT = window.NostrTools;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const THIN = !!(navigator.connection && (navigator.connection.saveData || /(^|-)2g$/.test(navigator.connection.effectiveType || '')));
const PHONE = () => innerWidth < 760;
const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.band'];
const SEARCH_RELAYS = ['wss://relay.nostr.band', 'wss://search.nos.today'];
const PROFILE_RELAYS = ['wss://purplepag.es'];
const HEX = /^[0-9a-f]{64}$/;
const now = () => Math.floor(Date.now() / 1000);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hexOf = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const bytesOf = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
const ago = t => { const d = now() - t; if (d < 45) return 'now'; if (d < 3600) return Math.floor(d / 60) + 'm'; if (d < 86400) return Math.floor(d / 3600) + 'h'; if (d < 7 * 86400) return Math.floor(d / 86400) + 'd'; return new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
const store = { get(k, d) { try { const v = localStorage.getItem('cube.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { if (v == null) localStorage.removeItem('cube.' + k); else localStorage.setItem('cube.' + k, JSON.stringify(v)); } catch {} } };
const toast = (msg, ms = 2400) => { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms); };
const chunks = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const hue = pk => (parseInt(String(pk).slice(0, 6), 16) || 140) % 360;

// ---- state ----------------------------------------------------------------------------------------
const S = {
  me: store.get('me', null), follows: store.get('follows', []), contactsAt: store.get('contactsAt', 0), contactsContent: '',
  relays: store.get('relays', DEFAULT_RELAYS), langs: store.get('langs', [(navigator.language || 'en').slice(0, 2)]), auto: store.get('auto', false), showReplies: store.get('showReplies', false),
  events: new Map(), profiles: new Map(), counts: new Map(), mine: new Map(), bookmarks: new Set(store.get('bookmarks', [])), muted: new Set(store.get('muted', [])),
  feed: 'world', feedArg: null, feedSub: null, items: [], nodes: new Map(), pendingNew: [], searchIds: new Set(), older: false, exhausted: false,
  seenMentions: store.get('seenMentions', now()), mentions: 0, quoteWaiters: new Map(), lastAt: new Map(), authorN: new Map(), firstSeen: new Map(),
};
const isFollow = pk => S.follows.includes(pk);
const isMe = pk => !!(S.me && S.me.pk === pk);

// ---- the worker: sockets, signatures, store -------------------------------------------------------
const W = new Worker('./worker.js?v=2'); const H = {}; W.onmessage = ({ data }) => H[data.type]?.(data); const send = m => W.postMessage(m);
let subN = 0; const subscribe = (filters, o = {}) => { const id = o.id || 's' + (++subN); send({ type: 'sub', id, filters, live: !!o.live, relays: o.relays || null, timeout: o.timeout }); return id; }; const unsubscribe = id => send({ type: 'unsub', id });
const profileQueue = new Set(); let profileTimer = 0;
function needProfile(pk) { if (!pk || !HEX.test(pk) || S.profiles.has(pk) || profileQueue.has(pk)) return; profileQueue.add(pk); clearTimeout(profileTimer); profileTimer = setTimeout(() => { const pks = [...profileQueue]; profileQueue.clear(); for (const c of chunks(pks, 250)) send({ type: 'profiles', pks: c }); }, 120); }
const prof = pk => S.profiles.get(pk) || {};
const name = pk => { if (!pk) return '?'; if (!HEX.test(pk)) return pk === 'me' ? (S.me?.name || 'you') : '?'; const p = prof(pk); return p.name || (isMe(pk) ? (S.me.name || 'you') : NT.nip19.npubEncode(pk).slice(0, 12) + '…'); };
const initial = pk => (name(pk).replace(/^@/, '')[0] || '?').toUpperCase();
function avatarHTML(pk, cls = 'av') { const p = prof(pk); return p.pic && !THIN ? `<span class="${cls}" data-pk="${pk}"><img src="${esc(p.pic)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></span>` : `<span class="${cls}" data-pk="${pk}" style="color:hsl(${hue(pk)} 60% 70%)">${esc(initial(pk))}</span>`; }

H.cached = ({ events, profiles }) => { for (const p of profiles) S.profiles.set(p.pubkey, p); let n = 0; for (const ev of events) if (ingest(ev)) n++; rebuildItems(); if (n) $('feedNote').textContent = `${n} notes from this device's cache · the relays are loading`; };
const nameQueue = new Set(); let nameTimer = 0;
H.profile = ({ profile }) => { const old = S.profiles.get(profile.pubkey); if (old && old.t > profile.t) return; S.profiles.set(profile.pubkey, profile); nameQueue.add(profile.pubkey); clearTimeout(nameTimer); nameTimer = setTimeout(refreshNames, 120); };
H.events = ({ sub, events }) => {
  const feedSub = sub === S.feedSub, older = sub === 'older';
  for (const ev of events) {
    const fresh = ingest(ev); if (S.feed === 'search' && feedSub) S.searchIds.add(ev.id);
    if (sub === 'me') noteMention(ev);
    if (S.quoteWaiters.has(ev.id)) fillQuote(ev);
    if (!fresh) continue;
    if (ev.kind === 1 || ev.kind === 6) { if (feedSub || older || sub === 'get') place(ev, feedSub && !S.filling); }
  }
  if (older) S.olderGot = (S.olderGot || 0) + events.length;
  if (older || S.filling) { S.filling = false; if (L.b < S.items.length) appendMore(20); }
  flushPending();
};
H.eose = ({ sub }) => { if (sub === 'older') { S.older = false; if (!S.olderGot) { S.exhausted = true; $('feedNote').textContent = S.items.length ? 'that is everything the relays gave' : 'nothing here yet'; } } if (sub === S.feedSub) { S.filling = false; if (L.b < S.items.length) appendMore(20); $('feedNote').textContent = S.items.length ? '' : emptyNote(); } };
H.ok = ({ id, ok, url }) => { const r = S.oks?.get(id); if (r) { if (ok) r.ok++; else r.fail++; } };
H.sent = ({ id, relays }) => { S.oks = S.oks || new Map(); S.oks.set(id, { ok: 0, fail: 0 }); setTimeout(() => { const r = S.oks.get(id); if (r) toast(r.ok ? `sent · ${r.ok} relay${r.ok === 1 ? '' : 's'} accepted` : relays ? 'sent · no relay confirmed' : 'no relay connected'); S.oks.delete(id); }, 1800); };
H.wiped = () => { location.reload(); };

// ---- ingest and counts ----------------------------------------------------------------------------
function ingest(ev) {
  if (!ev || S.events.has(ev.id)) return false; ev.tags = Array.isArray(ev.tags) ? ev.tags : [];
  if (ev.kind === 3) { if (isMe(ev.pubkey) && ev.created_at > S.contactsAt) applyContacts(ev); return false; }
  if (ev.kind === 7 || ev.kind === 9735 || ev.kind === 6 || (ev.kind === 1 && ev.tags.some(t => t[0] === 'e'))) countInteraction(ev);
  if (ev.kind === 1 || ev.kind === 6) { S.events.set(ev.id, ev); S.lastAt.set(ev.pubkey, Math.max(S.lastAt.get(ev.pubkey) || 0, ev.created_at)); S.authorN.set(ev.pubkey, (S.authorN.get(ev.pubkey) || 0) + 1); needProfile(ev.pubkey); if (S.events.size > 9000) trimEvents(); return true; }
  if (ev.kind === 7 || ev.kind === 9735) { S.events.set(ev.id, { id: ev.id, kind: ev.kind }); return false; }
  return false;
}
function trimEvents() { const keep = new Set(S.items.map(e => e.id)); const all = [...S.events.entries()].filter(([, e]) => e.created_at).sort((a, b) => a[1].created_at - b[1].created_at); let drop = 2500; for (const [id] of all) { if (drop <= 0) break; if (keep.has(id)) continue; S.events.delete(id); drop--; } }
function replyTarget(ev) { const es = ev.tags.filter(t => t[0] === 'e' && HEX.test(t[1] || '')); if (!es.length) return null; return (es.find(t => t[3] === 'reply') || es.find(t => t[3] === 'root') || es[es.length - 1])[1]; }
function rootOf(ev) { const es = ev.tags.filter(t => t[0] === 'e' && HEX.test(t[1] || '')); const r = es.find(t => t[3] === 'root'); return r ? r[1] : es[0]?.[1] || null; }
const satsOf = ev => { const b = ev.tags.find(t => t[0] === 'bolt11')?.[1] || ''; const m = b.match(/^lnbc(\d+)([munp]?)/i); if (!m) return 0; const mult = { '': 1e8, m: 1e5, u: 100, n: 0.1, p: 0.0001 }[m[2].toLowerCase()] || 1; return Math.round(Number(m[1]) * mult); };
function countInteraction(ev) {
  const id = replyTarget(ev); if (!id) return; const c = S.counts.get(id) || { likes: 0, reposts: 0, replies: 0, zaps: 0, sats: 0 }; S.counts.set(id, c);
  if (ev.kind === 7) { c.likes++; if (isMe(ev.pubkey)) mark(id, 'liked'); } else if (ev.kind === 6) { c.reposts++; if (isMe(ev.pubkey)) mark(id, 'reposted'); } else if (ev.kind === 9735) { c.zaps++; c.sats += satsOf(ev); } else if (ev.kind === 1) c.replies++;
  updateCounts(id);
}
function mark(id, what) { const m = S.mine.get(id) || {}; m[what] = true; S.mine.set(id, m); }
const countQueue = new Set(); let countTimer = 0;
function updateCounts(id) { countQueue.add(id); if (!countTimer) countTimer = setTimeout(() => { countTimer = 0; const q = [...countQueue]; countQueue.clear(); for (const i of q) paintCounts(i); }, 80); }
function paintCounts(id) { const el = S.nodes.get(id); if (!el) return; const c = S.counts.get(id); if (!c) return; const m = S.mine.get(id) || {}; const set = (k, v) => { const s = el.querySelector('.cnt-' + k); if (s) s.textContent = v ? String(v) : ''; }; set('replies', c.replies); set('reposts', c.reposts); set('likes', c.likes); set('sats', c.sats ? (c.sats >= 1000 ? (c.sats / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : c.sats) : c.zaps || ''); el.querySelector('[data-act="like"]')?.classList.toggle('on', !!m.liked); el.querySelector('[data-act="repost"]')?.classList.toggle('on', !!m.reposted); }
let countsTimer = 0; function refreshCounts() { clearTimeout(countsTimer); countsTimer = setTimeout(() => { const ids = [...S.nodes.keys()].slice(-150); if (!ids.length) return; subscribe([{ kinds: [1, 6, 7, 9735], '#e': ids, limit: 800 }], { id: 'counts', live: true }); }, 900); }

// ---- the list: a window of notes over a sorted array ------------------------------------------------
const L = { a: 0, b: 0, topH: 0 };
function inFeed(ev) {
  if (S.muted.has(ev.pubkey) || (ev.kind !== 1 && ev.kind !== 6)) return false; const reply = ev.kind === 1 && ev.tags.some(t => t[0] === 'e');
  switch (S.feed) {
    case 'world': return !botlike(ev) && (S.showReplies || !reply);
    case 'follows': return isFollow(ev.pubkey) || isMe(ev.pubkey);
    case 'mentions': return !!S.me && !isMe(ev.pubkey) && ev.tags.some(t => t[0] === 'p' && t[1] === S.me.pk);
    case 'profile': return ev.pubkey === S.feedArg;
    case 'tag': return ev.tags.some(t => t[0] === 't' && String(t[1]).toLowerCase() === S.feedArg) || new RegExp('#' + S.feedArg + '\\b', 'i').test(ev.content);
    case 'search': return S.searchIds.has(ev.id);
    case 'bookmarks': return S.bookmarks.has(ev.id);
  } return false;
}
const botlike = ev => { const t = ev.content || ''; if (ev.kind !== 1) return false; if (/^[\[{]/.test(t) || /channel:__|"type":|\[broadcast:/.test(t)) return true; const letters = (t.match(/\p{L}/gu) || []).length; return t.length > 20 && letters < t.length * 0.3 && !/https?:\/\//.test(t); };
const sortedIndex = ev => { const a = S.items; let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid].created_at > ev.created_at) lo = mid + 1; else hi = mid; } return lo; };
function rebuildItems() { S.items = [...S.events.values()].filter(e => e.created_at && inFeed(e)).sort((a, b) => b.created_at - a.created_at); resetList(); }
function resetList() { $('list').textContent = ''; S.nodes.clear(); L.a = L.b = 0; L.topH = 0; $('spacerTop').style.height = '0px'; S.pendingNew = []; $('newPill').hidden = true; $('feedNote').textContent = ''; appendMore(30); if (!S.items.length) $('feedNote').textContent = S.filling ? 'loading…' : emptyNote(); }
function emptyNote() { return S.feed === 'follows' && !S.follows.length ? 'you follow nobody yet: tap a cube or a name and follow' : S.feed === 'mentions' ? (S.me?.pk ? 'nobody has mentioned you yet' : 'mentions need a key: make one in settings') : S.feed === 'bookmarks' ? 'nothing bookmarked' : 'nothing here yet'; }
function place(ev, live) {
  if (!inFeed(ev)) return; if (live && scrollY >= 80) { S.pendingNew.push(ev); return; }
  const i = sortedIndex(ev); S.items.splice(i, 0, ev);
  if (i < L.a) { L.a++; L.b++; return; }
  if (i > L.b) return; if (i === L.b && L.b < L.a + 40) { $('list').append(noteEl(ev)); L.b++; return; } if (i === L.b) return;
  const next = S.nodes.get(S.items[i + 1]?.id); const el = noteEl(ev); if (next) next.before(el); else $('list').append(el); L.b++; if (live) pruneBelow();
}
let pendingTimer = 0; function flushPending() { if (!S.pendingNew.length) return; if (scrollY < 80) { const list = S.pendingNew; S.pendingNew = []; for (const ev of list) place(ev, false); $('newPill').hidden = true; pruneBelow(); syncCubes(); } else { $('newPill').textContent = `${S.pendingNew.length} new · tap to see`; $('newPill').hidden = false; } }
$('newPill').addEventListener('click', () => { scrollTo({ top: 0 }); const list = S.pendingNew.sort((a, b) => b.created_at - a.created_at); S.pendingNew = []; for (const ev of list) { const i = sortedIndex(ev); S.items.splice(i, 0, ev); } resetList(); });
function appendMore(n) { const frag = document.createDocumentFragment(); const end = Math.min(S.items.length, L.b + n); for (let i = L.b; i < end; i++) frag.append(noteEl(S.items[i])); $('list').append(frag); L.b = end; if (L.b >= S.items.length && !S.exhausted) requestOlder(); refreshCounts(); }
function prependMore(n) { const start = Math.max(0, L.a - n); if (start === L.a) return; const frag = document.createDocumentFragment(); for (let i = start; i < L.a; i++) frag.append(noteEl(S.items[i])); $('list').prepend(frag); let h = 0; for (let i = start; i < L.a; i++) { const el = S.nodes.get(S.items[i].id); if (el) h += el.offsetHeight; } L.a = start; L.topH = Math.max(0, L.topH - h); $('spacerTop').style.height = L.topH + 'px'; }
function pruneAbove() { const list = $('list'); while (L.b - L.a > 25) { const el = list.firstElementChild; if (!el || el.getBoundingClientRect().bottom > -2500) break; L.topH += el.offsetHeight; S.nodes.delete(el.dataset.id); mediaOff(el); el.remove(); L.a++; } $('spacerTop').style.height = L.topH + 'px'; }
function pruneBelow() { const list = $('list'); while (L.b - L.a > 25) { const el = list.lastElementChild; if (!el || el.getBoundingClientRect().top < innerHeight + 3000) break; S.nodes.delete(el.dataset.id); mediaOff(el); el.remove(); L.b--; } }
function requestOlder() { if (S.older || S.exhausted || S.feed === 'bookmarks') return; const last = S.items[S.items.length - 1]; const f = feedFilters({ until: last ? last.created_at - 1 : now(), limit: 80 }); if (!f) return; S.older = true; S.olderGot = 0; subscribe(f, { id: 'older', relays: S.feed === 'search' ? SEARCH_RELAYS : null, timeout: 12000 }); }
function onScroll() { const y = scrollY; if (y + innerHeight > document.documentElement.scrollHeight - 1400 && L.b < S.items.length) appendMore(20); else if (y + innerHeight > document.documentElement.scrollHeight - 1400) requestOlder(); if (y < L.topH + 700 && L.a > 0) prependMore(15); pruneAbove(); pruneBelow(); if (y < 80) flushPending(); syncCubes(); }
let scrollT = 0; addEventListener('scroll', () => { if (scrollT) return; scrollT = setTimeout(() => { scrollT = 0; onScroll(); }, 40); }, { passive: true });

// ---- feeds ----------------------------------------------------------------------------------------
function feedFilters(o) { const until = o.until ? { until: o.until } : {}; switch (S.feed) {
  case 'world': return [{ kinds: [1, 6], limit: o.limit, ...until }];
  case 'follows': { const a = [...new Set([...S.follows, ...(S.me?.pk ? [S.me.pk] : [])])]; return a.length ? chunks(a, 120).map(c => ({ kinds: [1, 6], authors: c, limit: o.limit, ...until })) : null; }
  case 'mentions': return S.me?.pk ? [{ kinds: [1, 6], '#p': [S.me.pk], limit: o.limit, ...until }] : null;
  case 'profile': return [{ kinds: [1, 6], authors: [S.feedArg], limit: o.limit, ...until }];
  case 'tag': return [{ kinds: [1], '#t': [S.feedArg], limit: o.limit, ...until }];
  case 'search': return o.until ? null : [{ kinds: [1], search: S.feedArg, limit: 60 }];
  default: return null; } }
function setFeed(feed, arg = null) {
  S.feed = feed; S.feedArg = arg; S.older = false; S.exhausted = false; S.searchIds = new Set(); if (S.feedSub) unsubscribe(S.feedSub); S.feedSub = null;
  document.querySelectorAll('[data-feed]').forEach(b => b.classList.toggle('on', b.dataset.feed === feed)); if (['world', 'follows', 'mentions'].includes(feed)) store.set('feed', feed);
  if (feed === 'mentions') { S.seenMentions = now(); store.set('seenMentions', S.seenMentions); S.mentions = 0; bell(); }
  const f = feedFilters({ limit: 120 }); S.filling = !!f; rebuildItems(); scrollTo({ top: 0 });
  if (f) S.feedSub = subscribe(f, { live: feed !== 'search', relays: feed === 'search' ? SEARCH_RELAYS : null, timeout: 20000 });
  $('feedNote').textContent = S.items.length ? '' : f ? 'loading…' : emptyNote();
  const crumb = feed === 'profile' ? name(arg) : feed === 'tag' ? '#' + arg : feed === 'search' ? `search: ${arg}` : feed === 'bookmarks' ? 'bookmarks' : ''; document.title = crumb ? `${crumb} · cube` : 'cube';
  if (crumb) { const back = document.createElement('button'); back.className = 'mb'; back.id = 'back'; back.textContent = '← ' + crumb; back.style.cssText = 'position:sticky;top:calc(var(--top) + .4rem);z-index:6;margin:0 0 .4rem'; back.addEventListener('click', () => setFeed(store.get('feed', 'world'))); $('feed').prepend(back); } else $('back')?.remove();
}
document.querySelectorAll('[data-feed]').forEach(b => b.addEventListener('click', () => setFeed(b.dataset.feed)));
function noteMention(ev) { if (!S.me || isMe(ev.pubkey) || ev.created_at <= S.seenMentions) return; S.mentions++; bell(); }
function bell() { const b = $('bell'); b.hidden = !S.mentions; b.textContent = S.mentions > 99 ? '99+' : String(S.mentions); renderMe(); }

// ---- a note ---------------------------------------------------------------------------------------
const TOK = /(https?:\/\/[^\s<>"']+|nostr:[a-z0-9]+|#[\p{L}\p{N}_]{1,50}|\n)/giu;
const IMG_RE = /\.(png|jpe?g|gif|webp|avif)$/i, VID_RE = /\.(mp4|webm|mov|m4v)$/i, AUD_RE = /\.(mp3|wav|ogg|m4a|flac)$/i;
const YT_RE = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/;
function classify(url) { const u = url.replace(/[.,;:!?)\]]+$/, ''); const yt = u.match(YT_RE); if (yt) return { kind: 'yt', id: yt[1], url: u }; const path = u.split('?')[0].split('#')[0]; if (IMG_RE.test(path)) return { kind: 'img', url: u }; if (VID_RE.test(path)) return { kind: 'vid', url: u }; if (AUD_RE.test(path)) return { kind: 'aud', url: u }; return { kind: 'link', url: u }; }
function imeta(ev) { const m = new Map(); for (const t of ev.tags) if (t[0] === 'imeta') { const o = {}; for (const kv of t.slice(1)) { const i = kv.indexOf(' '); if (i > 0) o[kv.slice(0, i)] = kv.slice(i + 1); } if (o.url) m.set(o.url, o); } return m; }
function parse(ev) {
  const media = [], quotes = [], meta = imeta(ev); let html = '', plain = '';
  for (const tok of (ev.content || '').split(TOK)) {
    if (!tok) continue;
    if (/^https?:\/\//i.test(tok)) { const c = classify(tok); if (c.kind === 'link') { let host = ''; try { host = new URL(c.url).hostname.replace(/^www\./, ''); } catch {} html += `<a class="link" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(host || c.url.slice(0, 40))}<i>↗</i></a>`; plain += ' ' + host + ' '; } else if (media.length < 4 && !media.some(x => x.url === c.url)) media.push({ ...c, ...(meta.get(tok) || meta.get(c.url) || {}) }); continue; }
    if (/^nostr:/i.test(tok)) { let d = null; try { d = NT.nip19.decode(tok.slice(6)); } catch {} if (!d) { html += esc(tok); continue; } if (d.type === 'npub' || d.type === 'nprofile') { const pk = d.type === 'npub' ? d.data : d.data.pubkey; needProfile(pk); html += `<span class="mn" data-pk="${pk}">@${esc(name(pk))}</span>`; plain += ' @' + name(pk); } else if (d.type === 'note' || d.type === 'nevent') { const id = d.type === 'note' ? d.data : d.data.id; if (quotes.length < 2 && !quotes.includes(id)) quotes.push(id); } else html += esc(tok); continue; }
    if (tok[0] === '#' && tok.length > 1) { html += `<a class="tag" data-tag="${esc(tok.slice(1).toLowerCase())}">${esc(tok)}</a>`; plain += ' ' + tok; continue; }
    html += esc(tok); plain += tok;
  }
  for (const [url, o] of meta) if (media.length < 4 && !media.some(x => x.url === url) && (o.m || '').startsWith('image')) media.push({ kind: 'img', url, ...o });
  return { html: html.trim(), plain: plain.replace(/\s+/g, ' ').trim(), media, quotes };
}
const blurCache = new Map();
function mediaHTML(media) {
  if (!media.length) return ''; const cls = 'media n' + Math.min(4, media.length);
  return `<div class="${cls}">` + media.map(m => { const dim = (m.dim || '').match(/^(\d+)x(\d+)$/); const ar = dim ? `--ar:${dim[1]}/${dim[2]};` : ''; const blur = m.blurhash && !THIN ? blurhash(m.blurhash) : null; const bg = blur ? `background-image:url(${blur});` : '';
    if (m.kind === 'img') return `<figure class="ph" style="${ar}${bg}" data-full="${esc(m.url)}"><img data-src="${esc(m.url)}" alt="${esc(m.alt || '')}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></figure>`;
    if (m.kind === 'vid') return `<figure class="ph vid" style="${ar}${bg}"><video data-src="${esc(m.url)}" preload="none" playsinline loop muted></video></figure>`;
    if (m.kind === 'yt') return `<figure class="ph yt" data-yt="${esc(m.id)}" style="background-image:url(https://i.ytimg.com/vi/${esc(m.id)}/hqdefault.jpg)"></figure>`;
    if (m.kind === 'aud') return `<audio controls preload="none" data-src="${esc(m.url)}"></audio>`; return ''; }).join('') + '</div>';
}
function quoteHTML(id) { const q = S.events.get(id); if (!q || !q.created_at) { send({ type: 'get', ids: [id] }); const w = S.quoteWaiters.get(id) || []; S.quoteWaiters.set(id, w); return `<div class="quote missing" data-quote="${id}">quoted note · loading</div>`; } return `<div class="quote" data-quote="${id}"><b>${esc(name(q.pubkey))}</b> <span style="color:var(--mute);font-size:.8em">${ago(q.created_at)}</span><div class="q">${esc(parse(q).plain.slice(0, 300) || (parse(q).media.length ? '[media]' : ''))}</div></div>`; }
function fillQuote(ev) { S.quoteWaiters.delete(ev.id); document.querySelectorAll(`.quote.missing[data-quote="${ev.id}"]`).forEach(el => { el.outerHTML = quoteHTML(ev.id); }); }
function noteEl(ev) {
  const art = document.createElement('article'); art.className = 'note'; art.dataset.id = ev.id;
  let inner = ev, repostBy = null;
  if (ev.kind === 6) { repostBy = ev.pubkey; let e = null; try { e = JSON.parse(ev.content); } catch {} if (e && HEX.test(e.id || '') && HEX.test(e.pubkey || '')) { if (!S.events.has(e.id)) { S.events.set(e.id, e); needProfile(e.pubkey); } inner = S.events.get(e.id); } else { const t = ev.tags.find(t => t[0] === 'e'); inner = (t && S.events.get(t[1])) || null; if (!inner) { if (t) send({ type: 'get', ids: [t[1]] }); inner = { id: t?.[1] || ev.id, pubkey: '', created_at: ev.created_at, content: '', tags: [], kind: 1 }; } } }
  art.dataset.pk = inner.pubkey; art.dataset.inner = inner.id;
  const p = prof(inner.pubkey), { html, plain, media, quotes } = parse(inner), lang = detectLang(plain); art.dataset.lang = lang;
  const target = inner.kind === 1 ? replyTarget(inner) : null; const tp = inner.tags.find(t => t[0] === 'p' && t[1] !== inner.pubkey)?.[1];
  const foreign = lang !== 'und' && !S.langs.includes(lang);
  art.innerHTML = `${repostBy ? `<div class="rp">↻ <span class="mn" data-pk="${repostBy}">${esc(name(repostBy))}</span> reposted</div>` : ''}<div class="gut">${avatarHTML(inner.pubkey)}</div><div class="body"><header><b class="nm" data-pk="${inner.pubkey}">${esc(name(inner.pubkey))}</b>${p.nip05 ? `<span class="v" title="${esc(p.nip05)}">✓</span>` : ''}<time title="${new Date(inner.created_at * 1000).toLocaleString()}">${ago(inner.created_at)}</time><span class="lang" ${foreign ? '' : 'hidden'}>${esc(lang)}</span><span class="sp"></span><button class="more" data-act="more" aria-label="more">⋯</button></header>${target ? `<div class="ctx">↩ replying${tp ? ` to <b class="mn" data-pk="${tp}">${esc(name(tp))}</b>` : ''} · <b data-act="thread">thread</b></div>` : ''}<div class="txt${plain.length > 700 ? ' clamp' : ''}">${html || (media.length ? '' : '<span style="color:var(--mute)">…</span>')}</div>${plain.length > 700 ? '<button class="showmore" data-act="expand">show more</button>' : ''}<div class="tr" hidden></div>${mediaHTML(media)}${quotes.map(quoteHTML).join('')}<footer><button class="act" data-act="reply" title="reply">↩ <span class="cnt cnt-replies"></span></button><button class="act" data-act="repost" title="repost">↻ <span class="cnt cnt-reposts"></span></button><button class="act" data-act="like" title="like">♥ <span class="cnt cnt-likes"></span></button><span class="act zap" title="zaps received">⚡ <span class="cnt cnt-sats"></span></span><button class="act" data-act="translate" ${lang === 'und' ? 'hidden' : ''}>${foreign ? 'translate' : 'tr'}</button><button class="act" data-act="bookmark" title="bookmark">${S.bookmarks.has(inner.id) ? '★' : '☆'}</button></footer></div>`;
  S.nodes.set(ev.id, art); if (inner.id !== ev.id) S.nodes.set(inner.id, art);
  art.querySelectorAll('[data-src]').forEach(el => mediaIO.observe(el)); noteIO.observe(art); updateCounts(inner.id);
  if (lang === 'und' && plain.length > 12) detectAsync(plain).then(l => { if (!l || l === 'und') return; art.dataset.lang = l; const f = !S.langs.includes(l); const tag = art.querySelector('.lang'); tag.textContent = l; tag.hidden = !f; const b = art.querySelector('[data-act="translate"]'); b.hidden = false; b.textContent = f ? 'translate' : 'tr'; if (f && S.auto && art.dataset.seen) translateNote(art); });
  return art;
}
function refreshNames() { const set = nameQueue; if (!set.size) return; nameQueue.clear(); for (const el of document.querySelectorAll('[data-pk]')) { const pk = el.dataset.pk; if (!set.has(pk)) continue; if (el.classList.contains('nm')) el.textContent = name(pk); else if (el.classList.contains('mn')) el.textContent = '@' + name(pk); else if (el.classList.contains('av')) { const p = prof(pk); if (p.pic && !THIN && !el.querySelector('img')) el.outerHTML = avatarHTML(pk); } else if (el.classList.contains('cube')) paintCube(el, pk, el.dataset.note ? S.events.get(el.dataset.note) : null); } }
const mediaIO = new IntersectionObserver(entries => { for (const en of entries) { if (!en.isIntersecting) continue; const el = en.target; mediaIO.unobserve(el); const src = el.dataset.src; if (!src) continue; delete el.dataset.src; if (el.tagName === 'IMG') { el.onload = () => el.classList.add('ok'); el.src = src; } else if (el.tagName === 'VIDEO') { el.onloadeddata = () => el.classList.add('ok'); el.preload = 'metadata'; el.src = src; } else if (el.tagName === 'AUDIO') el.src = src; } }, { rootMargin: '1400px 0px' });
const noteIO = new IntersectionObserver(entries => { for (const en of entries) { if (!en.isIntersecting) continue; const art = en.target; art.dataset.seen = '1'; if (S.auto) { const l = art.dataset.lang; if (l && l !== 'und' && !S.langs.includes(l)) translateNote(art); } } }, { rootMargin: '400px 0px' });
function mediaOff(el) { el.querySelectorAll('[data-src]').forEach(m => mediaIO.unobserve(m)); noteIO.unobserve(el); el.querySelectorAll('video').forEach(v => { try { v.pause(); v.removeAttribute('src'); v.load(); } catch {} }); }

// ---- blurhash: the placeholder is the picture's own colours before a byte of it arrives -------------
const B83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
const d83 = s => { let v = 0; for (const c of s) v = v * 83 + B83.indexOf(c); return v; };
const toLin = v => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
const toSRGB = v => { const x = Math.max(0, Math.min(1, v)); return Math.round((x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255); };
const sPow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
function blurhash(hash) {
  if (blurCache.has(hash)) return blurCache.get(hash); let out = null;
  try { const sz = d83(hash[0]), ny = Math.floor(sz / 9) + 1, nx = (sz % 9) + 1; if (hash.length === 4 + 2 * nx * ny) { const max = (d83(hash[1]) + 1) / 166, cols = []; const v = d83(hash.slice(2, 6)); cols.push([toLin(v >> 16), toLin((v >> 8) & 255), toLin(v & 255)]); for (let i = 1; i < nx * ny; i++) { const q = d83(hash.slice(4 + i * 2, 6 + i * 2)); cols.push([sPow((Math.floor(q / 361) - 9) / 9, 2) * max, sPow((Math.floor(q / 19) % 19 - 9) / 9, 2) * max, sPow((q % 19 - 9) / 9, 2) * max]); } const w = 24, h = 24, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), img = g.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let r = 0, gg = 0, b = 0; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = Math.cos(Math.PI * x * i / w) * Math.cos(Math.PI * y * j / h), col = cols[i + j * nx]; r += col[0] * k; gg += col[1] * k; b += col[2] * k; } const p = 4 * (x + y * w); img.data[p] = toSRGB(r); img.data[p + 1] = toSRGB(gg); img.data[p + 2] = toSRGB(b); img.data[p + 3] = 255; } g.putImageData(img, 0, 0); out = c.toDataURL(); } } catch { out = null; }
  if (blurCache.size > 500) blurCache.clear(); blurCache.set(hash, out); return out;
}

// ---- language: a cheap guess now, the browser's detector when it has one, translation on tap ---------
const STOP = { en: 'the and is are you this that with for was have not but they from what just like about your'.split(' '), es: 'que de la el en los es por un una para con del las como pero más'.split(' '), pt: 'que não de um uma para com os das dos mais mas você isso está'.split(' '), fr: 'les des est une pour dans que qui pas sur avec vous nous mais'.split(' '), de: 'und der die das ist nicht ich mit ein auf für von sie wir auch'.split(' '), it: 'che non una per con sono del della gli anche come più questo'.split(' '), nl: 'het een van niet dat met zijn voor maar ook naar'.split(' '), tr: 'bir ve bu için ile çok daha gibi ama değil'.split(' '), id: 'yang dan untuk dengan tidak ini itu dari akan saya'.split(' ') };
for (const k in STOP) STOP[k] = new Set(STOP[k]);
function detectLang(t) {
  if (!t) return 'und'; const s = t.replace(/https?:\/\/\S+|@\S+|[\d\p{P}\p{S}]/gu, ' '); const n = s.replace(/\s/g, '').length; if (n < 3) return 'und';
  const cnt = re => (s.match(re) || []).length;
  if (cnt(/[぀-ヿ]/g) / n > 0.08) return 'ja'; if (cnt(/[가-힯]/g) / n > 0.2) return 'ko'; if (cnt(/[一-鿿]/g) / n > 0.3) return 'zh'; if (cnt(/[Ѐ-ӿ]/g) / n > 0.4) return 'ru'; if (cnt(/[؀-ۿ]/g) / n > 0.4) return 'ar'; if (cnt(/[֐-׿]/g) / n > 0.4) return 'he'; if (cnt(/[฀-๿]/g) / n > 0.4) return 'th'; if (cnt(/[ऀ-ॿ]/g) / n > 0.3) return 'hi'; if (cnt(/[Ͱ-Ͽ]/g) / n > 0.4) return 'el';
  const words = s.toLowerCase().split(/\s+/).filter(Boolean); let best = 'und', bh = 1; for (const [lang, set] of Object.entries(STOP)) { let h = 0; for (const w of words) if (set.has(w)) h++; if (h > bh) { bh = h; best = lang; } } if (best !== 'und') return best;
  return /^[\x00-\x7f\s]*$/.test(s) && words.length >= 3 ? 'en' : 'und';
}
let detector = null;
async function detectAsync(text) { try { if (!('LanguageDetector' in self) || detector === false) return null; const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), ms))]); if (!detector) { const a = await within(self.LanguageDetector.availability(), 1200); if (a !== 'available') { detector = false; return null; } detector = await within(self.LanguageDetector.create(), 3000); } const r = await within(detector.detect(text.slice(0, 400)), 3000); return r?.[0]?.confidence > 0.55 ? r[0].detectedLanguage.slice(0, 2) : null; } catch { detector = detector || false; return null; } }
const trCache = new Map(Object.entries(store.get('tr', {})));
async function translate(text, from, to) {
  const key = to + ':' + text.slice(0, 200); if (trCache.has(key)) return trCache.get(key); let out = null;
  const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), ms))]);
  try { if ('Translator' in self && from !== 'und') { const a = await within(self.Translator.availability({ sourceLanguage: from, targetLanguage: to }), 1200); if (a === 'available') { const tr = await within(self.Translator.create({ sourceLanguage: from, targetLanguage: to }), 3000); out = await within(tr.translate(text), 8000); } } } catch {} // on-device when the model is already here, otherwise the network, never a hang
  if (!out) try { const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from === 'und' ? 'auto' : from}&tl=${to}&dt=t&q=${encodeURIComponent(text.slice(0, 2000))}`); if (r.ok) { const j = await r.json(); out = (j[0] || []).map(x => x[0]).join(''); } } catch {}
  if (!out) try { const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${from === 'und' ? 'en' : from}|${to}`); const j = await r.json(); if (j.responseStatus === 200) out = j.responseData.translatedText; } catch {}
  if (out) { trCache.set(key, out); if (trCache.size > 400) trCache.delete(trCache.keys().next().value); store.set('tr', Object.fromEntries(trCache)); }
  return out;
}
let trBusy = 0; const trQueue = [];
async function translateNote(art) {
  const box = art.querySelector('.tr'); if (!box || box.dataset.done) return; box.dataset.done = '1';
  const ev = S.events.get(art.dataset.inner); if (!ev) return; const { plain } = parse(ev); const from = art.dataset.lang || 'und', to = S.langs[0] || 'en'; if (!plain || from === to) return;
  if (trBusy >= 2) { trQueue.push(art); delete box.dataset.done; return; } trBusy++;
  box.hidden = false; box.innerHTML = `<small>translating from ${esc(from)}…</small>`;
  const out = await translate(plain, from, to); trBusy--;
  box.innerHTML = out ? `<small>translated from ${esc(from)} · <span class="mn" data-act="untranslate">hide</span></small>${esc(out)}` : '<small>translation unavailable right now</small>';
  const next = trQueue.shift(); if (next) translateNote(next);
}

// ---- interactions and publishing --------------------------------------------------------------------
async function sign(t) { const me = S.me; if (!me?.pk || me.mode === 'read') { toast('you are looking around without a key: make one in settings to post'); return null; } const ev = { kind: t.kind, created_at: now(), tags: t.tags || [], content: t.content || '', pubkey: me.pk }; try { if (me.mode === 'nip07') return await window.nostr.signEvent(ev); return NT.finalizeEvent(ev, bytesOf(me.sk)); } catch (e) { toast('signing failed: ' + (e?.message || e)); return null; } }
async function publish(t) { const ev = await sign(t); if (!ev) return null; send({ type: 'publish', event: ev }); const fresh = ingest(ev); if (fresh && inFeed(ev)) place(ev, false); return ev; }
async function like(ev) { if (S.mine.get(ev.id)?.liked) return; const r = await publish({ kind: 7, content: '+', tags: [['e', ev.id], ['p', ev.pubkey], ['k', String(ev.kind)]] }); if (r) { pulse(ev.pubkey, 'like'); toast('liked'); } }
async function repost(ev) { if (S.mine.get(ev.id)?.reposted) return; const r = await publish({ kind: 6, content: JSON.stringify(ev), tags: [['e', ev.id], ['p', ev.pubkey]] }); if (r) { pulse(ev.pubkey, 'repost'); toast('reposted'); } }
function applyContacts(ev) { S.contactsAt = ev.created_at; S.contactsContent = ev.content || ''; S.follows = [...new Set(ev.tags.filter(t => t[0] === 'p' && HEX.test(t[1] || '')).map(t => t[1]))]; store.set('follows', S.follows); store.set('contactsAt', S.contactsAt); renderCluster(); if (S.feed === 'follows') setFeed('follows'); }
async function follow(pk, on) {
  if (on === isFollow(pk)) return; S.follows = on ? [pk, ...S.follows] : S.follows.filter(p => p !== pk); store.set('follows', S.follows);
  if (S.me?.pk && S.me.mode !== 'read') { const ev = await publish({ kind: 3, content: S.contactsContent, tags: S.follows.map(p => ['p', p]) }); if (ev) S.contactsAt = ev.created_at; }
  if (on) flyToCluster(pk); else renderCluster(); toast(on ? `following ${name(pk)}` : `unfollowed ${name(pk)}`); syncCubes();
}
function mute(pk) { S.muted.add(pk); store.set('muted', [...S.muted]); rebuildItems(); toast('muted on this device'); }
function bookmark(id, btn) { if (S.bookmarks.has(id)) S.bookmarks.delete(id); else S.bookmarks.add(id); store.set('bookmarks', [...S.bookmarks]); if (btn) btn.textContent = S.bookmarks.has(id) ? '★' : '☆'; }

// clicks inside notes: one listener, the note decides
document.addEventListener('click', e => {
  if (e.target.closest('#onboard')) return;
  const act = e.target.closest('[data-act]'), art = e.target.closest('.note'); const ev = art && S.events.get(art.dataset.inner);
  if (act && art && ev) { const a = act.dataset.act; if (a === 'like') like(ev); else if (a === 'repost') repost(ev); else if (a === 'reply') openCompose(ev); else if (a === 'translate') { const box = art.querySelector('.tr'); if (!box.hidden && box.dataset.done) { box.hidden = true; } else { delete box.dataset.done; translateNote(art); } } else if (a === 'untranslate') art.querySelector('.tr').hidden = true; else if (a === 'bookmark') bookmark(ev.id, act); else if (a === 'expand') { art.querySelector('.txt').classList.remove('clamp'); act.remove(); } else if (a === 'thread') openThread(ev); else if (a === 'more') openMore(ev, art); return; }
  const mn = e.target.closest('.mn[data-pk], .nm[data-pk], .av[data-pk]'); if (mn && mn.dataset.pk) { openProfile(mn.dataset.pk); return; }
  const tag = e.target.closest('.tag[data-tag]'); if (tag) { closePanel(); setFeed('tag', tag.dataset.tag); return; }
  const q = e.target.closest('.quote[data-quote]'); if (q) { const qe = S.events.get(q.dataset.quote); if (qe && qe.created_at) openThread(qe); return; }
  const ph = e.target.closest('.ph'); if (ph) { if (ph.classList.contains('yt')) { if (!ph.querySelector('iframe')) { ph.classList.add('playing'); ph.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${esc(ph.dataset.yt)}?autoplay=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`; } } else if (ph.classList.contains('vid')) { const v = ph.querySelector('video'); if (!v) return; if (v.dataset.src) { mediaIO.unobserve(v); v.src = v.dataset.src; delete v.dataset.src; v.classList.add('ok'); } if (v.paused) { v.muted = false; v.play().catch(() => {}); ph.classList.add('playing'); } else { v.pause(); ph.classList.remove('playing'); } } else { const src = ph.dataset.full; if (src) { $('lightbox').innerHTML = `<img src="${esc(src)}" alt="">`; $('lightbox').hidden = false; } } return; }
  if (art && !e.target.closest('a, button, video, audio, .tr') && ev && e.target.closest('.txt, .body > header time')) openThread(ev);
});
$('lightbox').addEventListener('click', () => { $('lightbox').hidden = true; $('lightbox').innerHTML = ''; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('lightbox').hidden) { $('lightbox').hidden = true; $('lightbox').innerHTML = ''; } else closePanel(); } });

// ---- panels: thread, profile, compose, settings, search, follows --------------------------------------
function openPanel(title, body) { $('panelTitle').textContent = title; const B = $('panelBody'); B.textContent = ''; if (typeof body === 'string') B.innerHTML = body; else B.append(body); $('panel').hidden = false; B.scrollTop = 0; }
function closePanel() { $('panel').hidden = true; $('panelBody').textContent = ''; }
$('panelClose').addEventListener('click', closePanel);
function openThread(ev) {
  const box = document.createElement('div'); box.className = 'thread plist'; const root = rootOf(ev); const ids = new Set([ev.id]);
  const render = () => { box.textContent = ''; const all = [...S.events.values()].filter(e => e.created_at && e.kind === 1 && (e.id === ev.id || e.id === root || replyTarget(e) === ev.id || (root && rootOf(e) === root && e.created_at >= (S.events.get(root)?.created_at || 0)))).sort((a, b) => a.created_at - b.created_at); for (const e of all) { const el = noteEl(e); el.classList.add(e.id === ev.id ? 'root' : 'reply'); if (e.id !== ev.id && replyTarget(e) !== ev.id && e.id !== root) el.style.marginLeft = '2.4rem'; box.append(el); ids.add(e.id); } if (all.length === 1) box.insertAdjacentHTML('beforeend', '<p class="empty">no replies loaded yet</p>'); };
  render(); openPanel('thread', box);
  const want = [ev.id, root].filter(Boolean); send({ type: 'get', ids: want.filter(id => !S.events.get(id)?.created_at) });
  const sid = subscribe([{ kinds: [1, 7, 6, 9735], '#e': [...new Set(want)], limit: 200 }], { timeout: 10000 }); const h = H.events; let t = 0; const prev = H.events; H.events = d => { prev(d); if (d.sub === sid || d.sub === 'get') { clearTimeout(t); t = setTimeout(() => { if (!$('panel').hidden && $('panelBody').contains(box)) render(); }, 150); } }; setTimeout(() => { if (H.events !== prev) H.events = prev; }, 12000); void h;
}
function openProfile(pk) {
  needProfile(pk); const p = prof(pk); const box = document.createElement('div'); const me = isMe(pk);
  box.innerHTML = `<div class="prof">${avatarHTML(pk)}<div><h3 class="nm" data-pk="${pk}">${esc(name(pk))}</h3>${p.nip05 ? `<div class="n5">${esc(p.nip05)}</div>` : ''}<div class="about">${esc(p.about || '')}</div><div class="row">${me ? '<button class="mb" data-p="edit">edit profile</button>' : `<button class="mb ${isFollow(pk) ? 'on' : 'pri'}" data-p="follow">${isFollow(pk) ? 'following · unfollow' : 'follow'}</button><button class="mb" data-p="mute">mute</button>`}<button class="mb" data-p="copy">copy npub</button><button class="mb" data-p="feed">all their notes</button></div></div></div><div class="plist" id="plist"><p class="empty">loading their notes…</p></div>`;
  box.querySelector('[data-p="follow"]')?.addEventListener('click', e => { follow(pk, !isFollow(pk)); e.target.textContent = isFollow(pk) ? 'following · unfollow' : 'follow'; e.target.classList.toggle('on', isFollow(pk)); e.target.classList.toggle('pri', !isFollow(pk)); });
  box.querySelector('[data-p="mute"]')?.addEventListener('click', () => { mute(pk); closePanel(); }); box.querySelector('[data-p="edit"]')?.addEventListener('click', openSettings);
  box.querySelector('[data-p="copy"]').addEventListener('click', () => { navigator.clipboard?.writeText(NT.nip19.npubEncode(pk)).then(() => toast('npub copied')); }); box.querySelector('[data-p="feed"]').addEventListener('click', () => { closePanel(); setFeed('profile', pk); });
  openPanel(me ? 'you' : 'profile', box);
  const list = box.querySelector('#plist'); const seenIds = new Set(); const sid = subscribe([{ kinds: [1, 6], authors: [pk], limit: 30 }], { timeout: 10000 }); const prev = H.events; H.events = d => { prev(d); if (d.sub !== sid || !$('panelBody').contains(box)) return; if (list.querySelector('.empty')) list.textContent = ''; const got = d.events.filter(e => !seenIds.has(e.id)).sort((a, b) => b.created_at - a.created_at); for (const e of got) { seenIds.add(e.id); let after = null; for (const el of list.children) { const ee = S.events.get(el.dataset.id); if (ee && ee.created_at < e.created_at) { after = el; break; } } const el = noteEl(e); if (after) after.before(el); else list.append(el); } }; setTimeout(() => { if (H.events !== prev) H.events = prev; }, 11000);
}
function openMore(ev, art) { const box = document.createElement('div'); box.className = 'settings'; box.innerHTML = `<div class="row"><button class="mb" data-m="copy">copy note id</button><button class="mb" data-m="link">copy njump link</button><button class="mb" data-m="raw">raw json</button><button class="mb" data-m="mute">mute ${esc(name(ev.pubkey))}</button></div><pre class="key" id="raw" hidden></pre>`; box.querySelector('[data-m="copy"]').addEventListener('click', () => navigator.clipboard?.writeText(NT.nip19.noteEncode(ev.id)).then(() => toast('copied'))); box.querySelector('[data-m="link"]').addEventListener('click', () => navigator.clipboard?.writeText('https://njump.me/' + NT.nip19.noteEncode(ev.id)).then(() => toast('copied'))); box.querySelector('[data-m="raw"]').addEventListener('click', () => { const r = box.querySelector('#raw'); r.hidden = false; r.textContent = JSON.stringify(ev, null, 1); }); box.querySelector('[data-m="mute"]').addEventListener('click', () => { mute(ev.pubkey); closePanel(); }); openPanel('note', box); void art; }
function openCompose(replyTo = null) {
  const box = document.createElement('div'); box.className = 'compose';
  box.innerHTML = `${replyTo ? `<div class="ctx">↩ replying to <b>${esc(name(replyTo.pubkey))}</b>: <span style="color:var(--fg)">${esc(parse(replyTo).plain.slice(0, 140))}</span></div>` : ''}<textarea id="ctext" placeholder="${replyTo ? 'your reply' : 'what is happening'}" maxlength="5000"></textarea><div class="row"><small id="ccount">0</small><span style="flex:1"></span><button class="mb" id="cpaste" title="paste an image or video url">+ media url</button><button class="mb pri" id="csend">${replyTo ? 'reply' : 'post'}</button></div><p class="empty" style="text-align:left;padding:.4rem 0">links to images and videos render as media. #tags become tags. nostr:npub… mentions people.</p>`;
  const ta = box.querySelector('#ctext'); ta.addEventListener('input', () => { box.querySelector('#ccount').textContent = String(ta.value.length); });
  box.querySelector('#cpaste').addEventListener('click', () => { const u = prompt('image or video url'); if (u) ta.value = (ta.value + '\n' + u).trim(); });
  box.querySelector('#csend').addEventListener('click', async () => { const text = ta.value.trim(); if (!text) return; const tags = []; for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_]{1,50})/gu)) tags.push(['t', m[2].toLowerCase()]); for (const m of text.matchAll(/nostr:(npub1[0-9a-z]+|nprofile1[0-9a-z]+)/g)) { try { const d = NT.nip19.decode(m[1]); tags.push(['p', d.type === 'npub' ? d.data : d.data.pubkey]); } catch {} }
    if (replyTo) { const root = rootOf(replyTo); if (root && root !== replyTo.id) { tags.push(['e', root, '', 'root']); tags.push(['e', replyTo.id, '', 'reply']); } else tags.push(['e', replyTo.id, '', 'root']); const ps = new Set([replyTo.pubkey, ...replyTo.tags.filter(t => t[0] === 'p' && HEX.test(t[1] || '')).map(t => t[1])]); for (const p of ps) if (!isMe(p) && !tags.some(t => t[0] === 'p' && t[1] === p)) tags.push(['p', p]); }
    const ev = await publish({ kind: 1, content: text, tags }); if (ev) { closePanel(); toast(replyTo ? 'reply sent' : 'posted'); if (replyTo) pulse(replyTo.pubkey, 'reply'); } });
  openPanel(replyTo ? 'reply' : 'post', box); setTimeout(() => ta.focus(), 50);
}
$('composeBtn').addEventListener('click', () => openCompose()); $('composeBtn2').addEventListener('click', () => openCompose());
function openSettings() {
  const me = S.me || {}; const box = document.createElement('div'); box.className = 'settings';
  const npub = me.pk ? NT.nip19.npubEncode(me.pk) : ''; const nsec = me.sk ? NT.nip19.nsecEncode(bytesOf(me.sk)) : '';
  box.innerHTML = `<label>name<input id="sName" value="${esc(me.name || '')}" maxlength="60"></label><label>about<textarea id="sAbout" rows="3" maxlength="500">${esc(me.about || '')}</textarea></label><label>picture url<input id="sPic" value="${esc(me.pic || '')}"></label><label>nip-05 (name@domain, if you have one)<input id="sNip05" value="${esc(me.nip05 || '')}"></label><div class="row"><button class="mb pri" id="sSave">save profile${me.pk && me.mode !== 'read' ? ' · publish' : ''}</button></div>
  <label>your key</label>${me.pk ? `<div class="key">npub · ${esc(npub)}</div>` : '<div class="key">no key: you are looking around</div>'}${nsec ? `<div class="row"><button class="mb" id="sReveal">reveal nsec</button><button class="mb" id="sCopy">copy nsec</button></div><div class="key" id="sNsec" hidden>${esc(nsec)}</div><div class="warn">the nsec is the key itself. anyone who has it is you. it lives only in this browser; copy it somewhere safe or it is gone with the browser data.</div>` : me.mode === 'nip07' ? '<div class="warn">signed by your extension</div>' : ''}${!me.pk || me.mode === 'read' ? '<div class="row"><button class="mb pri" id="sNewKey">make me a key now</button><button class="mb" id="sUseExt" ' + (window.nostr ? '' : 'hidden') + '>use my extension</button></div>' : ''}
  <label>languages you read (comma separated, first is the one to translate into)<input id="sLangs" value="${esc(S.langs.join(', '))}"></label><div class="row"><label style="display:flex;gap:.4rem;align-items:center;text-transform:none"><input type="checkbox" id="sAuto" ${S.auto ? 'checked' : ''}> translate other languages as they scroll into view</label></div><div class="row"><label style="display:flex;gap:.4rem;align-items:center;text-transform:none"><input type="checkbox" id="sReplies" ${S.showReplies ? 'checked' : ''}> show replies in the world feed</label></div>
  <label>relays (one per line)<textarea id="sRelays" rows="4">${esc(S.relays.join('\n'))}</textarea></label><div class="row"><button class="mb" id="sRelaySave">use these relays</button><small id="sRelayState">${Object.entries(S.relayState || {}).map(([u, o]) => `${o ? '●' : '○'} ${u.replace('wss://', '')}`).join(' · ')}</small></div>
  <div class="row"><button class="mb" id="sBookmarks">bookmarks (${S.bookmarks.size})</button><button class="mb" id="sMuted">unmute all (${S.muted.size})</button><button class="mb" id="sForget">forget this device</button></div><div class="warn">forget wipes the key, the cache and every setting on this device. copy the nsec first if you want to keep this identity.</div>`;
  box.querySelector('#sSave').addEventListener('click', async () => { const m = { ...(S.me || { mode: 'read', pk: null }), name: box.querySelector('#sName').value.trim(), about: box.querySelector('#sAbout').value.trim(), pic: box.querySelector('#sPic').value.trim(), nip05: box.querySelector('#sNip05').value.trim() }; S.me = m; store.set('me', m); renderMe(); if (m.pk && m.mode !== 'read') { const ev = await publish({ kind: 0, content: JSON.stringify({ name: m.name, display_name: m.name, about: m.about, picture: m.pic, nip05: m.nip05 }) }); if (ev) toast('profile published'); } else toast('saved on this device'); S.profiles.set(m.pk || 'me', { pubkey: m.pk, t: now(), name: m.name, pic: m.pic, about: m.about, nip05: m.nip05 }); });
  box.querySelector('#sReveal')?.addEventListener('click', () => { box.querySelector('#sNsec').hidden = false; }); box.querySelector('#sCopy')?.addEventListener('click', () => navigator.clipboard?.writeText(nsec).then(() => toast('nsec copied: keep it secret')));
  box.querySelector('#sNewKey')?.addEventListener('click', async () => { const sk = NT.generateSecretKey(); S.me = { ...(S.me || {}), sk: hexOf(sk), pk: NT.getPublicKey(sk), mode: 'local' }; store.set('me', S.me); toast('you have a key now'); renderMe(); openSettings(); bootMe(); });
  box.querySelector('#sUseExt')?.addEventListener('click', async () => { try { const pk = await window.nostr.getPublicKey(); S.me = { ...(S.me || {}), pk, mode: 'nip07', sk: null }; store.set('me', S.me); toast('using your extension'); renderMe(); openSettings(); bootMe(); } catch { toast('the extension said no'); } });
  box.querySelector('#sLangs').addEventListener('change', e => { S.langs = e.target.value.split(/[,\s]+/).map(x => x.trim().toLowerCase().slice(0, 2)).filter(Boolean); if (!S.langs.length) S.langs = ['en']; store.set('langs', S.langs); });
  box.querySelector('#sAuto').addEventListener('change', e => { S.auto = e.target.checked; store.set('auto', S.auto); }); box.querySelector('#sReplies').addEventListener('change', e => { S.showReplies = e.target.checked; store.set('showReplies', S.showReplies); if (S.feed === 'world') rebuildItems(); });
  box.querySelector('#sRelaySave').addEventListener('click', () => { const list = box.querySelector('#sRelays').value.split(/\s+/).map(x => x.trim()).filter(x => /^wss?:\/\/\S+$/.test(x)).slice(0, 12); if (!list.length) return; S.relays = list; store.set('relays', list); send({ type: 'relays', relays: list }); toast(`${list.length} relays`); });
  box.querySelector('#sBookmarks').addEventListener('click', () => { closePanel(); setFeed('bookmarks'); }); box.querySelector('#sMuted').addEventListener('click', () => { S.muted.clear(); store.set('muted', []); rebuildItems(); toast('unmuted'); });
  box.querySelector('#sForget').addEventListener('click', () => { if (!confirm('wipe the key, cache and settings on this device?')) return; for (const k of Object.keys(localStorage)) if (k.startsWith('cube.')) localStorage.removeItem(k); send({ type: 'wipe' }); setTimeout(() => location.reload(), 1500); });
  openPanel('settings', box);
}
$('settingsBtn').addEventListener('click', openSettings);
function openFollows() { const box = document.createElement('div'); box.className = 'plist'; if (!S.follows.length) box.innerHTML = '<p class="empty">you follow nobody yet</p>'; for (const pk of S.follows) { needProfile(pk); const row = document.createElement('div'); row.className = 'prof'; row.innerHTML = `${avatarHTML(pk)}<div><h3 class="nm" data-pk="${pk}">${esc(name(pk))}</h3><div class="about">${esc((prof(pk).about || '').slice(0, 120))}</div></div>`; box.append(row); } openPanel(`following · ${S.follows.length}`, box); }
$('search').addEventListener('submit', e => { e.preventDefault(); runSearch($('q').value.trim()); });
function runSearch(q) { if (!q) return; closePanel(); if (/^(npub1|nprofile1)[0-9a-z]+$/.test(q)) { try { const d = NT.nip19.decode(q); openProfile(d.type === 'npub' ? d.data : d.data.pubkey); } catch { toast('bad npub'); } return; } if (/^(note1|nevent1)[0-9a-z]+$/.test(q)) { try { const d = NT.nip19.decode(q); const id = d.type === 'note' ? d.data : d.data.id; send({ type: 'get', ids: [id] }); setTimeout(() => { const ev = S.events.get(id); if (ev?.created_at) openThread(ev); else toast('note not found on these relays'); }, 1500); } catch { toast('bad note id'); } return; } if (q[0] === '#') { setFeed('tag', q.slice(1).toLowerCase()); return; } setFeed('search', q); }
$('searchBtn').addEventListener('click', () => { const box = document.createElement('div'); box.className = 'compose'; box.innerHTML = '<input id="q2" placeholder="search notes, #tags, npub…" style="width:100%;box-sizing:border-box;font-size:1rem">'; openPanel('search', box); const i = box.querySelector('#q2'); i.focus(); i.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(i.value.trim()); }); });

// ---- the cube that is you, and the cubes that are them ----------------------------------------------
const FACES = ['front', 'right', 'back', 'left', 'top', 'bottom'];
function cubeEl(pk, cls, note) { const el = document.createElement('div'); el.className = 'cube mini ' + cls; el.dataset.pk = pk; if (note) el.dataset.note = note.id; el.innerHTML = FACES.map(f => `<div class="face ${f}"></div>`).join(''); paintCube(el, pk, note); el.addEventListener('click', e => { e.stopPropagation(); if (isMe(pk) || pk === 'me') { if (S.me?.pk) openProfile(S.me.pk); else openSettings(); } else openProfile(pk); }); return el; }
// six faces: who (front), when (top), which language or proof (right), what it earned (back), how much of them is here (left), what they are to you (bottom)
function faces(pk, note) {
  if (isMe(pk) || pk === 'me') { const rel = Object.values(S.relayState || {}).filter(Boolean).length; return { top: S.mentions ? `@${S.mentions}` : 'you', right: S.follows.length ? `${S.follows.length}→` : '0→', back: rel ? `${rel} rly` : 'off', left: (S.langs[0] || 'en'), bottom: S.me?.pk ? (S.me.mode === 'read' ? 'look' : 'key') : 'look' }; }
  const p = prof(pk), c = note && S.counts.get(note.id), n = S.authorN.get(pk) || 0;
  const earned = c ? (c.sats ? `⚡${c.sats >= 1000 ? Math.round(c.sats / 1000) + 'k' : c.sats}` : c.likes ? `♥${c.likes}` : c.replies ? `↩${c.replies}` : c.reposts ? `↻${c.reposts}` : '·') : '·';
  const lang = note ? (S.nodes.get(note.id)?.dataset.lang || detectLang(parse(note).plain)) : 'und';
  return { top: note ? ago(note.created_at) : S.lastAt.get(pk) ? ago(S.lastAt.get(pk)) : '?', right: p.nip05 ? '✓' + (lang !== 'und' ? lang : '') : lang !== 'und' ? lang : '?', back: earned, left: n > 1 ? `×${n}` : '×1', bottom: isFollow(pk) ? '★' : S.firstSeen.get(pk) ? 'seen' : 'new' };
}
function paintCube(el, pk, note) {
  const p = isMe(pk) || pk === 'me' ? { pic: S.me?.pic, name: S.me?.name } : prof(pk); const pic = p.pic && !THIN ? `url("${p.pic.replace(/"/g, '')}")` : 'none';
  el.style.setProperty('--pic', pic); el.style.setProperty('--c', isMe(pk) || pk === 'me' ? 'var(--accent)' : `hsl(${hue(pk)} 60% 60%)`);
  const f = faces(pk, note), letter = pic === 'none' ? ((p.name || name(pk)).replace(/^@/, '')[0] || '?').toUpperCase() : '';
  for (const face of el.children) { const k = face.className.replace('face ', ''); face.textContent = k === 'front' ? letter : f[k] || ''; }
  if (note) el.dataset.note = note.id; if (!S.firstSeen.has(pk) && !isMe(pk)) S.firstSeen.set(pk, now());
  el.title = isMe(pk) || pk === 'me' ? `you · ${f.top} · ${f.right} following · ${f.back}` : `${name(pk)} · ${f.top} · ${f.right} · ${f.back} · ${f.left} · ${f.bottom}`;
}
function renderMe() { const el = $('meCube'); if (!el.children.length) el.innerHTML = FACES.map(f => `<div class="face ${f}"></div>`).join(''); const pk = S.me?.pk || 'me'; el.dataset.pk = pk; paintCube(el, pk); }
$('meCube').addEventListener('click', () => { if (S.me?.pk) openProfile(S.me.pk); else openSettings(); });
H.relay = ({ url, open }) => { S.relayState = S.relayState || {}; S.relayState[url] = open; renderMe(); };
function renderCluster() {
  const box = $('cluster'); box.textContent = ''; const N = PHONE() ? 4 : 8; const order = [...S.follows].sort((a, b) => (S.lastAt.get(b) || 0) - (S.lastAt.get(a) || 0)); const show = order.slice(0, N);
  for (const pk of show) { needProfile(pk); const el = cubeEl(pk, 'small'); box.append(el); }
  if (S.follows.length > show.length || S.follows.length) { const m = document.createElement('button'); m.className = 'more'; m.textContent = S.follows.length > show.length ? `+${S.follows.length - show.length}` : `${S.follows.length}`; m.title = 'everyone you follow'; m.addEventListener('click', openFollows); box.append(m); }
}
const C = { spawned: new Map(), paths: new Map() };
function syncCubes() {
  if (!$('onboard').hidden) return; const H_ = innerHeight, want = [], seen = new Map(), mid = H_ / 2;
  for (const n of $('list').children) { const r = n.getBoundingClientRect(); if (r.top > H_) break; if (r.bottom < 56) continue; const pk = n.dataset.pk; if (!pk || isFollow(pk) || isMe(pk)) continue; const d = Math.abs((r.top + r.bottom) / 2 - mid); const w = seen.get(pk); if (w) { if (d < w.d) { w.d = d; w.note = n; } continue; } if (want.length >= 5) continue; const item = { pk, note: n, d, av: null }; seen.set(pk, item); want.push(item); }
  for (const w of want) w.av = w.note.querySelector('.av').getBoundingClientRect(); // all reads before any write
  for (const [pk, c] of C.spawned) if (!want.some(w => w.pk === pk)) { c.el.classList.remove('in'); c.el.classList.add('out'); c.note.classList.remove('cubed'); C.spawned.delete(pk); C.paths.delete(pk); setTimeout(() => c.el.remove(), 350); }
  const me = $('meCube').getBoundingClientRect(), mx = me.left + me.width / 2, my = me.top + me.height / 2; const d = [];
  for (const w of want) { const ev = S.events.get(w.note.dataset.inner); let c = C.spawned.get(w.pk); if (!c) { const el = document.createElement('div'); el.className = 'spawn'; el.append(cubeEl(w.pk, '', ev)); $('cubes').append(el); c = { el, note: w.note, pk: w.pk }; C.spawned.set(w.pk, c); setTimeout(() => el.classList.add('in'), 20); } else if (c.note !== w.note) { c.note.classList.remove('cubed'); c.note = w.note; const cube = c.el.firstElementChild; paintCube(cube, w.pk, ev); cube.classList.remove('nod'); void cube.offsetWidth; cube.classList.add('nod'); }
    w.note.classList.add('cubed'); const g = w.av; const size = 40; const x = g.left + (g.width - size) / 2, y = g.top + (g.height - size) / 2; c.el.style.transform = `translate(${x}px, ${y}px)`; const cx = x + size / 2, cy = y + size / 2; const path = `M${cx} ${cy} C${cx} ${cy - 60} ${mx + 40} ${my + 30} ${mx} ${my}`; C.paths.set(w.pk, path); d.push(path); }
  const svg = $('links'); if (svg.getAttribute('width') !== String(innerWidth)) { svg.setAttribute('width', innerWidth); svg.setAttribute('height', innerHeight); svg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`); } svg.innerHTML = d.map(p => `<path d="${p}"/>`).join('');
}
function pulse(pk, kind = 'like') {
  const path = C.paths.get(pk), meEl = $('meCube'); const flash = cls => { meEl.classList.remove(cls); void meEl.offsetWidth; meEl.classList.add(cls); setTimeout(() => meEl.classList.remove(cls), 700); };
  if (!path || REDUCED) { flash(kind === 'repost' ? 'echo' : 'hit'); return; }
  const travel = (cls, from, to, delay, dur, done) => { const dot = document.createElement('i'); dot.className = 'dot ' + cls; dot.style.offsetPath = `path("${path}")`; dot.style.offsetDistance = from; $('cubes').append(dot); const a = dot.animate([{ offsetDistance: from }, { offsetDistance: to }], { duration: dur, delay, easing: 'ease-in-out', fill: 'forwards' }); let fired = false; const end = () => { if (fired) return; fired = true; dot.remove(); done?.(); }; a.onfinish = end; setTimeout(end, dur + delay + 300); };
  if (kind === 'reply') { for (let i = 0; i < 3; i++) travel('reply', '0%', '100%', i * 140, 620, i === 2 ? () => flash('hit') : null); }
  else if (kind === 'repost') { travel('repost', '0%', '100%', 0, 600, () => { flash('echo'); travel('repost', '100%', '0%', 80, 600, () => { const c = C.spawned.get(pk); const cube = c?.el.firstElementChild; if (cube) { cube.classList.remove('nod'); void cube.offsetWidth; cube.classList.add('nod'); } }); }); }
  else travel('', '0%', '100%', 0, 650, () => flash('hit'));
}
function flyToCluster(pk) { const c = C.spawned.get(pk); renderCluster(); const target = $('cluster').querySelector(`.cube[data-pk="${pk}"]`); if (!c) return; if (target && !REDUCED) { target.style.visibility = 'hidden'; const r = target.getBoundingClientRect(); c.el.style.transform = `translate(${r.left}px, ${r.top}px) scale(${r.width / 40})`; c.el.style.opacity = '1'; c.note.classList.remove('cubed'); C.spawned.delete(pk); C.paths.delete(pk); setTimeout(() => { c.el.remove(); target.style.visibility = ''; }, 720); } else { c.el.remove(); c.note.classList.remove('cubed'); C.spawned.delete(pk); C.paths.delete(pk); } }
addEventListener('resize', () => { renderCluster(); syncCubes(); });

// ---- first time: the big cube -----------------------------------------------------------------------
const ob = { key: null };
function faceTo(n) { $('bigcube').style.transform = ['', 'rotateY(-90deg)', 'rotateY(-180deg)', 'rotateY(-270deg)', 'rotateX(90deg)'][n] || ''; setTimeout(() => { const inp = $('bigcube').querySelectorAll('.face')[n === 4 ? 5 : n]?.querySelector('input:not([hidden])'); if (inp && !PHONE()) inp.focus(); }, 500); if (n === 4) $('obSummary').textContent = `${$('obName').value.trim() || 'someone'} · ${ob.key === 'new' ? 'a new key, made here' : ob.key === 'nip07' ? 'signed by your extension' : ob.key === 'paste' ? 'your own key' : 'no key, just looking'}`; }
function startOnboarding() {
  $('onboard').hidden = false; faceTo(0); if (window.nostr) $('obNip07').hidden = false;
  $('onboard').querySelectorAll('[data-next]').forEach(b => b.addEventListener('click', () => { const n = Number(b.dataset.next); if (n === 1 && !$('obName').value.trim()) { $('obName').focus(); return; } faceTo(n); }));
  $('obName').addEventListener('keydown', e => { if (e.key === 'Enter' && $('obName').value.trim()) faceTo(1); }); $('obAbout').addEventListener('keydown', e => { if (e.key === 'Enter') faceTo(2); }); $('obPic').addEventListener('keydown', e => { if (e.key === 'Enter') faceTo(3); });
  $('onboard').querySelectorAll('[data-key]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.key; if (k === 'paste') { $('obNsec').hidden = false; $('obNsec').focus(); ob.key = 'paste'; return; } ob.key = k; faceTo(4); }));
  $('obNsec').addEventListener('keydown', e => { if (e.key === 'Enter') { try { const d = NT.nip19.decode($('obNsec').value.trim()); if (d.type !== 'nsec') throw 0; ob.sk = hexOf(d.data); ob.key = 'paste'; faceTo(4); } catch { toast('that is not an nsec'); } } });
  $('obGo').addEventListener('click', finishOnboarding);
}
async function finishOnboarding() {
  const me = { name: $('obName').value.trim().slice(0, 40) || 'someone', about: $('obAbout').value.trim(), pic: $('obPic').value.trim(), mode: 'read', pk: null, sk: null };
  if (ob.key === 'new') { const sk = NT.generateSecretKey(); me.sk = hexOf(sk); me.pk = NT.getPublicKey(sk); me.mode = 'local'; }
  else if (ob.key === 'paste' && ob.sk) { me.sk = ob.sk; me.pk = NT.getPublicKey(bytesOf(ob.sk)); me.mode = 'local'; }
  else if (ob.key === 'nip07') { try { me.pk = await window.nostr.getPublicKey(); me.mode = 'nip07'; } catch { toast('the extension said no; continuing without a key'); } }
  S.me = me; store.set('me', me); renderMe();
  if (me.pk && me.mode !== 'read' && ob.key !== 'paste') publish({ kind: 0, content: JSON.stringify({ name: me.name, display_name: me.name, about: me.about, picture: me.pic }) });
  const scene = $('scene'), slot = $('meSlot').getBoundingClientRect(), r = scene.getBoundingClientRect(); const s = slot.width / r.width;
  scene.style.transform = `translate(${slot.left + slot.width / 2 - (r.left + r.width / 2)}px, ${slot.top + slot.height / 2 - (r.top + r.height / 2)}px) scale(${s})`; $('onboard').classList.add('settling');
  setTimeout(() => { $('onboard').hidden = true; bootMe(); toast(`hello, ${me.name}`); syncCubes(); }, REDUCED ? 50 : 1000);
}

// ---- boot -------------------------------------------------------------------------------------------
function bootMe() { if (!S.me?.pk) return; subscribe([{ kinds: [3, 0], authors: [S.me.pk], limit: 4 }], { timeout: 8000 }); subscribe([{ kinds: [1, 6, 7, 9735], '#p': [S.me.pk], since: now() - 3 * 86400, limit: 100 }], { id: 'me', live: true }); needProfile(S.me.pk); }
function boot() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/cube/sw.js').catch(() => {});
  send({ type: 'start', relays: S.relays, profileRelays: PROFILE_RELAYS });
  renderMe(); renderCluster(); bootMe(); setFeed(store.get('feed', 'world'));
  setInterval(() => { for (const el of $('list').querySelectorAll('time')) { const ev = S.events.get(el.closest('.note')?.dataset.inner); if (ev) el.textContent = ago(ev.created_at); } }, 30000);
  setInterval(flushPending, 1500); setInterval(syncCubes, 2500);
}
window.cube = { S, L, C, setFeed, openProfile, openThread, translateNote, translate, follow, syncCubes, pulse, openCompose, openSettings, onScroll, faces, renderMe };
boot(); if (!S.me) startOnboarding();

// blocks.js: the mempool.space view of a person. One cube per difficulty epoch they
// were active in (thickness = how much), newest beside the epoch still being mined;
// open one and its events settle into a treemap: sized by length, coloured by the
// engagement the relays report, pictures shown where there were pictures.
import { BLOCKS_PER_EPOCH, BLOCKS_PER_ERA, blockToDate, tipHeight } from './anchor.js';
import { eraMeta } from './analytics.js';
import { H, fmt as fmtN, dayShort, dayYear } from './time.js';

const GREENS = ['#0b1a12','#10261a','#153223','#1a3f2c','#1f4c35','#255a3f','#2b6849','#327754','#3a865f','#43956b','#4ea477','#5ab384','#68c291','#79d09f','#8dddae','#a4e9bf'];
const AMBER = '#e9c46a';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const el = (cls, text) => { const d = document.createElement('div'); if (cls) d.className = cls; if (text != null) d.textContent = text; return d; };
const fmt = n => n.toLocaleString();

export const isReply = e => e.kind === 1 && e.tags.some(t => t[0] === 'e');
export const GOGGLES = {
  all: () => true,
  notes: e => e.kind === 1 && !isReply(e),
  replies: isReply,
  media: e => e.media?.length > 0,
  links: e => /https?:\/\//.test(e.content || '') && !(e.media?.length),
  reposts: e => e.kind === 6,
  reactions: e => e.kind === 7,
};
export function topTags(anchored, n = 5) {
  const count = new Map();
  for (const e of anchored) for (const t of e.tags) if (t[0] === 't' && /^[\p{L}\p{N}_]{2,24}$/u.test(t[1] || '')) { const k = t[1].toLowerCase(); count.set(k, (count.get(k) || 0) + 1); }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}
export const hasTag = tag => e => e.tags.some(t => t[0] === 't' && t[1]?.toLowerCase() === tag);

// what a tile is worth on screen: reactions are dust, reposts small, notes by length, pictures get room
const weight = e => e.kind === 7 ? 12 : e.kind === 6 ? 40 : Math.max(24, Math.min(600, (e.content || '').length)) + (e.media?.length ? 220 : 0);

// squarified treemap (Bruls, Huizing, van Wijk); items sorted by weight descending
export function squarify(items, x, y, w, h) {
  const out = [], total = items.reduce((s, i) => s + i.w, 0);
  if (!total || w <= 0 || h <= 0) return out;
  const scale = (w * h) / total;
  let rest = items.slice(), rx = x, ry = y, rw = w, rh = h;
  const worst = (row, sum, side) => { let mx = 0, mn = Infinity; for (const it of row) { const a = it.w * scale; if (a > mx) mx = a; if (a < mn) mn = a; } const s2 = side * side; return Math.max(s2 * mx / (sum * sum), (sum * sum) / (s2 * mn)); };
  while (rest.length) {
    const side = Math.min(rw, rh); let row = [], sum = 0, i = 0;
    while (i < rest.length) {
      const it = rest[i], a = it.w * scale;
      if (row.length && worst([...row, it], sum + a, side) > worst(row, sum, side)) break;
      row.push(it); sum += a; i++;
    }
    rest = rest.slice(i);
    if (rw >= rh) { const cw = sum / rh; let cy = ry; for (const it of row) { const th = it.w * scale / cw; out.push({ it, x: rx, y: cy, w: cw, h: th }); cy += th; } rx += cw; rw -= cw; }
    else { const ch = sum / rw; let cx = rx; for (const it of row) { const tw = it.w * scale / ch; out.push({ it, x: cx, y: ry, w: tw, h: ch }); cx += tw; } ry += ch; rh -= ch; }
  }
  return out;
}

const kindColor = (e, era) => e.media?.length ? AMBER : e.kind === 7 ? GREENS[4] : e.kind === 6 ? GREENS[6] : eraMeta(era).color;
const score = c => c ? c.replies * 2 + c.reactions + c.zaps * 3 + Math.log10(1 + c.sats) : 0;

export function createBlocks(root, anchored, opts = {}) {
  const byEpoch = new Map();
  for (const e of anchored) { const k = e.anchor.epoch; if (!byEpoch.has(k)) byEpoch.set(k, []); byEpoch.get(k).push(e); }
  const tip = tipHeight(), cur = Math.floor(tip / BLOCKS_PER_EPOCH);
  const past = [...byEpoch.keys()].filter(k => k !== cur).sort((a, b) => b - a);
  const engagement = new Map();           // epoch -> Map(id -> counts)
  let goggle = GOGGLES.all, openEpoch = null, tiles = [];

  root.textContent = '';
  const caps = el('blk-caps'); caps.append(el('c1', 'in progress'), el('c2', 'mined · newest first →'));
  const row = el('blk-row'), panel = el('blk-open'); panel.hidden = true;
  root.append(caps, row, panel);
  const keys = ev => {
    if (openEpoch == null || ev.target?.closest?.('input, textarea')) return;
    if (ev.key === 'Escape') api.close();
    const order = [cur, ...past], i = order.indexOf(openEpoch);
    if (ev.key === 'ArrowLeft' && i > 0) { ev.preventDefault(); open(order[i - 1]); }
    if (ev.key === 'ArrowRight' && i >= 0 && i < order.length - 1) { ev.preventDefault(); open(order[i + 1]); }
  };
  document.addEventListener('keydown', keys);
  row.addEventListener('pointermove', ev => { const r = row.getBoundingClientRect(); row.style.setProperty('--tilt', ((ev.clientX - r.left) / r.width - 0.5) * 16 + 'deg'); });
  row.addEventListener('pointerleave', () => row.style.setProperty('--tilt', '0deg'));

  const cubes = new Map();
  function cube(epoch, events, inProgress) {
    const wrap = el('blk'), c = el('cube'), n = events.length, era = Math.floor(epoch * BLOCKS_PER_EPOCH / BLOCKS_PER_ERA);
    const depth = inProgress ? 22 : 14 + Math.min(72, Math.round(n * 1.6));
    c.style.setProperty('--d', depth + 'px'); c.style.setProperty('--c', eraMeta(era).color);
    if (inProgress) c.classList.add('mining');
    const front = el('f front'), top = el('f top'), side = el('f side');
    const cv = document.createElement('canvas'); front.append(cv); c.append(top, side, front);
    if (inProgress) {
      const fill = el('fill'); fill.style.height = ((tip % BLOCKS_PER_EPOCH) / BLOCKS_PER_EPOCH * 100).toFixed(1) + '%'; front.append(fill);
    }
    const label = el('blk-label');
    const h0 = epoch * BLOCKS_PER_EPOCH, h1 = h0 + BLOCKS_PER_EPOCH - 1;
    const when = inProgress ? `${dayShort(blockToDate(h0))} → now` : `${dayShort(blockToDate(h0))} → ${dayShort(blockToDate(h1))}`;
    label.append(el('l1', when), el('l2', H(h0)), el('l3', inProgress ? `E${epoch} · ${fmt(tip % BLOCKS_PER_EPOCH)} of ${fmt(BLOCKS_PER_EPOCH)}` : `E${epoch} · ${n} event${n === 1 ? '' : 's'}`));
    wrap.append(c, label);
    wrap.setAttribute('role', 'button'); wrap.tabIndex = 0;
    wrap.setAttribute('aria-label', inProgress ? `epoch ${epoch}, still being mined, ${n} events so far` : `epoch ${epoch}, ${when}, ${n} events`);
    wrap.addEventListener('click', () => open(epoch));
    wrap.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(epoch); } });
    cubes.set(epoch, { wrap, c, cv, events, era });
    return wrap;
  }
  row.append(cube(cur, byEpoch.get(cur) || [], true), el('blk-divider'));
  for (const k of past) row.append(cube(k, byEpoch.get(k), false));
  requestAnimationFrame(paintFaces);

  function paintFaces() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    for (const [, cb] of cubes) {
      const w = cb.cv.clientWidth || 96, h = cb.cv.clientHeight || 96;
      cb.cv.width = w * dpr; cb.cv.height = h * dpr;
      const ctx = cb.cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0b0e0d'; ctx.fillRect(0, 0, w, h);
      const items = cb.events.map(e => ({ e, w: weight(e) })).sort((a, b) => b.w - a.w);
      for (const r of squarify(items, 1, 1, w - 2, h - 2)) {
        ctx.fillStyle = kindColor(r.it.e, cb.era) + (goggle(r.it.e) ? 'dd' : '33');
        ctx.fillRect(r.x + 0.5, r.y + 0.5, Math.max(0.5, r.w - 1), Math.max(0.5, r.h - 1));
      }
    }
  }

  async function open(epoch, quiet) {
    const cb = cubes.get(epoch); if (!cb) return;
    opts.onOpen?.(epoch, !!quiet);
    for (const [, o] of cubes) o.c.classList.remove('open');
    cb.c.classList.add('open'); openEpoch = epoch;
    const events = cb.events, h0 = epoch * BLOCKS_PER_EPOCH, h1 = h0 + BLOCKS_PER_EPOCH - 1, era = cb.era;
    const notes = events.filter(e => e.kind === 1).length, reposts = events.filter(e => e.kind === 6).length, reactions = events.filter(e => e.kind === 7).length, media = events.filter(e => e.media?.length).length;
    const change = opts.change?.(h0);
    panel.textContent = ''; panel.hidden = false;
    const head = el('bh');
    const title = el('bt'); title.append(el('b1', epoch === cur ? `E${epoch} · mining now` : `E${epoch}`),
      el('b2', `${H(h0)} → ${H(h1)} · ${dayShort(blockToDate(h0))} → ${dayYear(blockToDate(Math.min(h1, tip)))}${change != null ? ` · difficulty ${change > 0 ? '+' : ''}${(change * 100).toFixed(2)}%` : ''}`),
      el('b3', `${fmt(events.length)} events · ${fmt(notes)} notes · ${fmt(reposts)} reposts · ${fmt(reactions)} reactions${media ? ` · ${fmt(media)} with media` : ''}`));
    const legend = el('blegend');
    for (const [name, color] of [['note', eraMeta(era).color], ['repost', GREENS[6]], ['reaction', GREENS[4]], ['media', AMBER]]) { const k = el('lk', name); k.style.setProperty('--k', color); legend.append(k); }
    const scale = el('lscale'); scale.append(el('ls1', 'quiet'), el('lbar'), el('ls2', 'loud')); scale.title = 'tile colour: the replies, reactions and zaps the relays report for that note · tile size: length of the note';
    legend.append(scale); title.append(legend);
    const links = el('bl');
    const a = document.createElement('a'); a.href = `https://mempool.space/block/${h0}`; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = `block ${fmt(h0)} on mempool.space ↗`;
    const close = document.createElement('button'); close.className = 'mb'; close.textContent = '✕ close'; close.addEventListener('click', () => { panel.hidden = true; cb.c.classList.remove('open'); openEpoch = null; tiles = []; });
    links.append(a, close); head.append(title, links);
    const map = el('bm'); panel.append(head, strip(events, h0, h1, era), map);
    if (!events.length) { map.append(el('bempty', 'nothing from you in this epoch yet')); return; }
    layout(map, events, era, engagement.get(epoch));
    if (!quiet) panel.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    if (!engagement.has(epoch) && opts.engage) {
      const ids = events.filter(e => e.kind === 1).map(e => e.id);
      if (ids.length) { const counts = await opts.engage(ids); engagement.set(epoch, counts); opts.onEngage?.(epoch, counts); if (openEpoch === epoch) recolor(counts); }
    }
  }

  // the epoch as a ruler: 2016 blocks left to right, a tick per 144 blocks (about a day),
  // every event a bar where its created_at lands, so chain time, calendar and the notes share one axis
  function strip(events, h0, h1, era) {
    const st = el('bstrip'), t0 = blockToDate(h0).getTime() / 1000, t1 = blockToDate(h1 + 1).getTime() / 1000;
    for (let d = 0; d <= 14; d++) { const tk = el('tick'); tk.style.left = (d / 14 * 100) + '%'; if (d % 7 === 0) { tk.classList.add('major'); tk.append(el('tl', d === 0 ? `${H(h0)} · ${dayShort(new Date(t0 * 1000))}` : d === 14 ? `${H(h1)} · ${dayShort(new Date(t1 * 1000))}` : `+${fmt(d * 144)} blocks · ${dayShort(new Date((t0 + d * 86400) * 1000))}`)); } st.append(tk); }
    for (const e of events) {
      const bar = el('bev'), x = Math.min(1, Math.max(0, (e.created_at - t0) / (t1 - t0)));
      bar.style.left = (x * 100) + '%'; bar.style.background = kindColor(e, era); bar.style.height = (e.kind === 7 ? 30 : e.kind === 6 ? 55 : 100) + '%';
      bar.addEventListener('pointerenter', ev => { opts.tip?.(e, ev); mark(e, true); });
      bar.addEventListener('pointermove', ev => opts.tip?.(e, ev));
      bar.addEventListener('pointerleave', () => { opts.tip?.(null); mark(e, false); });
      bar.addEventListener('click', () => opts.pick?.(e));
      st.append(bar); bar.ev = e;
    }
    return st;
  }
  function mark(e, on) { for (const { t, e: te } of tiles) if (te === e) t.classList.toggle('hi', on); for (const bar of panel.querySelectorAll('.bev')) if (bar.ev === e) bar.classList.toggle('hi', on); }

  function layout(map, events, era, counts) {
    map.textContent = ''; tiles = [];
    const W = map.clientWidth, H = map.clientHeight;
    if (!W || !H) { // not laid out yet (a background tab): come back when it has a size
      const ro = new ResizeObserver(() => { if (map.clientWidth && map.clientHeight) { ro.disconnect(); layout(map, events, era, counts); } }); ro.observe(map); return;
    }
    const items = events.map(e => ({ e, w: weight(e) })).sort((a, b) => b.w - a.w);
    const rects = squarify(items, 0, 0, W, H);
    rects.forEach((r, i) => {
      const e = r.it.e, t = el('tile');
      t.style.left = r.x + 'px'; t.style.top = r.y + 'px'; t.style.width = Math.max(0, r.w - 1) + 'px'; t.style.height = Math.max(0, r.h - 1) + 'px';
      t.style.background = kindColor(e, era);
      if (e.media?.length) { const img = new Image(); img.src = e.media[0]; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer'; img.alt = ''; t.append(img); t.classList.add('media'); }
      else if (r.w > 54 && r.h > 26) { const txt = el('tx', e.kind === 6 ? '↻ repost' : e.kind === 7 ? (e.content || '+').slice(0, 4) : (e.content || '').slice(0, 140)); t.append(txt); }
      else if (e.kind === 7 && r.w > 14 && r.h > 14) t.append(el('tx', (e.content || '+').slice(0, 2)));
      if (!goggle(e)) t.classList.add('dim');
      t.addEventListener('pointerenter', ev => { opts.tip?.(e, ev); mark(e, true); });
      t.addEventListener('pointermove', ev => opts.tip?.(e, ev));
      t.addEventListener('pointerleave', () => { opts.tip?.(null); mark(e, false); });
      t.addEventListener('click', () => opts.pick?.(e));
      if (!reduced) { t.style.transform = `translate(${(Math.random() - 0.5) * 320}px, ${(Math.random() - 0.5) * 240}px) scale(.3)`; t.style.opacity = '0'; t.style.transitionDelay = Math.min(i, 80) * 7 + 'ms'; }
      map.append(t); tiles.push({ t, e, r });
    });
    if (!reduced) requestAnimationFrame(() => requestAnimationFrame(() => { for (const { t } of tiles) { t.style.transform = ''; t.style.opacity = ''; } }));
    if (counts) recolor(counts);
  }

  function recolor(counts) {
    let max = 0; for (const { e } of tiles) max = Math.max(max, score(counts.get(e.id)));
    for (const { t, e, r } of tiles) {
      const c = counts.get(e.id); if (!c) continue;
      const s = score(c), idx = max ? 6 + Math.round(9 * Math.log(1 + s) / Math.log(1 + max)) : 7;
      if (e.media?.length) t.style.borderColor = GREENS[idx]; else if (e.kind === 1) t.style.background = GREENS[idx];
      if (r.w > 64 && r.h > 34 && (c.replies || c.reactions || c.zaps)) {
        const parts = []; if (c.sats) parts.push(`⚡${fmt(c.sats)}`); else if (c.zaps) parts.push(`⚡${c.zaps}`); if (c.replies) parts.push(`${c.replies} re`); if (c.reactions) parts.push(`${c.reactions} ♥`);
        t.append(el('badge', parts.join(' · ')));
      }
    }
  }

  const api = {
    setGoggle(fn) {
      goggle = fn || GOGGLES.all;
      for (const [, cb] of cubes) { const n = cb.events.filter(goggle).length; cb.wrap.classList.toggle('faint', cb.events.length > 0 && n === 0); cb.wrap.dataset.match = n; }
      paintFaces();
      for (const { t, e } of tiles) t.classList.toggle('dim', !goggle(e));
    },
    highlight(events) { const set = new Set(events); for (const { t, e } of tiles) t.classList.toggle('hi', set.has(e)); for (const bar of panel.querySelectorAll('.bev')) bar.classList.toggle('hi', set.has(bar.ev)); const first = tiles.find(x => set.has(x.e)); first?.t.scrollIntoView?.({ block: 'nearest' }); },
    open, close() { panel.hidden = true; for (const [, o] of cubes) o.c.classList.remove('open'); openEpoch = null; tiles = []; },
    relayout() { if (openEpoch == null) return; const cb = cubes.get(openEpoch); layout(panel.querySelector('.bm'), cb.events, cb.era, engagement.get(openEpoch)); },
    epochs: () => past.length,
    destroy() { document.removeEventListener('keydown', keys); root.textContent = ''; tiles = []; openEpoch = null; },
  };
  return api;
}

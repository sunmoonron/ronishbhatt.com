// tower.js: the 3D view. One turn of the helix is one difficulty epoch (2016 blocks),
// so a halving is 104 turns up the tower and every event is a bead at its block's
// angle on its epoch's turn. Software projection onto the 2D canvas: no WebGL, no
// library, frames only when something moves, and it thins itself out on a potato.
import { BLOCKS_PER_EPOCH, BLOCKS_PER_ERA, blockToDate, tipHeight } from './anchor.js';
import { eraMeta } from './analytics.js';

const TAU = Math.PI * 2, R = 6;                          // helix radius; one turn is one unit tall
const TURNS_PER_ERA = BLOCKS_PER_ERA / BLOCKS_PER_EPOCH; // 104.17
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const eraColor = era => eraMeta(era).color;

export function createTower(canvas, anchored, opts = {}) {
  let potato = !!opts.potato;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d');
  const beads = anchored.map(e => {
    const u = e.anchor.height / BLOCKS_PER_EPOCH, a = (u % 1) * TAU;
    return { e, u, a, x: R * Math.cos(a), z: R * Math.sin(a), era: e.anchor.era, n: 1 };
  }).sort((p, q) => p.u - q.u);
  const uMin = beads[0].u, uMax = beads.at(-1).u, span = Math.max(1.5, uMax - uMin);

  // one bead per epoch for the far view: at the epoch's mean angle, sized by count
  const epochs = new Map();
  for (const b of beads) {
    const k = Math.floor(b.u); let g = epochs.get(k);
    if (!g) epochs.set(k, g = { u: 0, sx: 0, sy: 0, n: 0, era: b.era, items: [], media: 0 });
    g.u += b.u; g.sx += Math.cos(b.a); g.sy += Math.sin(b.a); g.n++; g.items.push(b.e); if (b.e.media?.length) g.media++;
  }
  const clusters = [...epochs.values()].map(g => { const a = Math.atan2(g.sy, g.sx); return { e: g.n === 1 ? g.items[0] : null, u: g.u / g.n, a, x: R * Math.cos(a), z: R * Math.sin(a), era: g.era, n: g.n, items: g.items, media: g.media }; });

  const cam = { yaw: 0.7, pitch: 0.42, y: (uMin + uMax) / 2, dist: 0 };
  let W = 0, H = 0, f = 0, dpr = 1, projected = [], hover = null, dirty = true, raf = 0;
  let autorotUntil = 0, play = null, slow = 0;

  function resize() {
    W = canvas.clientWidth; H = canvas.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, potato ? 1 : 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    f = 0.95 * Math.min(W, H);
    if (!cam.dist) cam.dist = fitDistance();
    dirty = true; schedule();
  }
  function fitDistance() { return clamp(Math.max(span * 1.25 * f / H, 2.4 * R * f / W) + 4, 10, 600); }

  function project(x, y, z) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const Y = y - cam.y, X1 = x * cy + z * sy, Z1 = -x * sy + z * cy;
    const Y2 = Y * cp - Z1 * sp, Z2 = Y * sp + Z1 * cp, depth = cam.dist - Z2;
    if (depth < 0.5) return null;
    return { sx: W / 2 + f * X1 / depth, sy: H / 2 - f * Y2 / depth, depth };
  }
  const visibleTurns = () => H * cam.dist / f;

  function draw() {
    const t0 = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.8);
    bg.addColorStop(0, '#132019'); bg.addColorStop(1, '#0b0e0d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.lineJoin = 'round';

    const vis = visibleTurns(), lo = cam.y - vis, hi = cam.y + vis;
    // the axis, and the helix wire once fewer than 60 turns are in view
    const ax0 = project(0, uMin - 1, 0), ax1 = project(0, uMax + 1, 0);
    if (ax0 && ax1) { ctx.beginPath(); ctx.moveTo(ax0.sx, ax0.sy); ctx.lineTo(ax1.sx, ax1.sy); ctx.strokeStyle = '#7dd3a822'; ctx.lineWidth = 1; ctx.stroke(); }
    if (vis < 60) {
      const from = Math.max(uMin - 0.5, lo), to = Math.min(uMax + 0.5, hi), segs = Math.ceil((to - from) * 32);
      if (segs > 0 && segs < 4000) {
        ctx.beginPath(); let pen = false;
        for (let i = 0; i <= segs; i++) {
          const u = from + (to - from) * i / segs, a = (u % 1) * TAU, p = project(R * Math.cos(a), u, R * Math.sin(a));
          if (!p) { pen = false; continue; }
          if (pen) ctx.lineTo(p.sx, p.sy); else ctx.moveTo(p.sx, p.sy); pen = true;
        }
        ctx.strokeStyle = '#7dd3a82e'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    // planes: every halving inside the span, the first event, the tip
    const planes = [];
    for (let era = Math.floor(uMin / TURNS_PER_ERA) + 1; era * TURNS_PER_ERA <= uMax + 2; era++) {
      const m = eraMeta(era); planes.push({ u: era * TURNS_PER_ERA, color: m.color, label: `${m.name} · block ${(era * BLOCKS_PER_ERA).toLocaleString()} · ${blockToDate(era * BLOCKS_PER_ERA).toLocaleString('default', { month: 'short', year: 'numeric' })}` });
    }
    const tip = tipHeight();
    planes.push({ u: tip / BLOCKS_PER_EPOCH, color: '#b4f5d1', label: `now · block ${tip.toLocaleString()}`, dashed: true });
    planes.push({ u: uMin, color: '#8aa094', label: `${opts.truncated ? 'oldest fetched' : 'first'} · block ${beads[0].e.anchor.height.toLocaleString()} · ${blockToDate(beads[0].e.anchor.height).toLocaleString('default', { month: 'short', year: 'numeric' })}`, dashed: true });
    if (play) planes.push({ u: play.u, color: '#e9c46a', label: `block ${Math.round(play.u * BLOCKS_PER_EPOCH).toLocaleString()} · ${blockToDate(play.u * BLOCKS_PER_EPOCH).toLocaleString('default', { month: 'short', year: 'numeric' })}`, hot: true });
    ctx.font = '10px ui-monospace, Menlo, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const labelYs = [];
    for (const pl of planes) {
      if (pl.u < lo - 2 || pl.u > hi + 2) continue;
      const RR = R * 1.45; ctx.beginPath(); let pen = false, right = null;
      for (let i = 0; i <= 48; i++) {
        const a = i / 48 * TAU, p = project(RR * Math.cos(a), pl.u, RR * Math.sin(a));
        if (!p) { pen = false; continue; }
        if (pen) ctx.lineTo(p.sx, p.sy); else ctx.moveTo(p.sx, p.sy); pen = true;
        if (!right || p.sx > right.sx) right = p;
      }
      ctx.strokeStyle = pl.color + (pl.hot ? 'cc' : '55'); ctx.lineWidth = pl.hot ? 1.5 : 1;
      if (pl.dashed) ctx.setLineDash([3, 6]); ctx.stroke(); ctx.setLineDash([]);
      if (right) { // keep labels on the canvas and off each other
        const tw = ctx.measureText(pl.label).width, lx = Math.min(right.sx + 6, W - 6 - tw); let ly = right.sy;
        while (labelYs.some(y => Math.abs(y - ly) < 12)) ly += 12;
        labelYs.push(ly);
        ctx.fillStyle = pl.color + (pl.hot ? 'ff' : 'bb'); ctx.fillText(pl.label, Math.max(6, lx), ly);
      }
    }

    // beads (individual when they fit the budget, else one per epoch)
    const budget = potato ? 500 : 1400;
    const inView = beads.filter(b => b.u >= lo && b.u <= hi);
    const useClusters = inView.length > budget;
    const list = useClusters ? clusters.filter(c => c.u >= lo && c.u <= hi) : inView;
    const items = [];
    for (const b of list) {
      const p = project(b.x, b.u, b.z); if (!p) continue;
      if (p.sx < -20 || p.sx > W + 20 || p.sy < -20 || p.sy > H + 20) continue;
      const e = b.e, kind = e ? e.kind : 1;
      const base = b.n > 1 ? 0.14 * Math.sqrt(b.n) + 0.1 : kind === 1 ? 0.17 : kind === 6 ? 0.14 : 0.1;
      items.push({ b, p, px: clamp(f * base / p.depth, b.n > 1 ? 3 : 1.4, 22), kind });
    }
    items.sort((a, c) => c.p.depth - a.p.depth);
    const near = cam.dist * 0.6, far = cam.dist * 1.6;
    for (const it of items) {
      const { b, p, px, kind } = it, fade = clamp(1 - (p.depth - near) / (far - near), 0.25, 1);
      const dim = play && b.u > play.u ? 0.25 : 1;
      const color = eraColor(b.era), alpha = Math.round(255 * fade * dim * (kind === 7 && b.n === 1 ? 0.6 : 0.95)).toString(16).padStart(2, '0');
      ctx.beginPath();
      if (b.n > 1) { ctx.arc(p.sx, p.sy, px, 0, TAU); ctx.fillStyle = color + alpha; ctx.fill(); if (px > 9) { ctx.fillStyle = '#08150e'; ctx.font = `bold ${Math.min(11, px)}px ui-monospace, Menlo, monospace`; ctx.textAlign = 'center'; ctx.fillText(String(b.n), p.sx, p.sy + 0.5); ctx.textAlign = 'left'; } }
      else if (b.e?.media?.length) { ctx.moveTo(p.sx, p.sy - px * 1.3); ctx.lineTo(p.sx + px * 1.3, p.sy); ctx.lineTo(p.sx, p.sy + px * 1.3); ctx.lineTo(p.sx - px * 1.3, p.sy); ctx.closePath(); ctx.fillStyle = '#e9c46a' + alpha; ctx.fill(); }
      else if (kind === 6) { ctx.arc(p.sx, p.sy, px, 0, TAU); ctx.strokeStyle = color + alpha; ctx.lineWidth = 1; ctx.stroke(); }
      else { ctx.arc(p.sx, p.sy, px, 0, TAU); ctx.fillStyle = color + alpha; ctx.fill(); }
      if (hover && hover === (b.e || b)) { ctx.beginPath(); ctx.arc(p.sx, p.sy, px + 4, 0, TAU); ctx.strokeStyle = '#b4f5d1'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    projected = items;
    // scale hint
    ctx.fillStyle = '#8aa094'; ctx.font = '9px ui-monospace, Menlo, monospace'; ctx.textAlign = 'left';
    ctx.fillText(`${useClusters ? 'one bead per epoch' : `${inView.length} events`} · ${vis < 1000 ? vis.toFixed(0) : '∞'} turns in view · 1 turn = 2016 blocks${potato ? ' · potato mode' : ''}`, 8, H - 8);
    const ms = performance.now() - t0;
    if (!potato && ms > 45 && ++slow > 2) { potato = true; resize(); }
  }

  function frame(now) {
    raf = 0;
    if (play) {
      const k = clamp((now - play.t0) / play.ms, 0, 1);
      play.u = uMin - 1 + (span + 2) * k; cam.y = play.u;
      while (play.i < beads.length && beads[play.i].u <= play.u) { play.onBlip?.(beads[play.i].e, play.i / beads.length); play.i++; }
      if (k >= 1) { const done = play.onDone; play = null; done?.(); }
      dirty = true;
    } else if (now < autorotUntil && !reduced) { cam.yaw += 0.0025; dirty = true; }
    if (dirty) { dirty = false; draw(); }
    if (play || now < autorotUntil) schedule();
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(frame); }
  function touch() { dirty = true; schedule(); }

  // input: drag orbits, wheel zooms, two fingers pinch and travel, tap picks
  const pts = new Map(); let moved = false, pinch0 = 0, mid0 = 0;
  const pickAt = (mx, my) => {
    let best = null, bd = 1e9;
    for (const it of projected) { const d = Math.hypot(it.p.sx - mx, it.p.sy - my); if (d < it.px + 5 && d < bd) { bd = d; best = it.b; } }
    return best;
  };
  const local = ev => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  canvas.addEventListener('pointerdown', ev => {
    try { canvas.setPointerCapture(ev.pointerId); } catch {}
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); moved = false; autorotUntil = 0;
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); mid0 = (a.y + b.y) / 2; }
  });
  canvas.addEventListener('pointermove', ev => {
    const p = pts.get(ev.pointerId);
    if (!p) { // hover
      const [mx, my] = local(ev), b = pickAt(mx, my), e = b ? (b.e || b) : null;
      if (e !== hover) { hover = e; opts.onHover?.(e ? (b.e ? b.e : { cluster: b }) : null, ev); touch(); }
      else if (e) opts.onHover?.(b.e ? b.e : { cluster: b }, ev);
      return;
    }
    const dx = ev.clientX - p.x, dy = ev.clientY - p.y; p.x = ev.clientX; p.y = ev.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    if (pts.size === 1) { cam.yaw += dx * 0.008; cam.pitch = clamp(cam.pitch - dy * 0.005, -0.5, 1.4); }
    else if (pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mid = (a.y + b.y) / 2;
      if (pinch0 > 0) cam.dist = clamp(cam.dist * pinch0 / d, 5, 800);
      cam.y = clamp(cam.y + (mid - mid0) * visibleTurns() / H, uMin - 2, uMax + 2);
      pinch0 = d; mid0 = mid;
    }
    touch();
  });
  const up = ev => {
    if (pts.has(ev.pointerId) && !moved && pts.size === 1) { const [mx, my] = local(ev), b = pickAt(mx, my); if (b) opts.onPick?.(b.e ? b.e : { cluster: b }, ev); }
    pts.delete(ev.pointerId); pinch0 = 0;
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; opts.onHover?.(null); touch(); } });
  const wheel = ev => { ev.preventDefault(); cam.dist = clamp(cam.dist * Math.exp(ev.deltaY * 0.0015), 5, 800); touch(); };
  canvas.addEventListener('wheel', wheel, { passive: false });

  const api = {
    resize, touch,
    travel(frac) { cam.y = uMin + frac * span; touch(); },
    zoom(k) { cam.dist = clamp(cam.dist * k, 5, 800); touch(); },
    focus(u) { cam.y = clamp(u, uMin - 2, uMax + 2); cam.dist = Math.min(cam.dist, 26); autorotUntil = 0; touch(); },
    reset() { cam.yaw = 0.7; cam.pitch = 0.42; cam.y = (uMin + uMax) / 2; cam.dist = fitDistance(); touch(); },
    play(ms, onBlip, onDone) { if (play) return; play = { t0: performance.now(), ms, u: uMin - 1, i: 0, onBlip, onDone }; cam.pitch = 0.35; if (cam.dist > 60) cam.dist = 60; schedule(); },
    stop() { play = null; touch(); },
    playing: () => !!play,
    render() { const t0 = performance.now(); draw(); return performance.now() - t0; },
    state: () => ({ ...cam, uMin, uMax, span }),
    destroy() { cancelAnimationFrame(raf); raf = 0; canvas.removeEventListener('wheel', wheel); const c = canvas.cloneNode(false); canvas.replaceWith(c); return c; },
  };
  resize();
  if (!reduced && !potato) autorotUntil = performance.now() + 5000;
  schedule();
  return api;
}

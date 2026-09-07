// voxel.js: the chain as voxels. Every Bitcoin block is one cube: 12 by 12 of them make a
// day (144 blocks), 14 days make a difficulty epoch (2016), and the epochs coil upward,
// 26 to a turn, so one turn of the coil is one year. The cubes that light up are the blocks
// you were mined into. Software-projected on the 2D canvas, drawn only on input, thinned by
// distance so a potato keeps up.
import { BLOCKS_PER_EPOCH, BLOCKS_PER_ERA, blockToDate, tipHeight } from './anchor.js';
import { eraMeta } from './analytics.js';
import { H, dayShort } from './time.js';

const DAY = 144, LAYERS = 14, SIDE = 12, PER_TURN = 26, RADIUS = 72, RISE = 17;
const AMBER = '#e9c46a', MINT = '#b4f5d1';
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rgbCache = new Map();
const rgb = hex => { let c = rgbCache.get(hex); if (!c) { c = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; rgbCache.set(hex, c); } return c; };
const tint = (hex, k, a) => { const [r, g, b] = rgb(hex); return `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},${a})`; };
const score = c => c ? c.replies * 2 + c.reactions + c.zaps * 3 + Math.log10(1 + c.sats) : 0;

export function createVoxels(canvas, anchored, opts = {}) {
  let potato = !!opts.potato;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d');
  const tip = tipHeight(), curEpoch = Math.floor(tip / BLOCKS_PER_EPOCH);

  // one brick per epoch from the first to the one being mined, placed on the coil
  const byBlock = new Map();
  for (const e of anchored) { const h = e.anchor.height; if (!byBlock.has(h)) byBlock.set(h, []); byBlock.get(h).push(e); }
  const epochMin = Math.min(...anchored.map(e => e.anchor.epoch)), epochMax = Math.max(curEpoch, ...anchored.map(e => e.anchor.epoch));
  const coil = k => { const a = k / PER_TURN * TAU; return { x: RADIUS * Math.cos(a), y: k * RISE / PER_TURN, z: RADIUS * Math.sin(a) }; };
  const bricks = [];
  for (let k = epochMin; k <= epochMax; k++) { const c = coil(k - epochMin); bricks.push({ epoch: k, i: k - epochMin, cx: c.x, cz: c.z, y0: c.y, n: 0, media: 0, voxels: [], era: Math.floor(k * BLOCKS_PER_EPOCH / BLOCKS_PER_ERA) }); }
  const brickOf = k => bricks[k - epochMin];
  const voxels = [];
  for (const [h, events] of byBlock) {
    const k = Math.floor(h / BLOCKS_PER_EPOCH), i = h % BLOCKS_PER_EPOCH, L = Math.floor(i / DAY), j = i % DAY, b = brickOf(k);
    if (!b) continue;
    const v = { h, events, epoch: k, layer: L, era: Math.floor(h / BLOCKS_PER_ERA), x: b.cx + (j % SIDE) + 0.5 - SIDE / 2, z: b.cz + Math.floor(j / SIDE) + 0.5 - SIDE / 2, y: b.y0 + L + 0.5,
      n: events.length, media: events.some(e => e.media?.length), note: events.some(e => e.kind === 1), heat: 0, on: true };
    voxels.push(v); b.voxels.push(v); b.n += events.length; if (v.media) b.media++;
  }
  voxels.sort((a, c) => a.h - c.h);
  const maxN = Math.max(1, ...bricks.map(b => b.n));
  const N = bricks.length, top = bricks[N - 1].y0 + LAYERS;
  const centre = { x: 0, y: top / 2, z: 0 };
  const cam = { yaw: 0.9, pitch: 0.55, t: { ...centre }, dist: 0 };
  let W = 0, H_ = 0, f = 0, dpr = 1, camPos = { x: 0, y: 0, z: 0 }, projected = [], hover = null, dirty = true, raf = 0;
  let armed = false, fly = null, play = null, slow = 0, autorotUntil = 0;
  let head = null, rate = 2, headIdx = 0, lastHead = 0;  // playhead in block height, epochs per second, voxel cursor
  const flash = new Map();                                 // voxel -> time it was crossed

  function resize() {
    W = canvas.clientWidth; H_ = canvas.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, potato ? 1 : 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H_ * dpr);
    f = 0.95 * Math.min(W, H_);
    if (!cam.dist || !isFinite(cam.dist) || cam.fitted === false) { cam.dist = fitDistance(); cam.fitted = !!(W && H_); }
    touch();
  }
  function fitDistance() {
    if (!W || !H_) return 200;
    const wide = (RADIUS + SIDE) * 2 * 1.45 * f / W, tall = (top + 20) * 1.35 * f / H_;
    return clamp(Math.max(wide, tall) + 10, 60, 1500);
  }

  function project(x, y, z) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const X = x - cam.t.x, Y = y - cam.t.y, Z = z - cam.t.z;
    const X1 = X * cy + Z * sy, Z1 = -X * sy + Z * cy, Y2 = Y * cp - Z1 * sp, Z2 = Y * sp + Z1 * cp, depth = cam.dist - Z2;
    if (depth < 0.3) return null;
    return { sx: W / 2 + f * X1 / depth, sy: H_ / 2 - f * Y2 / depth, depth };
  }
  function updateCamPos() { camPos = { x: cam.t.x - cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw), y: cam.t.y + cam.dist * Math.sin(cam.pitch), z: cam.t.z + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw) }; }

  const FACES = [[1, 3, 7, 5, 1, 0, 0], [0, 4, 6, 2, -1, 0, 0], [2, 6, 7, 3, 0, 1, 0], [0, 1, 5, 4, 0, -1, 0], [4, 5, 7, 6, 0, 0, 1], [0, 2, 3, 1, 0, 0, -1]];
  function box(cx, cy, cz, hx, hy, hz, fill, alpha, edge, dashed) {
    const P = [];
    for (let i = 0; i < 8; i++) { const p = project(cx + (i & 1 ? hx : -hx), cy + (i & 2 ? hy : -hy), cz + (i & 4 ? hz : -hz)); if (!p) return; P.push(p); }
    if (dashed) ctx.setLineDash([3, 4]);
    for (const [a, b, c, d, nx, ny, nz] of FACES) {
      if ((cx + nx * hx - camPos.x) * nx + (cy + ny * hy - camPos.y) * ny + (cz + nz * hz - camPos.z) * nz >= 0) continue;
      ctx.beginPath(); ctx.moveTo(P[a].sx, P[a].sy); ctx.lineTo(P[b].sx, P[b].sy); ctx.lineTo(P[c].sx, P[c].sy); ctx.lineTo(P[d].sx, P[d].sy); ctx.closePath();
      if (alpha > 0) { ctx.fillStyle = tint(fill, ny > 0 ? 1 : ny < 0 ? 0.45 : nx ? 0.62 : 0.82, alpha); ctx.fill(); }
      if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke(); }
    }
    if (dashed) ctx.setLineDash([]);
  }
  function layerLines(b, alpha) {
    const s = SIDE / 2, sides = [[-s, -s, s, -s, 0, -1], [s, -s, s, s, 1, 0], [s, s, -s, s, 0, 1], [-s, s, -s, -s, -1, 0]];
    ctx.strokeStyle = `rgba(125,211,168,${alpha})`; ctx.lineWidth = 1; ctx.beginPath();
    for (const [x0, z0, x1, z1, nx, nz] of sides) {
      if ((b.cx + nx * s - camPos.x) * nx + (b.cz + nz * s - camPos.z) * nz >= 0) continue;
      for (let L = 1; L < LAYERS; L++) { const p0 = project(b.cx + x0, b.y0 + L, b.cz + z0), p1 = project(b.cx + x1, b.y0 + L, b.cz + z1); if (!p0 || !p1) continue; ctx.moveTo(p0.sx, p0.sy); ctx.lineTo(p1.sx, p1.sy); }
    }
    ctx.stroke();
  }
  function ring(cx, cz, y, r, color, dashed, label, labelYs) {
    ctx.beginPath(); let pen = false, right = null;
    for (let i = 0; i <= 36; i++) { const a = i / 36 * TAU, p = project(cx + r * Math.cos(a), y, cz + r * Math.sin(a)); if (!p) { pen = false; continue; } if (pen) ctx.lineTo(p.sx, p.sy); else ctx.moveTo(p.sx, p.sy); pen = true; if (!right || p.sx > right.sx) right = p; }
    ctx.strokeStyle = color; ctx.lineWidth = 1; if (dashed) ctx.setLineDash([3, 6]); ctx.stroke(); ctx.setLineDash([]);
    if (right && label) { const tw = ctx.measureText(label).width; let ly = right.sy; while (labelYs.some(v => Math.abs(v - ly) < 12)) ly += 12; labelYs.push(ly); ctx.fillStyle = color; ctx.fillText(label, Math.max(6, Math.min(right.sx + 6, W - 6 - tw)), ly); }
  }
  const yOf = h => { const b = brickOf(Math.floor(h / BLOCKS_PER_EPOCH)); return b ? b.y0 + (h % BLOCKS_PER_EPOCH) / DAY : null; };
  const near = b => Math.hypot(b.cx - cam.t.x, b.y0 + LAYERS / 2 - cam.t.y, b.cz - cam.t.z) < cam.dist * 1.6 + 30;

  function draw() {
    const t0 = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createRadialGradient(W / 2, H_ / 2, 0, W / 2, H_ / 2, Math.max(W, H_) * 0.8);
    bg.addColorStop(0, '#132019'); bg.addColorStop(1, '#0b0e0d'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H_);
    ctx.lineJoin = 'round'; ctx.font = '10px ui-monospace, Menlo, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    updateCamPos();
    const level = cam.dist > 110 ? 'chain' : cam.dist > 34 ? 'brick' : 'block';
    // the coil itself, one faint turn per year
    ctx.beginPath(); let pen = false;
    for (let i = 0; i <= N * 4; i++) { const c = coil(i / 4); const p = project(c.x, c.y + LAYERS / 2, c.z); if (!p) { pen = false; continue; } if (pen) ctx.lineTo(p.sx, p.sy); else ctx.moveTo(p.sx, p.sy); pen = true; }
    ctx.strokeStyle = 'rgba(125,211,168,.10)'; ctx.lineWidth = 1; ctx.stroke();
    const items = [], budget = potato ? 500 : 1600;
    let inView = 0;
    for (const b of bricks) {
      if (level !== 'chain' && !near(b)) continue;
      const cy = b.y0 + LAYERS / 2, p = project(b.cx, cy, b.cz); if (!p) continue;
      if (p.sx < -80 || p.sx > W + 80 || p.sy < -80 || p.sy > H_ + 80) continue;
      inView++;
      const color = eraMeta(b.era).color, mining = b.epoch === curEpoch, mined = (tip % BLOCKS_PER_EPOCH) / DAY;
      const hot = hover === b;
      if (level === 'chain') {
        const ahead = head != null && b.epoch * BLOCKS_PER_EPOCH > head;
        const k = (b.n ? 0.3 + 0.7 * Math.log(1 + b.n) / Math.log(1 + maxN) : 0) * (ahead ? 0.25 : 1);
        items.push({ depth: p.depth, d: () => box(b.cx, cy, b.cz, 6, LAYERS / 2, 6, color, b.n ? k : 0, hot ? MINT : b.n ? tint(MINT, 1, 0.35) : 'rgba(125,211,168,.14)', mining), pick: { brick: b, sx: p.sx, sy: p.sy, r: f * 7 / p.depth + 4 } });
        if (mining) items.push({ depth: p.depth - 0.01, d: () => box(b.cx, b.y0 + mined / 2, b.cz, 6, mined / 2, 6, MINT, 0.2, null) });
      } else {
        items.push({ depth: p.depth + 30, d: () => { box(b.cx, cy, b.cz, 6, LAYERS / 2, 6, color, 0.05, hot ? MINT : mining ? tint(MINT, 1, 0.5) : 'rgba(125,211,168,.2)', mining); if (level === 'block' || p.depth < 70) layerLines(b, 0.07); }, pick: { brick: b, sx: p.sx, sy: p.sy, r: level === 'brick' ? f * 6 / p.depth : 0 } });
        if (mining) items.push({ depth: p.depth + 29, d: () => box(b.cx, b.y0 + mined / 2, b.cz, 6, mined / 2, 6, MINT, 0.08, null) });
        for (const v of b.voxels) {
          if (items.length > budget) break;
          const q = project(v.x, v.y, v.z); if (!q) continue;
          if (q.sx < -10 || q.sx > W + 10 || q.sy < -10 || q.sy > H_ + 10) continue;
          const dimmed = !v.on || (head != null && v.h > head);
          const fl = flash.get(v); const glow = fl != null && performance.now() - fl < 700;
          const fill = v.media ? AMBER : v.heat ? MINT : v.note ? color : eraMeta(v.era).color;
          const alpha = dimmed ? 0.12 : v.note || v.media ? 0.95 : 0.6;
          items.push({ depth: q.depth, d: () => { if (glow) box(v.x, v.y, v.z, 0.9, 0.9, 0.9, AMBER, 0.35 * (1 - (performance.now() - fl) / 700), null); box(v.x, v.y, v.z, 0.5, 0.5, 0.5, fill, alpha, hover === v || glow ? MINT : dimmed ? null : 'rgba(11,14,13,.55)'); }, pick: { voxel: v, sx: q.sx, sy: q.sy, r: f * 0.7 / q.depth + 3 } });
        }
      }
    }
    items.sort((a, c) => c.depth - a.depth);
    projected = [];
    for (const it of items) { it.d(); if (it.pick && it.pick.r > 0) projected.push(it.pick); }
    // markers: halvings inside the span, the tip, the oldest fetched, the sweep
    const labelYs = [];
    for (let era = Math.floor(epochMin * BLOCKS_PER_EPOCH / BLOCKS_PER_ERA) + 1; era * BLOCKS_PER_ERA <= (epochMax + 1) * BLOCKS_PER_EPOCH; era++) {
      const h = era * BLOCKS_PER_ERA, b = brickOf(Math.floor(h / BLOCKS_PER_EPOCH)); if (!b || (level !== 'chain' && !near(b))) continue;
      ring(b.cx, b.cz, yOf(h), 9.5, eraMeta(era).color + 'cc', false, `${eraMeta(era).name} · ${H(h)}`, labelYs);
    }
    const tb = brickOf(curEpoch); if (tb && (level === 'chain' || near(tb))) ring(tb.cx, tb.cz, yOf(tip), 9.5, MINT + 'aa', true, `now · ${H(tip)}`, labelYs);
    const first = voxels[0], fb = first && brickOf(first.epoch); if (fb && (level === 'chain' || near(fb))) ring(fb.cx, fb.cz, yOf(first.h), 9.5, '#8aa094aa', true, `${opts.truncated ? 'oldest fetched' : 'first'} · ${H(first.h)} · ${dayShort(blockToDate(first.h))}`, labelYs);
    if (head != null) { const pb = brickOf(Math.floor(head / BLOCKS_PER_EPOCH)); if (pb && (level === 'chain' || near(pb))) { ring(pb.cx, pb.cz, yOf(head), 10.5, AMBER, false, `${play ? '▶ ' : ''}${H(head)} · ${dayShort(blockToDate(head))}`, labelYs); ring(pb.cx, pb.cz, yOf(head), 7, AMBER + '66', true, null, labelYs); } }
    // HUD
    ctx.fillStyle = '#8aa094'; ctx.font = '9px ui-monospace, Menlo, monospace';
    ctx.fillText(`${level} level · ${inView} epoch${inView === 1 ? '' : 's'} in view${potato ? ' · potato mode' : ''}`, 8, H_ - 8);
    opts.onView?.({ level, inView, head, playing: !!play, epoch: bricks[nearest()].epoch });
    ctx.textAlign = 'right'; ctx.fillStyle = armed ? MINT : '#8aa094';
    ctx.fillText(armed ? 'scroll zooms · drag orbits · ↑↓ walk the coil · Esc releases' : 'click to take the controls', W - 8, 12); ctx.textAlign = 'left';
    const ms = performance.now() - t0;
    if (!potato && ms > 45 && ++slow > 2) { potato = true; resize(); }
  }

  function frame(now) {
    raf = 0;
    if (fly) { const k = clamp((now - fly.t0) / fly.ms, 0, 1), e = 1 - Math.pow(1 - k, 3); cam.t = { x: fly.a.x + (fly.b.x - fly.a.x) * e, y: fly.a.y + (fly.b.y - fly.a.y) * e, z: fly.a.z + (fly.b.z - fly.a.z) * e }; cam.dist = fly.d0 + (fly.d1 - fly.d0) * e; if (k >= 1) fly = null; dirty = true; }
    if (play) {
      const dt = Math.min(0.1, (now - lastHead) / 1000); lastHead = now;
      head = Math.min((epochMax + 1) * BLOCKS_PER_EPOCH, head + rate * dt * BLOCKS_PER_EPOCH);
      if (play.follow) { const pos = clamp(head / BLOCKS_PER_EPOCH - epochMin, 0, N - 1), c = coil(pos); cam.t = { x: c.x, y: c.y + LAYERS / 2, z: c.z }; }
      advance(now);
      if (head >= (epochMax + 1) * BLOCKS_PER_EPOCH) { const done = play.onDone; play = null; done?.(); }
      dirty = true;
    } else if (now < autorotUntil && !reduced) { cam.yaw += 0.002; dirty = true; }
    if (dirty) { dirty = false; draw(); }
    if (fly || play || now < autorotUntil || (flash.size && [...flash.values()].some(t => now - t < 700))) schedule();
  }
  // frames come from rAF; while something animates, a timer stands in when a throttled tab withholds them
  let fallback = 0;
  function advance(now) {
    while (headIdx < voxels.length && voxels[headIdx].h <= head) { const v = voxels[headIdx]; flash.set(v, now); opts.onHead?.(v, !!play); headIdx++; }
    while (headIdx > 0 && voxels[headIdx - 1].h > head) headIdx--;
  }
  function schedule() {
    if (!raf) raf = requestAnimationFrame(frame);
    if ((fly || play) && !fallback) fallback = setTimeout(() => { fallback = 0; if (raf) { cancelAnimationFrame(raf); raf = 0; frame(performance.now()); } }, 90);
  }
  function touch() { dirty = true; schedule(); }
  function flyTo(t, d, ms = reduced ? 0 : 600) { autorotUntil = 0; if (!ms) { cam.t = { ...t }; cam.dist = d; touch(); return; } fly = { t0: performance.now(), ms, a: { ...cam.t }, b: { ...t }, d0: cam.dist, d1: d }; schedule(); }
  const brickTarget = b => ({ x: b.cx, y: b.y0 + LAYERS / 2, z: b.cz });

  // input: a click takes the controls, then the wheel zooms; before that the page scrolls as usual
  const pts = new Map(); let moved = false, pinch0 = 0, mid0 = 0;
  const local = ev => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  const pickAt = (mx, my) => { let best = null, bd = 1e9; for (const p of projected) { const d = Math.hypot(p.sx - mx, p.sy - my); if (d < p.r && d < bd) { bd = d; best = p; } } return best; };
  const arm = on => { armed = on; canvas.classList.toggle('armed', on); touch(); };
  canvas.addEventListener('pointerdown', ev => {
    try { canvas.setPointerCapture(ev.pointerId); } catch {}
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); moved = false; autorotUntil = 0;
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); mid0 = (a.y + b.y) / 2; }
  });
  canvas.addEventListener('pointermove', ev => {
    const p = pts.get(ev.pointerId);
    if (!p) {
      const [mx, my] = local(ev), hit = pickAt(mx, my), target = hit ? (hit.voxel || hit.brick) : null;
      if (target !== hover) { hover = target; opts.onHover?.(target ? (hit.voxel ? { block: hit.voxel } : { brick: hit.brick }) : null, ev); touch(); }
      else if (target) opts.onHover?.(hit.voxel ? { block: hit.voxel } : { brick: hit.brick }, ev);
      canvas.style.cursor = target ? 'pointer' : armed ? 'grab' : 'default'; return;
    }
    const dx = ev.clientX - p.x, dy = ev.clientY - p.y; p.x = ev.clientX; p.y = ev.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    if (pts.size === 1) { cam.yaw += dx * 0.008; cam.pitch = clamp(cam.pitch - dy * 0.005, -0.6, 1.45); }
    else if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mid = (a.y + b.y) / 2; if (pinch0 > 0) cam.dist = clamp(cam.dist * pinch0 / d, 5, 1500); cam.t.y = clamp(cam.t.y + (mid - mid0) * cam.dist / f, -10, top + 10); pinch0 = d; mid0 = mid; }
    fly = null; touch();
  });
  const up = ev => {
    if (pts.has(ev.pointerId) && !moved && pts.size === 1) {
      const [mx, my] = local(ev), hit = pickAt(mx, my);
      if (!armed) arm(true);
      if (hit?.voxel) opts.onBlock?.(hit.voxel);
      else if (hit?.brick) { flyTo(brickTarget(hit.brick), cam.dist > 110 ? 48 : 20); opts.onEpoch?.(hit.brick.epoch); }
    }
    pts.delete(ev.pointerId); pinch0 = 0;
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; opts.onHover?.(null); touch(); } });
  canvas.addEventListener('dblclick', ev => { ev.preventDefault(); const d = cam.dist > 110 ? fitDistance() : cam.dist > 34 ? 150 : 48; flyTo(cam.dist > 110 ? centre : cam.t, d); });
  const wheel = ev => { if (!armed) return; ev.preventDefault(); cam.dist = clamp(cam.dist * Math.exp(ev.deltaY * 0.0015), 5, 1500); fly = null; touch(); };
  canvas.addEventListener('wheel', wheel, { passive: false });
  const keys = ev => {
    if (!armed || ev.target?.closest?.('input, textarea')) return;
    if (ev.key === 'Escape') arm(false);
    else if (ev.key === '+' || ev.key === '=') { cam.dist = clamp(cam.dist / 1.3, 5, 1500); touch(); }
    else if (ev.key === '-') { cam.dist = clamp(cam.dist * 1.3, 5, 1500); touch(); }
    else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') { ev.preventDefault(); const cur = nearest(); const nb = bricks[clamp(cur + (ev.key === 'ArrowUp' ? 1 : -1), 0, N - 1)]; flyTo(brickTarget(nb), Math.min(cam.dist, 48)); }
    else if (ev.key === 'Backspace') { ev.preventDefault(); flyTo(cam.t, clamp(cam.dist * 2.4, 5, 1500)); }
  };
  const nearest = () => { let bi = 0, bd = 1e9; for (const b of bricks) { const d = Math.hypot(b.cx - cam.t.x, b.y0 + LAYERS / 2 - cam.t.y, b.cz - cam.t.z); if (d < bd) { bd = d; bi = b.i; } } return bi; };
  document.addEventListener('keydown', keys);
  const outside = ev => { if (armed && !canvas.contains(ev.target)) arm(false); };
  document.addEventListener('pointerdown', outside);

  const api = {
    resize, touch, render() { const t0 = performance.now(); updateCamPos(); draw(); return performance.now() - t0; },
    travel(frac) { const pos = frac * (N - 1), c = coil(pos); cam.t = { x: c.x, y: c.y + LAYERS / 2, z: c.z }; fly = null; if (cam.dist > 110) cam.dist = 48; touch(); },
    setHead(h, follow) { if (h != null && !Number.isFinite(h)) return; head = h == null ? null : clamp(h, epochMin * BLOCKS_PER_EPOCH, (epochMax + 1) * BLOCKS_PER_EPOCH); if (head != null) { advance(performance.now()); if (follow && cam.dist <= 110) { const pos = clamp(head / BLOCKS_PER_EPOCH - epochMin, 0, N - 1), c = coil(pos); cam.t = { x: c.x, y: c.y + LAYERS / 2, z: c.z }; } } touch(); },
    head: () => head, rate(r) { if (r) rate = r; return rate; },
    setView(name) { cam.pitch = name === 'top' ? 1.35 : name === 'side' ? 0.12 : 0.55; touch(); },
    zoom(k) { cam.dist = clamp(cam.dist * k, 5, 1500); touch(); },
    reset() { cam.yaw = 0.9; cam.pitch = 0.55; flyTo(centre, fitDistance()); },
    flyTo(epoch) { const b = brickOf(epoch); if (b) flyTo(brickTarget(b), 48); },
    setGoggle(fn) { for (const v of voxels) v.on = !fn || v.events.some(fn); touch(); },
    engage(counts) { for (const v of voxels) { let s = 0; for (const e of v.events) s = Math.max(s, score(counts.get(e.id))); if (s) v.heat = s; } touch(); },
    play(onDone) { if (play) return; fly = null; autorotUntil = 0; if (head == null || head >= (epochMax + 1) * BLOCKS_PER_EPOCH - 1) { head = epochMin * BLOCKS_PER_EPOCH; headIdx = 0; } lastHead = performance.now(); play = { follow: cam.dist <= 110, onDone }; schedule(); },
    pause() { play = null; touch(); }, stop() { play = null; touch(); }, playing: () => !!play,
    tick(now = performance.now()) { if (raf) { cancelAnimationFrame(raf); raf = 0; } frame(now); },
    state: () => ({ yaw: cam.yaw, pitch: cam.pitch, t: cam.t, dist: cam.dist, bricks: N, voxels: voxels.length, lit: voxels.filter(v => v.on).length, armed, head, rate, epochMin, epochMax }),
    destroy() { cancelAnimationFrame(raf); raf = 0; clearTimeout(fallback); fallback = 0; document.removeEventListener('keydown', keys); document.removeEventListener('pointerdown', outside); canvas.removeEventListener('wheel', wheel); const c = canvas.cloneNode(false); c.classList.remove('armed'); canvas.replaceWith(c); return c; },
  };
  resize();
  if (!reduced && !potato) autorotUntil = performance.now() + 5000;
  schedule();
  return api;
}

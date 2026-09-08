// view.js: the lattice drawn as a coil of epoch bricks, every block a voxel sized by how much
// happened in it and coloured by whoever did most of it, replies as strings between voxels.
// Chain level asks the Fenwick tree, never the events; the events are only read close up.
// Software projection on a 2D canvas, frames only on input, no library.
import { BLOCKS_PER_EPOCH, BLOCKS_PER_DAY, SIDE, F_REPLY, F_MEDIA, F_COMMUNITY } from './lattice.js';
const LAYERS = 14, PER_TURN = 26, RADIUS = 72, RISE = 17, TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rgbCache = new Map();
const rgb = hex => { let c = rgbCache.get(hex); if (!c) { c = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; rgbCache.set(hex, c); } return c; };
const tint = (hex, k, a) => { const [r, g, b] = rgb(hex); return `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},${a})`; };
const MINT = '#b4f5d1', AMBER = '#e9c46a', CROWD = '#255a3f';

export function createView(canvas, lattice, opts = {}) {
  let potato = !!opts.potato;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d');
  const epochMin = Math.floor(lattice.h0 / BLOCKS_PER_EPOCH), epochMax = Math.floor(lattice.h1 / BLOCKS_PER_EPOCH), N = epochMax - epochMin + 1;
  const coil = k => { const a = k / PER_TURN * TAU; return { x: RADIUS * Math.cos(a), y: k * RISE / PER_TURN, z: RADIUS * Math.sin(a) }; };
  const bricks = Array.from({ length: N }, (_, k) => { const c = coil(k); return { epoch: epochMin + k, i: k, cx: c.x, cz: c.z, y0: c.y, h0: (epochMin + k) * BLOCKS_PER_EPOCH }; });
  const top = bricks[N - 1].y0 + LAYERS;
  const centre = { x: bricks.reduce((s, b) => s + b.cx, 0) / N, y: bricks.reduce((s, b) => s + b.y0 + LAYERS / 2, 0) / N, z: bricks.reduce((s, b) => s + b.cz, 0) / N };
  const extent = Math.max(...bricks.map(b => Math.hypot(b.cx - centre.x, b.y0 + LAYERS / 2 - centre.y, b.cz - centre.z))) + 11;
  const cam = { yaw: 0.9, pitch: 0.55, t: { ...centre }, dist: 0 };
  let W = 0, H_ = 0, f = 0, dpr = 1, camPos = { x: 0, y: 0, z: 0 }, projected = [], hover = null, dirty = true, raf = 0, fallback = 0;
  let armed = false, fly = null, play = null, head = null, rate = 1, headH = 0, lastHead = 0, slow = 0, autorotUntil = 0;
  let voxels = [], strings = [], maxN = 1, maxBrick = 1;

  // rebuild the drawable set from the lattice (cheap: one pass over buckets), throttled by the page
  function rebuild() {
    const c = lattice.cols; voxels = []; strings = []; maxN = 1; maxBrick = 1;
    const vByH = new Map();
    for (const [h, idx] of lattice.buckets) {
      const a = lattice.address(h), b = bricks[a.epoch - epochMin]; if (!b) continue;
      let community = 0, media = 0, replies = 0, reactions = 0, score = 0;
      for (const i of idx) { if (c.flags[i] & F_COMMUNITY) community++; if (c.flags[i] & F_MEDIA) media++; if (c.flags[i] & F_REPLY) replies++; if (c.kind[i] === 7) reactions++; score += c.score[i]; }
      const dom = lattice.dominant(h), au = lattice.authors[dom];
      const v = { h, n: idx.length, community, media, replies, reactions, score, author: dom, color: au ? au.color : CROWD, role: au ? au.role : 'crowd',
        x: b.cx + a.col + 0.5 - SIDE / 2, z: b.cz + a.row + 0.5 - SIDE / 2, y: b.y0 + a.day + 0.5, brick: b, idx };
      voxels.push(v); vByH.set(h, v); maxN = Math.max(maxN, idx.length);
    }
    for (const v of voxels) for (const i of v.idx) { const t = c.target[i]; if (t >= 0 && c.kind[i] === 1) { const tv = vByH.get(c.height[t]); if (tv && tv !== v) strings.push({ a: v, b: tv, color: lattice.authors[c.author[i]]?.color || CROWD }); } }
    for (const b of bricks) maxBrick = Math.max(maxBrick, lattice.count(b.h0, b.h0 + BLOCKS_PER_EPOCH - 1));
    voxels.sort((p, q) => p.h - q.h); touch();
  }

  function resize() { W = canvas.clientWidth; H_ = canvas.clientHeight; dpr = Math.min(window.devicePixelRatio || 1, potato ? 1 : 2); canvas.width = Math.round(W * dpr); canvas.height = Math.round(H_ * dpr); f = 0.95 * Math.min(W, H_); if (!cam.dist || cam.fitted === false) { cam.dist = fitDistance(); cam.fitted = !!(W && H_); } touch(); }
  function fitDistance() { if (!W || !H_) return 200; return clamp(extent * 2.3 * f / Math.min(W, H_) + 14, 30, 1500); }
  function project(x, y, z) { const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch); const X = x - cam.t.x, Y = y - cam.t.y, Z = z - cam.t.z; const X1 = X * cy + Z * sy, Z1 = -X * sy + Z * cy, Y2 = Y * cp - Z1 * sp, Z2 = Y * sp + Z1 * cp, depth = cam.dist - Z2; if (depth < 0.3) return null; return { sx: W / 2 + f * X1 / depth, sy: H_ / 2 - f * Y2 / depth, depth }; }
  function updateCamPos() { camPos = { x: cam.t.x - cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw), y: cam.t.y + cam.dist * Math.sin(cam.pitch), z: cam.t.z + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw) }; }
  const FACES = [[1, 3, 7, 5, 1, 0, 0], [0, 4, 6, 2, -1, 0, 0], [2, 6, 7, 3, 0, 1, 0], [0, 1, 5, 4, 0, -1, 0], [4, 5, 7, 6, 0, 0, 1], [0, 2, 3, 1, 0, 0, -1]];
  function box(cx, cy, cz, hx, hy, hz, fill, alpha, edge, dashed) {
    const P = []; for (let i = 0; i < 8; i++) { const p = project(cx + (i & 1 ? hx : -hx), cy + (i & 2 ? hy : -hy), cz + (i & 4 ? hz : -hz)); if (!p) return; P.push(p); }
    if (dashed) ctx.setLineDash([3, 4]);
    for (const [a, b, c, d, nx, ny, nz] of FACES) { if ((cx + nx * hx - camPos.x) * nx + (cy + ny * hy - camPos.y) * ny + (cz + nz * hz - camPos.z) * nz >= 0) continue; ctx.beginPath(); ctx.moveTo(P[a].sx, P[a].sy); ctx.lineTo(P[b].sx, P[b].sy); ctx.lineTo(P[c].sx, P[c].sy); ctx.lineTo(P[d].sx, P[d].sy); ctx.closePath(); if (alpha > 0) { ctx.fillStyle = tint(fill, ny > 0 ? 1 : ny < 0 ? 0.45 : nx ? 0.62 : 0.82, alpha); ctx.fill(); } if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke(); } }
    if (dashed) ctx.setLineDash([]);
  }
  function layerLines(b, alpha) { const s = SIDE / 2, sides = [[-s, -s, s, -s, 0, -1], [s, -s, s, s, 1, 0], [s, s, -s, s, 0, 1], [-s, s, -s, -s, -1, 0]]; ctx.strokeStyle = `rgba(125,211,168,${alpha})`; ctx.lineWidth = 1; ctx.beginPath(); for (const [x0, z0, x1, z1, nx, nz] of sides) { if ((b.cx + nx * s - camPos.x) * nx + (b.cz + nz * s - camPos.z) * nz >= 0) continue; for (let L = 1; L < LAYERS; L++) { const p0 = project(b.cx + x0, b.y0 + L, b.cz + z0), p1 = project(b.cx + x1, b.y0 + L, b.cz + z1); if (!p0 || !p1) continue; ctx.moveTo(p0.sx, p0.sy); ctx.lineTo(p1.sx, p1.sy); } } ctx.stroke(); }
  function ring(cx, cz, y, r, color, dashed, label, labelYs) { ctx.beginPath(); let pen = false, right = null; for (let i = 0; i <= 36; i++) { const a = i / 36 * TAU, p = project(cx + r * Math.cos(a), y, cz + r * Math.sin(a)); if (!p) { pen = false; continue; } if (pen) ctx.lineTo(p.sx, p.sy); else ctx.moveTo(p.sx, p.sy); pen = true; if (!right || p.sx > right.sx) right = p; } ctx.strokeStyle = color; ctx.lineWidth = 1; if (dashed) ctx.setLineDash([3, 6]); ctx.stroke(); ctx.setLineDash([]); if (right && label) { const tw = ctx.measureText(label).width; let ly = right.sy; while (labelYs.some(v => Math.abs(v - ly) < 12)) ly += 12; labelYs.push(ly); ctx.fillStyle = color; ctx.fillText(label, Math.max(6, Math.min(right.sx + 6, W - 6 - tw)), ly); } }
  const yOf = h => { const b = bricks[Math.floor(h / BLOCKS_PER_EPOCH) - epochMin]; return b ? b.y0 + (h % BLOCKS_PER_EPOCH) / BLOCKS_PER_DAY : null; };
  const near = b => Math.hypot(b.cx - cam.t.x, b.y0 + LAYERS / 2 - cam.t.y, b.cz - cam.t.z) < cam.dist * 1.6 + 30;

  function draw() {
    const t0 = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createRadialGradient(W / 2, H_ / 2, 0, W / 2, H_ / 2, Math.max(W, H_) * 0.8); bg.addColorStop(0, '#132019'); bg.addColorStop(1, '#0b0e0d'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H_);
    ctx.lineJoin = 'round'; ctx.font = '10px ui-monospace, Menlo, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    updateCamPos();
    const level = cam.dist > 110 ? 'chain' : cam.dist > 34 ? 'brick' : 'block';
    ctx.beginPath(); let pen = false; for (let i = 0; i <= N * 4; i++) { const c = coil(i / 4), p = project(c.x, c.y + LAYERS / 2, c.z); if (!p) { pen = false; continue; } if (pen) ctx.lineTo(p.sx, p.sy); else ctx.moveTo(p.sx, p.sy); pen = true; } ctx.strokeStyle = 'rgba(125,211,168,.10)'; ctx.lineWidth = 1; ctx.stroke();
    const items = [], budget = potato ? 1500 : 5000, drawn = new Set(); let inView = 0;
    const order = bricks.slice().sort((a, b) => Math.hypot(a.cx - cam.t.x, a.y0 + LAYERS / 2 - cam.t.y, a.cz - cam.t.z) - Math.hypot(b.cx - cam.t.x, b.y0 + LAYERS / 2 - cam.t.y, b.cz - cam.t.z));
    for (const b of order) {
      if (level !== 'chain' && !near(b)) continue;
      const cy = b.y0 + LAYERS / 2, p = project(b.cx, cy, b.cz); if (!p) continue;
      if (p.sx < -80 || p.sx > W + 80 || p.sy < -80 || p.sy > H_ + 80) continue;
      inView++;
      const total = lattice.count(b.h0, b.h0 + BLOCKS_PER_EPOCH - 1), comm = lattice.countCommunity(b.h0, b.h0 + BLOCKS_PER_EPOCH - 1), hot = hover === b;
      if (level === 'chain') {
        const k = total ? 0.25 + 0.7 * Math.log(1 + total) / Math.log(1 + maxBrick) : 0, share = total ? comm / total : 0;
        const ahead = head != null && b.h0 > head;
        items.push({ depth: p.depth, d: () => box(b.cx, cy, b.cz, 6, LAYERS / 2, 6, share > 0.3 ? '#7dd3a8' : '#43956b', (total ? k : 0) * (ahead ? 0.25 : 1), hot ? MINT : total ? tint(MINT, 1, 0.35) : 'rgba(125,211,168,.14)'), pick: { brick: b, sx: p.sx, sy: p.sy, r: f * 7 / p.depth + 4, total, comm } });
      } else {
        items.push({ depth: p.depth + 30, d: () => { box(b.cx, cy, b.cz, 6, LAYERS / 2, 6, '#43956b', 0.05, hot ? MINT : 'rgba(125,211,168,.2)'); if (level === 'block' || p.depth < 70) layerLines(b, 0.07); }, pick: { brick: b, sx: p.sx, sy: p.sy, r: level === 'brick' ? f * 6 / p.depth : 0, total, comm } });
        for (const v of voxels) {
          if (v.brick !== b || items.length > budget) continue;
          const q = project(v.x, v.y, v.z); if (!q || q.sx < -10 || q.sx > W + 10 || q.sy < -10 || q.sy > H_ + 10) continue;
          drawn.add(v);
          const dimmed = (head != null && v.h > head) || (opts.threshold && v.score < opts.threshold() && !v.community);
          const size = 0.22 + 0.24 * Math.log2(1 + v.n) / Math.log2(1 + maxN), fill = v.media ? AMBER : v.color; // never wider than its cell
          const alpha = dimmed ? 0.1 : v.role === 'crowd' ? 0.55 : 0.95;
          items.push({ depth: q.depth, d: () => { box(v.x, v.y, v.z, size, size, size, fill, alpha, hover === v ? MINT : dimmed ? null : 'rgba(11,14,13,.55)'); if (v.reactions && level === 'block' && !dimmed) { for (let s = 0; s < Math.min(v.reactions, 6); s++) { const a = s / 6 * TAU, sp = project(v.x + Math.cos(a) * 0.75, v.y + 0.7, v.z + Math.sin(a) * 0.75); if (sp) { ctx.fillStyle = tint(MINT, 1, 0.9); ctx.fillRect(sp.sx - 1, sp.sy - 1, 2.5, 2.5); } } } }, pick: { voxel: v, sx: q.sx, sy: q.sy, r: f * (size + 0.3) / q.depth + 3 } });
        }
      }
    }
    items.sort((a, c) => c.depth - a.depth); projected = [];
    for (const it of items) { it.d(); if (it.pick && it.pick.r > 0) projected.push(it.pick); }
    if (level !== 'chain') { // replies as strings between the voxel that replied and the voxel it answered
      ctx.lineWidth = 1;
      for (const s of strings) { if (!drawn.has(s.a) || !drawn.has(s.b)) continue; const p = project(s.a.x, s.a.y, s.a.z), q = project(s.b.x, s.b.y, s.b.z); if (!p || !q) continue; ctx.strokeStyle = tint(s.color, 1, head != null && s.a.h > head ? 0.08 : 0.5); ctx.beginPath(); ctx.moveTo(p.sx, p.sy); ctx.lineTo(q.sx, q.sy); ctx.stroke(); }
    }
    const labelYs = [];
    for (const b of bricks) { if (level === 'chain' || near(b)) ring(b.cx, b.cz, b.y0 - 0.4, 9.5, 'rgba(138,160,148,.5)', true, `E${b.epoch} · #${b.h0.toLocaleString()} · ${lattice.count(b.h0, b.h0 + BLOCKS_PER_EPOCH - 1)}`, labelYs); }
    if (head != null) { const b = bricks[Math.floor(head / BLOCKS_PER_EPOCH) - epochMin]; if (b && (level === 'chain' || near(b))) ring(b.cx, b.cz, yOf(head), 10.5, AMBER, false, `${play ? '▶ ' : ''}#${Math.round(head).toLocaleString()}`, labelYs); }
    ctx.fillStyle = '#8aa094'; ctx.font = '9px ui-monospace, Menlo, monospace';
    ctx.fillText(`${level} level · ${inView} epoch${inView === 1 ? '' : 's'} in view · ${lattice.cols.n.toLocaleString()} events in ${lattice.buckets.size.toLocaleString()} blocks${potato ? ' · potato mode' : ''}`, 8, H_ - 8);
    ctx.textAlign = 'right'; ctx.fillStyle = armed ? MINT : '#8aa094'; ctx.fillText(armed ? 'scroll zooms · drag orbits · Esc releases' : 'click to take the controls', W - 8, 12); ctx.textAlign = 'left';
    opts.onView?.({ level, inView, head });
    const ms = performance.now() - t0; if (!potato && ms > 60 && ++slow > 4) { potato = true; resize(); }
  }
  function advance() { while (headH < voxels.length && voxels[headH].h <= head) { opts.onHead?.(voxels[headH], !!play); headH++; } while (headH > 0 && voxels[headH - 1].h > head) headH--; }
  function frame(now) {
    raf = 0;
    if (fly) { const k = clamp((now - fly.t0) / fly.ms, 0, 1), e = 1 - Math.pow(1 - k, 3); cam.t = { x: fly.a.x + (fly.b.x - fly.a.x) * e, y: fly.a.y + (fly.b.y - fly.a.y) * e, z: fly.a.z + (fly.b.z - fly.a.z) * e }; cam.dist = fly.d0 + (fly.d1 - fly.d0) * e; if (k >= 1) fly = null; dirty = true; }
    if (play) { const dt = Math.min(0.1, (now - lastHead) / 1000); lastHead = now; head = Math.min(lattice.h1, head + rate * dt * BLOCKS_PER_EPOCH); const pos = clamp(head / BLOCKS_PER_EPOCH - epochMin, 0, N - 1), c = coil(pos), at = { x: c.x, y: c.y + LAYERS / 2, z: c.z }; if (fly) fly.b = at; else if (play.follow) cam.t = at; advance(); if (head >= lattice.h1) { const done = play.onDone; play = null; done?.(); } dirty = true; }
    else if (now < autorotUntil && !reduced) { cam.yaw += 0.002; dirty = true; }
    if (dirty) { dirty = false; draw(); }
    if (fly || play || now < autorotUntil) schedule();
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(frame); if ((fly || play) && !fallback) fallback = setTimeout(() => { fallback = 0; if (raf) { cancelAnimationFrame(raf); raf = 0; frame(performance.now()); } }, 90); }
  function touch() { dirty = true; schedule(); }
  function flyTo(t, d, ms = reduced ? 0 : 600) { autorotUntil = 0; if (!ms) { cam.t = { ...t }; cam.dist = d; touch(); return; } fly = { t0: performance.now(), ms, a: { ...cam.t }, b: { ...t }, d0: cam.dist, d1: d }; schedule(); }
  const brickTarget = b => ({ x: b.cx, y: b.y0 + LAYERS / 2, z: b.cz });
  const pts = new Map(); let moved = false, pinch0 = 0, mid0 = 0;
  const local = ev => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  const pickAt = (mx, my) => { let best = null, bd = 1e9; for (const p of projected) { const d = Math.hypot(p.sx - mx, p.sy - my); if (d < p.r && d < bd) { bd = d; best = p; } } return best; };
  const arm = on => { armed = on; canvas.classList.toggle('armed', on); touch(); };
  canvas.addEventListener('pointerdown', ev => { try { canvas.setPointerCapture(ev.pointerId); } catch {} pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); moved = false; autorotUntil = 0; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); mid0 = (a.y + b.y) / 2; } });
  canvas.addEventListener('pointermove', ev => { const p = pts.get(ev.pointerId); if (!p) { const [mx, my] = local(ev), hit = pickAt(mx, my), target = hit ? (hit.voxel || hit.brick) : null; if (target !== hover) { hover = target; opts.onHover?.(hit, ev); touch(); } else if (target) opts.onHover?.(hit, ev); canvas.style.cursor = target ? 'pointer' : armed ? 'grab' : 'default'; return; } const dx = ev.clientX - p.x, dy = ev.clientY - p.y; p.x = ev.clientX; p.y = ev.clientY; if (Math.abs(dx) + Math.abs(dy) > 2) moved = true; if (pts.size === 1) { cam.yaw += dx * 0.008; cam.pitch = clamp(cam.pitch - dy * 0.005, -0.6, 1.45); } else if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mid = (a.y + b.y) / 2; if (pinch0 > 0) cam.dist = clamp(cam.dist * pinch0 / d, 5, 1500); cam.t.y = clamp(cam.t.y + (mid - mid0) * cam.dist / f, -10, top + 10); pinch0 = d; mid0 = mid; } fly = null; touch(); });
  const up = ev => { if (pts.has(ev.pointerId) && !moved && pts.size === 1) { const [mx, my] = local(ev), hit = pickAt(mx, my); if (!armed) arm(true); if (hit?.voxel) opts.onPick?.(hit.voxel); else if (hit?.brick) flyTo(brickTarget(hit.brick), cam.dist > 110 ? 48 : 20); } pts.delete(ev.pointerId); pinch0 = 0; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; opts.onHover?.(null); touch(); } });
  canvas.addEventListener('dblclick', ev => { ev.preventDefault(); const d = cam.dist > 110 ? fitDistance() : cam.dist > 34 ? 150 : 48; flyTo(cam.dist > 110 ? centre : cam.t, d); });
  const wheel = ev => { if (!armed) return; ev.preventDefault(); cam.dist = clamp(cam.dist * Math.exp(ev.deltaY * 0.0015), 5, 1500); fly = null; touch(); };
  canvas.addEventListener('wheel', wheel, { passive: false });
  const keys = ev => { if (!armed || ev.target?.closest?.('input, textarea, select')) return; if (ev.key === 'Escape') arm(false); else if (ev.key === '+' || ev.key === '=') { cam.dist = clamp(cam.dist / 1.3, 5, 1500); touch(); } else if (ev.key === '-') { cam.dist = clamp(cam.dist * 1.3, 5, 1500); touch(); } else if (ev.key === 'Backspace') { ev.preventDefault(); flyTo(cam.t, clamp(cam.dist * 2.4, 5, 1500)); } };
  document.addEventListener('keydown', keys);
  const outside = ev => { if (armed && !canvas.contains(ev.target)) arm(false); };
  document.addEventListener('pointerdown', outside);
  const api = {
    rebuild, resize, touch, render() { updateCamPos(); draw(); },
    setHead(h, follow) { if (h != null && !Number.isFinite(h)) return; head = h == null ? null : clamp(h, lattice.h0, lattice.h1); if (head != null) { advance(); if (follow && cam.dist <= 110) { const pos = clamp(head / BLOCKS_PER_EPOCH - epochMin, 0, N - 1), c = coil(pos); cam.t = { x: c.x, y: c.y + LAYERS / 2, z: c.z }; } } touch(); },
    head: () => head, rate(r) { if (r) rate = r; return rate; },
    play(onDone) { if (play) return; fly = null; autorotUntil = 0; if (head == null || head >= lattice.h1 - 1) { head = lattice.h0; headH = 0; } lastHead = performance.now(); play = { follow: true, onDone }; const pos = clamp(head / BLOCKS_PER_EPOCH - epochMin, 0, N - 1), c = coil(pos); if (cam.dist > 60) { if (cam.pitch > 0.9) cam.pitch = 0.55; flyTo({ x: c.x, y: c.y + LAYERS / 2, z: c.z }, 42, reduced ? 0 : 900); } schedule(); },
    pause() { play = null; touch(); }, playing: () => !!play,
    reset() { cam.yaw = 0.9; cam.pitch = 0.55; flyTo(centre, fitDistance()); },
    flyTo(epoch) { const b = bricks[epoch - epochMin]; if (b) flyTo(brickTarget(b), 48); },
    state: () => ({ dist: cam.dist, head, voxels: voxels.length, strings: strings.length, armed, bricks: N }),
    destroy() { cancelAnimationFrame(raf); raf = 0; clearTimeout(fallback); document.removeEventListener('keydown', keys); document.removeEventListener('pointerdown', outside); canvas.removeEventListener('wheel', wheel); },
  };
  resize(); if (!reduced && !potato) autorotUntil = performance.now() + 4000; schedule();
  return api;
}

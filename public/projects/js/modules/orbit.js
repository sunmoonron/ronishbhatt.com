// orbit.js: the 2D orbital view. Every halving era since genesis is a ring, genesis
// sits at the centre, and an event is a dot at its block's angle inside its era
// (12 o'clock is the halving). The current era's ring is only drawn as far as the tip.
import { BLOCKS_PER_ERA, blockToDate, tipHeight } from './anchor.js';
import { eraMeta } from './analytics.js';

const TAU = Math.PI * 2;
export const eraColor = era => eraMeta(era).color;
const size = e => e.kind === 1 ? 2.6 : e.kind === 6 ? 2.2 : 1.6;

export function blockAngle(height) { return (height % BLOCKS_PER_ERA) / BLOCKS_PER_ERA * TAU - Math.PI / 2; }

// opts: { sweep: angle of the radar hand or null, hover: event or null }
export function drawOrbit(canvas, anchored, metrics, opts = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = W / 2, cy = H / 2, maxR = Math.min(W, H) / 2 - 22;
  const tip = tipHeight(), curEra = Math.floor(tip / BLOCKS_PER_ERA), eras = curEra + 1;
  const eraRadius = era => maxR * (0.26 + 0.74 * era / Math.max(1, eras - 1));

  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.8);
  bg.addColorStop(0, '#132019'); bg.addColorStop(1, '#0b0e0d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  ctx.font = '10px ui-monospace, Menlo, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  for (let era = 0; era < eras; era++) {
    const r = eraRadius(era), color = eraColor(era), active = metrics.eraMap.has(era);
    ctx.lineWidth = 1;
    if (era === curEra) {
      const end = blockAngle(tip);
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, end); ctx.strokeStyle = color + '66'; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, r, end, TAU * 0.75); ctx.strokeStyle = color + '22'; ctx.setLineDash([2, 7]); ctx.stroke(); ctx.setLineDash([]);
      const nx = cx + r * Math.cos(end), ny = cy + r * Math.sin(end);
      ctx.beginPath(); ctx.arc(nx, ny, 3, 0, TAU); ctx.fillStyle = color; ctx.fill();
      ctx.fillStyle = color + 'cc'; ctx.textAlign = end > Math.PI / 2 || end < -Math.PI / 2 ? 'right' : 'left';
      ctx.fillText(`now · ${tip.toLocaleString()}`, nx + (ctx.textAlign === 'left' ? 7 : -7), ny + 4);
      ctx.textAlign = 'center';
    } else {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.strokeStyle = color + (active ? '55' : '2a'); ctx.setLineDash([3, 9]); ctx.stroke(); ctx.setLineDash([]);
    }
    const m = eraMeta(era);
    ctx.fillStyle = color + (active ? 'cc' : '77');
    ctx.fillText(`${m.name} · ${m.year}`, cx, cy - r - 6);
  }

  const dots = [];
  for (const e of anchored) {
    const era = e.anchor.era, r = eraRadius(era), a = blockAngle(e.anchor.height);
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a), color = eraColor(era), rad = size(e);
    let glow = 0;
    if (opts.sweep != null) { let d = opts.sweep - a; d = ((d % TAU) + TAU) % TAU; if (d < 0.35) glow = 1 - d / 0.35; }
    ctx.beginPath();
    if (e.kind === 6) { ctx.arc(x, y, rad + glow * 2, 0, TAU); ctx.strokeStyle = color + 'cc'; ctx.lineWidth = 1; ctx.stroke(); }
    else { ctx.arc(x, y, rad + glow * 3, 0, TAU); ctx.fillStyle = e.kind === 1 ? color + (glow ? 'ff' : 'dd') : color + '77'; ctx.fill(); }
    if (e.media?.length) { ctx.beginPath(); ctx.arc(x, y, rad + 2.5, 0, TAU); ctx.strokeStyle = '#e9c46a88'; ctx.lineWidth = 1; ctx.stroke(); }
    dots.push({ x, y, r: rad + 5, event: e });
  }

  if (opts.sweep != null) {
    const a = opts.sweep, R = eraRadius(eras - 1) + 8;
    const g = ctx.createConicGradient ? ctx.createConicGradient(a - 0.6, cx, cy) : null;
    if (g) { g.addColorStop(0, 'rgba(125,211,168,0)'); g.addColorStop(0.095, 'rgba(125,211,168,0.16)'); g.addColorStop(0.0955, 'rgba(125,211,168,0)'); g.addColorStop(1, 'rgba(125,211,168,0)');
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a - 0.6, a); ctx.closePath(); ctx.fillStyle = g; ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a)); ctx.strokeStyle = '#b4f5d1'; ctx.lineWidth = 1; ctx.stroke();
  }
  if (opts.hover) {
    const d = dots.find(o => o.event === opts.hover);
    if (d) { ctx.beginPath(); ctx.arc(d.x, d.y, 7, 0, TAU); ctx.strokeStyle = '#b4f5d1'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 30);
  glow.addColorStop(0, '#7dd3a866'); glow.addColorStop(1, 'transparent');
  ctx.beginPath(); ctx.arc(cx, cy, 30, 0, TAU); ctx.fillStyle = glow; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, 9, 0, TAU); ctx.fillStyle = '#7dd3a8'; ctx.fill();
  ctx.fillStyle = '#08150e'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('₿', cx, cy + 0.5);
  ctx.textBaseline = 'alphabetic';
  return dots;
}

export function hitTest(dots, mx, my) {
  let best = null, bd = 1e9;
  for (const d of dots) { const dist = Math.hypot(mx - d.x, my - d.y); if (dist < d.r && dist < bd) { bd = dist; best = d.event; } }
  return best;
}

// Epoch bars: one bar per active difficulty epoch, coloured by era.
export function drawTimeline(canvas, metrics) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b0e0d'; ctx.fillRect(0, 0, W, H);
  const epochs = [...metrics.epochMap.entries()].sort((a, b) => a[0] - b[0]);
  if (!epochs.length) return;
  const first = epochs[0][0], last = epochs.at(-1)[0], n = last - first + 1;
  const maxV = Math.max(...epochs.map(e => e[1]));
  const padL = 8, padR = 8, padT = 8, padB = 18, chartW = W - padL - padR, chartH = H - padT - padB, barW = chartW / n;
  for (const [epoch, count] of epochs) {
    const era = Math.floor(epoch * 2016 / BLOCKS_PER_ERA), bh = Math.max(1, (count / maxV) * chartH);
    ctx.fillStyle = eraColor(era) + 'cc';
    ctx.fillRect(padL + (epoch - first) * barW, padT + chartH - bh, Math.max(1, barW - (barW > 3 ? 1 : 0)), bh);
  }
  ctx.fillStyle = '#8aa094'; ctx.font = '8px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'left'; ctx.fillText(`epoch ${first} · ${blockToDate(first * 2016).getFullYear()}`, padL, H - 4);
  ctx.textAlign = 'right'; ctx.fillText(`epoch ${last} · ${blockToDate(last * 2016).getFullYear()}`, W - padR, H - 4);
}

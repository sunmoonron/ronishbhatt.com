// orbit.js, Canvas-based orbital visualization
// Concentric rings = halving eras · dots = events · position = block within era

const PALETTE    = ['#f7931a', '#22c55e', '#38bdf8', '#a78bfa', '#f43f5e', '#fbbf24'];
const ERA_LABELS = ['Genesis', '1st Era', '2nd Era', '3rd Era', '4th Era', '5th Era'];
const ERA_RADII  = [62, 112, 158, 200, 238, 273]; // px from center
const BLOCKS_PER_ERA = 210000;

// Draw the full orbit visualization. Returns dot-coord array for hit-testing.
export function drawOrbit(canvas, anchored, metrics) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const cx = W / 2, cy = H / 2;

  // Background
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.8);
  bg.addColorStop(0, '#13131f');
  bg.addColorStop(1, '#0a0a0a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Orbit rings + era labels
  for (const era of metrics.activeEras) {
    const r     = eraRadius(era);
    const color = PALETTE[era % PALETTE.length];

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = color + '28';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 9]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label sits just above the ring
    ctx.save();
    ctx.fillStyle  = color + '99';
    ctx.font       = `10px monospace`;
    ctx.textAlign  = 'center';
    ctx.fillText(ERA_LABELS[era] ?? `Era ${era}`, cx, cy - r - 7);
    ctx.restore();
  }

  // Event dots
  const dots = [];
  for (const e of anchored) {
    const era   = e.anchor.era;
    const r     = eraRadius(era);
    const angle = blockAngle(e.anchor.height);
    const x     = cx + r * Math.cos(angle);
    const y     = cy + r * Math.sin(angle);
    const color = PALETTE[era % PALETTE.length];
    const rad   = e.kind === 1 ? 2.5 : 1.5; // notes slightly larger

    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = color + (e.kind === 1 ? 'dd' : '88');
    ctx.fill();

    dots.push({ x, y, r: rad + 5, event: e }); // +5 for easier hover target
  }

  // Center glow
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 32);
  glow.addColorStop(0, '#f7931a66');
  glow.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  // Center ₿ node
  ctx.beginPath();
  ctx.arc(cx, cy, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#f7931a';
  ctx.fill();
  ctx.fillStyle      = '#000';
  ctx.font           = 'bold 11px system-ui';
  ctx.textAlign      = 'center';
  ctx.textBaseline   = 'middle';
  ctx.fillText('₿', cx, cy + 0.5);

  return dots;
}

// Hit test, returns the event under cursor, or null
export function hitTest(dots, mx, my) {
  for (const d of dots) {
    if (Math.hypot(mx - d.x, my - d.y) < d.r) return d.event;
  }
  return null;
}

// Draw timeline bar chart (epochMap)
export function drawTimeline(canvas, metrics) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);

  const epochs = [...metrics.epochMap.entries()].sort((a, b) => a[0] - b[0]);
  if (!epochs.length) return;

  const maxV  = Math.max(...epochs.map(e => e[1]));
  const padL  = 8, padR = 8, padT = 8, padB = 18;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const barW   = chartW / epochs.length;

  epochs.forEach(([epoch, count], i) => {
    const era   = Math.floor(epoch / (210000 / 2016));
    const color = PALETTE[era % PALETTE.length];
    const bh    = (count / maxV) * chartH;
    const x     = padL + i * barW;
    const y     = padT + chartH - bh;

    ctx.fillStyle = color + 'bb';
    ctx.fillRect(x, y, Math.max(1, barW - 1), bh);
  });

  // Axis labels
  ctx.fillStyle  = '#4b5563';
  ctx.font       = '8px monospace';
  ctx.textAlign  = 'left';
  ctx.fillText(`ep.${epochs[0][0]}`, padL, H - 4);
  ctx.textAlign  = 'right';
  ctx.fillText(`ep.${epochs.at(-1)[0]}`, W - padR, H - 4);
}

// ── helpers ──────────────────────────────────────────────────────
function eraRadius(era) {
  return ERA_RADII[Math.min(era, ERA_RADII.length - 1)];
}

function blockAngle(height) {
  const inEra = height % BLOCKS_PER_ERA;
  return (inEra / BLOCKS_PER_ERA) * Math.PI * 2 - Math.PI / 2;
}

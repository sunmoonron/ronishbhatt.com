// anchor.js: timestamps to block heights, interpolated inside real difficulty epochs.
// EPOCHS holds [height, timestamp] for every adjustment since genesis (tools/epochs.mjs);
// addRows() merges what mempool.space reports live and setTip() pins the current
// segment, so a height is off by a few blocks at most instead of tens of thousands.
import { EPOCHS } from './epochs.js';

export const BLOCKS_PER_EPOCH = 2016, BLOCKS_PER_ERA = 210000;
const GENESIS_TS = 1231006505, AVG_BLOCK = 600;
let table = EPOCHS.slice();
let tip = null;

export function addRows(rows) {
  const known = new Set(table.map(r => r[0]));
  for (const r of rows) if (r[0] % BLOCKS_PER_EPOCH === 0 && !known.has(r[0])) table.push([r[0], r[1]]);
  table.sort((a, b) => a[0] - b[0]);
}
export function setTip(height, ts = Math.floor(Date.now() / 1000)) { tip = { height: Number(height), ts }; }
export function tipHeight() {
  if (tip) return tip.height;
  const [h, t] = table.at(-1);
  return h + Math.round((Date.now() / 1000 - t) / AVG_BLOCK);
}

function bisect(key, idx) {
  let lo = 0, hi = table.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (table[m][idx] <= key) lo = m; else hi = m - 1; }
  return lo;
}
function segment(lo) {
  const [h0, t0] = table[lo];
  if (lo + 1 < table.length) return [h0, t0, table[lo + 1][0], table[lo + 1][1]];
  if (tip && tip.height > h0 && tip.ts > t0) return [h0, t0, tip.height, tip.ts];
  return [h0, t0, h0 + BLOCKS_PER_EPOCH, t0 + BLOCKS_PER_EPOCH * AVG_BLOCK];
}

export function estimateHeight(ts) {
  if (!(ts > GENESIS_TS)) return 0;
  const [h0, t0, h1, t1] = segment(bisect(ts, 1));
  const h = Math.round(h0 + (ts - t0) / (t1 - t0) * (h1 - h0));
  return Math.max(h0, tip ? Math.min(h, tip.height) : h);
}
export function blockToDate(height) {
  const [h0, t0, h1, t1] = segment(bisect(height, 0));
  return new Date((t0 + (height - h0) / (h1 - h0) * (t1 - t0)) * 1000);
}
export function heightToAnchor(height) {
  return { height, epoch: Math.floor(height / BLOCKS_PER_EPOCH), era: Math.floor(height / BLOCKS_PER_ERA), precision: 'epoch' };
}
export function anchorEventsFast(events) {
  return events.map(e => ({ ...e, anchor: heightToAnchor(estimateHeight(e.created_at)) }));
}
export function blockLabel(height) {
  const d = blockToDate(height);
  return `block ${height.toLocaleString()} · ${d.toLocaleString('default', { month: 'short', year: 'numeric' })}`;
}

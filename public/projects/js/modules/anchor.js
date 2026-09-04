// anchor.js — Maps Nostr event timestamps to Bitcoin block heights
// Uses linear interpolation from genesis — fast, no API calls needed.
// Average block time = 600s (10 min); good enough for analytics use.

const GENESIS_TS  = 1231006505; // block 0, Jan 3 2009
const AVG_BLOCK   = 600;        // seconds

export function estimateHeight(unixTs) {
  if (unixTs < GENESIS_TS) return 0;
  return Math.round((unixTs - GENESIS_TS) / AVG_BLOCK);
}

export function heightToAnchor(height) {
  return {
    height,
    epoch: Math.floor(height / 2016),     // difficulty adjustment period
    era:   Math.floor(height / 210000),   // halving era
    isEstimate: true,
  };
}

// Fast O(n) pass — no network required
export function anchorEventsFast(events) {
  return events.map(e => ({
    ...e,
    anchor: heightToAnchor(estimateHeight(e.created_at)),
  }));
}

// Estimate calendar date from block height
export function blockToDate(height) {
  return new Date((GENESIS_TS + height * AVG_BLOCK) * 1000);
}

// Block → human label  e.g.  "block 840,000 · Apr 2024"
export function blockLabel(height) {
  const d = blockToDate(height);
  return `block ${height.toLocaleString()} · ${d.toLocaleString('default', { month: 'short', year: 'numeric' })}`;
}

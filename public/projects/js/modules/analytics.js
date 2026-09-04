// analytics.js — Metrics computation from anchored Nostr events

export const KIND = Object.freeze({
  NOTE: 1, REPOST: 6, REACTION: 7, ZAP: 9735, LONG_FORM: 30023,
});

// OG tiers by first-seen block height
export const OG_TIERS = [
  { maxBlock: 700000,   label: '⚡ OG Nostr Native',  color: '#f7931a' },
  { maxBlock: 800000,   label: '🟢 Early Adopter',     color: '#22c55e' },
  { maxBlock: 840000,   label: '🔵 Pre-Halving',       color: '#38bdf8' },
  { maxBlock: Infinity, label: '🟣 Post-Halving',      color: '#a78bfa' },
];

export const ERA_META = [
  { name: 'Genesis Era',   color: '#f7931a' },
  { name: '1st Halving',   color: '#22c55e' },
  { name: '2nd Halving',   color: '#38bdf8' },
  { name: '3rd Halving',   color: '#a78bfa' },
  { name: '4th Halving',   color: '#f43f5e' },
  { name: '5th Era',       color: '#fbbf24' },
];

export function getOGStatus(firstBlock) {
  return OG_TIERS.find(t => firstBlock < t.maxBlock) ?? OG_TIERS.at(-1);
}

export function computeMetrics(anchored) {
  if (!anchored.length) return null;

  const sorted = [...anchored].sort((a, b) => a.anchor.height - b.anchor.height);

  // Maps: height→count, epoch→count, era→count, kind→count
  const blockMap = new Map();
  const epochMap = new Map();
  const eraMap   = new Map();
  const kindMap  = new Map();

  let maxStreak = 1, curStreak = 1, lastH = -2;

  for (const e of sorted) {
    const { height, epoch, era } = e.anchor;
    blockMap.set(height, (blockMap.get(height) ?? 0) + 1);
    epochMap.set(epoch,  (epochMap.get(epoch)  ?? 0) + 1);
    eraMap.set(era,      (eraMap.get(era)       ?? 0) + 1);
    kindMap.set(e.kind,  (kindMap.get(e.kind)   ?? 0) + 1);

    if (height === lastH + 1) {
      curStreak++;
      if (curStreak > maxStreak) maxStreak = curStreak;
    } else {
      curStreak = 1;
    }
    lastH = height;
  }

  return {
    total:       anchored.length,
    notes:       kindMap.get(KIND.NOTE)     ?? 0,
    reactions:   kindMap.get(KIND.REACTION) ?? 0,
    reposts:     kindMap.get(KIND.REPOST)   ?? 0,
    blocksActive: blockMap.size,
    maxStreak,
    blockMap,
    epochMap,
    eraMap,
    firstBlock:  sorted[0].anchor.height,
    lastBlock:   sorted.at(-1).anchor.height,
    activeEras:  [...eraMap.keys()].sort((a, b) => a - b),
    og:          getOGStatus(sorted[0].anchor.height),
  };
}

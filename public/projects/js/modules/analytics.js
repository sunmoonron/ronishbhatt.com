// analytics.js: metrics from anchored events (heights, epochs, eras, kinds, streaks).

export const KIND = Object.freeze({ NOTE: 1, REPOST: 6, REACTION: 7, OTS: 1040, ZAP: 9735, LONG_FORM: 30023 });

// OG tiers by first-seen block height
export const OG_TIERS = [
  { maxBlock: 700000,  label: '⚡ OG Nostr Native', color: '#e9c46a' },
  { maxBlock: 800000,  label: '🌱 Early Adopter',   color: '#7dd3a8' },
  { maxBlock: 840000,  label: '🌿 Pre-Halving',     color: '#a4e9bf' },
  { maxBlock: Infinity, label: '🍃 Post-Halving',   color: '#b4f5d1' },
];

export const ERA_META = [
  { name: 'Genesis era',  color: '#255a3f', year: 2009 },
  { name: '1st halving',  color: '#327754', year: 2012 },
  { name: '2nd halving',  color: '#43956b', year: 2016 },
  { name: '3rd halving',  color: '#5ab384', year: 2020 },
  { name: '4th halving',  color: '#a4e9bf', year: 2024 },
  { name: '5th halving',  color: '#e9c46a', year: 2028 },
];
export const eraMeta = era => ERA_META[era] ?? { name: `era ${era}`, color: '#e9c46a', year: 2009 + 4 * era };

export function getOGStatus(firstBlock) {
  return OG_TIERS.find(t => firstBlock < t.maxBlock) ?? OG_TIERS.at(-1);
}

export function computeMetrics(anchored) {
  if (!anchored.length) return null;
  const sorted = [...anchored].sort((a, b) => a.anchor.height - b.anchor.height);
  const blockMap = new Map(), epochMap = new Map(), eraMap = new Map(), kindMap = new Map();
  let maxStreak = 1, curStreak = 1, lastH = -2, media = 0;

  for (const e of sorted) {
    const { height, epoch, era } = e.anchor;
    blockMap.set(height, (blockMap.get(height) ?? 0) + 1);
    epochMap.set(epoch, (epochMap.get(epoch) ?? 0) + 1);
    eraMap.set(era, (eraMap.get(era) ?? 0) + 1);
    kindMap.set(e.kind, (kindMap.get(e.kind) ?? 0) + 1);
    if (e.media?.length) media++;
    if (height === lastH + 1) { curStreak++; if (curStreak > maxStreak) maxStreak = curStreak; }
    else if (height !== lastH) curStreak = 1;
    lastH = height;
  }

  return {
    total: anchored.length,
    notes: kindMap.get(KIND.NOTE) ?? 0,
    reactions: kindMap.get(KIND.REACTION) ?? 0,
    reposts: kindMap.get(KIND.REPOST) ?? 0,
    media,
    blocksActive: blockMap.size,
    maxStreak,
    blockMap, epochMap, eraMap,
    firstBlock: sorted[0].anchor.height,
    lastBlock: sorted.at(-1).anchor.height,
    activeEras: [...eraMap.keys()].sort((a, b) => a - b),
    og: getOGStatus(sorted[0].anchor.height),
  };
}

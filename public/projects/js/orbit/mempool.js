// mempool.js: the two mempool.space calls the page makes (tip height, difficulty adjustments).
const BASE = 'https://mempool.space/api';

export const HALVINGS = [
  { height: 0,       name: 'Genesis',     year: 2009 },
  { height: 210000,  name: '1st Halving', year: 2012 },
  { height: 420000,  name: '2nd Halving', year: 2016 },
  { height: 630000,  name: '3rd Halving', year: 2020 },
  { height: 840000,  name: '4th Halving', year: 2024 },
  { height: 1050000, name: '5th Halving', year: 2028 },
];

async function apiFetch(path, ms = 5000) {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`mempool ${r.status}: ${path}`);
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r.text();
}

export const getTipHeight = () => apiFetch('/blocks/tip/height');
// [[timestamp, height, difficulty, change], ...] newest first
export const getDifficultyAdjustments = () => apiFetch('/v1/mining/difficulty-adjustments');

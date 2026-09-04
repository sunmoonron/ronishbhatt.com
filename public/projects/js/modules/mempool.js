// mempool.js — Mempool.space API client
const BASE = 'https://mempool.space/api';

const HALVINGS = [
  { height: 0,       name: 'Genesis',     year: 2009 },
  { height: 210000,  name: '1st Halving', year: 2012 },
  { height: 420000,  name: '2nd Halving', year: 2016 },
  { height: 630000,  name: '3rd Halving', year: 2020 },
  { height: 840000,  name: '4th Halving', year: 2024 },
  { height: 1050000, name: '5th Halving', year: 2028 },
];

const NOTABLE = {
  840000: '4th Halving',
  774628: 'First Ordinal Inscription',
  630000: '3rd Halving',
  500000: '500K Milestone',
  420000: '2nd Halving',
  210000: '1st Halving',
};

async function apiFetch(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`mempool ${r.status}: ${path}`);
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r.text();
}

export const getTipHeight      = ()  => apiFetch('/blocks/tip/height');
export const getBlockAtTs      = ts  => apiFetch(`/v1/mining/blocks/timestamp/${ts}`);
export const getBlockHash      = h   => apiFetch(`/block-height/${h}`);
export const getBlock          = id  => apiFetch(`/block/${id}`);

// Returns a canonical anchor object from a precise API lookup
export async function preciseAnchor(timestamp) {
  const b = await getBlockAtTs(timestamp);
  return {
    height:    b.height,
    epoch:     Math.floor(b.height / 2016),
    era:       Math.floor(b.height / 210000),
    timestamp: b.timestamp,
    precise:   true,
  };
}

export { HALVINGS, NOTABLE };

// time.js: one way of writing a moment, everywhere on the page. Three clocks that mean
// different things: the block height (where the moment falls on the chain, interpolated
// from the difficulty schedule), the calendar (the author's clock, read by a human), and
// the unix seconds (the created_at that the signature actually covers).
import { BLOCKS_PER_EPOCH, BLOCKS_PER_ERA, blockToDate, estimateHeight, tipHeight } from './anchor.js';
import { eraMeta } from './analytics.js';

export const fmt = n => Math.round(n).toLocaleString();
export const H = h => '#' + fmt(h);
export const E = h => 'E' + Math.floor(h / BLOCKS_PER_EPOCH);
export const dayShort = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const dayYear = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
export const clock = d => d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// the three readings of one unix timestamp (a height can be passed to skip the interpolation)
export function stamp(ts, height = estimateHeight(ts)) {
  return { ts, h: height, epoch: Math.floor(height / BLOCKS_PER_EPOCH), inEpoch: height % BLOCKS_PER_EPOCH, era: Math.floor(height / BLOCKS_PER_ERA), date: new Date(ts * 1000) };
}

const TITLES = {
  chain: 'block height: where this moment falls on the chain, interpolated from the real difficulty schedule (about five blocks either way); E is the difficulty epoch and the offset is the block inside it',
  human: 'the author’s clock, shown in your local time',
  raw: 'created_at in unix seconds: the number the signature actually covers, so this is the only one of the three that is signed',
};

// a compact three-line reading; returns an element so callers never touch innerHTML
export function stack(ts, height) {
  const s = stamp(ts, height), el = document.createElement('div'); el.className = 'tstack';
  const row = (cls, glyph, text, title) => { const r = document.createElement('span'); r.className = 'tr ' + cls; r.title = title;
    const g = document.createElement('b'); g.textContent = glyph; const t = document.createElement('span'); t.textContent = text; r.append(g, t); return r; };
  el.append(
    row('chain', '⛓', `${H(s.h)} · E${s.epoch} +${fmt(s.inEpoch)} · ${eraMeta(s.era).name}`, TITLES.chain),
    row('human', '📅', clock(s.date), TITLES.human),
    row('raw', 'τ', String(s.ts), TITLES.raw),
  );
  return el;
}

// one line, for places without room for three
export function line(ts, height) { const s = stamp(ts, height); return `${H(s.h)} · ${clock(s.date)} · τ${s.ts}`; }

// the live "now": the tip, the current epoch's progress, the wall clock, unix seconds ticking
export function nowStack() {
  const el = document.createElement('div'); el.className = 'tstack now';
  const chain = document.createElement('span'), human = document.createElement('span'), raw = document.createElement('span');
  chain.className = 'tr chain'; human.className = 'tr human'; raw.className = 'tr raw';
  chain.title = 'the chain tip from mempool.space, the current difficulty epoch and how far into it we are'; human.title = 'your clock'; raw.title = 'unix seconds, ticking';
  el.append(chain, human, raw);
  const tick = () => {
    const tip = tipHeight(), ts = Math.floor(Date.now() / 1000), left = BLOCKS_PER_EPOCH - tip % BLOCKS_PER_EPOCH;
    chain.textContent = `⛓ ${H(tip)} · E${Math.floor(tip / BLOCKS_PER_EPOCH)} +${fmt(tip % BLOCKS_PER_EPOCH)} · ${fmt(left)} to go`;
    human.textContent = `📅 ${clock(new Date(ts * 1000))}`;
    raw.textContent = `τ ${ts}`;
  };
  tick(); el.timer = setInterval(tick, 1000);
  return el;
}

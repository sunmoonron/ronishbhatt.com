// sim.js: a seeded small world, generated in a Web Worker and streamed to the page in chunks. Eight
// named people who differ in when they are awake and how far behind they read, a crowd who post
// into the void, and a live tip: after the backfill the worker keeps mining a block every few
// seconds and the people keep acting, so the page has to cope with time moving under it. The
// visitor is "you": what you post is answered by the same rules, the way the others answer each other.
const BLOCKS_PER_EPOCH = 2016, BLOCKS_PER_DAY = 144;
const mulberry = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const hourOf = h => (h % BLOCKS_PER_DAY) / 6, dayOf = h => Math.floor(h / BLOCKS_PER_DAY);
const bump = (x, c, w) => { let d = Math.abs(x - c); d = Math.min(d, 24 - d); return Math.exp(-(d * d) / (2 * w * w)); };
// replyTo: who they answer, [probability, soonest, latest] in blocks. react: who they heart, probability.
const PEOPLE = [
  { name: 'ada', story: 'up at seven, posts before work, answers bo within minutes', rate: 10, hours: [9, 1.6], topics: ['the rink at Nathan Phillips is open', 'two laps before work, no regrets', 'ice was soft today', 'who is skating tonight', 'new blades, new me', 'lost a glove at Harbourfront again'], replyTo: { bo: [0.65, 1, 3], you: [0.6, 1, 3], hal: [0.35, 1, 4], gus: [0.4, 1, 3] }, react: { bo: 0.6, you: 0.7, hal: 0.4 } },
  { name: 'bo', story: 'evenings only, answers ada hours later, never the same hour', rate: 8, hours: [20.5, 2], topics: ['block 965k came in fast', 'running the node on a potato and it purrs', 'my relay ate 4k wraps last night', 'proof of work is the only spam filter that scales', 'fee market is asleep', 'sats or it did not happen'], replyTo: { ada: [0.55, 6, 30], you: [0.5, 6, 30], hal: [0.2, 6, 20] }, react: { ada: 0.5, you: 0.5 } },
  { name: 'cy', story: 'twelve time zones away: awake while ada and bo sleep', rate: 9, hours: [3, 1.8], topics: ['trained a 7M model on a laptop', 'context dilution is real, plot attached', 'superweights are so weird', 'residual stream is a highway', 'logit lens shows the word early', 'weight dictionaries for lunch'], replyTo: { dee: [0.6, 1, 8], you: [0.3, 40, 90] }, react: { dee: 0.6, you: 0.4 } },
  { name: 'dee', story: 'cy\'s neighbour, same hours, replies the moment cy posts', rate: 7, hours: [4, 1.8], topics: ['reading Bruls on treemaps', 'a coil is the right shape for time', 'twelve by twelve is a day, who knew', 'shipped the epoch ruler', 'every block a voxel', 'text mode first, then 3D'], replyTo: { cy: [0.6, 1, 4], you: [0.3, 40, 90] }, react: { cy: 0.7, you: 0.4 } },
  { name: 'eve', story: 'never posts, only hearts; you see her in the sparks and nowhere else', rate: 0, hours: [14, 6], topics: [], replyTo: { you: [0.15, 2, 20] }, react: { ada: 0.4, bo: 0.4, cy: 0.35, dee: 0.35, fin: 0.5, gus: 0.3, hal: 0.6, you: 0.85 }, reactAny: 0.2 },
  { name: 'fin', story: 'silent for days, then twenty posts in twenty minutes, each answering the last', rate: 0.4, hours: [22, 1], burstEvery: 6, topics: ['new route on the bike', 'tuning the amp', 'the show was loud', 'sunday reset', 'wrote a small thing', 'walked to the pier', 'ok hear me out', 'and another thing', 'this is the part nobody gets', 'anyway', 'thread continues', 'last one I promise'], replyTo: { you: [0.15, 1, 3] }, react: {} },
  { name: 'gus', story: 'opens the client every few days and answers things from three days ago', rate: 0.3, hours: [19, 1.5], visitEvery: [3, 5], topics: ['back, what did I miss', 'catching up', 'reading the week in one sitting'], replyTo: {}, react: { you: 0.5 } },
  { name: 'hal', story: 'joined two days ago; his first post was a hello, and he answers anyone who answers him', rate: 4, hours: [14, 3], joinsDaysAgo: 2, topics: ['hello, is this thing on', 'how do you all find people here', 'first week, still lost', 'ok this is starting to make sense', 'is there a search', 'thanks for the welcome'], replyTo: { you: [0.5, 1, 4] }, react: { you: 0.6 }, answersBack: 0.7 },
];
const CROWD_TOPICS = ['gm', 'gn', 'zapping this', 'wow', 'thoughts?', 'this is the way', 'saved for later', 'ok', 'anyone in Toronto?', 'lol', 'watching the mempool', 'first', 'hello world', 'what relay is this', 'nice', 'bump'];
const REPLIES = ['same', 'come tonight then', 'send the plot', 'that is the thing', 'ha, yes', 'no way', 'true', 'let me try that', 'agreed', 'wait what', 'welcome', 'late to this but yes'];
self.onmessage = ({ data }) => {
  if (data.type === 'post') return onPost({ id: data.id, height: data.height, author: 'you', kind: 1, target: null, depth: 0 });
  if (data.type === 'live') { clearInterval(timer); timer = data.ms ? setInterval(tick, data.ms) : 0; return; }
  start(data);
};
let timer = 0, rnd, h0, h1, crowd, idx, seq = 0, buf = [], sent = 0, byId = new Map(), future = new Map(), friendPosts = [], lastVisit = new Map(), started = false;
const pick = a => a[Math.floor(rnd() * a.length)], between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
function start(data) {
  const { seed = 7, tip, epochs = 3, crowd: n = 60 } = data; rnd = mulberry(seed); crowd = n; started = true;
  h0 = Math.floor((tip - epochs * BLOCKS_PER_EPOCH) / BLOCKS_PER_EPOCH) * BLOCKS_PER_EPOCH; h1 = tip;
  const authors = PEOPLE.map(p => ({ name: p.name, role: 'friend', story: p.story })).concat([{ name: 'you', role: 'you', story: 'the visitor: whatever you post here is answered by the same rules' }], Array.from({ length: crowd }, (_, i) => ({ name: 'anon' + (i + 1).toString(36).padStart(2, '0'), role: 'crowd' })));
  idx = Object.fromEntries(authors.map((a, i) => [a.name, i]));
  self.postMessage({ type: 'authors', authors, h0, h1 });
  for (const p of PEOPLE) if (p.visitEvery) lastVisit.set(p.name, h0 - between(0, 3) * BLOCKS_PER_DAY);
  for (let h = h0; h <= h1; h++) { genBlock(h); if (buf.length >= 400) flush(); }
  flush(); self.postMessage({ type: 'done', total: sent });
}
function tick() { h1++; genBlock(h1); flush(true); }
function flush(always) { if (!buf.length && !always) return; buf.sort((x, y) => x.height - y.height); const n = buf.length, k = { type: 'chunk', tip: h1, height: new Int32Array(n), author: new Uint16Array(n), kind: new Uint8Array(n), flags: new Uint8Array(n), ids: [], text: [], targets: [] };
  buf.forEach((e, j) => { k.height[j] = e.height; k.author[j] = idx[e.author]; k.kind[j] = e.kind; k.flags[j] = e.flags; k.ids.push(e.id); k.text.push(e.text); k.targets.push(e.target || null); });
  self.postMessage(k, [k.height.buffer, k.author.buffer, k.kind.buffer, k.flags.buffer]); sent += n; buf = []; }
// an event lands in a block: it is emitted, remembered, and the other people decide whether to answer it
function emit(height, author, kind, text, target, depth = 0, media = false) {
  const id = 'sim' + (seq++).toString(36), ev = { height, author, kind, flags: (target && kind === 1 ? 1 : 0) | (media ? 2 : 0), id, text, target, depth };
  buf.push(ev); byId.set(id, ev); if (byId.size > 5000) byId.delete(byId.keys().next().value);
  if (kind === 1 && author !== 'you' && PEOPLE.some(p => p.name === author)) { friendPosts.push(ev); if (friendPosts.length > 600) friendPosts.shift(); }
  onPost(ev); return id;
}
const later = (h, ev) => { const q = future.get(h) || []; q.push(ev); future.set(h, q); };
function onPost(ev) {
  if (ev.kind !== 1) return;
  for (const p of PEOPLE) {
    if (p.name === ev.author) continue;
    const r = p.replyTo[ev.author]; if (r && ev.depth < 4 && rnd() < r[0]) later(ev.height + between(r[1], r[2]), { author: p.name, kind: 1, text: pick(REPLIES), target: ev.id, depth: ev.depth + 1 });
    const k = p.react[ev.author] ?? (p.reactAny && ev.author.startsWith('anon') ? 0 : p.reactAny); if (k && rnd() < k) later(ev.height + between(1, 12), { author: p.name, kind: 7, text: '+', target: ev.id });
    // hal answers whoever answered him, a few blocks later, and the thread stays short
    if (p.answersBack && ev.target && byId.get(ev.target)?.author === p.name && ev.depth < 3 && rnd() < p.answersBack) later(ev.height + between(1, 4), { author: p.name, kind: 1, text: pick(['thanks!', 'oh nice', 'got it', 'will do', 'ha']), target: ev.id, depth: ev.depth + 1 });
  }
  if (!ev.author.startsWith('anon')) { // the crowd notices friends and you
    if (rnd() < 0.2) later(ev.height + between(1, 20), { author: 'anon' + between(1, crowd).toString(36).padStart(2, '0'), kind: 7, text: '+', target: ev.id });
    if (rnd() < 0.08 && ev.depth < 2) later(ev.height + between(1, 20), { author: 'anon' + between(1, crowd).toString(36).padStart(2, '0'), kind: 1, text: pick(REPLIES), target: ev.id, depth: ev.depth + 1 });
  }
}
function genBlock(h) {
  const due = future.get(h); if (due) { future.delete(h); for (const e of due) emit(h, e.author, e.kind, e.text, e.target, e.depth || 0); }
  const hour = hourOf(h), dayIdx = dayOf(h);
  for (const p of PEOPLE) {
    if (p.joinsDaysAgo != null) { const joinH = h1 - p.joinsDaysAgo * BLOCKS_PER_DAY + 14 * 6; if (h < joinH) continue; if (h === joinH) { emit(h, p.name, 1, p.topics[0]); continue; } }
    if (p.burstEvery && dayIdx % p.burstEvery === 2) { // a burst day: a chain of posts in two blocks, late at night
      if (h % BLOCKS_PER_DAY === 22 * 6 || h % BLOCKS_PER_DAY === 22 * 6 + 1) { let prev = null; const n = between(6, 10); for (let i = 0; i < n; i++) { const id = 'sim' + (seq++).toString(36); const ev = { height: h, author: p.name, kind: 1, flags: prev ? 1 : 0, id, text: pick(p.topics), target: prev, depth: 0 }; buf.push(ev); byId.set(id, ev); friendPosts.push(ev); prev = id; if (i === 0) onPost(ev); } }
      continue;
    }
    if (p.visitEvery) { // a visitor with a reading pointer of his own: on a visit he answers what he missed
      const last = lastVisit.get(p.name); if (h - last >= between(p.visitEvery[0], p.visitEvery[1]) * BLOCKS_PER_DAY && Math.abs(hour - p.hours[0]) < 0.17) {
        lastVisit.set(p.name, h); emit(h, p.name, 1, pick(p.topics));
        const missed = friendPosts.filter(e => e.height > last && e.height < h - 6 && e.author !== p.name); for (let i = 0; i < Math.min(missed.length, between(3, 6)); i++) { const t = pick(missed); later(h + between(0, 2), { author: p.name, kind: 1, text: pick(REPLIES), target: t.id, depth: 1 }); }
      }
      continue;
    }
    if (p.rate && rnd() < p.rate / BLOCKS_PER_DAY * bump(hour, p.hours[0], p.hours[1]) * 2.4) emit(h, p.name, 1, pick(p.topics), null, 0, rnd() < 0.12);
  }
  const d = 0.25 + 0.75 * Math.max(0, Math.sin((hour - 6) / 24 * Math.PI * 2));
  for (let c = 1; c <= crowd; c++) if (rnd() < 0.6 / BLOCKS_PER_DAY * d) emit(h, 'anon' + c.toString(36).padStart(2, '0'), rnd() < 0.05 ? 6 : 1, pick(CROWD_TOPICS));
}

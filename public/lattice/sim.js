// sim.js: a seeded community, generated in a Web Worker and streamed to the page in chunks so the
// lattice lights up after the first few hundred events. Two pairs who talk to each other, two
// strangers who only post, and a crowd of sixty who mostly post into the void and sometimes react.
const BLOCKS_PER_EPOCH = 2016, BLOCKS_PER_DAY = 144;
const mulberry = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const PEOPLE = [
  { name: 'ada', role: 'community', pair: 'bo', rate: 12, topics: ['the rink at Nathan Phillips is open', 'two laps before work, no regrets', 'ice was soft today', 'who is skating tonight', 'new blades, new me', 'lost a glove at Harbourfront again'] },
  { name: 'bo', role: 'community', pair: 'ada', rate: 9, topics: ['block 965k came in fast', 'running the node on a potato and it purrs', 'my relay ate 4k wraps last night', 'proof of work is the only spam filter that scales', 'fee market is asleep', 'sats or it did not happen'] },
  { name: 'cy', role: 'community', pair: 'dee', rate: 10, topics: ['trained a 7M model on a laptop', 'context dilution is real, plot attached', 'superweights are so weird', 'residual stream is a highway', 'logit lens shows the word early', 'weight dictionaries for lunch'] },
  { name: 'dee', role: 'community', pair: 'cy', rate: 8, topics: ['reading Bruls on treemaps', 'a coil is the right shape for time', 'twelve by twelve is a day, who knew', 'shipped the epoch ruler', 'every block a voxel', 'text mode first, then 3D'] },
  { name: 'eve', role: 'stranger', pair: null, rate: 6, topics: ['sourdough attempt four', 'the lake is glass tonight', 'finished the book', 'coffee at the counter', 'garden is finally green', 'rain again'] },
  { name: 'fin', role: 'stranger', pair: null, rate: 5, topics: ['new route on the bike', 'tuning the amp', 'the show was loud', 'sunday reset', 'wrote a small thing', 'walked to the pier'] },
];
const CROWD_TOPICS = ['gm', 'gn', 'zapping this', 'wow', 'thoughts?', 'this is the way', 'saved for later', 'ok', 'anyone in Toronto?', 'lol', 'watching the mempool', 'first', 'hello world', 'what relay is this', 'nice', 'bump'];
const REPLIES = ['same', 'come tonight then', 'send the plot', 'that is the thing', 'ha, yes', 'no way', 'true', 'let me try that', 'agreed', 'wait what'];
self.onmessage = ({ data }) => {
  const { seed = 7, tip, epochs = 3, crowd = 60 } = data, rnd = mulberry(seed);
  const h0 = Math.floor((tip - epochs * BLOCKS_PER_EPOCH) / BLOCKS_PER_EPOCH) * BLOCKS_PER_EPOCH, h1 = tip;
  const authors = PEOPLE.map(p => ({ name: p.name, role: p.role })).concat(Array.from({ length: crowd }, (_, i) => ({ name: 'anon' + (i + 1).toString(36).padStart(2, '0'), role: 'crowd' })));
  self.postMessage({ type: 'authors', authors, h0, h1 });
  const idx = Object.fromEntries(authors.map((a, i) => [a.name, i]));
  const recentBy = new Map(); // author -> [{id, height}]
  let seq = 0, buf = [], sent = 0;
  const diurnal = h => { const hour = ((h % BLOCKS_PER_DAY) / 6); return 0.25 + 0.75 * Math.max(0, Math.sin((hour - 6) / 24 * Math.PI * 2)) ; };
  const flush = () => { if (!buf.length) return; const n = buf.length, k = { type: 'chunk', height: new Int32Array(n), author: new Uint16Array(n), kind: new Uint8Array(n), flags: new Uint8Array(n), ids: [], text: [], targets: [] };
    buf.forEach((e, j) => { k.height[j] = e.height; k.author[j] = e.author; k.kind[j] = e.kind; k.flags[j] = e.flags; k.ids.push(e.id); k.text.push(e.text); k.targets.push(e.target || null); });
    self.postMessage(k, [k.height.buffer, k.author.buffer, k.kind.buffer, k.flags.buffer]); sent += n; buf = []; };
  const post = (height, author, kind, flags, text, target) => { const id = 'sim' + (seq++).toString(36); buf.push({ height, author, kind, flags, id, text, target }); const r = recentBy.get(author) || []; r.push({ id, height }); if (r.length > 40) r.shift(); recentBy.set(author, r); return id; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  for (let h = h0; h <= h1; h++) {
    const d = diurnal(h);
    for (const p of PEOPLE) {
      const a = idx[p.name], community = p.role === 'community' ? 4 : 0;
      if (rnd() < p.rate / BLOCKS_PER_DAY * d * 1.6) {
        const media = rnd() < 0.12 ? 2 : 0;
        const id = post(h, a, 1, community | media, pick(p.topics));
        if (p.pair) { // the partner replies and reacts, a few blocks later
          const partner = idx[p.pair];
          if (rnd() < 0.45) buf.push({ height: Math.min(h1, h + 1 + Math.floor(rnd() * 10)), author: partner, kind: 1, flags: 4 | 1, id: 'sim' + (seq++).toString(36), text: pick(REPLIES), target: id });
          if (rnd() < 0.6) buf.push({ height: Math.min(h1, h + 1 + Math.floor(rnd() * 5)), author: partner, kind: 7, flags: 4, id: 'sim' + (seq++).toString(36), text: '+', target: id });
        }
      }
    }
    for (let c = 0; c < crowd; c++) {
      if (rnd() < 0.7 / BLOCKS_PER_DAY * d) {
        const a = PEOPLE.length + c, r = rnd();
        if (r < 0.2) { const target = pick(PEOPLE.filter(p => p.role === 'community')); const rec = recentBy.get(idx[target.name]); if (rec && rec.length) { const t = rec[rec.length - 1]; post(h, a, 7, 0, '+', t.id); continue; } }
        if (r < 0.28) { const target = pick(PEOPLE); const rec = recentBy.get(idx[target.name]); if (rec && rec.length) { const t = rec[rec.length - 1]; post(h, a, 1, 1, pick(REPLIES), t.id); continue; } }
        post(h, a, rnd() < 0.05 ? 6 : 1, 0, pick(CROWD_TOPICS));
      }
    }
    if (buf.length >= 400) { buf.sort((x, y) => x.height - y.height); flush(); }
  }
  buf.sort((x, y) => x.height - y.height); flush();
  self.postMessage({ type: 'done', total: sent });
};

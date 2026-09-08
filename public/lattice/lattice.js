// lattice.js: the feed as a block lattice. Every event gets an address derived from its block
// height (epoch, day, row, column: a mixed-radix number, base 2016 / 144 / 12), a bucket per
// block holds its events, a Fenwick tree over heights answers "how much happened between these
// blocks" in O(log n) without touching the events, and the events themselves live in columnar
// typed arrays that grow by doubling, so a feed of a million events is a few megabytes.
export const BLOCKS_PER_EPOCH = 2016, BLOCKS_PER_DAY = 144, SIDE = 12;
export const F_REPLY = 1, F_MEDIA = 2, F_COMMUNITY = 4;

export class Fenwick {
  constructor(n) { this.n = n; this.t = new Int32Array(n + 1); }
  add(i, v) { for (i++; i <= this.n; i += i & -i) this.t[i] += v; }
  prefix(i) { let s = 0; for (i = Math.min(i, this.n - 1) + 1; i > 0; i -= i & -i) s += this.t[i]; return s; }
  range(a, b) { if (b < a) return 0; return this.prefix(b) - (a > 0 ? this.prefix(a - 1) : 0); }
}

export class Columns {
  constructor(cap = 4096) { this.n = 0; this.cap = cap; this.height = new Int32Array(cap); this.author = new Uint16Array(cap); this.kind = new Uint8Array(cap); this.flags = new Uint8Array(cap); this.target = new Int32Array(cap).fill(-1); this.score = new Uint16Array(cap); this.text = []; this.ids = []; }
  grow() {
    const cap = this.cap * 2, g = (old, C) => { const a = new C(cap); a.set(old); return a; };
    this.height = g(this.height, Int32Array); this.author = g(this.author, Uint16Array); this.kind = g(this.kind, Uint8Array); this.flags = g(this.flags, Uint8Array);
    const t = new Int32Array(cap).fill(-1); t.set(this.target); this.target = t; this.score = g(this.score, Uint16Array); this.cap = cap;
  }
  push(height, author, kind, flags, id, text) { if (this.n === this.cap) this.grow(); const i = this.n++; this.height[i] = height; this.author[i] = author; this.kind[i] = kind; this.flags[i] = flags; this.ids[i] = id; this.text[i] = text; return i; }
}

export class Lattice {
  constructor(h0, h1) {
    this.h0 = h0; this.h1 = h1; this.cols = new Columns(); this.buckets = new Map(); this.byId = new Map(); this.pending = new Map();
    this.all = new Fenwick(h1 - h0 + 1); this.community = new Fenwick(h1 - h0 + 1); this.authors = []; this.listeners = new Set();
  }
  addAuthor(a) { this.authors.push(a); return this.authors.length - 1; }
  address(h) { const i = ((h % BLOCKS_PER_EPOCH) + BLOCKS_PER_EPOCH) % BLOCKS_PER_EPOCH, d = i % BLOCKS_PER_DAY; return { epoch: Math.floor(h / BLOCKS_PER_EPOCH), day: Math.floor(i / BLOCKS_PER_DAY), row: Math.floor(d / SIDE), col: d % SIDE }; }
  // one event; replies and reactions credit their target's score, even when the target arrives later
  ingest(height, author, kind, flags, id, text, targetId) {
    if (height < this.h0 || height > this.h1 || (id && this.byId.has(id))) return -1;
    const c = this.cols, i = c.push(height, author, kind, flags, id, text);
    if (id) this.byId.set(id, i);
    let b = this.buckets.get(height); if (!b) this.buckets.set(height, b = []); b.push(i);
    this.all.add(height - this.h0, 1); if (flags & F_COMMUNITY) this.community.add(height - this.h0, 1);
    if (targetId) { const t = this.byId.get(targetId); if (t != null) { c.target[i] = t; c.score[t]++; } else { const p = this.pending.get(targetId) || []; p.push(i); this.pending.set(targetId, p); } }
    if (id && this.pending.has(id)) { for (const j of this.pending.get(id)) { c.target[j] = i; c.score[i]++; } this.pending.delete(id); }
    return i;
  }
  ingestChunk(k) { for (let j = 0; j < k.height.length; j++) this.ingest(k.height[j], k.author[j], k.kind[j], k.flags[j], k.ids[j], k.text[j], k.targets[j] || null); this.emit(); }
  count(a, b) { return this.all.range(a - this.h0, b - this.h0); }
  countCommunity(a, b) { return this.community.range(a - this.h0, b - this.h0); }
  block(h) { return this.buckets.get(h) || []; }
  // the busiest author of a block decides its colour; ties go to community members
  dominant(h) { const idx = this.block(h); if (!idx.length) return -1; const m = new Map(); let best = -1, bn = 0; for (const i of idx) { const a = this.cols.author[i], n = (m.get(a) || 0) + 1 + ((this.cols.flags[i] & F_COMMUNITY) ? 0.5 : 0); m.set(a, n); if (n > bn) { bn = n; best = a; } } return best; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const f of this.listeners) f(this); }
}

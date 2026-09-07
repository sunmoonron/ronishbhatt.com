/* TinyGPT: a hand-written inference engine for the in-page story model (GPT-2 style, word-level vocabulary).
   Mirrors train_tiny.py exactly: x = tok[id] + pos[p]; per block: x += proj(attn(ln1(x))); x += proj2(gelu(fc(ln2(x))));
   logits = lnf(x) · tokᵀ. Weights arrive as an int8-per-row blob and are dequantized once into Float32Arrays.
   The KV cache is the model's memory: story tokens append entries; planted memories are entries computed on a phrase
   alone and spliced in; erasing removes entries. All attention is over the whole cache, causal only among story tokens
   (planted entries are attendable by everything, exactly as in the PyTorch validation). */
(function (global) {
  "use strict";

  function b64ToBytes(b64) {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  class TinyGPT {
    constructor(exp) {
      const c = exp.config;
      this.V = c.V; this.d = c.d; this.H = c.heads; this.L = c.layers; this.ctx = c.ctx; this.hd = this.d / this.H;
      this.vocab = exp.vocab; this.wid = new Map(exp.vocab.map((w, i) => [w, i]));
      const bytes = b64ToBytes(exp.blob_b64), buf = bytes.buffer, base = bytes.byteOffset;
      const W = {};
      for (const m of exp.meta) {
        if (m.q_off !== undefined) {
          const rows = m.shape[0], cols = m.shape[1];
          const q = new Int8Array(buf, base + m.q_off, m.q_len), s = new Float32Array(buf.slice(base + m.s_off, base + m.s_off + m.s_len));
          const f = new Float32Array(rows * cols);
          for (let r = 0; r < rows; r++) { const sc = s[r], o = r * cols; for (let c2 = 0; c2 < cols; c2++) f[o + c2] = q[o + c2] * sc; }
          W[m.name] = f;
        } else {
          W[m.name] = new Float32Array(buf.slice(base + m.f_off, base + m.f_off + m.f_len));
        }
      }
      this.W = W;
      this.layers = [];
      for (let l = 0; l < this.L; l++) {
        const p = `blocks.${l}.`;
        this.layers.push({ ln1w: W[p + "ln1.weight"], ln1b: W[p + "ln1.bias"], qkvw: W[p + "qkv.weight"], qkvb: W[p + "qkv.bias"], projw: W[p + "proj.weight"], projb: W[p + "proj.bias"],
          ln2w: W[p + "ln2.weight"], ln2b: W[p + "ln2.bias"], fcw: W[p + "fc.weight"], fcb: W[p + "fc.bias"], proj2w: W[p + "proj2.weight"], proj2b: W[p + "proj2.bias"] });
      }
      this.tok = W["tok.weight"]; this.pos = W["pos.weight"]; this.lnfw = W["lnf.weight"]; this.lnfb = W["lnf.bias"];
      // scratch buffers
      const d = this.d;
      this.x = new Float32Array(d); this.h = new Float32Array(d); this.qkv = new Float32Array(3 * d); this.att = new Float32Array(d); this.mlp = new Float32Array(4 * d); this.tmp = new Float32Array(d);
      this.scores = new Float32Array(1024);
      this.logits = new Float32Array(this.V);
      this.cache = this.newCache();
    }
    newCache() {
      const cap = this.ctx + 256;
      return { n: 0, cap, K: Array.from({ length: this.L }, () => new Float32Array(cap * this.d)), Vv: Array.from({ length: this.L }, () => new Float32Array(cap * this.d)), tag: new Int32Array(cap), planted: new Uint8Array(cap) };
    }
    static layerNorm(x, w, b, out) {
      const n = x.length; let mean = 0; for (let i = 0; i < n; i++) mean += x[i]; mean /= n;
      let v = 0; for (let i = 0; i < n; i++) { const t = x[i] - mean; v += t * t; } v /= n;
      const inv = 1 / Math.sqrt(v + 1e-5);
      for (let i = 0; i < n; i++) out[i] = (x[i] - mean) * inv * w[i] + b[i];
    }
    static matvec(W, b, x, out, rows, cols) {           // out[r] = b[r] + Σ_c W[r*cols+c] x[c]; inner loop unrolled by 4
      for (let r = 0; r < rows; r++) {
        const o = r * cols; let s0 = 0, s1 = 0, s2 = 0, s3 = 0, c = 0;
        for (; c + 3 < cols; c += 4) { s0 += W[o + c] * x[c]; s1 += W[o + c + 1] * x[c + 1]; s2 += W[o + c + 2] * x[c + 2]; s3 += W[o + c + 3] * x[c + 3]; }
        for (; c < cols; c++) s0 += W[o + c] * x[c];
        out[r] = (b ? b[r] : 0) + s0 + s1 + s2 + s3;
      }
    }
    static gelu(v) { return 0.5 * v * (1 + Math.tanh(0.7978845608028654 * (v + 0.044715 * v * v * v))); }

    /* one token through the model; appends its K/V to `cache` (tag = story id); returns logits (Float32Array, reused) */
    forward(tokId, position, cache, tag) {
      const d = this.d, H = this.H, hd = this.hd, x = this.x, h = this.h, qkv = this.qkv, att = this.att, mlp = this.mlp, tmp = this.tmp;
      if (cache.n >= cache.cap) throw new Error("memory full");
      const to = tokId * d, po = position * d;
      for (let i = 0; i < d; i++) x[i] = this.tok[to + i] + this.pos[po + i];
      const scale = 1 / Math.sqrt(hd);
      for (let l = 0; l < this.L; l++) {
        const Ly = this.layers[l];
        TinyGPT.layerNorm(x, Ly.ln1w, Ly.ln1b, h);
        TinyGPT.matvec(Ly.qkvw, Ly.qkvb, h, qkv, 3 * d, d);
        const K = cache.K[l], Vv = cache.Vv[l], n = cache.n, ko = n * d;
        for (let i = 0; i < d; i++) { K[ko + i] = qkv[d + i]; Vv[ko + i] = qkv[2 * d + i]; }
        const total = n + 1, sc = this.scores;
        for (let hh = 0; hh < H; hh++) {
          const qo = hh * hd; let mx = -1e30;
          for (let e = 0; e < total; e++) {
            const eo = e * d + qo; let s = 0;
            for (let j = 0; j < hd; j++) s += qkv[qo + j] * K[eo + j];
            s *= scale; sc[e] = s; if (s > mx) mx = s;
          }
          let z = 0; for (let e = 0; e < total; e++) { const p = Math.exp(sc[e] - mx); sc[e] = p; z += p; }
          const inv = 1 / z;
          for (let j = 0; j < hd; j++) att[qo + j] = 0;
          for (let e = 0; e < total; e++) { const p = sc[e] * inv, eo = e * d + qo; for (let j = 0; j < hd; j++) att[qo + j] += p * Vv[eo + j]; }
        }
        TinyGPT.matvec(Ly.projw, Ly.projb, att, tmp, d, d);
        for (let i = 0; i < d; i++) x[i] += tmp[i];
        TinyGPT.layerNorm(x, Ly.ln2w, Ly.ln2b, h);
        TinyGPT.matvec(Ly.fcw, Ly.fcb, h, mlp, 4 * d, d);
        for (let i = 0; i < 4 * d; i++) mlp[i] = TinyGPT.gelu(mlp[i]);
        TinyGPT.matvec(Ly.proj2w, Ly.proj2b, mlp, tmp, d, 4 * d);
        for (let i = 0; i < d; i++) x[i] += tmp[i];
      }
      cache.tag[cache.n] = tag; cache.planted[cache.n] = 0; cache.n++;
      TinyGPT.layerNorm(x, this.lnfw, this.lnfb, h);
      TinyGPT.matvec(this.tok, null, h, this.logits, this.V, d);
      return this.logits;
    }

    /* memories of a phrase: run "<eos> phrase" on a fresh cache, then splice the phrase entries into the main cache */
    plant(ids, tag) {
      const c = this.newCache();
      this.forward(1, 0, c, -1);
      for (let i = 0; i < ids.length; i++) this.forward(ids[i], i + 1, c, -1);
      const d = this.d, m = this.cache;
      for (let e = 1; e < c.n; e++) {
        if (m.n >= m.cap) break;
        for (let l = 0; l < this.L; l++) { m.K[l].set(c.K[l].subarray(e * d, (e + 1) * d), m.n * d); m.Vv[l].set(c.Vv[l].subarray(e * d, (e + 1) * d), m.n * d); }
        m.tag[m.n] = tag; m.planted[m.n] = 1; m.n++;
      }
    }
    /* erase every cache entry with the given tag (a story word or a planted memory) */
    erase(tag) {
      const m = this.cache, d = this.d; let w = 0;
      for (let e = 0; e < m.n; e++) {
        if (m.tag[e] === tag) continue;
        if (w !== e) { for (let l = 0; l < this.L; l++) { m.K[l].copyWithin(w * d, e * d, (e + 1) * d); m.Vv[l].copyWithin(w * d, e * d, (e + 1) * d); } m.tag[w] = m.tag[e]; m.planted[w] = m.planted[e]; }
        w++;
      }
      m.n = w;
    }
    reset() { this.cache = this.newCache(); }

    sample(logits, temp, topk, rand) {
      const V = this.V, idx = new Int32Array(topk), val = new Float32Array(topk).fill(-Infinity);
      for (let i = 0; i < V; i++) {                        // partial top-k by insertion (k small)
        const v = logits[i]; if (v <= val[topk - 1]) continue;
        let j = topk - 1; while (j > 0 && val[j - 1] < v) { val[j] = val[j - 1]; idx[j] = idx[j - 1]; j--; }
        val[j] = v; idx[j] = i;
      }
      let mx = val[0], z = 0; const p = new Float32Array(topk);
      for (let j = 0; j < topk; j++) { p[j] = Math.exp((val[j] - mx) / temp); z += p[j]; }
      let r = rand() * z;
      for (let j = 0; j < topk; j++) { r -= p[j]; if (r <= 0) return idx[j]; }
      return idx[topk - 1];
    }
    encode(text) {
      const re = /[a-z]+(?:'[a-z]+)?|[.,!?;:"()-]|\n/g, out = []; let m;
      const t = text.toLowerCase();
      while ((m = re.exec(t)) !== null) out.push(this.wid.has(m[0]) ? this.wid.get(m[0]) : 2);
      return out;
    }
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { TinyGPT };
  else global.TinyGPT = TinyGPT;
})(typeof window !== "undefined" ? window : globalThis);

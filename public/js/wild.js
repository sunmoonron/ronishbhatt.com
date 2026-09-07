// wild.js: the same page, but you can see the machinery. Ciphertext rain
// (the real veiled bytes, as a relay sees them), a boot terminal that types
// the actual protocol exchange, every block descrambling from its own
// ciphertext, hover to re-veil, the relays orbiting the key, and a HUD that
// counts hashes while a message mines. Per-browser toggle, off by default,
// nothing published: the "wild" pill turns it on, "calm" turns it off.
const P = ['#0b1a12', '#10261a', '#153223', '#1a3f2c', '#1f4c35', '#255a3f', '#2b6849', '#327754', '#3a865f', '#43956b', '#4ea477', '#5ab384', '#68c291', '#79d09f', '#8dddae', '#a4e9bf'];
const CSS = `html.wild body{background:#050806;color:#d8f3e3}html.wild #rain{position:fixed;inset:0;z-index:0;opacity:.5;pointer-events:none}
html.wild main{position:relative;z-index:1}html.wild header.me{background:linear-gradient(135deg,rgba(11,26,18,.88),rgba(5,8,6,.92));border-color:#3a865f;box-shadow:0 0 40px rgba(125,211,168,.25),inset 0 0 60px rgba(125,211,168,.06)}
html.wild header.me img{box-shadow:0 0 30px #7dd3a8;animation:halo 3s ease-in-out infinite}@keyframes halo{50%{box-shadow:0 0 60px #a4e9bf,0 0 120px rgba(125,211,168,.4)}}
html.wild h1,html.wild .label,html.wild details.fold>summary{font-family:var(--mono)}html.wild h1{text-shadow:0 0 14px rgba(125,211,168,.8)}html.wild .label{color:#a4e9bf;text-shadow:0 0 8px rgba(125,211,168,.6)}
html.wild section.c{padding:1rem;border:1px solid rgba(125,211,168,.35);border-radius:14px}html.wild section.c,html.wild details.fold,html.wild .chat,html.wild .item{background:rgba(8,14,10,.8);border-color:rgba(125,211,168,.35);box-shadow:0 0 24px rgba(125,211,168,.12)}
html.wild .item{transform:perspective(900px) rotateX(2deg)}html.wild .item:hover{transform:perspective(900px) rotateX(0) translateY(-4px) scale(1.01)}html.wild .courses li,html.wild .word{font-family:var(--mono)}
html.wild body::after{content:"";position:fixed;inset:0;z-index:2;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.14) 0 2px,transparent 2px 4px)}
html.wild .veil{color:#43956b!important;text-shadow:none!important}
.term{position:fixed;inset:0;z-index:60;background:rgba(3,6,4,.95);color:#a4e9bf;font:13px/1.55 var(--mono);padding:2rem;overflow:hidden;transition:inset .6s ease,padding .6s ease,font-size .6s ease;cursor:pointer}
.term.min{inset:auto 1rem 1rem auto;width:min(27rem,92vw);max-height:8.5rem;padding:.55rem .8rem;background:rgba(3,6,4,.88);border:1px solid rgba(125,211,168,.35);border-radius:10px;overflow:auto;font-size:11px;cursor:default}
.term .l{white-space:pre-wrap;word-break:break-all}.term .ok{color:#7dd3a8}.term .dim{color:#43956b}.term .cur{display:inline-block;width:.6em;height:1em;background:#a4e9bf;vertical-align:-2px;animation:blink 1s steps(2) infinite}@keyframes blink{50%{opacity:0}}
.term .bar{display:flex;gap:.5rem;justify-content:flex-end;margin-top:.35rem}.term button{font:11px var(--mono);padding:.15rem .5rem;background:rgba(125,211,168,.12);border:1px solid rgba(125,211,168,.35);color:#a4e9bf;border-radius:6px}
.hud{position:fixed;left:1rem;bottom:1rem;z-index:61;font:12px var(--mono);color:#a4e9bf;background:rgba(3,6,4,.88);border:1px solid rgba(125,211,168,.35);border-radius:10px;padding:.5rem .8rem;display:none;max-width:16rem}.hud.on{display:block}.hud canvas{display:block;width:100%;height:auto;margin-bottom:.35rem}
@media (prefers-reduced-motion:reduce){html.wild *{animation:none!important;transition:none!important}html.wild #rain{display:none}}`;

let cipher = '', ctx = null, soundOn = false, events = [];
const $ = s => document.querySelector(s), sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = n => Math.floor(Math.random() * n);
const blip = f => { if (!soundOn || !ctx) return; const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.value = .05; o.connect(g); g.connect(ctx.destination); o.start(); g.gain.exponentialRampToValueAtTime(.0005, ctx.currentTime + .14); o.stop(ctx.currentTime + .15); };

export async function start() {
  const html = document.documentElement; html.classList.add('wild');
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const pill = $('#wildpill'); if (pill) pill.textContent = 'calm';
  const snap = await fetch('/site.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => null);
  events = (snap?.events || []).filter(e => e.kind === 30078);
  cipher = events.map(e => e.content).join('') || 'QWxs';
  rain(); orbit(); hud();
  await terminal();
  await descramble(document.querySelectorAll('main > header, main > section, main > details'), 900, 110);
  document.addEventListener('pointerenter', e => { const b = e.target.closest?.('main > section, main > details, .item'); if (b && !b.dataset.glitching) { b.dataset.glitching = '1'; descramble([b], 260, 0).then(() => delete b.dataset.glitching); } }, true);
}

// ---- rain: the relay's view of this site, falling ----
function rain() {
  const c = document.createElement('canvas'); c.id = 'rain'; document.body.prepend(c);
  const g = c.getContext('2d'); let cols = [], w = 0, h = 0, last = 0;
  const size = () => { w = c.width = innerWidth; h = c.height = innerHeight; cols = Array.from({ length: Math.ceil(w / 16) }, () => rnd(h / 16)); };
  size(); addEventListener('resize', size);
  const tick = t => { requestAnimationFrame(tick); if (document.hidden || t - last < 50) return; last = t;
    g.fillStyle = 'rgba(5,8,6,.18)'; g.fillRect(0, 0, w, h); g.font = '14px ui-monospace,Menlo,monospace';
    cols.forEach((y, i) => { g.fillStyle = P[8 + rnd(8)]; g.fillText(cipher[rnd(cipher.length)], i * 16, y * 16); cols[i] = y * 16 > h && Math.random() > .975 ? 0 : y + 1; }); };
  requestAnimationFrame(tick);
}

// ---- terminal: what actually happened to build this page ----
async function terminal() {
  const t = document.createElement('div'); t.className = 'term'; document.body.append(t);
  const out = document.createElement('div'); t.append(out);
  const bar = document.createElement('div'); bar.className = 'bar';
  const snd = document.createElement('button'); snd.textContent = 'sound'; snd.onclick = e => { e.stopPropagation(); soundOn = !soundOn; if (soundOn && !ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); snd.textContent = soundOn ? 'mute' : 'sound'; blip(660); };
  const calm = document.createElement('button'); calm.textContent = 'calm'; calm.onclick = e => { e.stopPropagation(); localStorage.removeItem('rb.wild'); location.href = location.pathname; };
  bar.append(snd, calm); t.append(bar);
  let skip = false; t.addEventListener('click', () => { skip = true; }, { once: true });
  const line = async (text, cls = '') => { const l = document.createElement('div'); l.className = 'l ' + cls; out.append(l); const cur = document.createElement('span'); cur.className = 'cur';
    if (skip) { l.textContent = text; return; } l.append(cur); for (let i = 0; i < text.length; i += 3) { l.firstChild ? l.insertBefore(document.createTextNode(text.slice(i, i + 3)), cur) : l.append(text.slice(i, i + 3)); await sleep(skip ? 0 : 9); } cur.remove(); if (t.scrollHeight > t.clientHeight) t.scrollTop = t.scrollHeight; };
  const relay = document.querySelector('meta[name="site-relay"]')?.content || 'wss://relay', site = document.querySelector('meta[name="site-pubkey"]')?.content || '';
  await line(`> ${relay} … open`, 'ok'); await line(`> REQ authors=${site.slice(0, 12)}… kinds=30078`); 
  for (const e of events) { await line(`> ← EVENT ${e.id.slice(0, 12)}… ${e.content.length} B, veiled`, 'dim'); blip(220 + parseInt(e.id.slice(8, 10), 16) * 3); }
  await line(`> schnorr verify ×${events.length} … ok`, 'ok');
  await line(`> key: reading favicon.svg … 64 squares, 32 bytes`, 'ok');
  await line(`> unveil ×${events.length} … ok`, 'ok'); await line('> render', 'ok'); blip(880);
  await sleep(skip ? 0 : 400); t.classList.add('min'); t.style.cursor = 'default';
}

// ---- descramble: from the relay's bytes to the words ----
function textNodes(root) { const out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeValue.trim() && !n.parentElement.closest('svg, form, input, textarea, button, style, script, .keys') ? 1 : 2 }); let n; while ((n = w.nextNode())) out.push(n); return out; }
function descramble(blocks, ms, stagger) {
  const jobs = [...blocks].map((b, i) => ({ nodes: textNodes(b).map(n => ({ n, text: n.nodeValue })), at: performance.now() + i * stagger }));
  return new Promise(res => { const step = () => { const now = performance.now(); let busy = false;
    for (const j of jobs) { const p = Math.min(1, Math.max(0, (now - j.at) / ms)); if (p < 1) busy = true;
      for (const { n, text } of j.nodes) { const k = Math.floor(text.length * p); let s = text.slice(0, k); for (let i = k; i < text.length; i++) s += text[i] === ' ' ? ' ' : cipher[rnd(cipher.length)]; n.nodeValue = s; n.parentElement?.classList.toggle('veil', p < 1); } }
    if (busy) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
}

// ---- orbit: the relays around the key ----
async function orbit() {
  const box = document.createElement('div'); box.className = 'hud on'; box.id = 'orbit'; box.style.left = '1rem'; box.style.bottom = '1rem'; document.body.append(box);
  const c = document.createElement('canvas'); c.width = 240; c.height = 150; box.append(c); const g = c.getContext('2d');
  const svg = await fetch(document.querySelector('link[rel="icon"][type="image/svg+xml"]')?.getAttribute('href') || '/favicon.svg').then(r => r.text()).catch(() => '');
  const cells = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map(m => m[1]).filter(f => P.includes(f.toLowerCase()));
  const relays = [...document.querySelectorAll('footer [data-relay]')].map(el => ({ el, name: el.dataset.relay.replace(/^wss?:\/\//, '').replace(/\..*/, '') }));
  let t0 = performance.now();
  const draw = now => { requestAnimationFrame(draw); if (document.hidden) return; const t = (now - t0) / 1000; g.clearRect(0, 0, 240, 150);
    const cx = 120, cy = 75; cells.forEach((f, i) => { g.fillStyle = f; g.fillRect(cx - 12 + (i % 8) * 3, cy - 12 + Math.floor(i / 8) * 3, 2.5, 2.5); });
    relays.forEach((r, i) => { const open = r.el.querySelector('.dot')?.classList.contains('open'), a = t * (0.25 + i * 0.07) + i * 1.6, R = 42 + i * 14, x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R * 0.55;
      g.strokeStyle = open ? 'rgba(125,211,168,.35)' : 'rgba(229,72,77,.35)'; g.beginPath(); g.ellipse(cx, cy, R, R * 0.55, 0, 0, Math.PI * 2); g.stroke();
      if (open) { const q = (t * 0.8 + i * 0.3) % 1, px = cx + (x - cx) * q, py = cy + (y - cy) * q; g.fillStyle = '#a4e9bf'; g.beginPath(); g.arc(px, py, 1.5, 0, 7); g.fill(); }
      g.fillStyle = open ? '#7dd3a8' : '#e5484d'; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); g.fillStyle = '#a4e9bf'; g.font = '9px ui-monospace,Menlo,monospace'; g.fillText(r.name, x + 6, y + 3); }); };
  requestAnimationFrame(draw);
}

// ---- HUD: the work behind a message ----
function hud() {
  const h = document.createElement('div'); h.className = 'hud'; h.style.left = '1rem'; h.style.bottom = '11.5rem'; document.body.append(h);
  document.addEventListener('pow', e => { const d = e.detail; h.classList.add('on');
    h.textContent = d.done ? `sealed: ${d.hashes.toLocaleString()} hashes for ${d.bits} bits` : `mining… ${d.hashes.toLocaleString()} hashes, best ${d.best}/${d.bits} bits`;
    if (d.done) { blip(1320); setTimeout(() => h.classList.remove('on'), 6000); } });
}

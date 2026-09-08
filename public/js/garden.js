// garden.js: "Bip reads the room". Anyone can plant one word through the
// relay's word door (kind 1, tag t=plant, 18 bits of work, 24 characters).
// "Tell it" loads the 7M-parameter model from Plant a Thought into your
// browser, plants the last forty words as memories, and writes a story:
// different in every browser, from the same shared garden.
import { useState, useEffect } from 'preact/hooks';
import { env, recentWords, subscribeWords, applyWord, mine, publish, now, WORD } from './store.js';
import { html, toast, fmtDate } from './ui.js';
import { ensureVisitorKey } from './chat.js';

export const PLANT_POW = 18; // must match the relay's word door
let engine = null, loading = null;
const script = src => new Promise((ok, err) => { const s = document.createElement('script'); s.src = src; if (env.SRI[src]) s.integrity = env.SRI[src]; s.onload = ok; s.onerror = err; document.head.append(s); });
async function loadBip(say) {
  if (engine) return engine;
  return loading ||= (async () => {
    say('fetching the robot, 9 MB…');
    const [model] = await Promise.all([fetch(env.ASSETS.model).then(r => r.json()), script(env.ASSETS.engine)]);
    say('waking it up…'); engine = new globalThis.TinyGPT(model); return engine;
  })();
}
export async function plant(word) {
  word = word.trim(); if (!WORD.test(word)) throw new Error('one word, letters or digits, 24 characters at most');
  const sk = ensureVisitorKey();
  const ev = env.NT.finalizeEvent(await mine({ kind: 1, pubkey: env.NT.getPublicKey(sk), created_at: now(), tags: [['t', 'plant']], content: word }, PLANT_POW), sk);
  const res = await publish(ev, [env.PRIMARY]);
  if (!res[0]?.ok) throw new Error(res[0]?.msg || 'the door said no');
  applyWord(ev);
}
const PUNCT = new Set(['.', ',', '!', '?', ';', ':', '"', '(', ')', '-', '\n']);
export async function tell(words, onStory, say) {
  const eng = await loadBip(say);
  eng.reset(); eng.forward(1, 0, eng.cache, 0);
  const planted = []; let tag = 1000;
  for (const w of words) { const ids = eng.encode(w.toLowerCase()); if (!ids.length || ids.includes(2)) continue; for (let k = 0; k < 3; k++) eng.plant(ids, tag++); planted.push(w.toLowerCase()); } // three copies each: one is easy for the model to ignore
  say(planted.length ? `Bip remembers ${planted.length} of the ${words.length} words` : 'Bip knows none of these words yet, so it just talks');
  let seed = Date.now() % 1e6; const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const story = []; let prev = 1, pos = 1;
  for (let n = 0; n < 70; n++) {
    const logits = eng.forward(prev, Math.min(pos, eng.ctx - 1), eng.cache, pos);
    for (const id of story.slice(-10).map(w => w.id)) if (!PUNCT.has(eng.vocab[id])) logits[id] -= 1.2;
    const id = eng.sample(logits, 0.85, 40, rand); if (id === 1) break;
    const text = eng.vocab[id] === '<unk>' ? '…' : eng.vocab[id];
    story.push({ id, text, mem: planted.includes(text) || planted.includes(text.replace(/s$/, '')) }); prev = id; pos++;
    onStory(story); await new Promise(r => setTimeout(r, 80));
  }
  return story;
}
// The story as text: sentence starts capitalised, no space before punctuation, planted words marked.
const Story = ({ story }) => { let cap = true, out = [];
  for (const w of story) { if (w.text === '\n') continue; let piece = w.text; if (cap && /^[a-z]/.test(piece)) { piece = piece[0].toUpperCase() + piece.slice(1); cap = false; } if (/^[.!?]$/.test(w.text)) cap = true;
    const space = (/^[.,!?;:)]$/.test(w.text) || !out.length) ? '' : ' '; out.push(space, w.mem ? html`<b class="mem">${piece}</b>` : piece); }
  return html`<p class="story">${out}</p>`; };

export function Garden({ live }) {
  const [word, setWord] = useState(''), [busy, setBusy] = useState(''), [story, setStory] = useState(null), [status, setStatus] = useState('');
  useEffect(() => { if (live) subscribeWords(); }, [live]);
  const words = recentWords(40).reverse(); // oldest first, so the row reads left to right the way it was planted
  const doPlant = async e => { e.preventDefault(); if (!live) return; setBusy('planting, 18 bits of work…'); try { await plant(word); setWord(''); toast('planted; Bip will remember it'); } catch (x) { toast(x.message, 'err'); } finally { setBusy(''); } };
  const doTell = async () => { if (!live || busy) return; setBusy('telling…'); setStory([]); try { await tell(words.map(w => w.word), s => setStory([...s]), setStatus); } catch (x) { toast('Bip stumbled: ' + x.message, 'err'); } finally { setBusy(''); } };
  return html`<div class="garden">
    <div class="words">${words.length ? words.map(w => html`<span key=${w.id} class="word" title=${fmtDate(w.created_at)}>${w.word}</span>`) : html`<span class="empty">nothing planted yet</span>`}</div>
    <form class="plantform" onSubmit=${doPlant}><input value=${word} maxlength="24" placeholder="plant one word" onInput=${e => setWord(e.target.value)} disabled=${!!busy} /><button class="pri" type="submit" disabled=${!!busy || !word.trim()}>plant</button><button type="button" onClick=${doTell} disabled=${!!busy || !words.length}>${busy || 'tell it'}</button></form>
    ${status ? html`<p class="legend">${status}</p>` : null}
    ${story ? html`<${Story} story=${story} />` : null}
    <p class="legend">One word per message, eighteen bits of work at the door, stored on my relay only. "Tell it" loads a 7-million-parameter model into your browser and writes a story around the last forty words; every browser gets a different one.</p>
  </div>`;
}

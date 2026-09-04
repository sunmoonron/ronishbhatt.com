// owner.js, loaded only after "unlock": in-place editing of every block (the
// stylesheet included), drafts, deletions, and the console (/dash.html, same key).
import { useState, useEffect, useRef } from 'preact/hooks';
import { env, K, DEFAULT_CFG, store, sel, apply, publish, sign, unlock, lock, now, h, veil, meta, text, dTag, addrOf, keyOf, notify } from './store.js';
import { html, toast, npub } from './ui.js';

const CSS = `.ownerbar{grid-column:1/-1;position:sticky;top:0;z-index:5;display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin:-1.5rem -1.25rem 1.5rem;padding:.55rem 1.25rem;background:var(--card);border-bottom:1px solid var(--accent);font-size:.78rem;color:var(--mute)}.ownerbar .grow{flex:1}.ownerbar code{font:.78rem var(--mono);color:var(--fg)}
.edit{position:absolute;right:0;top:0}.label .edit,summary .edit,.meta .edit{position:static}#chat.owner{grid-column:1/-1;grid-row:auto;position:static}
.panel{position:fixed;top:0;right:0;bottom:0;width:min(34rem,100%);background:var(--card);border-left:1px solid var(--line);z-index:20;overflow:auto;padding:1.25rem;box-shadow:-20px 0 60px rgba(0,0,0,.35)}.panel h2{margin:0 0 .25rem;font-size:1.05rem}.panel .sub{font-size:.78rem;color:var(--mute);margin:0}
label.f{display:block;font-size:.72rem;color:var(--mute);margin:.75rem 0 .25rem;letter-spacing:.04em}textarea.big{min-height:16rem;font-family:var(--mono);font-size:.8rem}.err{color:var(--err);font-size:.8rem}
.console{position:fixed;inset:0;z-index:30;background:var(--bg);display:flex;flex-direction:column}.console iframe{flex:1;border:0;width:100%;background:#0b0c0f}.console .bar{display:flex;gap:.6rem;align-items:center;padding:.45rem .8rem;border-bottom:1px solid var(--line);font-size:.78rem;color:var(--mute)}
dialog{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:12px;padding:1.25rem;max-width:26rem;width:calc(100% - 2rem)}dialog::backdrop{background:rgba(0,0,0,.55)}dialog h2{margin:0 0 .4rem;font-size:1.05rem}dialog p{font-size:.85rem;color:var(--mute);margin:0 0 .5rem}
.inbox{display:grid;grid-template-columns:15rem minmax(0,1fr);min-height:24rem}.inbox .threads{display:flex;flex-direction:column;border-right:1px solid var(--line);overflow:auto;max-height:34rem}
.thread{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.1rem .5rem;text-align:left;border:0;border-bottom:1px solid var(--line);border-radius:0;background:none;padding:.65rem .8rem;line-height:1.3}.thread:hover{background:color-mix(in srgb,var(--accent) 6%,transparent)}.thread.on{background:color-mix(in srgb,var(--accent) 12%,transparent)}
.thread b{font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.thread time{font-size:.66rem;color:var(--mute)}.thread small{grid-column:1/-1;font-size:.74rem;color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.thread .badge{grid-column:2;justify-self:end}
.inbox .conv{display:flex;flex-direction:column;min-width:0}.inbox .conv .who{gap:.6rem}.inbox .conv .who code{font:.72rem var(--mono)}.inbox .conv .log{flex:1;max-height:28rem}.inbox .empty{padding:1rem}
@media (max-width:700px){.inbox{grid-template-columns:1fr}.inbox .threads{border-right:0;border-bottom:1px solid var(--line);max-height:11rem}}
@media (max-width:900px){.ownerbar{order:-4}}@media (max-width:600px){.ownerbar{margin:-1rem -1rem 1.5rem;padding:.5rem 1rem}}`;
if (typeof document !== 'undefined' && !document.getElementById('owner-css')) { const s = document.createElement('style'); s.id = 'owner-css'; s.textContent = CSS; document.head.append(s); }

// Where publishes go: the personal relay only, or the backups too. Deletions always go everywhere.
export const targets = () => localStorage.getItem('rb.targets') === 'mine' ? [env.PRIMARY] : env.RELAYS;
export async function publishTemplate(tmpl, relays = targets()) {
  const ev = sign(tmpl); apply(ev, { verified: true });
  const res = await publish(ev, relays), ok = res.filter(r => r.ok).length, mine = res.find(r => r.url === env.PRIMARY);
  toast(ok ? `published to ${ok}/${res.length} relays${mine?.ok ? ' (incl. mine)' : ', NOT on my relay: ' + mine?.msg}` : 'no relay accepted it: ' + res.map(r => r.msg).join('; '), ok ? '' : 'err');
  return { ev, res };
}

const SCHEMAS = {
  0: [['name', 'Name'], ['about', 'About, one line'], ['picture', 'Picture URL'], ['nip05', 'NIP-05 (e.g. _@ronishbhatt.com)'], ['website', 'Website']],
  layout: [['title', 'Site title'], ['sections', 'Sections in order, comma separated (chat, projects, writing, notes, or any block slug)'], ['links', 'Header pills, one per line: label | url'], ['chat', 'Chat enabled (yes / no)']],
  css: [['content', 'Stylesheet, the whole page\'s CSS']],
  block: [['slug', 'Slug, fixed once published'], ['type', 'Type: section / project / writing'], ['display', 'Display: normal, or details (folded; the summary is the visible line)'], ['title', 'Title'], ['summary', 'One-line summary'], ['r', 'Link'], ['image', 'Image URL'], ['order', 'Order, lower first'], ['body', 'Body, Markdown']],
  1: [['content', 'Note, Markdown']],
};
const BIG = new Set(['body', 'content', 'links', 'about']);
// Blocks, the layout and the stylesheet are all kind 30078; the form is picked by slug.
const formOf = (kind, ev, preset) => kind === 'block' || kind === K.block ? ({ layout: 'layout', css: 'css' }[preset?.slug || meta(ev)?.slug || slugOf(ev)] || 'block') : kind;
const slugOf = ev => ev ? (dTag(ev) === h('layout') ? 'layout' : dTag(ev) === h('css') ? 'css' : meta(ev)?.slug) : undefined;

function toFields(kind, ev, preset = {}) {
  const f = formOf(kind, ev, preset);
  if (f === 0) { try { return { ...JSON.parse(ev?.content || '{}') }; } catch { return {}; } }
  if (f === 'layout') { const c = sel.config(); return { title: c.title, sections: (c.sections || []).join(', '), links: (c.links || []).map(l => `${l.label} | ${l.url}`).join('\n'), chat: c.chat === false ? 'no' : 'yes' }; }
  if (f === 'css') return { content: ev ? text(ev) : '' };
  if (f === 'block') { const m = ev ? meta(ev) || {} : {}; return { slug: m.slug || preset.slug || '', type: m.type || preset.type || 'section', display: m.display || '', title: m.title || preset.title || '', summary: m.summary || '', r: m.r || '', image: m.image || '', order: m.order || '', body: m.body || '' }; }
  return { content: ev ? text(ev) : '' };
}
// A veiled event: hashed d, NIP-44 body under the page secret, nothing else in the tags.
const veiled = (slug, plain) => ({ kind: K.block, tags: [['d', h(slug)], ['veil', 'nip44']], content: veil(plain) });
function toTemplate(kind, f, ev, preset = {}) {
  const form = formOf(kind, ev, preset);
  if (form === 0) { const o = {}; for (const k of ['name', 'about', 'picture', 'nip05', 'website']) if (f[k]?.trim()) o[k] = f[k].trim(); return { kind: 0, content: JSON.stringify(o) }; }
  if (form === 'layout') return veiled('layout', JSON.stringify({ title: f.title?.trim() || DEFAULT_CFG.title, sections: f.sections.split(',').map(s => s.trim().toLowerCase()).filter(Boolean), chat: !/^n/i.test(f.chat || 'yes'),
    links: f.links.split('\n').map(l => l.split('|').map(s => s.trim())).filter(p => p[0] && p[1]).map(([label, url]) => ({ label, url })) }));
  if (form === 'css') return veiled('css', f.content || '');
  if (form === 'block') {
    const slug = (f.slug || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, ''); if (!slug) throw new Error('a slug is required');
    if (slug === 'layout' || slug === 'css') throw new Error('that slug is reserved');
    const m = { slug, type: (f.type || 'section').trim().toLowerCase(), title: f.title?.trim() || slug, published_at: meta(ev)?.published_at || now(), body: f.body || '' };
    for (const k of ['summary', 'r', 'image', 'order', 'display']) if (f[k]?.trim()) m[k] = f[k].trim();
    return veiled(slug, JSON.stringify(m));
  }
  if (!f.content?.trim()) throw new Error('empty note'); return { kind: K.note, content: f.content.trim() };
}
export async function deleteEvent(ev) {
  const tags = [['k', String(ev.kind)]]; if (!ev.draft) tags.push(['e', ev.id]); if (ev.kind >= 30000) tags.push(['a', addrOf(ev)]);
  await publishTemplate({ kind: K.del, tags, content: 'removed from ronishbhatt.com' }, env.RELAYS); // apply() drops the event and restores its draft, if any
  if (ev.draft) { store.events.delete(keyOf(ev)); notify(); }
}
// Recall: one deletion event naming every signed event of the site key, sent to every relay.
// Relays that honour NIP-09 (mine does, the big public ones do) drop them; the page falls back to its baked drafts.
export async function recallAll() {
  const evs = [...store.events.values()].filter(e => !e.draft && e.kind !== K.del);
  if (!evs.length) return toast('nothing signed to recall');
  const tags = [];
  for (const e of evs) { tags.push(['e', e.id]); if (e.kind >= 30000) tags.push(['a', addrOf(e)]); tags.push(['k', String(e.kind)]); }
  const { res } = await publishTemplate({ kind: K.del, tags, content: 'recalled from ronishbhatt.com' }, env.RELAYS); // apply() drops them and the seed drafts take over
  notify(); toast(`recalled ${evs.length} events; accepted by ${res.filter(r => r.ok).length}/${res.length} relays`);
}
export async function publishDrafts() {
  const drafts = sel.drafts(); let n = 0;
  for (const d of drafts) { const tmpl = d.kind === K.block ? { kind: K.block, tags: [['d', dTag(d)], ['veil', 'nip44']], content: veil(text(d)) } : { kind: d.kind, tags: d.tags || [], content: text(d) }; const { res } = await publishTemplate(tmpl); if (res.some(r => r.ok)) n++; }
  toast(`${n}/${drafts.length} drafts published`);
}

export function OwnerBar({ onEdit, onConsole, unread }) {
  const drafts = sel.drafts().length, [busy, setBusy] = useState(false);
  return html`<div class="ownerbar"><span>unlocked · <code>${npub(env.SITE).slice(0, 16)}…</code></span>
    ${drafts ? html`<button class="sm pri" disabled=${busy} onClick=${async () => { setBusy(true); try { await publishDrafts(); } finally { setBusy(false); } }}>${busy ? html`<span class="spin"></span>` : null}publish ${drafts} draft${drafts > 1 ? 's' : ''}</button>` : null}
    <button class="sm" onClick=${() => onEdit('block', sel.layoutEvent(), { slug: 'layout' })}>layout</button>
    <button class="sm" onClick=${() => onEdit('block', sel.cssEvent(), { slug: 'css' })}>stylesheet</button>
    <button class="sm" onClick=${() => onEdit('block', null, { type: 'section' })}>+ block</button>
    <button class="sm" onClick=${() => onEdit(K.note, null)}>+ note</button>
    <button class="sm" onClick=${() => document.getElementById('chat')?.scrollIntoView({ behavior: 'smooth' })}>inbox${unread ? html`<span class="badge">${unread}</span>` : null}</button>
    <span class="grow"></span>
    <button class="sm" title="where publishes go; deletions always go to every relay" onClick=${() => { localStorage.setItem('rb.targets', targets().length === 1 ? 'all' : 'mine'); notify(); }}>publish to: ${targets().length === 1 ? 'my relay only' : 'all relays'}</button>
    <button class="sm danger" onClick=${async () => { if (confirm('Send one deletion for every signed event of this key to every relay? The page keeps working from its baked drafts.')) await recallAll(); }}>recall all</button>
    <button class="sm" onClick=${onConsole}>console</button><button class="sm" onClick=${() => { lock(); location.reload(); }}>lock</button></div>`;
}
export function UnlockDialog({ open, onClose }) {
  const ref = useRef(), [err, setErr] = useState('');
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  const go = e => { e.preventDefault(); setErr(''); try { unlock(e.target.nsec.value, e.target.remember.checked); e.target.reset(); onClose(); toast('unlocked, every block is editable now'); } catch (x) { setErr(x.message); } };
  return html`<dialog ref=${ref} onClose=${onClose}><h2>unlock</h2><p>The site key signs every block on this page, receives the chat, and opens the console. It never leaves this browser.</p>
    <form onSubmit=${go} method="dialog"><input name="nsec" type="password" placeholder="nsec1…" autocomplete="off" />
      <label class="f" style="display:flex;gap:.4rem;align-items:center;text-transform:none;letter-spacing:0"><input name="remember" type="checkbox" style="width:auto" /> keep the key in this browser</label>
      ${err ? html`<div class="err">${err}</div>` : null}
      <div class="row"><button class="pri" type="submit">unlock</button><button type="button" onClick=${onClose}>cancel</button></div></form></dialog>`;
}
export function Editor({ target, onClose }) {
  const { kind, ev, preset } = target, form = formOf(kind, ev, preset);
  const [f, setF] = useState(() => toFields(kind, ev, preset)), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = async () => { setErr(''); setBusy(true); try { await publishTemplate(toTemplate(kind, f, ev, preset)); onClose(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  const del = async () => { if (!ev || !confirm('Delete this from the relays? (a kind-5 deletion is published)')) return; setBusy(true); try { await deleteEvent(ev); onClose(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  const title = { 0: 'header (kind 0, plain)', layout: 'layout (veiled)', css: 'stylesheet (veiled)', block: `${f.type || 'section'} (veiled block)`, 1: 'note (kind 1, plain)' }[form];
  return html`<div class="panel"><h2>${ev ? 'edit' : 'new'} ${title}</h2>
    <p class="sub">${ev && !ev.draft ? `replaces the version signed ${new Date(ev.created_at * 1000).toLocaleString()}` : 'not on the relay yet'}</p>
    ${SCHEMAS[form].map(([k, label]) => html`<label class="f" key=${k}>${label}</label>${BIG.has(k) ? html`<textarea class=${k === 'content' ? 'big' : ''} value=${f[k] || ''} onInput=${e => set(k, e.target.value)} />` : html`<input value=${f[k] || ''} disabled=${k === 'slug' && ev && !ev.draft} onInput=${e => set(k, e.target.value)} />`}`)}
    ${err ? html`<div class="err" style="margin-top:.5rem">${err}</div>` : null}
    <div class="row"><button class="pri" disabled=${busy} onClick=${save}>${busy ? html`<span class="spin"></span>` : null}publish to ${env.RELAYS.length} relays</button><button disabled=${busy} onClick=${onClose}>cancel</button><span class="grow"></span>${ev ? html`<button class="danger" disabled=${busy} onClick=${del}>delete</button>` : null}</div></div>`;
}
export const Console = ({ onClose }) => html`<div class="console"><div class="bar"><span>console · <code>/dash.html</code> · same key, same box</span><span class="grow"></span><button class="sm" onClick=${onClose}>close</button></div><iframe src="/dash.html" title="dell7920 console"></iframe></div>`;

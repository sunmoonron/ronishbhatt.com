// owner.js, loaded only after "unlock": in-place editing of every block (the
// stylesheet included), drafts, deletions, and the console (/dash.html, same key).
import { useState, useEffect, useRef } from 'preact/hooks';
import { env, K, TAG, CONFIG_D, CSS_D, DEFAULT_CFG, store, sel, apply, publish, sign, unlock, lock, now, tag, tagsOf, dTag, addrOf, keyOf, notify } from './store.js';
import { html, toast, npub } from './ui.js';

const CSS = `.ownerbar{position:sticky;top:0;z-index:5;display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin:-2.5rem -1.25rem 2.5rem;padding:.55rem 1.25rem;background:var(--card);border-bottom:1px solid var(--accent);font-size:.78rem;color:var(--mute)}.ownerbar .grow{flex:1}.ownerbar code{font:.78rem var(--mono);color:var(--fg)}
.edit{position:absolute;right:0;top:0}.label .edit{position:static}
.panel{position:fixed;top:0;right:0;bottom:0;width:min(34rem,100%);background:var(--card);border-left:1px solid var(--line);z-index:20;overflow:auto;padding:1.25rem;box-shadow:-20px 0 60px rgba(0,0,0,.35)}.panel h2{margin:0 0 .25rem;font-size:1.05rem}.panel .sub{font-size:.78rem;color:var(--mute);margin:0}
label.f{display:block;font-size:.72rem;color:var(--mute);margin:.75rem 0 .25rem;letter-spacing:.04em}textarea.big{min-height:16rem;font-family:var(--mono);font-size:.8rem}.err{color:var(--err);font-size:.8rem}
.console{position:fixed;inset:0;z-index:30;background:var(--bg);display:flex;flex-direction:column}.console iframe{flex:1;border:0;width:100%;background:#0b0c0f}.console .bar{display:flex;gap:.6rem;align-items:center;padding:.45rem .8rem;border-bottom:1px solid var(--line);font-size:.78rem;color:var(--mute)}
dialog{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:12px;padding:1.25rem;max-width:26rem;width:calc(100% - 2rem)}dialog::backdrop{background:rgba(0,0,0,.55)}dialog h2{margin:0 0 .4rem;font-size:1.05rem}dialog p{font-size:.85rem;color:var(--mute);margin:0 0 .5rem}
@media (max-width:600px){.ownerbar{margin:-1rem -1rem 1.5rem;padding:.5rem 1rem}}`;
if (typeof document !== 'undefined' && !document.getElementById('owner-css')) { const s = document.createElement('style'); s.id = 'owner-css'; s.textContent = CSS; document.head.append(s); }

export async function publishTemplate(tmpl, relays = env.RELAYS) {
  const ev = sign(tmpl); apply(ev, { verified: true });
  const res = await publish(ev, relays), ok = res.filter(r => r.ok).length, mine = res.find(r => r.url === env.PRIMARY);
  toast(ok ? `published to ${ok}/${res.length} relays${mine?.ok ? ' (incl. mine)' : ', NOT on my relay: ' + mine?.msg}` : 'no relay accepted it: ' + res.map(r => r.msg).join('; '), ok ? '' : 'err');
  return { ev, res };
}

const SCHEMAS = {
  0: [['name', 'Name'], ['about', 'About, one line'], ['picture', 'Picture URL'], ['nip05', 'NIP-05 (e.g. _@ronishbhatt.com)'], ['website', 'Website']],
  layout: [['title', 'Site title'], ['sections', 'Sections in order, comma separated (chat, about, now, projects, writing, notes, or any block slug)'], ['links', 'Footer links, one per line: label | url'], ['chat', 'Chat enabled (yes / no)']],
  css: [['content', 'Stylesheet, the whole page\'s CSS']],
  30023: [['d', 'Slug, fixed once published'], ['type', 'Type: section / project / writing'], ['title', 'Title'], ['summary', 'One-line summary'], ['r', 'Link'], ['image', 'Image URL'], ['order', 'Order, lower first'], ['content', 'Body, Markdown']],
  1: [['content', 'Note, Markdown']],
};
const BIG = new Set(['content', 'links', 'about']);
const formOf = (kind, ev, preset) => kind === K.config ? ((dTag(ev) || preset?.d) === CSS_D ? 'css' : 'layout') : kind;

function toFields(kind, ev, preset = {}) {
  const f = formOf(kind, ev, preset);
  if (f === 0) { try { return { ...JSON.parse(ev?.content || '{}') }; } catch { return {}; } }
  if (f === 'layout') { const c = sel.config(); return { title: c.title, sections: (c.sections || []).join(', '), links: (c.links || []).map(l => `${l.label} | ${l.url}`).join('\n'), chat: c.chat === false ? 'no' : 'yes' }; }
  if (f === 'css') return { content: ev?.content || '' };
  if (f === 30023) return { d: dTag(ev) || preset.d || '', type: tagsOf(ev, 't').find(t => t !== TAG) || preset.type || 'section', title: tag(ev, 'title') || preset.title || '', summary: tag(ev, 'summary') || '', r: tag(ev, 'r') || '', image: tag(ev, 'image') || '', order: tag(ev, 'order') || '', content: ev?.content || '' };
  return { content: ev?.content || '' };
}
function toTemplate(kind, f, ev, preset = {}) {
  const form = formOf(kind, ev, preset);
  if (form === 0) { const o = {}; for (const k of ['name', 'about', 'picture', 'nip05', 'website']) if (f[k]?.trim()) o[k] = f[k].trim(); return { kind: 0, content: JSON.stringify(o) }; }
  if (form === 'layout') return { kind: K.config, tags: [['d', CONFIG_D]], content: JSON.stringify({ title: f.title?.trim() || DEFAULT_CFG.title, sections: f.sections.split(',').map(s => s.trim().toLowerCase()).filter(Boolean), chat: !/^n/i.test(f.chat || 'yes'),
    links: f.links.split('\n').map(l => l.split('|').map(s => s.trim())).filter(p => p[0] && p[1]).map(([label, url]) => ({ label, url })) }) };
  if (form === 'css') return { kind: K.config, tags: [['d', CSS_D]], content: f.content || '' };
  if (form === 30023) {
    const d = (f.d || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, ''); if (!d) throw new Error('a slug is required');
    const tags = [['d', d], ['title', f.title.trim() || d], ['t', TAG], ['t', (f.type || 'section').trim().toLowerCase()], ['published_at', tag(ev, 'published_at') || String(now())], ['alt', `${f.title.trim() || d}, a block of ronishbhatt.com`]];
    for (const k of ['summary', 'r', 'image', 'order']) if (f[k]?.trim()) tags.push([k, f[k].trim()]);
    return { kind: K.article, tags, content: f.content || '' };
  }
  if (!f.content?.trim()) throw new Error('empty note'); return { kind: K.note, content: f.content.trim() };
}
export async function deleteEvent(ev) {
  const tags = [['k', String(ev.kind)]]; if (!ev.draft) tags.push(['e', ev.id]); if (ev.kind >= 30000 || ev.kind === 0) tags.push(['a', addrOf(ev)]);
  await publishTemplate({ kind: K.del, tags, content: 'removed from ronishbhatt.com' }); store.events.delete(keyOf(ev)); notify();
}
export async function publishDrafts() {
  const drafts = sel.drafts(); let n = 0;
  for (const d of drafts) { const { res } = await publishTemplate({ kind: d.kind, tags: (d.tags || []).map(t => t[0] === 'published_at' ? ['published_at', String(now())] : t), content: d.content }); if (res.some(r => r.ok)) n++; }
  toast(`${n}/${drafts.length} drafts published`);
}

export function OwnerBar({ onEdit, onConsole, unread }) {
  const drafts = sel.drafts().length, [busy, setBusy] = useState(false);
  return html`<div class="ownerbar"><span>unlocked · <code>${npub(env.SITE).slice(0, 16)}…</code></span>
    ${drafts ? html`<button class="sm pri" disabled=${busy} onClick=${async () => { setBusy(true); try { await publishDrafts(); } finally { setBusy(false); } }}>${busy ? html`<span class="spin"></span>` : null}publish ${drafts} draft${drafts > 1 ? 's' : ''}</button>` : null}
    <button class="sm" onClick=${() => onEdit(K.config, sel.configEvent(), { d: CONFIG_D })}>layout</button>
    <button class="sm" onClick=${() => onEdit(K.config, sel.cssEvent(), { d: CSS_D })}>stylesheet</button>
    <button class="sm" onClick=${() => onEdit(K.article, null, { type: 'section' })}>+ block</button>
    <button class="sm" onClick=${() => onEdit(K.note, null)}>+ note</button>
    <button class="sm" onClick=${() => document.getElementById('chat')?.scrollIntoView({ behavior: 'smooth' })}>inbox${unread ? html`<span class="badge">${unread}</span>` : null}</button>
    <span class="grow"></span><button class="sm" onClick=${onConsole}>console</button><button class="sm" onClick=${() => { lock(); location.reload(); }}>lock</button></div>`;
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
  const title = { 0: 'header (kind 0)', layout: 'layout (kind 30078)', css: 'stylesheet (kind 30078)', 30023: `${f.type || 'section'} (kind 30023)`, 1: 'note (kind 1)' }[form];
  return html`<div class="panel"><h2>${ev ? 'edit' : 'new'} ${title}</h2>
    <p class="sub">${ev && !ev.draft ? `replaces the version signed ${new Date(ev.created_at * 1000).toLocaleString()}` : 'not on the relay yet'}</p>
    ${SCHEMAS[form].map(([k, label]) => html`<label class="f" key=${k}>${label}</label>${BIG.has(k) ? html`<textarea class=${k === 'content' ? 'big' : ''} value=${f[k] || ''} onInput=${e => set(k, e.target.value)} />` : html`<input value=${f[k] || ''} disabled=${k === 'd' && ev && !ev.draft} onInput=${e => set(k, e.target.value)} />`}`)}
    ${err ? html`<div class="err" style="margin-top:.5rem">${err}</div>` : null}
    <div class="row"><button class="pri" disabled=${busy} onClick=${save}>${busy ? html`<span class="spin"></span>` : null}publish to ${env.RELAYS.length} relays</button><button disabled=${busy} onClick=${onClose}>cancel</button><span class="grow"></span>${ev ? html`<button class="danger" disabled=${busy} onClick=${del}>delete</button>` : null}</div></div>`;
}
export const Console = ({ onClose }) => html`<div class="console"><div class="bar"><span>console · <code>/dash.html</code> · same key, same box</span><span class="grow"></span><button class="sm" onClick=${onClose}>close</button></div><iframe src="/dash.html" title="dell7920 console"></iframe></div>`;

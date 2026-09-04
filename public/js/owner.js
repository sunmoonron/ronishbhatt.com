// owner.js — what the site key unlocks: editing every block in place,
// publishing drafts, deleting, and the console (/dash.html, same key).
// Publishing = sign a template and hand it to the relays; the page then
// re-renders from the event that comes back, like any other visitor's would.
import { html, useState, useEffect, useRef } from '/vendor/htm-preact-3.1.1.standalone.mjs';
import { NT, SITE, RELAYS, PRIMARY, TAG, CONFIG_D, K, DEFAULT_CFG, store, sel, apply, publish, sign, unlock, lock, owner, now, tag, tagsOf, dTag, addrOf, keyOf, notify } from './store.js';
import { toast } from './ui.js';

export async function publishTemplate(tmpl, relays = RELAYS) {
  const ev = sign(tmpl);
  apply(ev, { verified: true });
  const res = await publish(ev, relays);
  const ok = res.filter(r => r.ok).length;
  toast(ok ? `published to ${ok}/${res.length} relays${res.find(r => r.url === PRIMARY && r.ok) ? ' (incl. mine)' : ' — NOT on my relay: ' + res.find(r => r.url === PRIMARY)?.msg}` : 'no relay accepted it: ' + res.map(r => r.msg).join('; '), ok ? '' : 'err');
  return { ev, res };
}

// ---- forms: event <-> fields -----------------------------------------------------
const SCHEMAS = {
  0: [['name', 'Name'], ['about', 'About — one line'], ['picture', 'Picture URL'], ['nip05', 'NIP-05 (e.g. _@ronishbhatt.com)'], ['website', 'Website']],
  30078: [['title', 'Site title'], ['accent', 'Accent colour (#hex)'], ['sections', 'Sections in order — comma separated. Known: about, now, projects, writing, notes, chat, colophon, or any section slug'],
    ['links', 'Footer links — one per line: label | url'], ['chat', 'Chat enabled (yes / no)']],
  30023: [['d', 'Slug (d tag) — stays fixed once published'], ['type', 'Type: section / project / writing'], ['title', 'Title'], ['summary', 'One-line summary'], ['r', 'Link (projects and writing)'], ['image', 'Image URL'], ['order', 'Order — lower first'], ['content', 'Body — Markdown']],
  1: [['content', 'Note — Markdown']],
};
const BIG = new Set(['content', 'links', 'about']);

export function toFields(kind, ev, preset = {}) {
  if (kind === 0) { try { return { ...JSON.parse(ev?.content || '{}') }; } catch { return {}; } }
  if (kind === 30078) { const c = { ...DEFAULT_CFG, ...(ev ? JSON.parse(ev.content) : {}) }; return { title: c.title, accent: c.accent, sections: (c.sections || []).join(', '), links: (c.links || []).map(l => `${l.label} | ${l.url}`).join('\n'), chat: c.chat === false ? 'no' : 'yes' }; }
  if (kind === 30023) return { d: dTag(ev) || preset.d || '', type: tagsOf(ev, 't').find(t => t !== TAG) || preset.type || 'section', title: tag(ev, 'title') || preset.title || '', summary: tag(ev, 'summary') || '', r: tag(ev, 'r') || '', image: tag(ev, 'image') || '', order: tag(ev, 'order') || '', content: ev?.content || '' };
  return { content: ev?.content || '' };
}
export function toTemplate(kind, f, ev) {
  if (kind === 0) { const o = {}; for (const k of ['name', 'about', 'picture', 'nip05', 'website']) if (f[k]?.trim()) o[k] = f[k].trim(); return { kind: 0, content: JSON.stringify(o) }; }
  if (kind === 30078) return { kind: 30078, tags: [['d', CONFIG_D]], content: JSON.stringify({ title: f.title?.trim() || DEFAULT_CFG.title, accent: /^#[0-9a-f]{3,8}$/i.test(f.accent?.trim() || '') ? f.accent.trim() : DEFAULT_CFG.accent,
    sections: f.sections.split(',').map(s => s.trim().toLowerCase()).filter(Boolean), chat: !/^n/i.test(f.chat || 'yes'),
    links: f.links.split('\n').map(l => l.split('|').map(s => s.trim())).filter(p => p[0] && p[1]).map(([label, url]) => ({ label, url })) }) };
  if (kind === 30023) {
    const d = (f.d || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, ''); if (!d) throw new Error('a slug is required');
    const tags = [['d', d], ['title', f.title.trim() || d], ['t', TAG], ['t', (f.type || 'section').trim().toLowerCase()], ['published_at', tag(ev, 'published_at') || String(now())]];
    for (const k of ['summary', 'r', 'image', 'order']) if (f[k]?.trim()) tags.push([k, f[k].trim()]);
    tags.push(['alt', `${f.title.trim() || d} — a block of ronishbhatt.com`]);
    return { kind: 30023, tags, content: f.content || '' };
  }
  if (!f.content?.trim()) throw new Error('empty note'); return { kind: 1, content: f.content.trim() };
}

export async function deleteEvent(ev) {
  const tags = [['k', String(ev.kind)]];
  if (!ev.draft) tags.push(['e', ev.id]);
  if (ev.kind >= 30000 || ev.kind === 0) tags.push(['a', addrOf(ev)]);
  await publishTemplate({ kind: 5, tags, content: 'removed from ronishbhatt.com' });
  store.events.delete(keyOf(ev)); notify();
}

export async function publishDrafts() {
  const drafts = sel.drafts(); let n = 0;
  for (const d of drafts) {
    const tmpl = { kind: d.kind, tags: (d.tags || []).map(t => t[0] === 'published_at' ? ['published_at', String(now())] : t), content: d.content };
    const { res } = await publishTemplate(tmpl); if (res.some(r => r.ok)) n++;
  }
  toast(`${n}/${drafts.length} drafts published`);
}

// ---- components --------------------------------------------------------------------
export function OwnerBar({ onEdit, onConsole, unread }) {
  const drafts = sel.drafts().length; const [busy, setBusy] = useState(false);
  return html`<div class="ownerbar">
    <span>unlocked · <code>${NT.nip19.npubEncode(SITE).slice(0, 16)}…</code></span>
    ${drafts ? html`<button class="sm pri" disabled=${busy} onClick=${async () => { setBusy(true); try { await publishDrafts(); } finally { setBusy(false); } }}>${busy ? html`<span class="spin"></span>` : null}publish ${drafts} draft${drafts > 1 ? 's' : ''}</button>` : null}
    <button class="sm" onClick=${() => onEdit({ kind: 30078, ev: sel.configEvent() })}>layout & theme</button>
    <button class="sm" onClick=${() => onEdit({ kind: 30023, preset: { type: 'section' } })}>+ section</button>
    <button class="sm" onClick=${() => onEdit({ kind: 1 })}>+ note</button>
    <button class="sm" onClick=${() => document.getElementById('chat')?.scrollIntoView({ behavior: 'smooth' })}>inbox${unread ? html`<span class="badge">${unread}</span>` : null}</button>
    <span class="grow"></span>
    <button class="sm" onClick=${onConsole}>console</button>
    <button class="sm" onClick=${() => { lock(); location.reload(); }}>lock</button>
  </div>`;
}

export function UnlockDialog({ open, onClose }) {
  const ref = useRef(); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  const go = e => { e.preventDefault(); setErr(''); setBusy(true);
    try { unlock(e.target.nsec.value, e.target.remember.checked); e.target.reset(); onClose(); toast('unlocked — every block is editable now'); }
    catch (x) { setErr(x.message); } finally { setBusy(false); } };
  return html`<dialog ref=${ref} onClose=${onClose}>
    <h2>unlock</h2>
    <p>The site key signs every block on this page, accepts the chat, and opens the console. It never leaves this browser.</p>
    <form onSubmit=${go} method="dialog">
      <input name="nsec" type="password" placeholder="nsec1…" autocomplete="off" />
      <label class="f" style="display:flex;gap:.4rem;align-items:center;text-transform:none;letter-spacing:0"><input name="remember" type="checkbox" style="width:auto" /> keep the key in this browser</label>
      ${err ? html`<div class="err">${err}</div>` : null}
      <div class="row"><button class="pri" type="submit" disabled=${busy}>unlock</button><button type="button" onClick=${onClose}>cancel</button></div>
    </form>
  </dialog>`;
}

export function Editor({ target, onClose }) {
  const { kind, ev, preset } = target;
  const [f, setF] = useState(() => toFields(kind, ev, preset));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = async () => { setErr(''); setBusy(true); try { await publishTemplate(toTemplate(kind, f, ev)); onClose(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  const del = async () => { if (!ev || !confirm('Delete this from the relays? (a kind-5 deletion is published)')) return; setBusy(true); try { await deleteEvent(ev); onClose(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  const title = { 0: 'header (kind 0 profile)', 30078: 'layout & theme (kind 30078)', 30023: `${f.type || 'section'} (kind 30023 article)`, 1: 'note (kind 1)' }[kind];
  return html`<div class="panel">
    <h2>${ev ? 'edit' : 'new'} ${title}</h2>
    <p class="sub">${ev && !ev.draft ? `replaces the version signed ${new Date(ev.created_at * 1000).toLocaleString()}` : 'not on the relay yet'}</p>
    ${SCHEMAS[kind].map(([k, label]) => html`<label class="f" key=${k}>${label}</label>
      ${BIG.has(k) ? html`<textarea class=${k === 'content' ? 'big' : ''} value=${f[k] || ''} onInput=${e => set(k, e.target.value)} />`
        : html`<input value=${f[k] || ''} disabled=${k === 'd' && ev && !ev.draft} onInput=${e => set(k, e.target.value)} />`}`)}
    ${err ? html`<div class="err" style="margin-top:.5rem">${err}</div>` : null}
    <div class="row">
      <button class="pri" disabled=${busy} onClick=${save}>${busy ? html`<span class="spin"></span>` : null}publish to ${RELAYS.length} relays</button>
      <button disabled=${busy} onClick=${onClose}>cancel</button>
      <span class="grow"></span>
      ${ev ? html`<button class="danger" disabled=${busy} onClick=${del}>delete</button>` : null}
    </div>
  </div>`;
}

export const Console = ({ onClose }) => html`<div class="console">
  <div class="bar"><span>console · <code>/dash.html</code> · same key, same box</span><span class="grow"></span><button class="sm" onClick=${onClose}>close</button></div>
  <iframe src="/dash.html" title="dell7920 console"></iframe>
</div>`;

// ui.js — the visible components. Markdown in, sanitised HTML out; every
// block carries a link to the event it was rendered from.
import { html } from '/vendor/htm-preact-3.1.1.standalone.mjs';
import { marked } from '/vendor/marked-18.0.11.esm.js';
import { store, tag, dTag, njump, seenOn, RELAYS, PRIMARY, notify } from './store.js';

marked.use({ gfm: true });
const purify = window.DOMPurify;
purify.addHook('afterSanitizeAttributes', n => {
  if (n.tagName === 'A') { n.setAttribute('rel', 'noopener'); if (/^https?:/i.test(n.getAttribute('href') || '')) n.setAttribute('target', '_blank'); }
});
export const md = src => purify.sanitize(marked.parse(String(src || '')), { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button'] });
export const Markdown = ({ src }) => html`<div class="md" dangerouslySetInnerHTML=${{ __html: md(src) }} />`;

export const fmtDate = ts => new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
export const fmtTime = ts => new Date(ts * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// ---- toasts ------------------------------------------------------------------
export const toasts = []; let tid = 0;
export function toast(text, kind = '', ms = 5000) {
  const t = { id: ++tid, text, kind }; toasts.push(t); notify();
  setTimeout(() => { const i = toasts.indexOf(t); if (i >= 0) { toasts.splice(i, 1); notify(); } }, ms);
}
export const Toasts = () => html`<div class="toasts">${toasts.map(t => html`<div key=${t.id} class=${'toast ' + t.kind}>${t.text}</div>`)}</div>`;

// ---- building blocks ---------------------------------------------------------
export const EvLink = ({ ev }) => {
  if (!ev || ev.draft) return null;
  const u = njump(ev); if (!u) return null;
  const from = seenOn(ev); const title = `signed event ${ev.id.slice(0, 8)}… · ${from.length ? 'served by ' + from.map(s => s.replace('wss://', '')).join(', ') : 'from the baked snapshot'} · open it in another client`;
  return html`<a class="ev" href=${u} target="_blank" rel="noopener" title=${title}>⌁ event</a>`;
};
export const Draft = ({ ev }) => ev?.draft ? html`<span class="draft">draft</span>` : null;

export const Label = ({ text, ev, children }) => html`
  <h2 class="label">${text}<${Draft} ev=${ev} /><span class="grow"></span><${EvLink} ev=${ev} />${children}</h2>`;

export const Header = ({ p, ev, children }) => html`
  <header class="me">
    ${p.picture ? html`<img src=${p.picture} alt="" />` : null}
    <div><h1>${p.name || 'Ronish Bhatt'}</h1><p>${p.about || ''}<${Draft} ev=${ev} /></p></div>
    ${children}
  </header>`;

export const Section = ({ ev, children }) => html`
  <section class="c" id=${dTag(ev)}>
    <${Label} text=${tag(ev, 'title') || dTag(ev)} ev=${ev} />
    <${Markdown} src=${ev.content} />
    ${children}
  </section>`;

// Project / writing cards: title → link, one-line summary, optional Markdown body.
export const Items = ({ id, title, items, edit, add }) => html`
  <section class="c" id=${id}>
    <${Label} text=${title}>${add ? html`<button class="sm" onClick=${add}>+ add</button>` : null}</${Label}>
    ${items.length ? html`<ul class="items">${items.map(e => html`
      <li key=${e.id} class="item">
        ${tag(e, 'image') ? html`<img class="th" src=${tag(e, 'image')} alt="" />` : null}
        <div class="b">
          <div class="t"><a href=${tag(e, 'r') || njump(e) || '#'} target=${/^https?:/.test(tag(e, 'r') || '') ? '_blank' : null} rel="noopener">${tag(e, 'title') || dTag(e)}</a> <${Draft} ev=${e} /></div>
          ${tag(e, 'summary') ? html`<div class="s">${tag(e, 'summary')}</div>` : null}
          ${e.content?.trim() ? html`<${Markdown} src=${e.content} />` : null}
          <div class="meta">${edit ? edit(e) : null}<${EvLink} ev=${e} /></div>
        </div>
      </li>`)}</ul>` : html`<p class="empty">nothing here yet</p>`}
  </section>`;

export const Notes = ({ notes, edit, compose }) => html`
  <section class="c" id="notes">
    <${Label} text="Notes">${compose ? html`<button class="sm" onClick=${compose}>+ note</button>` : null}</${Label}>
    ${notes.length ? notes.map(n => html`
      <div class="note" key=${n.id}>
        <time>${fmtDate(n.created_at)}</time>
        <${Markdown} src=${n.content} />
        <div class="meta">${edit ? edit(n) : null}<${EvLink} ev=${n} /></div>
      </div>`) : html`<p class="empty">no notes yet</p>`}
  </section>`;

export const Footer = ({ cfg, ownerOn, onUnlock }) => html`
  <footer>
    <div class="links">
      ${(cfg.links || []).map(l => html`<a key=${l.url} href=${l.url} target=${/^https?:/.test(l.url) ? '_blank' : null} rel="noopener">${l.label}</a>`)}
      ${ownerOn ? null : html`<button class="lnk" style="font-size:.85rem" onClick=${onUnlock}>unlock</button>`}
    </div>
    <div class="status">
      ${RELAYS.map(u => { const s = store.status.get(u); return html`<span key=${u} title=${s === 'open' ? 'connected' : s === 'closed' ? 'not connected' : 'connecting'}><i class=${'dot ' + (s === 'open' ? 'open' : s === 'closed' ? 'err' : '')}></i>${u.replace('wss://', '').replace('ws://', '')}${u === PRIMARY ? ' · mine' : ''}</span>`; })}
      <span>${[...store.events.values()].filter(e => !e.draft).length} signed events${store.ready ? '' : ' · syncing…'}</span>
    </div>
  </footer>`;

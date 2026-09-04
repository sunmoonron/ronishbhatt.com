// ui.js — the page as a function of the store. Pure: the same code renders in
// the browser (hydration + live updates) and in Node (tools/bake.mjs pre-renders
// the HTML so the page paints before any script runs).
import { h } from 'preact';
import htm from 'htm';
import { marked } from 'marked';
import { store, env, sel, tag, dTag, seenOn } from './store.js';
export const html = htm.bind(h);

marked.use({ gfm: true, renderer: { link({ href, title, tokens }) {
  const ext = /^https?:/i.test(href);
  return `<a href="${href}"${title ? ` title="${title}"` : ''}${ext ? ' target="_blank" rel="noopener"' : ''}>${this.parser.parseInline(tokens)}</a>`;
} } });
const PURIFY = { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'script'], ADD_ATTR: ['target'] };
const sanitize = s => globalThis.DOMPurify ? globalThis.DOMPurify.sanitize(s, PURIFY) : s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '');
export const md = src => sanitize(marked.parse(String(src || '')));
export const Markdown = ({ src }) => html`<div class="md" dangerouslySetInnerHTML=${{ __html: md(src) }} />`;
export const fmtDate = ts => new Date(ts * 1000).toISOString().slice(0, 10);

// NIP-19 links without a crypto library, so links render identically before nostr-tools loads.
const B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const polymod = vs => { let c = 1; for (const v of vs) { const b = c >> 25; c = ((c & 0x1ffffff) << 5) ^ v; for (let i = 0; i < 5; i++) if ((b >> i) & 1) c ^= [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3][i]; } return c; };
const bech32 = (hrp, bytes) => { const w = []; let acc = 0, bits = 0; for (const b of bytes) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; w.push((acc >> bits) & 31); } } if (bits) w.push((acc << (5 - bits)) & 31);
  const exp = [...[...hrp].map(c => c.charCodeAt(0) >> 5), 0, ...[...hrp].map(c => c.charCodeAt(0) & 31)];
  const pm = polymod([...exp, ...w, 0, 0, 0, 0, 0, 0]) ^ 1; for (let i = 0; i < 6; i++) w.push((pm >> (5 * (5 - i))) & 31);
  return hrp + '1' + w.map(x => B32[x]).join(''); };
const hex = s => s.match(/../g).map(x => parseInt(x, 16)), utf8 = s => [...new TextEncoder().encode(s)], tlv = (t, b) => [t, b.length, ...b];
export const njump = ev => { const relay = env.PRIMARY ? tlv(1, utf8(env.PRIMARY)) : [];
  if (ev.kind >= 30000) return 'https://njump.me/' + bech32('naddr', [...tlv(0, utf8(dTag(ev))), ...relay, ...tlv(2, hex(ev.pubkey)), ...tlv(3, [ev.kind >>> 24, (ev.kind >> 16) & 255, (ev.kind >> 8) & 255, ev.kind & 255])]);
  if (ev.kind === 0) return 'https://njump.me/' + bech32('nprofile', [...tlv(0, hex(ev.pubkey)), ...relay]);
  return 'https://njump.me/' + bech32('nevent', [...tlv(0, hex(ev.id)), ...relay, ...tlv(2, hex(ev.pubkey))]); };
export const npub = pk => bech32('npub', hex(pk));

// ---- toasts ---------------------------------------------------------------------
export const toasts = []; let tid = 0;
export function toast(text, kind = '', ms = 5000) {
  const t = { id: ++tid, text, kind }; toasts.push(t); store.status.set('toast', tid); notifyLater();
  setTimeout(() => { const i = toasts.indexOf(t); if (i >= 0) { toasts.splice(i, 1); notifyLater(); } }, ms);
}
let _notify = () => {}; export const bindNotify = fn => _notify = fn; const notifyLater = () => _notify();
export const Toasts = () => html`<div class="toasts">${toasts.map(t => html`<div key=${t.id} class=${'toast ' + t.kind}>${t.text}</div>`)}</div>`;

// ---- blocks ----------------------------------------------------------------------
const Draft = ({ ev }) => ev?.draft ? html`<span class="draft">draft</span>` : null;
const EvLink = ({ ev }) => { if (!ev || ev.draft) return null; const from = seenOn(ev);
  return html`<a class="ev" href=${njump(ev)} target="_blank" rel="noopener" title=${`signed event ${ev.id.slice(0, 8)}… · ${from.length ? 'served by ' + from.map(s => s.replace(/^wss?:\/\//, '')).join(', ') : 'from the baked snapshot'} · open it in another client`}>⌁ event</a>`; };
const Label = ({ text, ev, children }) => html`<h2 class="label">${text}<${Draft} ev=${ev} /><span class="grow"></span><${EvLink} ev=${ev} />${children}</h2>`;

const Items = ({ id, items, edit, add }) => html`<section class="c" id=${id}>
  <${Label} text=${id}>${add ? html`<button class="sm" onClick=${add}>+ add</button>` : null}</${Label}>
  ${items.length ? html`<ul class="items">${items.map(e => html`<li key=${keyId(e)} class="item">
    ${tag(e, 'image') ? html`<img class="th" src=${tag(e, 'image')} alt="" />` : null}
    <div class="b">
      <div class="t"><a href=${tag(e, 'r') || njump(e)} target=${/^https?:/.test(tag(e, 'r') || '') ? '_blank' : null} rel="noopener">${tag(e, 'title') || dTag(e)}</a> <${Draft} ev=${e} /></div>
      ${tag(e, 'summary') ? html`<div class="s">${tag(e, 'summary')}</div>` : null}
      ${e.content?.trim() ? html`<${Markdown} src=${e.content} />` : null}
      <div class="meta">${edit ? edit(e) : null}<${EvLink} ev=${e} /></div>
    </div></li>`)}</ul>` : html`<p class="empty">nothing here yet</p>`}
</section>`;
const keyId = e => e.draft ? e.id : keyOfEv(e);
const keyOfEv = e => e.kind >= 30000 ? `${e.kind}:${dTag(e)}` : e.id;

const Notes = ({ notes, edit, compose }) => html`<section class="c" id="notes">
  <${Label} text="notes">${compose ? html`<button class="sm" onClick=${compose}>+ note</button>` : null}</${Label}>
  ${notes.length ? notes.map(n => html`<div class="note" key=${n.id}><time>${fmtDate(n.created_at)}</time><${Markdown} src=${n.content} /><div class="meta">${edit ? edit(n) : null}<${EvLink} ev=${n} /></div></div>`) : html`<p class="empty">no notes yet</p>`}
</section>`;

export function Page({ Chat, chatProps, edit, onUnlock, ownerOn, children }) {
  const cfg = sel.config(), p = sel.profileData(), profile = sel.profile();
  const blocks = cfg.sections.map(id => {
    if (id === 'projects' || id === 'writing') { const type = id === 'projects' ? 'project' : 'writing';
      return html`<${Items} key=${id} id=${id} items=${sel.articles(type)} edit=${edit && (e => edit(30023, e))} add=${edit && (() => edit(30023, null, { type }))} />`; }
    if (id === 'notes') return html`<${Notes} key="notes" notes=${sel.notes()} edit=${edit && (e => edit(1, e))} compose=${edit && (() => edit(1, null))} />`;
    if (id === 'chat') return cfg.chat === false && !ownerOn ? null : html`<section class="c" id="chat" key="chat"><${Label} text=${ownerOn ? 'inbox' : 'say hi'} /><${Chat} ...${chatProps} /></section>`;
    const ev = sel.section(id);
    if (!ev) return ownerOn ? html`<section class="c" key=${id}><${Label} text=${id}>${edit(30023, null, { d: id, type: 'section', title: id })}</${Label}><p class="empty">no “${id}” block on the relay yet</p></section>` : null;
    return html`<section class="c" id=${id} key=${id}><${Label} text=${tag(ev, 'title') || id} ev=${ev}>${edit ? edit(30023, ev) : null}</${Label}><${Markdown} src=${ev.content} /></section>`;
  });
  return html`${children}
    <header class="me">${p.picture ? html`<img src=${p.picture} alt="" />` : null}<div><h1>${p.name || 'Ronish Bhatt'}</h1><p>${p.about || ''}<${Draft} ev=${profile} /></p></div>${edit ? edit(0, profile) : null}</header>
    ${blocks}
    <footer>
      <div class="links">${(cfg.links || []).map(l => html`<a key=${l.url} href=${l.url} target=${/^https?:/.test(l.url) ? '_blank' : null} rel="noopener">${l.label}</a>`)}
        ${ownerOn ? null : html`<button class="lnk" onClick=${onUnlock}>unlock</button>`}</div>
      <div class="status">${env.RELAYS.map(u => { const s = store.status.get(u); return html`<span key=${u} title=${s === 'open' ? 'connected' : s === 'closed' ? 'not connected' : 'connecting'}><i class=${'dot' + (s === 'open' ? ' open' : s === 'closed' ? ' err' : '')}></i>${u.replace(/^wss?:\/\//, '')}${u === env.PRIMARY ? ' · mine' : ''}</span>`; })}
        <span>${sel.signed()} signed events${store.ready ? '' : ' · syncing…'}</span></div>
    </footer>`;
}

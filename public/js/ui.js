// ui.js - the page as a function of the store. Pure: the same code renders in
// the browser (hydration + live updates) and in Node (tools/bake.mjs pre-renders
// the HTML so the page paints before any script runs).
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { marked } from 'marked';
import { store, env, sel, meta, text, dTag, seenOn, PALETTE } from './store.js';
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
  return html`<a class="ev" href=${njump(ev)} target="_blank" rel="noopener" title=${`signed event ${ev.id.slice(0, 8)}, ${from.length ? 'served by ' + from.map(s => s.replace(/^wss?:\/\//, '')).join(', ') : 'from the baked snapshot'}; open it in another client`}>⌁ event</a>`; };
const Label = ({ text, ev, children }) => html`<h2 class="label">${text}<${Draft} ev=${ev} /><span class="grow"></span><${EvLink} ev=${ev} />${children}</h2>`;

// A tile's picture (or a placeholder) opens the thing inline; boot.js does the same before the app loads.
const Thumb = ({ ev }) => { const [open, setOpen] = useState(false); const m = meta(ev), href = m.r || '#', img = m.image;
  const toggle = e => { if (href === '#') return; e.preventDefault(); setOpen(o => !o); };
  return html`<a class=${img ? 'thumb' : 'thumb ph'} href=${href} data-preview aria-label=${'open ' + (m.title || '') + ' here'} onClick=${toggle}>${img ? html`<img class="th" src=${img} alt="" loading="lazy" />` : '▶'}</a>
    ${open ? html`<iframe class="preview" src=${href} title=${m.title} />` : null}`; };
const Items = ({ id, items, edit, add }) => html`<section class="c" id=${id}>
  <${Label} text=${id}>${add ? html`<button class="sm" onClick=${add}>+ add</button>` : null}</${Label}>
  ${items.length ? html`<ul class="items">${items.map(e => { const m = meta(e); return html`<li key=${keyId(e)} class="item">
    ${m.r ? html`<${Thumb} ev=${e} />` : null}
    <div class="b">
      <div class="t"><a href=${m.r || njump(e)} target=${/^https?:/.test(m.r || '') ? '_blank' : null} rel="noopener">${m.title || m.slug}</a> <${Draft} ev=${e} /></div>
      ${m.summary ? html`<div class="s">${m.summary}</div>` : null}
      ${m.body?.trim() ? html`<${Markdown} src=${m.body} />` : null}
      <div class="meta">${edit ? edit(e) : null}<${EvLink} ev=${e} /></div>
    </div></li>`; })}</ul>` : html`<p class="empty">nothing here yet</p>`}
</section>`;
const keyId = e => e.kind >= 30000 ? `${e.kind}:${dTag(e)}` : e.id;

const Notes = ({ notes, edit, compose }) => html`<section class="c" id="notes">
  <${Label} text="notes">${compose ? html`<button class="sm" onClick=${compose}>+ note</button>` : null}</${Label}>
  ${notes.length ? notes.map(n => html`<div class="note" key=${n.id}><time>${fmtDate(n.created_at)}</time><${Markdown} src=${text(n)} /><div class="meta">${edit ? edit(n) : null}<${EvLink} ev=${n} /></div></div>`) : html`<p class="empty">no notes yet</p>`}
</section>`;

// The mural: one tile per message ever accepted at the door, from ids alone.
export function Mural() {
  const tiles = [...store.wraps.values()].sort((a, b) => a.created_at - b.created_at);
  if (!tiles.length) return html`<p class="empty" style="padding:.25rem 1rem 1rem">no messages yet; the first tile lands when someone writes to me.</p>`;
  const cols = 24, cell = 10, rows = Math.ceil(tiles.length / cols), oldest = tiles[0].created_at, newest = tiles[tiles.length - 1].created_at;
  return html`<div class="mural"><svg viewBox=${`0 0 ${cols * cell} ${rows * cell}`} role="img" aria-label=${`${tiles.length} messages, one tile each`}>
    ${tiles.map((t, i) => { const s = 5 + Math.min(4, Math.max(0, t.bits - 16)), o = 0.45 + 0.55 * ((t.created_at - oldest) / Math.max(1, newest - oldest));
      return html`<rect key=${t.id} x=${((i % cols) * cell + (cell - s) / 2).toFixed(1)} y=${(Math.floor(i / cols) * cell + (cell - s) / 2).toFixed(1)} width=${s} height=${s} rx="1.5" fill=${PALETTE[parseInt(t.id[7], 16) || 0]} opacity=${o.toFixed(2)}><title>${`${t.bits} bits of work, ${fmtDate(t.created_at)}`}</title></rect>`; })}
  </svg><p class="legend">${tiles.length} messages accepted at the door. Bigger squares cost more work, brighter ones are newer; nothing is decrypted and nobody is named.</p></div>`;
}

export function Page({ Chat, chatProps, Garden, gardenProps, edit, onUnlock, ownerOn, children }) {
  const cfg = sel.config(), p = sel.profileData(), profile = sel.profile();
  const blocks = cfg.sections.map(id => {
    if (id === 'projects' || id === 'writing') { const type = id === 'projects' ? 'project' : 'writing';
      return html`<${Items} key=${id} id=${id} items=${sel.articles(type)} edit=${edit && (e => edit('block', e))} add=${edit && (() => edit('block', null, { type }))} />`; }
    if (id === 'notes') return html`<${Notes} key="notes" notes=${sel.notes()} edit=${edit && (e => edit(1, e))} compose=${edit && (() => edit(1, null))} />`;
    if (id === 'chat') return cfg.chat === false && !ownerOn ? null : html`<section class=${ownerOn ? 'c owner' : 'c'} id="chat" key="chat"><${Label} text=${ownerOn ? 'inbox' : 'say hi'} /><${Chat} ...${chatProps} /></section>`;
    if (id === 'mural') return html`<details class="fold" id="mural" key="mural"><summary>the proof-of-work mural<span class="tiny">experimental</span></summary><${Mural} /></details>`;
    if (id === 'garden') return Garden ? html`<details class="fold" id="garden" key="garden"><summary>Bip reads the room<span class="tiny">experimental</span></summary><${Garden} ...${gardenProps} /></details>` : null;
    const ev = sel.section(id);
    if (!ev) return ownerOn ? html`<section class="c" key=${id}><${Label} text=${id}>${edit('block', null, { slug: id, type: 'section', title: id })}</${Label}><p class="empty">no ${id} block on the relay yet</p></section>` : null;
    const m = meta(ev);
    if (m.display === 'details') return html`<details class="fold" id=${id} key=${id}><summary>${m.summary || m.title || id}<${Draft} ev=${ev} /><span class="grow"></span>${edit ? edit('block', ev) : null}<${EvLink} ev=${ev} /></summary><${Markdown} src=${m.body} /></details>`;
    return html`<section class="c" id=${id} key=${id}><${Label} text=${m.title || id} ev=${ev}>${edit ? edit('block', ev) : null}</${Label}><${Markdown} src=${m.body} /></section>`;
  });
  return html`${children}
    <header class="me"><img src=${env.ICON} alt="" width="56" height="56" /><div class="who"><h1>${p.name || 'Ronish Bhatt'}</h1><p class="line">${p.about || ''}<${Draft} ev=${profile} /></p>
      <div class="pills">${(cfg.links || []).map(l => html`<a key=${l.url} class="pill" href=${l.url} target=${/^https?:/.test(l.url) ? '_blank' : null} rel="noopener">${l.label}</a>`)}<a class="pill" href=${'https://njump.me/' + npub(env.SITE)} target="_blank" rel="noopener" title="the key that signs this page">${npub(env.SITE).slice(0, 13)}…</a>${ownerOn ? null : html`<button class="pill lnk" onClick=${onUnlock}>unlock</button>`}</div></div>${edit ? edit('block', profile, { slug: 'profile' }) : null}</header>
    ${blocks}
    <footer>
      <div class="status">${env.RELAYS.map(u => { const s = store.status.get(u); return html`<span key=${u} data-relay=${u} title=${s === 'open' ? 'connected' : s === 'closed' ? 'not connected' : 'connecting'}><i class=${'dot' + (s === 'open' ? ' open' : s === 'closed' ? ' err' : '')}></i>${u.replace(/^wss?:\/\//, '')}${u === env.PRIMARY ? ' · mine' : ''}</span>`; })}
        <span>${sel.signed()} signed events${store.ready ? '' : ' · syncing…'}</span></div>
    </footer>`;
}

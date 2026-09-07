// app.js: the full page, loaded by boot.js on first use (a chat message, an
// unlock, or a relay that has something newer than the baked HTML). Fetches
// the events, loads the crypto, verifies, renders live, and keeps subscribing.
import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { html, Page, Toasts, bindNotify } from './ui.js';
import { Garden } from './garden.js';
import { env, init, sel, onChange, notify, loadSnapshot, loadCache, keepCache, connect, reverify, owner, storedKey, restore, decodeIcon, subscribeWraps } from './store.js';
import { Chat, chat, chatConfigure, send as chatSend, setNick } from './chat.js';

const meta = n => document.querySelector(`meta[name="${n}"]`)?.content?.trim() || '';
const jsonMeta = n => { try { return JSON.parse(meta(n) || '{}'); } catch { return {}; } };
const iconHref = document.querySelector('link[rel="icon"][type="image/svg+xml"]')?.getAttribute('href') || '/favicon.svg';
init({ site: meta('site-pubkey'), relay: meta('site-relay'), backups: meta('site-backups').split(',').map(s => s.trim()).filter(Boolean), icon: iconHref, assets: jsonMeta('site-assets'), sri: jsonMeta('site-sri') });
const SRI = env.SRI;
const script = src => new Promise((ok, err) => { const s = document.createElement('script'); s.src = src; if (SRI[src]) s.integrity = SRI[src]; s.onload = ok; s.onerror = err; document.head.append(s); });
let Owner = null, started = false; const initial = { unlockOpen: false };

function App() {
  const [, bump] = useState(0);
  useEffect(() => onChange(() => bump(n => n + 1)), []);
  const [unlockOpen, setUnlockOpen] = useState(initial.unlockOpen), [editing, setEditing] = useState(null), [consoleOpen, setConsoleOpen] = useState(false);
  const isOwner = !!(Owner && owner.sk), cfg = sel.config();
  useEffect(() => { document.title = cfg.title; }, [cfg.title]);
  useEffect(() => { const el = document.getElementById('theme'), css = sel.css(); if (el && css && el.textContent !== css) el.textContent = css; });
  useEffect(() => { chatConfigure(isOwner); }, [isOwner]);
  const edit = isOwner ? (kind, ev, preset) => html`<button class="sm edit" onClick=${e => { e.preventDefault(); e.stopPropagation(); setEditing({ kind, ev, preset }); }}>edit</button>` : null;
  const openUnlock = async () => { if (!Owner) Owner = await import('./owner.js'); setUnlockOpen(true); };
  return html`<${Page} Chat=${Chat} chatProps=${{ live: true, ownerMode: isOwner }} Garden=${Garden} gardenProps=${{ live: true }} edit=${edit} ownerOn=${isOwner} onUnlock=${openUnlock}>
      ${isOwner ? html`<${Owner.OwnerBar} onEdit=${(kind, ev, preset) => setEditing({ kind, ev, preset })} onConsole=${() => setConsoleOpen(true)} unread=${chat.unread} />` : null}
    </${Page}>
    ${Owner && unlockOpen ? html`<${Owner.UnlockDialog} open=${unlockOpen} onClose=${() => setUnlockOpen(false)} />` : null}
    ${Owner && editing ? html`<${Owner.Editor} key=${editing.ev?.id || editing.kind} target=${editing} onClose=${() => setEditing(null)} />` : null}
    ${Owner && consoleOpen ? html`<${Owner.Console} onClose=${() => setConsoleOpen(false)} />` : null}
    <${Toasts} />`;
}

export async function start(opts = {}) {
  if (started) return; started = true;
  const seedText = document.querySelector('#chat textarea')?.value || '', seedNick = document.querySelector('#chat .who input')?.value || '';
  const [snap, svg] = await Promise.all([fetch('/site.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => null), fetch(iconHref).then(r => r.text()), script('/vendor/nostr-tools-2.25.2.bundle.js')]);
  env.NT = window.NostrTools; // the crypto is needed before anything is read: identifiers are hashed, bodies veiled
  try { init({ veil: decodeIcon(svg) }); } catch (e) { console.warn('icon is not a key:', e.message); }
  loadSnapshot(snap); loadCache(); keepCache(); bindNotify(notify);
  script('/vendor/dompurify-3.4.14.min.c2f26ea4.js').then(notify).catch(() => {});
  connect(); chatConfigure(false); if (sel.sections().includes('mural')) subscribeWraps();
  if (seedNick) setNick(seedNick);
  chat.seed = opts.send ? '' : seedText;
  if (opts.unlock || storedKey()) { Owner = await import('./owner.js'); if (storedKey()) { try { restore(); } catch {} } else initial.unlockOpen = true; }
  const root = document.getElementById('app'); root.textContent = ''; render(html`<${App} />`, root);
  if (opts.focus === 'chat') { document.querySelector('#chat textarea')?.focus(); if (opts.send && seedText.trim()) chatSend(env.SITE, seedText); }
}

// app.js: the full page, loaded by boot.js on first use (a chat message, an
// unlock, or a relay that has something newer than the baked HTML). Fetches
// the events, loads the crypto, verifies, renders live, and keeps subscribing.
import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { html, Page, Toasts, bindNotify } from '/js/ui.js';
import { env, init, sel, onChange, notify, loadSnapshot, loadCache, keepCache, connect, reverify, owner, storedKey, restore } from '/js/store.js';
import { Chat, chat, chatConfigure, send as chatSend, setNick } from '/js/chat.js';

const meta = n => document.querySelector(`meta[name="${n}"]`)?.content?.trim() || '';
init({ site: meta('site-pubkey'), relay: meta('site-relay'), backups: meta('site-backups').split(',').map(s => s.trim()).filter(Boolean) });
let SRI = {}; try { SRI = JSON.parse(meta('site-sri') || '{}'); } catch {}
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
  const edit = isOwner ? (kind, ev, preset) => html`<button class="sm edit" onClick=${() => setEditing({ kind, ev, preset })}>edit</button>` : null;
  const openUnlock = async () => { if (!Owner) Owner = await import('/js/owner.js'); setUnlockOpen(true); };
  return html`<${Page} Chat=${Chat} chatProps=${{ live: true, ownerMode: isOwner }} edit=${edit} ownerOn=${isOwner} onUnlock=${openUnlock}>
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
  let snap = null; try { snap = await (await fetch('/site.json', { cache: 'no-cache' })).json(); } catch {}
  loadSnapshot(snap); loadCache(); keepCache(); bindNotify(notify);
  await script('/vendor/nostr-tools-2.25.2.bundle.js'); env.NT = window.NostrTools; reverify();
  script('/vendor/dompurify-3.4.14.min.c2f26ea4.js').then(notify).catch(() => {});
  connect(); chatConfigure(false);
  if (seedNick) setNick(seedNick);
  chat.seed = opts.send ? '' : seedText;
  if (opts.unlock || storedKey()) { Owner = await import('/js/owner.js'); if (storedKey()) { try { restore(); } catch {} } else initial.unlockOpen = true; }
  const root = document.getElementById('app'); root.textContent = ''; render(html`<${App} />`, root);
  if (opts.focus === 'chat') { document.querySelector('#chat textarea')?.focus(); if (opts.send && seedText.trim()) chatSend(env.SITE, seedText); }
}

// app.js — inlined into index.html by the bake. Hydrates the pre-rendered page,
// then upgrades it: crypto and the relay pool after first paint, the owner
// tools only after "unlock".
import { hydrate } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { html, Page, Toasts, bindNotify } from '/js/ui.js';
import { env, init, store, sel, onChange, notify, loadSnapshot, loadCache, keepCache, connect, reverify, owner, storedKey, restore } from '/js/store.js';
import { Chat, chat, chatConfigure } from '/js/chat.js';

const meta = n => document.querySelector(`meta[name="${n}"]`)?.content?.trim() || '';
init({ site: meta('site-pubkey'), relay: meta('site-relay'), backups: meta('site-backups').split(',').map(s => s.trim()).filter(Boolean) });
const SRI = globalThis.SRI || {}; // subresource hashes, filled in by the bake
const script = src => new Promise((ok, err) => { const s = document.createElement('script'); s.src = src; if (SRI[src]) s.integrity = SRI[src]; s.onload = ok; s.onerror = err; document.head.append(s); });
let Owner = null, live = false;

function App() {
  const [, bump] = useState(0);
  useEffect(() => onChange(() => bump(n => n + 1)), []);
  const [unlockOpen, setUnlockOpen] = useState(false), [editing, setEditing] = useState(null), [consoleOpen, setConsoleOpen] = useState(false);
  const isOwner = !!(Owner && owner.sk), cfg = sel.config();
  useEffect(() => { document.title = cfg.title; }, [cfg.title]);
  useEffect(() => { const el = document.getElementById('theme'), css = sel.css(); if (el && css && el.textContent !== css) el.textContent = css; });
  useEffect(() => { if (live) chatConfigure(isOwner); }, [isOwner, live]);
  const edit = isOwner ? (kind, ev, preset) => html`<button class=${'sm edit'} onClick=${() => setEditing({ kind, ev, preset })}>edit</button>` : null;
  const openUnlock = async () => { if (!Owner) Owner = await import('/js/owner.js'); setUnlockOpen(true); };
  return html`<${Page} Chat=${Chat} chatProps=${{ live, ownerMode: isOwner }} edit=${edit} ownerOn=${isOwner} onUnlock=${openUnlock}>
      ${isOwner ? html`<${Owner.OwnerBar} onEdit=${(kind, ev, preset) => setEditing({ kind, ev, preset })} onConsole=${() => setConsoleOpen(true)} unread=${chat.unread} />` : null}
    </${Page}>
    ${Owner && unlockOpen ? html`<${Owner.UnlockDialog} open=${unlockOpen} onClose=${() => setUnlockOpen(false)} />` : null}
    ${Owner && editing ? html`<${Owner.Editor} key=${editing.ev?.id || editing.kind} target=${editing} onClose=${() => setEditing(null)} />` : null}
    ${Owner && consoleOpen ? html`<${Owner.Console} onClose=${() => setConsoleOpen(false)} />` : null}
    <${Toasts} />`;
}

(async () => {
  // Hydrate from exactly what was pre-rendered; anything newer (cache, relays) arrives as a normal re-render.
  try { loadSnapshot(JSON.parse(document.getElementById('snapshot').textContent)); } catch {}
  bindNotify(notify);
  hydrate(html`<${App} />`, document.getElementById('app'));
  loadCache(); keepCache(); notify();
  await script('/vendor/nostr-tools-2.25.2.bundle.js'); env.NT = window.NostrTools; reverify();
  script('/vendor/dompurify-3.4.14.min.c2f26ea4.js').then(notify).catch(() => {});
  connect(); live = true; chatConfigure(false); notify();
  if (storedKey()) { Owner = await import('/js/owner.js'); try { restore(); } catch {} notify(); }
})();

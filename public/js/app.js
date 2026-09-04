// app.js — composes the page from whatever events the store holds right now.
import { html, render, useState, useEffect } from '/vendor/htm-preact-3.1.1.standalone.mjs';
import { store, sel, onChange, loadCache, loadSnapshot, connect, restoreUnlock, owner, DEFAULT_CFG, K } from './store.js';
import { Header, Section, Items, Notes, Footer, Toasts, Label } from './ui.js';
import { Chat, chat, chatConfigure, chatInit } from './chat.js';
import { OwnerBar, UnlockDialog, Editor, Console } from './owner.js';

function App() {
  const [, bump] = useState(0);
  useEffect(() => onChange(() => bump(n => n + 1)), []);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const cfg = { ...DEFAULT_CFG, ...(sel.config() || {}) };
  const isOwner = !!owner.sk;
  useEffect(() => { document.title = cfg.title || DEFAULT_CFG.title; document.documentElement.style.setProperty('--accent', cfg.accent || DEFAULT_CFG.accent); }, [cfg.title, cfg.accent]);
  useEffect(() => { chatConfigure(isOwner); }, [isOwner]);
  const edit = (kind, ev, preset) => html`<button class="sm edit" onClick=${() => setEditing({ kind, ev, preset })}>edit</button>`;
  const editInline = (kind, ev) => html`<button class="sm" onClick=${() => setEditing({ kind, ev })}>edit</button>`;

  const blocks = cfg.sections.map(id => {
    if (id === 'projects' || id === 'writing') {
      const type = id === 'projects' ? 'project' : 'writing';
      return html`<${Items} key=${id} id=${id} title=${id} items=${sel.articles(type)} edit=${isOwner ? e => editInline(30023, e) : null} add=${isOwner ? () => setEditing({ kind: 30023, preset: { type } }) : null} />`;
    }
    if (id === 'notes') return html`<${Notes} key="notes" notes=${sel.notes()} edit=${isOwner ? e => editInline(1, e) : null} compose=${isOwner ? () => setEditing({ kind: 1 }) : null} />`;
    if (id === 'chat') return cfg.chat === false && !isOwner ? null : html`<section class="c" id="chat" key="chat"><${Label} text=${isOwner ? 'inbox' : 'say hi'} /><${Chat} ownerMode=${isOwner} /></section>`;
    const ev = sel.section(id);
    if (!ev) return isOwner ? html`<section class="c" key=${id}><${Label} text=${id} /><p class="empty">no “${id}” section on the relay yet</p>${edit(30023, null, { d: id, type: 'section', title: id })}</section>` : null;
    return html`<${Section} key=${id} ev=${ev}>${isOwner ? edit(30023, ev) : null}</${Section}>`;
  });

  return html`
    ${isOwner ? html`<${OwnerBar} onEdit=${setEditing} onConsole=${() => setConsoleOpen(true)} unread=${chat.unread} />` : null}
    <${Header} p=${sel.profileData()} ev=${sel.profile()}>${isOwner ? edit(0, sel.profile()) : null}</${Header}>
    ${blocks}
    <${Footer} cfg=${cfg} ownerOn=${isOwner} onUnlock=${() => setUnlockOpen(true)} />
    <${UnlockDialog} open=${unlockOpen} onClose=${() => setUnlockOpen(false)} />
    ${editing ? html`<${Editor} key=${editing.ev?.id || editing.kind} target=${editing} onClose=${() => setEditing(null)} />` : null}
    ${consoleOpen ? html`<${Console} onClose=${() => setConsoleOpen(false)} />` : null}
    <${Toasts} />`;
}

(async () => {
  loadCache();
  await loadSnapshot();
  restoreUnlock();
  const root = document.getElementById('app'); root.textContent = '';
  render(html`<${App} />`, root);
  connect();
  chatInit();
})();

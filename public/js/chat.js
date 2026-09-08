// chat.js, "say hi": NIP-17 private messages to the site key, no account.
// A visitor's browser mints a key on first send; each message is a kind-14
// rumor, sealed and gift-wrapped (NIP-59) with NIP-13 work on the wrap, then
// published to the personal relay and the backups. The relay's write policy
// (dell-nix modules/strfry-node.nix) admits wraps to the owner at POW_IN bits
// and to anyone at POW_OUT (the owner's replies). Both sides keep a self-copy.
import { useState, useEffect, useRef } from 'preact/hooks';
import { store, env, pool, owner, mine, publish, now, notify, tag } from './store.js';
import { html, toast, npub } from './ui.js';

export const POW_IN = 16, POW_OUT = 20; // must match the relay's write policy
const randomPast = () => now() - Math.floor(Math.random() * 2 * 86400);
const short = pk => npub(pk).slice(0, 12) + '…';
const VISITOR_KEY = 'rb.visitor.nsec', NICK = 'rb.nick', CACHE = () => `rb.chat.${chat.mode}.v1`;
export const chat = { mode: 'visitor', sk: null, me: null, nick: '', threads: new Map(), busy: '', sub: null, active: null, unread: 0, live: false, seed: '' };
const seen = new Set();

function makeRumor(sk, to, text, subject) { const tags = [['p', to, env.PRIMARY]]; if (subject) tags.push(['subject', subject]); return env.NT.nip59.createRumor({ kind: 14, content: text, tags }, sk); }
async function wrapRumor(rumor, sk, to, bits) {
  const NT = env.NT, seal = NT.nip59.createSeal(rumor, sk, to), eph = NT.generateSecretKey();
  const tmpl = { kind: 1059, pubkey: NT.getPublicKey(eph), created_at: randomPast(), tags: [['p', to]], content: NT.nip44.encrypt(JSON.stringify(seal), NT.nip44.getConversationKey(eph, to)) };
  return NT.finalizeEvent(await mine(tmpl, bits), eph);
}
function unwrapDM(wrap, sk) { // with the checks nostr-tools' unwrapEvent leaves to the caller
  const NT = env.NT, seal = JSON.parse(NT.nip44.decrypt(wrap.content, NT.nip44.getConversationKey(sk, wrap.pubkey)));
  if (seal.kind !== 13 || !NT.verifyEvent(seal)) throw new Error('bad seal');
  const rumor = JSON.parse(NT.nip44.decrypt(seal.content, NT.nip44.getConversationKey(sk, seal.pubkey)));
  if (rumor.kind !== 14 || rumor.pubkey !== seal.pubkey || NT.getEventHash(rumor) !== rumor.id) throw new Error('bad rumor');
  return rumor;
}

function thread(peer) { let t = chat.threads.get(peer); if (!t) { t = { peer, subject: '', msgs: [], unread: 0 }; chat.threads.set(peer, t); } return t; }
function addMsg(peer, m) {
  const t = thread(peer), i = t.msgs.findIndex(x => x.id === m.id);
  if (i >= 0) t.msgs[i] = { ...t.msgs[i], ...m }; else { t.msgs.push(m); t.msgs.sort((a, b) => a.ts - b.ts); if (t.msgs.length > 300) t.msgs.splice(0, t.msgs.length - 300); }
  if (m.subject) t.subject = m.subject;
  save(); notify();
}
function save() { try { localStorage.setItem(CACHE(), JSON.stringify([...chat.threads.values()].map(t => ({ ...t, unread: 0 })))); } catch {} }
function load() { try { for (const t of JSON.parse(localStorage.getItem(CACHE()) || '[]')) { if (t.peer === chat.me) continue; chat.threads.set(t.peer, t); t.msgs.forEach(m => { seen.add(m.id); if (m.pending) { m.pending = false; m.failed = [{ msg: 'interrupted' }]; } }); } } catch {} }

function onWrap(wrap) {
  if (seen.has(wrap.id)) return; seen.add(wrap.id);
  let rumor; try { rumor = unwrapDM(wrap, chat.sk); } catch { return; }
  if (seen.has(rumor.id)) return; seen.add(rumor.id);
  const to = tag(rumor, 'p') || '', mine_ = rumor.pubkey === chat.me, peer = mine_ ? to : rumor.pubkey;
  if (!/^[0-9a-f]{64}$/.test(peer) || (chat.mode === 'visitor' && peer !== env.SITE)) return;
  if (mine_ && to === chat.me) return; // a copy addressed to myself is not a conversation
  const text = String(rumor.content || '').slice(0, 5000);
  addMsg(peer, { id: rumor.id, from: rumor.pubkey, to, text, ts: rumor.created_at, mine: mine_, subject: mine_ ? '' : tag(rumor, 'subject') || '' });
  if (!mine_ && rumor.created_at > now() - 3 * 86400) {
    if (chat.mode === 'owner' && chat.active !== peer) { thread(peer).unread++; chat.unread++; notify(); }
    if (document.hidden && globalThis.Notification?.permission === 'granted') try { new Notification(chat.mode === 'owner' ? `New message from ${thread(peer).subject || short(peer)}` : 'Ronish replied', { body: text.slice(0, 120) }); } catch {}
  }
}
function subscribe() { chat.sub?.close(); chat.sub = chat.me && pool ? pool.subscribe(env.RELAYS, { kinds: [1059], '#p': [chat.me] }, { label: 'dm', onevent: onWrap }) : null; }

export function chatConfigure(ownerMode) {
  const mode = ownerMode ? 'owner' : 'visitor';
  if (chat.live && chat.mode === mode) return;
  chat.sub?.close(); chat.threads = new Map(); seen.clear(); chat.unread = 0; chat.active = null; chat.mode = mode; chat.live = true;
  if (ownerMode) { chat.sk = owner.sk; chat.me = env.SITE; }
  else {
    let raw = localStorage.getItem(VISITOR_KEY) || localStorage.getItem('bottlechat_visitor_nsec'); // migrate the old chat's identity
    if (raw && !localStorage.getItem(VISITOR_KEY)) localStorage.setItem(VISITOR_KEY, raw);
    ['bottlechat_visitor_nsec', 'bottlechat_owner_nsec', 'bottlechat_messages', 'bottlechat_seen_ids', 'bottlechat_owner_conversations', 'bottlechat_welcome_shown', 'bottlechat_nick'].forEach(k => localStorage.removeItem(k));
    try { chat.sk = raw ? env.NT.nip19.decode(raw).data : null; } catch { chat.sk = null; }
    chat.me = chat.sk ? env.NT.getPublicKey(chat.sk) : null; chat.nick = localStorage.getItem(NICK) || '';
  }
  load(); subscribe(); notify();
}
export function ensureVisitorKey() { if (chat.mode === 'owner') return owner.sk; ensureKey(); return chat.sk; }
function ensureKey() { if (chat.sk) return; chat.sk = env.NT.generateSecretKey(); chat.me = env.NT.getPublicKey(chat.sk); localStorage.setItem(VISITOR_KEY, env.NT.nip19.nsecEncode(chat.sk)); subscribe(); }

export function setNick(n) { chat.nick = String(n || '').trim().slice(0, 40); localStorage.setItem(NICK, chat.nick); }
export async function send(peer, text) {
  text = text.trim().slice(0, 5000); if (!text || chat.busy || !env.NT) return;
  const isOwner = chat.mode === 'owner';
  if (isOwner && globalThis.Notification?.permission === 'default') Notification.requestPermission().catch(() => {}); // from a click, as browsers require
  if (!isOwner) { ensureKey(); if (chat.nick) localStorage.setItem(NICK, chat.nick); }
  const rumor = makeRumor(chat.sk, peer, text, isOwner ? '' : chat.nick); seen.add(rumor.id);
  addMsg(peer, { id: rumor.id, from: chat.me, to: peer, text, ts: rumor.created_at, mine: true, pending: true });
  chat.busy = 'sealing'; notify();
  try {
    const toPeer = await wrapRumor(rumor, chat.sk, peer, peer === env.SITE ? POW_IN : POW_OUT);
    chat.busy = 'sending'; notify();
    const res = await publish(toPeer, env.RELAYS);
    wrapRumor(rumor, chat.sk, chat.me, isOwner ? POW_IN : 0).then(w => publish(w, isOwner ? env.RELAYS : env.BACKUPS)).catch(() => {});
    const ok = res.filter(r => r.ok);
    addMsg(peer, { id: rumor.id, pending: false, delivered: ok.map(r => r.url), failed: res.filter(r => !r.ok) });
    if (!ok.length) toast('no relay accepted the message: ' + res.map(r => r.msg).join('; '), 'err');
  } catch (e) { toast('could not send: ' + e.message, 'err'); addMsg(peer, { id: rumor.id, pending: false, failed: [{ msg: e.message }] }); }
  chat.busy = ''; notify();
}

// ---- component (live=false is the shell the bake pre-renders; boot.js wires it) ----
const fmtTime = ts => { const d = new Date(ts * 1000); return `${d.toISOString().slice(5, 10).replace('-', '/')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`; };
const Delivery = ({ m }) => m.pending ? html`<small>${chat.busy === 'sealing' ? 'sealing (proof of work)…' : 'sending…'}</small>`
  : m.mine ? html`<small title=${(m.delivered || []).join('\n')}>${fmtTime(m.ts)} · ${m.delivered?.length ? `✓ ${m.delivered.length} relay${m.delivered.length > 1 ? 's' : ''}${m.delivered.includes(env.PRIMARY) ? ' incl. mine' : ''}` : m.delivered ? '✗ not delivered' : '↗ sent'}</small>`
  : html`<small>${fmtTime(m.ts)}</small>`;
function Log({ msgs }) {
  const ref = useRef();
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [msgs.length, msgs[msgs.length - 1]?.pending]);
  return html`<div class="log" ref=${ref}>${msgs.map(m => html`<div key=${m.id} class=${'msg' + (m.mine ? ' out' : '')}>${m.text}<${Delivery} m=${m} /></div>`)}</div>`;
}
function Composer({ peer, placeholder }) {
  const [text, setText] = useState(() => { const t = chat.seed || ''; chat.seed = ''; return t; });
  const go = e => { e?.preventDefault(); const t = text; setText(''); send(peer, t); };
  return html`<form onSubmit=${go}><textarea rows="1" value=${text} placeholder=${placeholder} disabled=${!!chat.busy} onInput=${e => setText(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter' && !e.shiftKey) go(e); }} />
    <button class="pri" type="submit" disabled=${!!chat.busy}>${chat.busy ? html`<span class="spin"></span>${chat.busy}` : 'send'}</button></form>`;
}
function Keys() {
  const exportKey = () => { const k = localStorage.getItem(VISITOR_KEY); if (!k) return toast('no key yet; send a message first'); navigator.clipboard?.writeText(k).then(() => toast('key copied, keep it private'), () => prompt('your key:', k)); };
  const importKey = () => { const v = prompt('paste an nsec1… key to continue an earlier conversation:'); if (!v) return; try { env.NT.nip19.decode(v.trim()); localStorage.setItem(VISITOR_KEY, v.trim()); localStorage.removeItem(CACHE()); location.reload(); } catch { toast('that is not a valid key', 'err'); } };
  const forget = () => { if (confirm("Forget this browser's key and conversation?")) { localStorage.removeItem(VISITOR_KEY); localStorage.removeItem(NICK); localStorage.removeItem(CACHE()); location.reload(); } };
  return html`<details class="keys"><summary>your key</summary><div>Messages are encrypted to my key and signed by one that lives only in this browser. Export it to pick the conversation up elsewhere.</div>
    <div class="row"><button class="sm" onClick=${exportKey}>export</button><button class="sm" onClick=${importKey}>import</button><button class="sm danger" onClick=${forget}>forget</button></div></details>`;
}
export function Chat({ live, ownerMode }) {
  const [, bump] = useState(0);
  if (ownerMode) {
    const threads = [...chat.threads.values()].sort((a, b) => (b.msgs.at(-1)?.ts || 0) - (a.msgs.at(-1)?.ts || 0));
    if (!chat.active && threads[0]) chat.active = threads[0].peer;
    const t = chat.threads.get(chat.active);
    const open = x => { chat.active = x.peer; chat.unread -= x.unread; x.unread = 0; bump(n => n + 1); notify(); };
    return html`<div class="chat inbox">
      <aside class="threads">${threads.length ? threads.map(x => { const last = x.msgs.at(-1); return html`<button key=${x.peer} class=${'thread' + (x.peer === chat.active ? ' on' : '')} onClick=${() => open(x)}>
        <b>${x.subject || short(x.peer)}</b><time>${last ? fmtTime(last.ts) : ''}</time>
        <small>${last ? (last.mine ? 'you: ' : '') + last.text.slice(0, 70) : ''}</small>${x.unread ? html`<i class="badge">${x.unread}</i>` : null}</button>`; })
        : html`<p class="empty">no conversations yet; they arrive here from the relay</p>`}</aside>
      <section class="conv">${t ? html`<div class="who"><b>${t.subject || 'anonymous'}</b><code>${short(t.peer)}</code><span>${t.msgs.length} message${t.msgs.length === 1 ? '' : 's'}</span></div><${Log} msgs=${t.msgs} /><${Composer} peer=${t.peer} placeholder="reply (20-bit proof of work, a few seconds)" />` : html`<p class="empty">pick a conversation</p>`}</section>
    </div>`;
  }
  const msgs = chat.threads.get(env.SITE)?.msgs || [];
  return html`<div class="chat">
    <div class="who">${msgs.length ? html`<span>you are <b>${chat.nick || 'anonymous'}</b></span><button class="lnk" onClick=${() => { const n = prompt('nickname:', chat.nick); if (n != null) { chat.nick = n.trim().slice(0, 40); localStorage.setItem(NICK, chat.nick); bump(x => x + 1); } }}>change</button>`
      : html`<span>call me</span><input placeholder="your name (optional)" maxlength="40" value=${chat.nick} onInput=${e => { chat.nick = e.target.value; }} />`}</div>
    ${msgs.length ? html`<${Log} msgs=${msgs} />` : html`<div class="hint">End-to-end encrypted, no account: your browser mints a key, wraps the message to mine (NIP-17) and hands it to my relay. I reply here; come back in the same browser or export your key below.</div>`}
    <${Composer} peer=${env.SITE} placeholder="say hi…" />
    <${Keys} /></div>`;
}

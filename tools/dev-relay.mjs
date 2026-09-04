// dev-relay.mjs, a throwaway in-memory relay for local testing that applies
// the same write policy as the personal relay on the Dell
// (dell-nix/modules/strfry-node.nix, mode "personal"). OWNER=<hex> PORT=7777
import { WebSocketServer } from 'ws';
import { verifyEvent } from 'nostr-tools/pure';
import { matchFilters } from 'nostr-tools/filter';
import { getPow } from 'nostr-tools/nip13';

const OWNER = (process.env.OWNER || '').toLowerCase(), PORT = +(process.env.PORT || 7777);
const WRAP_POW_OWNER = 16, WRAP_POW_ANY = 20, WRAP_MAX_BYTES = 16384;
const events = new Map();
const dTag = e => e.tags.find(t => t[0] === 'd')?.[1] ?? '';
const repl = k => k === 0 || k === 3 || (k >= 10000 && k < 20000) || (k >= 30000 && k < 40000);
const keyOf = e => !repl(e.kind) ? e.id : e.kind >= 30000 ? `${e.kind}:${e.pubkey}:${dTag(e)}` : `${e.kind}:${e.pubkey}`;

function policy(ev) {
  if (OWNER && ev.pubkey === OWNER) return [true, ''];
  if (ev.kind === 1059) {
    if (JSON.stringify(ev).length > WRAP_MAX_BYTES) return [false, 'blocked: gift wrap too large'];
    if (ev.created_at > Date.now() / 1000 + 900) return [false, 'invalid: created_at is too far in the future'];
    const p = ev.tags.find(t => t[0] === 'p')?.[1] || '';
    const need = OWNER && p === OWNER ? WRAP_POW_OWNER : WRAP_POW_ANY;
    const nonce = ev.tags.find(t => t[0] === 'nonce');
    if ((nonce ? +nonce[2] : 0) < need || getPow(ev.id) < need) return [false, `pow: gift wraps need ${need} bits here`];
    return [true, ''];
  }
  return [false, "restricted: this relay only accepts the owner's events"];
}

const wss = new WebSocketServer({ port: PORT });
const subs = new Map(); // ws -> Map(id -> filters)
wss.on('connection', ws => {
  subs.set(ws, new Map());
  ws.on('close', () => subs.delete(ws));
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m[0] === 'EVENT') {
      const ev = m[1];
      if (!verifyEvent(ev)) return ws.send(JSON.stringify(['OK', ev.id, false, 'invalid: bad signature']));
      const [ok, msg] = policy(ev);
      if (!ok) return ws.send(JSON.stringify(['OK', ev.id, false, msg]));
      if (ev.kind === 5) for (const t of ev.tags) { if (t[0] === 'e') events.delete(t[1]); if (t[0] === 'a') for (const [k, e] of events) if (k === t[1] && e.created_at <= ev.created_at) events.delete(k); }
      const k = keyOf(ev), cur = events.get(k);
      if (cur && cur.created_at > ev.created_at) return ws.send(JSON.stringify(['OK', ev.id, true, 'duplicate: older than the stored version']));
      events.set(k, ev);
      ws.send(JSON.stringify(['OK', ev.id, true, '']));
      for (const [w, ss] of subs) for (const [id, filters] of ss) if (matchFilters(filters, ev)) w.send(JSON.stringify(['EVENT', id, ev]));
      console.log(`[${PORT}] accepted kind ${ev.kind} ${ev.id.slice(0, 8)} from ${ev.pubkey.slice(0, 8)}`);
    } else if (m[0] === 'REQ') {
      const id = m[1], filters = m.slice(2);
      subs.get(ws).set(id, filters);
      const limit = Math.min(...filters.map(f => f.limit ?? 500));
      [...events.values()].filter(e => matchFilters(filters, e)).sort((a, b) => b.created_at - a.created_at).slice(0, limit)
        .forEach(e => ws.send(JSON.stringify(['EVENT', id, e])));
      ws.send(JSON.stringify(['EOSE', id]));
    } else if (m[0] === 'CLOSE') subs.get(ws)?.delete(m[1]);
  });
});
console.log(`dev relay on ws://127.0.0.1:${PORT} owner=${OWNER.slice(0, 8) || '(none)'}`);

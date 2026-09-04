// policy-test.mjs, prove a personal relay's write policy from the outside
// with a throwaway key. Usage: node policy-test.mjs wss://relay.ronishbhatt.com <owner hex>
// Expects: plain note REJECTED, unmined wrap REJECTED, 16-bit wrap to owner
// ACCEPTED, 16-bit wrap to a stranger REJECTED (needs 20), 20-bit wrap to a stranger ACCEPTED.
import { generateSecretKey, getPublicKey, finalizeEvent, getEventHash } from 'nostr-tools/pure';
import { getPow } from 'nostr-tools/nip13';
const [url, OWNER] = process.argv.slice(2);
if (!url || !OWNER) { console.error('usage: node policy-test.mjs <relay url> <owner hex>'); process.exit(2); }
const sk = generateSecretKey(); const stranger = getPublicKey(generateSecretKey());
const mine = (ev, bits) => { const tag = ['nonce', '0', String(bits)]; ev.tags.push(tag); for (let n = 1; ; n++) { tag[1] = String(n); ev.id = getEventHash(ev); if (getPow(ev.id) >= bits) return ev; } };
const wrap = (to, bits) => { const eph = generateSecretKey(); const t = { kind: 1059, pubkey: getPublicKey(eph), created_at: Math.floor(Date.now() / 1000) - 60, tags: [['p', to]], content: 'policy-test ' + Math.random() }; return finalizeEvent(bits ? mine(t, bits) : t, eph); };
const cases = [
  ['plain kind-1 note from a stranger', finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'policy-test' }, sk), false],
  ['unmined gift wrap to the owner', wrap(OWNER, 0), false],
  ['16-bit gift wrap to the owner', wrap(OWNER, 16), true],
  ['16-bit gift wrap to a stranger', wrap(stranger, 16), false],
  ['20-bit gift wrap to a stranger', wrap(stranger, 20), true],
];
const ws = new WebSocket(url);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = e => rej(new Error('connect failed')); });
let fail = 0;
for (const [label, ev, expect] of cases) {
  const ok = await new Promise(res => { const h = m => { const d = JSON.parse(m.data); if (d[0] === 'OK' && d[1] === ev.id) { ws.removeEventListener('message', h); res([d[2], d[3]]); } }; ws.addEventListener('message', h); ws.send(JSON.stringify(['EVENT', ev])); setTimeout(() => res([null, 'timeout']), 10000); });
  const pass = ok[0] === expect; if (!pass) fail++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}: ${ok[0] === null ? 'no answer' : ok[0] ? 'accepted' : 'rejected'} ${ok[1] ? '(' + ok[1] + ')' : ''}`);
}
ws.close(); process.exit(fail ? 1 : 0);

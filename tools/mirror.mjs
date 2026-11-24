// mirror.mjs <relay>: copy every event the site key signed (blocks, notes, deletions) from my relay to
// another relay. Signed events carry their own proof, so this needs no key; run it when a backup changes.
import fs from 'node:fs';
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import { verifyEvent } from 'nostr-tools/pure';
import WS from 'ws';
useWebSocketImplementation(WS);
const target = process.argv[2]; if (!target) { console.error('usage: node tools/mirror.mjs wss://relay'); process.exit(2); }
const src = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const m = n => src.match(new RegExp(`<meta name="${n}" content="([^"]*)"`))?.[1] || '';
const SITE = m('site-pubkey'), PRIMARY = m('site-relay');
const pool = new SimplePool();
const evs = (await pool.querySync([PRIMARY], { authors: [SITE], kinds: [1, 5, 30078], limit: 500 }, { maxWait: 8000 })).filter(e => verifyEvent(e));
evs.sort((a, b) => (a.kind === 5) - (b.kind === 5) || a.created_at - b.created_at); // deletions last, so the target sees what they delete
let ok = 0; const bad = [];
for (const ev of evs) { const [r] = await Promise.allSettled(pool.publish([target], ev, { maxWait: 8000 })); if (r.status === 'fulfilled') ok++; else bad.push(`${ev.kind} ${ev.id.slice(0, 8)}: ${r.reason?.message || r.reason}`); }
const back = await pool.querySync([target], { authors: [SITE], kinds: [1, 5, 30078], limit: 500 }, { maxWait: 8000 });
console.log(`${target}: ${ok}/${evs.length} accepted, ${back.length} now served${bad.length ? '; refused: ' + bad.join('; ') : ''}`);
pool.destroy(); process.exit(bad.length ? 1 : 0);

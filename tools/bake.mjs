#!/usr/bin/env node
// bake.mjs — refresh the signed snapshot from the relays and inline it into
// public/index.html (and public/site.json). deploy.sh runs it; it is safe to
// run any time. Drafts survive until a signed event with the same address
// exists on a relay (or a deletion covers it).
import fs from 'node:fs';
import { SimplePool } from 'nostr-tools/pool';
import { verifyEvent } from 'nostr-tools/pure';

const PUB = (process.env.SITE_DIR ? process.env.SITE_DIR.replace(/\/?$/, '/') : new URL('../public/', import.meta.url).pathname);
const html = fs.readFileSync(PUB + 'index.html', 'utf8');
const meta = n => html.match(new RegExp(`<meta name="${n}" content="([^"]*)"`))?.[1] || '';
const SITE = meta('site-pubkey');
const RELAYS = [meta('site-relay'), ...meta('site-backups').split(',').map(s => s.trim()).filter(Boolean)];
const snap = JSON.parse(fs.readFileSync(PUB + 'site.json', 'utf8'));

const dTag = e => e.tags.find(t => t[0] === 'd')?.[1] ?? '';
const addr = e => `${e.kind}:${e.pubkey}:${dTag(e)}`;
const repl = k => k === 0 || k === 3 || (k >= 10000 && k < 20000) || (k >= 30000 && k < 40000);
const keyOf = e => !repl(e.kind) ? e.id : e.kind >= 30000 ? addr(e) : `${e.kind}:${e.pubkey}`;
const tags = (e, n) => e.tags.filter(t => t[0] === n).map(t => t[1]);

const pool = new SimplePool();
let fetched = [];
try {
  fetched = await pool.querySync(RELAYS, { authors: [SITE], kinds: [0, 1, 5, 30023, 30078], limit: 500 }, { maxWait: 8000 });
} catch (e) { console.error('relay query failed:', e.message); }
pool.destroy();

const good = fetched.filter(e => e.pubkey === SITE && verifyEvent(e));
const dels = good.filter(e => e.kind === 5);
const deleted = e => dels.some(d => tags(d, 'e').includes(e.id) || (e.kind >= 30000 && d.created_at >= e.created_at && tags(d, 'a').includes(addr(e))));
const byKey = new Map();
for (const e of good) {
  if (e.kind === 5 || deleted(e)) continue;
  const k = keyOf(e), cur = byKey.get(k);
  if (!cur || cur.created_at < e.created_at || (cur.created_at === e.created_at && cur.id > e.id)) byKey.set(k, e);
}
const events = [...byKey.values(), ...dels].sort((a, b) => a.kind - b.kind || b.created_at - a.created_at);
// Only re-bake if the relays actually answered: an outage must not wipe the last good snapshot.
const previous = snap.events || [];
const useNew = good.length > 0 || previous.length === 0;
const finalEvents = useNew ? events : previous;
const live = new Set(finalEvents.map(keyOf));
const drafts = (snap.drafts || []).filter(d => { const e = { ...d, pubkey: SITE, created_at: 0, id: '' }; return !live.has(keyOf(e)) && !deleted(e); });

const out = { site: SITE, baked_at: Math.floor(Date.now() / 1000), events: finalEvents, drafts };
fs.writeFileSync(PUB + 'site.json', JSON.stringify(out, null, 1));
const inline = JSON.stringify(out).replace(/<\//g, '<\\/');
const re = /(<script type="application\/json" id="snapshot">)[\s\S]*?(<\/script>)/;
if (!re.test(html)) throw new Error('snapshot block not found in index.html');
fs.writeFileSync(PUB + 'index.html', html.replace(re, `$1${inline}$2`));
console.log(`baked: ${finalEvents.length} signed events (${good.length} fetched from ${RELAYS.length} relays${useNew ? '' : ', kept previous'}), ${drafts.length} drafts remaining`);

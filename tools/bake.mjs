#!/usr/bin/env node
// bake.mjs <public dir>: pull the site key's events from the relays, verify
// them, pre-render the page with the same components the browser uses, and
// write index.html (title, description, stylesheet, body, a tiny index of
// baked event ids, import map with integrity, CSP and SRI hashes) plus
// site.json (the full events + still-unpublished drafts the app fetches on
// demand). Drafts live in drafts.json for good: a block with no live signed
// version, including one that was deleted or recalled, renders its draft.
// An unreachable relay keeps the previous snapshot.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { render } from 'preact-render-to-string';
import { verifyEvent } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import { init, env, store, apply, sel, keyOf } from '../public/js/store.js';
import { html, Page } from '../public/js/ui.js';
import { Chat } from '../public/js/chat.js';

const PUB = (process.argv[2] || new URL('../public', import.meta.url).pathname).replace(/\/$/, '') + '/';
const src = fs.readFileSync(PUB + 'index.html', 'utf8');
const meta = n => src.match(new RegExp(`<meta name="${n}" content="([^"]*)"`))?.[1] || '';
init({ site: meta('site-pubkey'), relay: meta('site-relay'), backups: meta('site-backups').split(',').map(s => s.trim()).filter(Boolean), NT: { verifyEvent } });
const snap = JSON.parse(fs.readFileSync(PUB + 'site.json', 'utf8'));
const seed = JSON.parse(fs.readFileSync(PUB + 'drafts.json', 'utf8')).drafts; // permanent seed content: the fallback when a block has no live signed version

const pool = new SimplePool(); let fetched = [];
try { fetched = await pool.querySync(env.RELAYS, { authors: [env.SITE], kinds: [0, 1, 5, 30023, 30078], limit: 500 }, { maxWait: 8000 }); } catch (e) { console.error('relay query failed:', e.message); }
pool.destroy();
const good = fetched.filter(e => e.pubkey === env.SITE && verifyEvent(e));
const useNew = good.length > 0 || !(snap.events || []).length;
for (const e of useNew ? good : snap.events) apply(e, { verified: true });
for (const d of seed) { const ev = { ...d, pubkey: env.SITE, created_at: 0, sig: '' }; ev.id = 'draft:' + keyOf(ev); apply(ev, { draft: true }); }

const events = [...store.events.values()].filter(e => !e.draft).concat(store.dels);
const drafts = seed; // the whole seed ships every time: a draft only fills a key with no live signed version, so it costs nothing until it is needed
const baked_at = Math.floor(Date.now() / 1000);
fs.writeFileSync(PUB + 'site.json', JSON.stringify({ site: env.SITE, baked_at, events, drafts }, null, 1));

const cfg = sel.config(), p = sel.profileData();
const body = render(html`<${Page} Chat=${Chat} chatProps=${{ live: false }} />`);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const sha = (algo, data) => crypto.createHash(algo).update(data).digest('base64');
const sri = f => `sha384-${sha('sha384', fs.readFileSync(PUB + f))}`;
// First-party modules get content-hashed copies (imports rewritten to match), so
// the HTML, which is never cached, always names the exact bytes it was baked
// with; stale copies at any cache layer can no longer be served under a live name.
const ORDER = ['pow-worker', 'store', 'ui', 'chat', 'owner', 'app', 'boot'];
const hashed = {}, keep = new Set();
for (const name of ORDER) {
  let code = fs.readFileSync(PUB + `js/${name}.js`, 'utf8');
  code = code.replace(/(['"])\.\/([a-z-]+)\.js\1/g, (m, q, dep) => hashed[dep] ? `${q}./${hashed[dep]}${q}` : m);
  const h = crypto.createHash('sha256').update(code).digest('hex').slice(0, 8);
  hashed[name] = `${name}.${h}.js`; keep.add(hashed[name]);
  fs.writeFileSync(PUB + 'js/' + hashed[name], code);
}
for (const f of fs.readdirSync(PUB + 'js')) if (/^[a-z-]+\.[0-9a-f]{8}\.js$/.test(f) && !keep.has(f)) fs.unlinkSync(PUB + 'js/' + f);
// Import map: bare names to pinned vendor files, with integrity for every module the app can load.
const VENDOR = { preact: '/vendor/preact-10.29.8.c30e721e.mjs', 'preact/hooks': '/vendor/preact-hooks-10.29.8.a6ee626f.mjs', htm: '/vendor/htm-3.1.1.mjs', marked: '/vendor/marked-18.0.11.05e41134.mjs' };
const MODULES = [...Object.values(VENDOR), ...['app', 'store', 'ui', 'chat', 'owner'].map(n => '/js/' + hashed[n])];
const LAZY = ['/vendor/nostr-tools-2.25.2.bundle.js', '/vendor/dompurify-3.4.14.min.c2f26ea4.js'];
const importmap = JSON.stringify({ imports: VENDOR, integrity: Object.fromEntries(MODULES.map(f => [f, sri(f)])) });
const index = JSON.stringify({ baked_at, ids: events.map(e => e.id) });
const out = src
  .replace(/<title>[^<]*<\/title>/, `<title>${esc(cfg.title)}</title>`)
  .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(p.about || '')}">`)
  .replace(/<meta name="site-sri" content="[^"]*">/, `<meta name="site-sri" content="${esc(JSON.stringify(Object.fromEntries(LAZY.map(f => [f, sri(f)]))))}">`)
  .replace(/'sha256-[^']*'/, `'sha256-${sha('sha256', importmap)}'`)
  .replace(/<script type="importmap">[\s\S]*?<\/script>/, `<script type="importmap">${importmap}</script>`)
  .replace(/<style id="theme">[\s\S]*?<\/style>/, `<style id="theme">${sel.css().replace(/<\/style/gi, '')}</style>`)
  .replace(/<main id="app">[\s\S]*?<\/main>/, `<main id="app">${body}</main>`)
  .replace(/(<script type="application\/json" id="snapshot">)[\s\S]*?(<\/script>)/, `$1${index}$2`)
  .replace(/<script type="module" src="[^"]*" integrity="[^"]*">/, `<script type="module" src="/js/${hashed.boot}" integrity="${sri('/js/' + hashed.boot)}">`);
fs.writeFileSync(PUB + 'index.html', out);
console.log(`baked ${PUB}: ${events.length} signed events (${good.length} fetched from ${env.RELAYS.length} relays${useNew ? '' : ', kept previous'}), ${seed.length} seed drafts (${[...store.events.values()].filter(e => e.draft).length} showing), html ${(out.length / 1024).toFixed(1)} KB`);

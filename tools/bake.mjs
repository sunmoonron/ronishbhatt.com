#!/usr/bin/env node
// bake.mjs <public dir> — pull the site key's events from the relays, verify
// them, pre-render the page with the same components the browser uses, and
// write index.html (title, description, stylesheet, body, snapshot, CSP hash)
// plus site.json. Drafts survive until a signed event with the same address
// exists. An unreachable relay keeps the previous snapshot.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { render } from 'preact-render-to-string';
import { verifyEvent } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import { init, env, store, apply, sel, keyOf, tagsOf, addrOf, K } from '../public/js/store.js';
import { html, Page } from '../public/js/ui.js';
import { Chat } from '../public/js/chat.js';

const PUB = (process.argv[2] || new URL('../public', import.meta.url).pathname).replace(/\/$/, '') + '/';
const src = fs.readFileSync(PUB + 'index.html', 'utf8');
const meta = n => src.match(new RegExp(`<meta name="${n}" content="([^"]*)"`))?.[1] || '';
init({ site: meta('site-pubkey'), relay: meta('site-relay'), backups: meta('site-backups').split(',').map(s => s.trim()).filter(Boolean), NT: { verifyEvent } });
const snap = JSON.parse(fs.readFileSync(PUB + 'site.json', 'utf8'));

const pool = new SimplePool(); let fetched = [];
try { fetched = await pool.querySync(env.RELAYS, { authors: [env.SITE], kinds: [0, 1, 5, 30023, 30078], limit: 500 }, { maxWait: 8000 }); } catch (e) { console.error('relay query failed:', e.message); }
pool.destroy();
const good = fetched.filter(e => e.pubkey === env.SITE && verifyEvent(e));
const useNew = good.length > 0 || !(snap.events || []).length;
for (const e of useNew ? good : snap.events) apply(e, { verified: true });
for (const d of snap.drafts || []) { const ev = { ...d, pubkey: env.SITE, created_at: 0, sig: '' }; ev.id = 'draft:' + keyOf(ev); apply(ev, { draft: true }); }

const events = [...store.events.values()].filter(e => !e.draft).concat(store.dels);
const drafts = (snap.drafts || []).filter(d => { const ev = { ...d, pubkey: env.SITE, created_at: 0 }; return store.events.get(keyOf(ev))?.draft; });
const out = { site: env.SITE, baked_at: Math.floor(Date.now() / 1000), events, drafts };
fs.writeFileSync(PUB + 'site.json', JSON.stringify(out, null, 1));

const cfg = sel.config(), p = sel.profileData();
const body = render(html`<${Page} Chat=${Chat} chatProps=${{ live: false }} />`);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const sha = (algo, data) => crypto.createHash(algo).update(data).digest('base64');
const sri = f => `sha384-${sha('sha384', fs.readFileSync(PUB + f))}`;
// The import map: bare names -> pinned vendor files, plus subresource integrity
// for every module the page can load (browsers that know the field verify it).
const VENDOR = { preact: '/vendor/preact-10.29.8.mjs', 'preact/hooks': '/vendor/preact-hooks-10.29.8.mjs', htm: '/vendor/htm-3.1.1.mjs', marked: '/vendor/marked-18.0.11.mjs' };
const MODULES = [...Object.values(VENDOR), '/js/store.js', '/js/ui.js', '/js/chat.js', '/js/owner.js'];
const LAZY = ['/vendor/nostr-tools-2.25.2.bundle.js', '/vendor/dompurify-3.4.14.min.js'];
const importmap = JSON.stringify({ imports: VENDOR, integrity: Object.fromEntries(MODULES.map(f => [f, sri(f)])) });
const app = `globalThis.SRI=${JSON.stringify(Object.fromEntries(LAZY.map(f => [f, sri(f)])))};\n` + fs.readFileSync(PUB + 'js/app.js', 'utf8').replace(/<\/script/gi, '<\\/script');
let html_ = src
  .replace(/<title>[^<]*<\/title>/, `<title>${esc(cfg.title)}</title>`)
  .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(p.about || '')}">`)
  .replace(/'sha256-[^']*' 'sha256-[^']*'/, `'sha256-${sha('sha256', importmap)}' 'sha256-${sha('sha256', app)}'`)
  .replace(/<script type="importmap">[\s\S]*?<\/script>/, `<script type="importmap">${importmap}</script>`)
  .replace(/<style id="theme">[\s\S]*?<\/style>/, `<style id="theme">${sel.css().replace(/<\/style/gi, '')}</style>`)
  .replace(/<main id="app">[\s\S]*?<\/main>/, `<main id="app">${body}</main>`)
  .replace(/(<script type="application\/json" id="snapshot">)[\s\S]*?(<\/script>)/, `$1${JSON.stringify(out).replace(/<\//g, '<\\/')}$2`)
  .replace(/<script type="module"[^>]*>[\s\S]*?<\/script>\n<\/body>/, `<script type="module">${app}</script>\n</body>`);
fs.writeFileSync(PUB + 'index.html', html_);
console.log(`baked ${PUB}: ${events.length} signed events (${good.length} fetched from ${env.RELAYS.length} relays${useNew ? '' : ', kept previous'}), ${drafts.length} drafts, html ${(html_.length / 1024).toFixed(1)} KB`);

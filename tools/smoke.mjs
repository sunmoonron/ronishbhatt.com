#!/usr/bin/env node
// smoke.mjs: load the real page in headless Chrome and check what has broken before.
//
//   node tools/smoke.mjs [url] [--e2e] [--shots dir]
//
// url defaults to https://ronishbhatt.com/. Three runs: desktop wild, desktop
// calm at a narrower width, and a phone. Each run fails on a script exception,
// a console error, a same-origin request that fails, a retired section on the
// page, horizontal overflow, a chat that never subscribes for replies, an
// achievement list that is not 99 unique entries, an achievement card that
// covers the terminal or the orbit HUD, or a presence key that changes on
// reload. It warns, without failing, about relays that do not connect and a
// shell the site key has not signed yet.
// --e2e also proves a reply arrives: it publishes, to the public backups, a
// gift wrap addressed to the run's throwaway visitor key (the same path an
// owner reply takes), waits for it to appear in the chat, then deletes it.
// No dependencies beyond nostr-tools: Chrome is driven over its DevTools socket.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import * as nip44 from 'nostr-tools/nip44';
import * as nip59 from 'nostr-tools/nip59';
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import WS from 'ws';
useWebSocketImplementation(WS);

const args = process.argv.slice(2), flag = f => args.includes(f), opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const URL_ = args.find(a => /^https?:\/\//.test(a)) || 'https://ronishbhatt.com/', E2E = flag('--e2e'), SHOTS = opt('--shots');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0, warnings = 0;
const fail = (run, msg) => { failures++; console.log(`  FAIL  ${run}: ${msg}`); };
const warn = (run, msg) => { warnings++; console.log(`  warn  ${run}: ${msg}`); };
const pass = (run, msg) => console.log(`  ok    ${run}: ${msg}`);

// ---- the shell tells us the site key and the relays --------------------------------
const shell = await fetch(URL_, { headers: { 'cache-control': 'no-cache' } }).then(r => r.text());
const meta = n => shell.match(new RegExp(`<meta name="${n}" content="([^"]*)"`))?.[1] || '';
const SITE = meta('site-pubkey'), PRIMARY = meta('site-relay'), BACKUPS = meta('site-backups').split(',').map(s => s.trim()).filter(Boolean);
if (!SITE) { console.log(`no site key in the shell at ${URL_}`); process.exit(2); }

// ---- a minimal DevTools client -------------------------------------------------------
class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.n = 0; this.wait = new Map(); this.subs = new Set(); }
  async open() { await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = e => { const m = JSON.parse(e.data); const w = m.id && this.wait.get(m.id);
      if (w) { this.wait.delete(m.id); m.error ? w.rej(new Error(m.error.message)) : w.res(m.result); } else for (const f of this.subs) f(m); }; }
  send(method, params = {}, sessionId) { const id = ++this.n; this.ws.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((res, rej) => this.wait.set(id, { res, rej })); }
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-smoke-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((res, rej) => { let buf = ''; const t = setTimeout(() => rej(new Error('Chrome did not start')), 20000);
  chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); res(m[1]); } }); });
const cdp = new CDP(wsUrl); await cdp.open();
const shutdown = () => { try { chrome.kill('SIGKILL'); } catch {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };

async function openPage({ width, height, mobile, wild, visitorNsec }) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true }); // each run starts with empty storage
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp.send(m, p, sessionId), log = { errors: [], socket: [], failed: [] }, origin = new URL(URL_).origin;
  cdp.subs.add(m => { if (m.sessionId !== sessionId) return; const p = m.params;
    if (m.method === 'Runtime.exceptionThrown') log.errors.push('exception: ' + String(p.exceptionDetails.exception?.description || p.exceptionDetails.text).split('\n')[0]);
    if (m.method === 'Runtime.consoleAPICalled' && p.type === 'error') log.errors.push('console.error: ' + p.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
    if (m.method === 'Log.entryAdded' && p.entry.level === 'error') (/WebSocket connection/.test(p.entry.text) ? log.socket : log.errors).push(p.entry.text.slice(0, 200));
    if (m.method === 'Network.responseReceived' && p.response.status >= 400 && p.response.url.startsWith(origin)) log.failed.push(`${p.response.status} ${p.response.url}`); });
  for (const d of ['Runtime', 'Log', 'Page', 'Network']) await s(`${d}.enable`);
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile });
  if (mobile) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await s('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('rb.wild', '${wild ? 1 : 0}'); localStorage.setItem('rb.ach.sound', '0');${visitorNsec ? ` localStorage.setItem('rb.visitor.nsec', '${visitorNsec}');` : ''} } catch {}` });
  const ev = async expr => { const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const until = async (expr, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await ev(expr); if (v) return v; } catch {} await sleep(250); } return null; };
  const shot = async name => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const { data } = await s('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(data, 'base64')); };
  return { s, ev, until, log, shot, close: async () => { await cdp.send('Target.closeTarget', { targetId }); await cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {}); } };
}
// the page's own module instances, found by their content-hashed names
const MOD = n => `(async () => { const u = [...performance.getEntriesByType('resource').map(e => e.name), ...[...document.querySelectorAll('link[rel=modulepreload]')].map(l => l.href)].find(x => /\\/js\\/${n}\\.[0-9a-f]{8}\\.js$/.test(x)); return u ? import(u) : null; })()`;
const rectOverlap = `(a, b) => { if (!a || !b) return 0; const r = a.getBoundingClientRect(), q = b.getBoundingClientRect(); if (!r.width || !q.width || getComputedStyle(b).display === 'none') return 0; return Math.max(0, Math.min(r.right, q.right) - Math.max(r.left, q.left)) * Math.max(0, Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top)); }`;

async function run(name, cfg) {
  console.log(`\n${name} (${cfg.width}x${cfg.height}${cfg.mobile ? ', touch' : ''}, ${cfg.wild ? 'wild' : 'calm'})`);
  const sk = generateSecretKey(), pk = getPublicKey(sk), p = await openPage({ ...cfg, visitorNsec: nip19.nsecEncode(sk) });
  await p.s('Page.navigate', { url: URL_ });
  // wild mode descrambles text in from ciphertext, so read the name once it has settled
  const h1 = await p.until(`(async () => { const t = () => document.querySelector('main > header.me h1')?.textContent.trim(); const a = t(); await new Promise(r => setTimeout(r, 1200)); return a && a === t() && !document.querySelector('main .veil') ? a : null; })()`, 20000);
  h1 ? pass(name, `rendered "${h1}"`) : fail(name, 'the header never rendered');
  await p.until(`document.querySelector('#chat') && document.querySelectorAll('main section.c').length >= 3 && document.querySelectorAll('main > details').length >= 3`);
  const secs = await p.ev(`[...document.querySelectorAll('main > section, main > details')].map(e => e.id)`);
  for (const id of ['projects', 'writing', 'chat']) if (!secs.includes(id)) fail(name, `section #${id} missing`);
  const retired = secs.filter(id => id === 'mural' || id === 'garden');
  retired.length ? fail(name, `retired sections still on the page: ${retired}`) : pass(name, `sections ${secs.join(', ')}`);
  // replies: the chat must subscribe to this visitor's key once the pool exists
  const subscribed = await p.until(`${MOD('chat')}.then(m => !!(m && m.chat.sub && m.chat.me === '${pk}'))`, 20000);
  subscribed ? pass(name, 'chat subscribed for replies to the visitor key') : fail(name, 'chat never subscribed for replies');
  if (E2E && cfg.e2e) {
    const text = `smoke test ${Math.random().toString(36).slice(2, 8)}`, eph = generateSecretKey();
    const rumor = nip59.createRumor({ kind: 14, content: text, tags: [['p', SITE]] }, sk), seal = nip59.createSeal(rumor, sk, pk);
    const wrap = finalizeEvent({ kind: 1059, created_at: Math.floor(Date.now() / 1000) - 60, tags: [['p', pk]], content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(eph, pk)) }, eph);
    const pool = new SimplePool(); const res = await Promise.allSettled(pool.publish(BACKUPS, wrap, { maxWait: 8000 }));
    const took = res.filter(r => r.status === 'fulfilled').length, refused = res.map((r, i) => r.status === 'rejected' ? `${BACKUPS[i].replace('wss://', '')} (${String(r.reason?.message || r.reason).slice(0, 60)})` : null).filter(Boolean);
    if (refused.length) warn(name, 'backups that refused the wrap: ' + refused.join('; '));
    const shown = await p.until(`[...document.querySelectorAll('#chat .log .msg')].some(m => m.textContent.includes(${JSON.stringify(text)}))`, 20000);
    shown ? pass(name, `a wrap addressed to the visitor reached the chat (${took}/${BACKUPS.length} backups took it)`) : fail(name, `a wrap addressed to the visitor never reached the chat (${took}/${BACKUPS.length} backups took it)`);
    await Promise.allSettled(pool.publish(BACKUPS, finalizeEvent({ kind: 5, created_at: Math.floor(Date.now() / 1000), tags: [['e', wrap.id]], content: '' }, eph), { maxWait: 6000 })); pool.destroy();
  }
  const relays = await p.until(`(() => { const d = [...document.querySelectorAll('footer [data-relay]')]; return d.length && d.every(x => x.querySelector('.dot')?.classList.contains('open')) ? d.length : 0; })()`, 15000);
  if (relays) pass(name, `all ${relays} relays connected`);
  else warn(name, 'relays not all connected: ' + await p.ev(`[...document.querySelectorAll('footer [data-relay]')].map(x => x.dataset.relay.replace('wss://', '') + (x.querySelector('.dot')?.classList.contains('open') ? ' open' : ' closed')).join(', ')`));
  const verdict = await p.until(`(window.__strict?.log || []).map(l => l.stage).find(s => s === 'shell-signed' || s === 'shell-unsigned')`, 8000);
  verdict === 'shell-signed' ? pass(name, 'shell is on the list the site key signed') : warn(name, verdict ? 'shell not on the signed list yet: unlock and press "sign this deploy"' : 'no shell verdict (not the strict entry?)');
  const over = await p.ev(`document.documentElement.scrollWidth - innerWidth`);
  over > 1 ? fail(name, `horizontal overflow of ${over}px`) : pass(name, 'no horizontal overflow');
  // achievements: ninety-nine unique ones, and a card never covers the terminal or the HUD
  const ach = await p.ev(`${MOD('presence')}.then(m => m && m.ACHIEVEMENTS.map(a => a.id))`);
  if (!ach) fail(name, 'presence module not loaded');
  else (ach.length === 99 && new Set(ach).size === 99) ? pass(name, '99 unique achievements') : fail(name, `${ach.length} achievements, ${new Set(ach).size} unique`);
  const pk1 = await p.until(`${MOD('presence')}.then(m => m && m.presenceDebug().pk)`, 20000);
  await p.ev(`document.dispatchEvent(new Event('copy'))`);
  const card = await p.until(`document.querySelector('.ach.on') ? 1 : 0`, 5000);
  if (!card) fail(name, 'no achievement card appeared after a copy');
  else { await sleep(700); const ov = await p.ev(`(() => { const o = ${rectOverlap}, c = document.querySelector('.ach'); return { term: o(c, document.querySelector('.term')), hud: o(c, document.getElementById('orbit')), chip: o(c, document.querySelector('.presence-chip')) }; })()`);
    (ov.term || ov.hud || ov.chip) ? fail(name, `achievement card overlaps: ${JSON.stringify(ov)}`) : pass(name, 'achievement card clears the terminal, HUD and chip'); }
  await p.shot(name);
  // reload: same tab, same reader
  await p.s('Page.reload', { ignoreCache: false });
  await p.until(`document.querySelector('main > header.me h1')`);
  const after = await p.until(`${MOD('presence')}.then(m => m && m.presenceDebug().pk && m.presenceDebug())`, 20000);
  if (!pk1 || !after) fail(name, 'presence key unavailable around a reload');
  else if (after.pk !== pk1) fail(name, 'presence key changed on reload: a reload counts as a new reader');
  else if (after.peers.includes(pk1)) fail(name, 'the page counts its own previous load as another reader');
  else pass(name, 'reload keeps one presence key and does not count itself');
  await sleep(1500);
  for (const e of [...new Set(p.log.errors)]) fail(name, e);
  for (const f of [...new Set(p.log.failed)]) fail(name, 'request failed: ' + f);
  if (p.log.socket.length) warn(name, `${p.log.socket.length} relay socket error(s): ${[...new Set(p.log.socket)].slice(0, 2).join(' | ')}`);
  await p.close();
}

try {
  console.log(`smoke test of ${URL_} (site ${SITE.slice(0, 12)}…, relays ${[PRIMARY, ...BACKUPS].map(u => u.replace('wss://', '')).join(', ')})`);
  await run('desktop', { width: 1280, height: 800, wild: true, e2e: true });
  await run('narrow-calm', { width: 1024, height: 700, wild: false });
  await run('phone', { width: 375, height: 812, mobile: true, wild: true });
} catch (e) { fail('runner', e.message); }
shutdown();
console.log(`\n${failures ? `${failures} failure${failures > 1 ? 's' : ''}` : 'all checks passed'}${warnings ? `, ${warnings} warning${warnings > 1 ? 's' : ''}` : ''}`);
process.exit(failures ? 1 : 0);

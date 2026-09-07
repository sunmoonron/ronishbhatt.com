#!/usr/bin/env node
// icon.mjs [hex]: draw the site icon. Its 64 squares are the 32 bytes that
// unveil the relay, one shade of green per hex digit, row by row, high nibble
// first. Without an argument it redraws the key already in the icon (or, once,
// the old site-veil meta). Also writes the raster copies through macOS sips.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { PALETTE, decodeIcon } from '../public/js/store.js';
const PUB = new URL('../public/', import.meta.url).pathname;
let hex = (process.argv[2] || '').toLowerCase();
if (!hex) { try { hex = decodeIcon(fs.readFileSync(PUB + 'favicon.svg', 'utf8')); } catch { hex = fs.readFileSync(PUB + 'index.html', 'utf8').match(/name="site-veil" content="([0-9a-f]{64})"/)?.[1] || ''; } }
if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('need a 64-hex key');
const cells = [...hex].map((ch, i) => { const r = Math.floor(i / 8), c = i % 8, s = 6.5, x = 6 + c * s + 0.55, y = 6 + r * s + 0.55;
  return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="5.4" height="5.4" rx="1.4" fill="${PALETTE[parseInt(ch, 16)]}"/>`; }).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#101318"/>${cells}</svg>\n`;
if (decodeIcon(svg) !== hex) throw new Error('round trip failed');
fs.writeFileSync(PUB + 'favicon.svg', svg);
try {
  fs.writeFileSync('/tmp/mark-square.svg', svg.replace(' rx="15"', ''));
  execSync(`sips -s format png -z 180 180 /tmp/mark-square.svg --out "${PUB}apple-touch-icon.png" >/dev/null && sips -s format png -z 32 32 "${PUB}favicon.svg" --out /tmp/fav32.png >/dev/null`);
  const png = fs.readFileSync('/tmp/fav32.png'), hdr = Buffer.alloc(22);
  hdr.writeUInt16LE(1, 2); hdr.writeUInt16LE(1, 4); hdr[6] = 32; hdr[7] = 32; hdr.writeUInt16LE(1, 10); hdr.writeUInt16LE(32, 12); hdr.writeUInt32LE(png.length, 14); hdr.writeUInt32LE(22, 18);
  fs.writeFileSync(PUB + 'favicon.ico', Buffer.concat([hdr, png]));
} catch (e) { console.warn('raster icons skipped:', e.message); }
console.log(`icon drawn from key ${hex.slice(0, 8)}…; the key is now only in the picture`);

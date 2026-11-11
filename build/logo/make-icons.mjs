// 0.7.0 item 4: static Parallel Flow icons (favicon, PWA / home-screen, About fallback, Windows .ico for the Player exe + installer).
// The static swap point: change COLORS / BG here and re-run. Static files cannot follow the live theme, so they use Midnight Neon
// (the default theme): TOP wave = Wav orange, BOTTOM wave = Wiz teal, the same rule as the in-app emblem (wwwroot/js/logo.js).
// Dev tool only (not shipped). Needs Playwright's Chromium:  node build/logo/make-icons.mjs [playwright-module-dir]
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const { chromium } = createRequire(path.resolve(process.argv[2] || '/workspace/f262-tools') + '/')('playwright');
const { emblemSvg } = await import(path.join(repo, 'src/WavWiz.Server/wwwroot/js/logo.js'));
export const COLORS = { top: '#FF3C00', bottom: '#12D6C2' };   // Midnight Neon: Wav orange (top), Wiz teal (bottom)
export const BG = '#14171A';                                    // Midnight Neon background (home-screen tiles)
const web = path.join(repo, 'src/WavWiz.Server/wwwroot'), assets = path.join(web, 'assets'), logoDir = path.join(repo, 'assets/logo');
const svg = emblemSvg({ cls: 'e', colors: COLORS });

const b = await chromium.launch(); const page = await b.newPage();
/** n x n PNG. tile: solid background square; scale: emblem size as a share of the tile (viewBox already has ~8% padding). */
async function png(n, { tile = false, scale = 1, radius = 0 } = {}) {
  await page.setViewportSize({ width: n, height: n });
  const e = Math.round(n * scale);
  await page.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${n}px;height:${n}px;display:flex;align-items:center;justify-content:center;${tile ? `background:${BG};border-radius:${radius}px` : ''}">${svg.replace('class="e"', `class="e" width="${e}" height="${e}"`)}</div></body></html>`);
  return page.screenshot({ omitBackground: !tile || radius > 0, clip: { x: 0, y: 0, width: n, height: n } });
}
function ico(frames) {   // PNG-backed ICO (Vista+): ICONDIR + ICONDIRENTRY[] + PNG data
  const head = Buffer.alloc(6 + 16 * frames.length); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(frames.length, 4);
  let off = head.length; frames.forEach(([n, buf], i) => { const o = 6 + 16 * i; head.writeUInt8(n % 256, o); head.writeUInt8(n % 256, o + 1); head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6); head.writeUInt32LE(buf.length, o + 8); head.writeUInt32LE(off, o + 12); off += buf.length; });
  return Buffer.concat([head, ...frames.map(f => f[1])]);
}
const out = {};
for (const n of [16, 32, 48, 64]) out[`logo-${n}.png`] = await png(n);                                   // transparent: tabs, small UI
for (const n of [128, 256]) out[`logo-${n}.png`] = await png(n, { tile: true, radius: Math.round(n * 0.18) });   // About fallback, desktop
for (const n of [152, 167, 180]) out[`logo-${n}.png`] = await png(n, { tile: true });                   // iOS home screen (iOS rounds it)
for (const n of [192, 512]) out[`logo-${n}.png`] = await png(n, { tile: true, radius: Math.round(n * 0.18) });   // PWA "any"
for (const n of [192, 512]) out[`logo-maskable-${n}.png`] = await png(n, { tile: true, scale: 0.8 });   // maskable: inside the 80 % safe zone
for (const [f, buf] of Object.entries(out)) fs.writeFileSync(path.join(assets, f), buf);
fs.writeFileSync(path.join(web, 'favicon.ico'), ico([[16, out['logo-16.png']], [32, out['logo-32.png']], [48, out['logo-48.png']]]));
const win = []; for (const n of [16, 24, 32, 48, 64, 128, 256]) win.push([n, n <= 64 ? await png(n) : await png(n, { tile: true, radius: Math.round(n * 0.18) })]);
fs.writeFileSync(path.join(logoDir, 'wavwiz.ico'), ico(win));
for (const n of [16, 32, 48, 64, 128, 180, 256, 512]) fs.writeFileSync(path.join(logoDir, `wavwiz-${n}.png`), n <= 64 ? await png(n) : await png(n, { tile: true, radius: n === 180 ? 0 : Math.round(n * 0.18) }));
for (const n of [256, 512, 1024]) fs.writeFileSync(path.join(logoDir, `wavwiz-${n}-transparent.png`), await png(n));
fs.writeFileSync(path.join(logoDir, 'wavwiz-1024.png'), await png(1024, { tile: true, radius: 184 }));
fs.writeFileSync(path.join(logoDir, 'wavwiz-parallel-flow.svg'), emblemSvg({ cls: 'pf', title: 'WavWiz', colors: COLORS }) + '\n');
await b.close();
console.log('wrote', Object.keys(out).length + 2, 'web icons + favicon.ico, assets/logo/wavwiz.ico (16-256) and PNG masters');

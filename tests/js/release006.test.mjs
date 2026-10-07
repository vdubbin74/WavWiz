import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const imp = n => import(pathToFileURL(`${process.env.JS_DIR}/${n}.js`).href);
const brand = await imp('brand');
const viz = await imp('viz');
const js = process.env.JS_DIR;

test('0.0.6 brand: plain text wordmark factory (no SVG letter paths)', () => {
  assert.ok(typeof brand.wordmark === 'function');
  assert.ok(typeof brand.brandMark === 'function');
  assert.ok(!brand.WORDMARK_SVG.includes('<path'));
  assert.match(brand.WORDMARK_SVG, /#FF3C00/i);
  assert.match(brand.WORDMARK_SVG, /#19C3B1/i);
});

test('0.0.6/0.0.7 viz: Particle burst is default engine; ring remains; milkdrop removed in 0.0.7', () => {
  assert.equal(viz.ENGINES[0][0], 'particles');
  assert.ok(viz.ENGINES.some(([k]) => k === 'wavwiz'));
  assert.ok(!viz.ENGINES.some(([k]) => k === 'milkdrop'));
  const src = readFileSync(join(js, 'vizcore.js'), 'utf8');
  assert.match(src, /DEFAULT_ENGINE = 'particles'/);
});

test('0.0.6 art helpers in source', () => {
  const src = readFileSync(join(js, 'art.js'), 'utf8');
  assert.match(src, /export const radioArt/);
  assert.match(src, /export function itemArtUrl/);
  assert.match(src, /\/radio\/\$\{id\}/);
});

test('0.0.6 CSS: hamburger hidden on desktop, phone lock, NP styles', () => {
  const css = readFileSync(join(js, '../app.css'), 'utf8');
  assert.match(css, /\.hamburger\{display:none\}/);
  assert.match(css, /touch-action:\s*manipulation/);
  assert.match(css, /\.devchip/);
  assert.match(css, /\.wm-wav/);
  assert.match(css, /\.transport\.pod/);
  assert.match(css, /0\.0\.6/);
});

test('0.0.6 menu: PC Devices drops phone entry; phone drawer export exists', () => {
  const src = readFileSync(join(js, 'menu.js'), 'utf8');
  assert.match(src, /export function createPhoneDrawerNav/);
  assert.match(src, /go\('visualizer'\)/);      // 0.0.7: View > Visualizer… opens the Visualizer page
  const pcBlock = src.split('devices:')[1].split('devicesPhone:')[0];
  assert.ok(!pcBlock.includes('This phone as a device'));
  assert.match(src, /devicesPhone:[\s\S]*This phone as a device/);
});

test('0.0.6 particles module ships', () => {
  const src = readFileSync(join(js, 'particles.js'), 'utf8');
  assert.match(src, /export class ParticleBurst/);
  assert.match(src, /refreshTheme/);
});

test('0.0.6 about version', () => {
  const src = readFileSync(join(js, 'about.js'), 'utf8');
  assert.match(src, /WHATS_NEW_VERSION = '0\.\d\.\d+'/);      // 0.0.7 bumps it
});

test('0.0.6 index viewport locks zoom', () => {
  // run.sh copies js + app.css only; read index from the repo wwwroot next to the source tree
  const html = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/index.html', import.meta.url), 'utf8');
  assert.match(html, /maximum-scale=1/);
  assert.match(html, /user-scalable=no/);
});

test('0.0.6 room auto-join helpers', () => {
  const src = readFileSync(join(js, 'room.js'), 'utf8');
  assert.match(src, /export function installPhoneAutoJoin/);
  assert.match(src, /export async function startPhoneAsDevice/);
});

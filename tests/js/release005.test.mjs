import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const imp = n => import(pathToFileURL(`${process.env.JS_DIR}/${n}.js`).href);
const theme = await imp('theme');
const brand = await imp('brand');
const uiscale = await imp('uiscale');

test('0.0.5 brand: wordmark keeps Wav/Wiz colors (0.0.6 uses plain text; colors still present)', () => {
  const html = brand.WORDMARK_SVG || '';
  assert.match(html, /#FF3C00/i);
  assert.match(html, /#19C3B1/i);
  assert.ok(typeof brand.wordmark === 'function');
  assert.ok(typeof brand.brandMark === 'function');
});

test('0.0.5/0.1.2 themes: Midnight Neon default; charcoal/steel/midnight removed', () => {
  assert.equal(theme.PRESETS.default.name, 'Midnight Neon');
  assert.equal(theme.PRESETS.default.accent, '#FF3C00');
  assert.ok(!theme.PRESETS.charcoal);
  assert.ok(!theme.PRESETS.steel);
  assert.ok(!theme.PRESETS.midnight);
  assert.ok(theme.PRESETS.ember && theme.PRESETS.arctic && theme.PRESETS.pepecoin && theme.PRESETS.violet);
});

test('0.0.5 display sizes', () => {
  assert.deepEqual(uiscale.SCALES.map(x => x[0]), ['small', 'compact', 'medium', 'large', 'xlarge']);   // 0.0.8 adds Extra large (TV)
  assert.equal(uiscale.loadScale(), 'compact');
});

test('0.0.5 CSS is boxy (thin radius, no pill 99px on buttons)', () => {
  const css = readFileSync(join(process.env.JS_DIR, '../app.css'), 'utf8');
  assert.match(css, /--radius:\s*3px/);
  assert.match(css, /\.menubar/);
  // pill chips should not use 99px anymore for primary chrome
  assert.ok(!/\.btn[^\{]*\{[^}]*border-radius:\s*99px/.test(css));
  assert.match(css, /\.btn,\.iconbtn\{[^}]*border-radius:\s*3px/);
});

test('0.0.5 menu module ships nested File/Library/Playback/Devices/View/Help', () => {
  const src = readFileSync(join(process.env.JS_DIR, 'menu.js'), 'utf8');
  assert.match(src, /export function createMenuBar/);
  for (const label of ['File', 'Library', 'Playback', 'Devices', 'View', 'Help', 'Theme', 'Display size', 'Visualizer']) {
    assert.match(src, new RegExp("'" + label + "(…)?'"));      // 0.0.7: 'Theme…' / 'Visualizer…' open pages
  }
});

test('0.0.5: no hard-coded private LAN addresses in shipped JS', () => {
  const dir = process.env.JS_DIR;
  const hits = [];
  for (const f of readdirSync(dir).filter(x => x.endsWith('.js'))) {
    const t = readFileSync(join(dir, f), 'utf8');
    if (/\b(192\.168|10\.\d{1,3}|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/.test(t)) hits.push(f);
  }
  assert.deepEqual(hits, []);
});

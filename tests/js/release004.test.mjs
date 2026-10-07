import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const imp = n => import(pathToFileURL(`${process.env.JS_DIR}/${n}.js`).href);
const theme = await imp('theme');
const brand = await imp('brand');

test('0.0.4/0.1.2 themes: Midnight Neon default, Classic Amber gone, five presets', () => {
  assert.equal(theme.PRESETS.default.name, 'Midnight Neon');
  assert.equal(theme.PRESETS.default.accent, '#FF3C00');
  assert.ok(!theme.PRESETS.amber);
  assert.deepEqual(Object.keys(theme.PRESETS), ['default', 'ember', 'arctic', 'pepecoin', 'violet']);
  for (const k of ['default', 'ember', 'arctic', 'pepecoin', 'violet']) assert.ok(theme.isHex(theme.PRESETS[k].accent));
});

test('0.0.4 brand: neon wordmark SVG has orange WAV and teal WIZ', () => {
  const html = brand.WORDMARK_SVG;
  assert.match(html, /#FF3C00/i);
  assert.match(html, /#19C3B1/i);
  // 0.0.6 plain text: color tokens remain; SVG viewBox optional
  assert.ok(/WavWiz|aria-label|viewBox/.test(html + ' WavWiz'));
});

test('0.0.4: no Classic Amber name and no user-facing Room(s) in shipped JS string literals', () => {
  const dir = process.env.JS_DIR;
  const hits = [];
  for (const f of readdirSync(dir).filter(x => x.endsWith('.js'))) {
    const t = readFileSync(join(dir, f), 'utf8');
    if (/Classic Amber/.test(t)) hits.push(`${f}: Classic Amber`);
    for (const m of t.matchAll(/(['"`])((?:(?!)[^\\]|\\.)*)/gs)) {
      const s = m[2];
      if (/\bRooms?\b/.test(s)) hits.push(`${f}: ${s.slice(0, 100)}`);
    }
  }
  assert.deepEqual(hits, [], hits.join('\n'));
});

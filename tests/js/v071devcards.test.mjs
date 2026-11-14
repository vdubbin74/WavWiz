// 0.7.1: Devices cards — Now Playing transport menu, no ⋮ handle glyphs, themed trim CSS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
globalThis.Element ??= class {};

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const root = new URL('../../src/WavWiz.Server/wwwroot/', import.meta.url);
const rd = p => readFileSync(new URL(p, root), 'utf8');

test('0.7.1 zone now-playing menu is Play/Pause, Previous, Next, Mute', async () => {
  const { zoneNowMenu42 } = await import(pathToFileURL(join(js, 'ctxmenu.js')).href + '?v071');
  const lab = l => l.map(i => i.label);
  const a = { can: true, playing: false, muted: false };
  assert.deepEqual(lab(zoneNowMenu42(a)), ['Play', 'Previous', 'Next', 'Mute']);
  assert.deepEqual(lab(zoneNowMenu42({ can: true, playing: true, muted: true })), ['Pause', 'Previous', 'Next', 'Unmute']);
  assert.ok(zoneNowMenu42({ can: false, playing: false, muted: false }).every(i => i.disabled));
  assert.ok(zoneNowMenu42(a).every(i => i.ic && i.id));
});

test('0.7.1: drag handles have no ⋮ glyph; trim / chevron / themed now-line CSS is present', () => {
  const tree = rd('js/tree42.js');
  const ap = rd('js/airplaysetup.js');
  const cs = rd('js/castsetup.js');
  assert.doesNotMatch(tree, /class: 'dgrip42'[\s\S]{0,200}'⋮'/);
  assert.doesNotMatch(tree, /class: 'zgut42'[\s\S]{0,400}'⋮'/);
  assert.doesNotMatch(tree, /'cgrip69'[\s\S]{0,280}'⋮'/);
  assert.match(tree, /setChev\(b, folded \? 'r' : 'd'\)/);
  assert.match(tree, /qb42-trow' \}, title, expand\)/);
  assert.match(ap, /setChev\(fold, open \? 'd' : 'r'\)/);
  assert.match(cs, /setChev\(fold, open \? 'd' : 'r'\)/);
  assert.match(ap, /qb42-trow' \}, title, fold\)/);
  assert.match(cs, /qb42-trow' \}, title, fold\)/);
  const css = rd('app.css');
  assert.match(css, /0\.7\.1: Devices cards/);
  assert.match(css, /data-card-trim/);
  assert.match(css, /trim-notch/);
  assert.match(css, /trim-wave/);
  assert.match(css, /--voltrack/);
  assert.match(css, /\.plus\.chv/);
  // flattened now-playing bar: a 0.7.1 rule clears the old box border
  assert.match(css, /\.tree42 \.zl-now[\s\S]{0,400}border:\s*0/);
});

test('0.7.1 wireNowMenu is exported and attachCtx marks justmenu (refresh-safe portal)', async () => {
  const z = rd('js/zones40.js');
  assert.match(z, /export function wireNowMenu/);
  assert.match(z, /openCtx/);
  const ctx = rd('js/ctxmenu.js');
  assert.match(ctx, /dataset\.justmenu/);
  assert.match(ctx, /\.zgut42,\.cgrip69/);
});

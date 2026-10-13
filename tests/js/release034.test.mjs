// WavWiz 0.3.4 - logic + markup checks (H1-H9). Browser behavior: tests/ui/pwa034.mjs and tests/ui/jukebox034.mjs (Chromium).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
globalThis.Element ??= class {};
const js = process.env.JS_DIR, web = join(js, '..');
const srcWeb = new URL('../../src/WavWiz.Server/wwwroot/', import.meta.url).pathname;   // non-CSS web files are not copied by run.sh
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
test('H1 manifest + iOS meta + service worker rules', async () => {
  const m = JSON.parse(readFileSync(join(srcWeb, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, 'WavWiz'); assert.equal(m.id, '/'); assert.equal(m.scope, '/'); assert.ok(m.description);
  assert.ok(m.icons.some(i => i.sizes === '192x192' && i.purpose === 'any')); assert.ok(m.icons.filter(i => i.purpose === 'maskable').length >= 2);
  const html = readFileSync(join(srcWeb, 'index.html'), 'utf8');
  for (const re of [/apple-touch-icon" href="\/assets\/logo-180\.png"/, /apple-mobile-web-app-capable" content="yes"/, /name="mobile-web-app-capable" content="yes"/, /apple-mobile-web-app-title" content="WavWiz"/, /status-bar-style" content="black-translucent"/]) assert.match(html, re);
  const sw = readFileSync(join(srcWeb, 'sw.js'), 'utf8');
  assert.match(sw, /'wavwiz-shell-' \+ VERSION/); assert.match(sw, /startsWith\('\/api\/'\)/); assert.match(sw, /fetch\(req\)\.then/, 'network first');
  assert.match(sw, /k !== CACHE\).map\(k => caches\.delete/, 'old caches dropped on activate');
  const p = await imp('pwa'); assert.equal(p.swUrl('0.3.4'), '/sw.js?v=0.3.4'); assert.equal(p.swUrl(''), '/sw.js?v=dev');
  assert.equal(await p.registerSw({}), null, 'no serviceWorker -> skipped');
});
test('H2 number column minimum', async () => {
  const c = await imp('cols'); assert.ok(c.NUM_MIN >= 60);
  assert.match(readFileSync(join(web, 'app.css'), 'utf8'), /\.qtable td\.num,\.qtable th\.num\{[^}]*white-space:nowrap/);
});
test('H3 gradient is two theme colors; fill percent', async () => {
  const s = src('sliderstyle.js'); assert.match(s, /linear-gradient\(90deg,var\(--accent\),var\(--accent2\)\)/);
  const { fillPct } = await imp('sliderstyle');
  assert.equal(fillPct({ min: '0', max: '100', value: '25' }), 25); assert.equal(fillPct({ min: '', max: '', value: '50' }), 50);
  assert.equal(fillPct({ min: '0', max: '200', value: '300' }), 100);
});
test('H4-H7 jukebox helpers', async () => {
  const j = await imp('jukebox-core');
  assert.equal(j.albumName({ artist: 'A', name: 'Blue', tracks: 9 }), 'Blue'); assert.equal(j.albumName({ album: 'Old' }), 'Old'); assert.equal(j.albumName(null), '');
  assert.equal(j.minePicks({ next: [{ mine: true }, { guest: 'g1' }, { guest: 'g2' }] }, 'g1'), 2); assert.equal(j.minePicks(null, 'x'), 0);
  const n = j.selNo(12345); assert.ok(n >= 100 && n <= 999); assert.equal(j.selNo(12345), n);
  assert.match(j.upNextLine([]), /0 songs/);
  const css = readFileSync(join(web, 'jukebox.css'), 'utf8'); assert.match(css, /\.jbg \.btn\.primary\.jb-add\.in,\.jb \.btn\.primary\.jb-add\.in\{/);
  assert.doesNotMatch(css + src('settingsui.js'), /vinyl/i, 'no Vinyl style');
});
test('0.3.4 What\'s new and version', async () => {
  const a = await imp('about'); assert.equal(a.WHATS_NEW_VERSION, '0.3.4'); assert.ok(a.WHATS_NEW.some(([t]) => t === 'Jukebox styles'));
});

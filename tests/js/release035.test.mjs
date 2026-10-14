// WavWiz 0.3.5 - pure logic + markup checks (J1-J18). Browser behavior: tests/ui/ui035.mjs and tests/ui/jukebox035.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
globalThis.Element ??= class {};
const js = process.env.JS_DIR, web = join(js, '..');
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
test('J3 caps: only locked caps limit; zone cap = average of member limits; clamp', async () => {
  const d = await imp('devices');
  assert.equal(d.capOf({ volLocked: false, volCap: 40 }), null);
  assert.equal(d.capOf({ volLocked: true, volCap: 40 }), 40);
  assert.equal(d.capOf({ volLocked: true, volCap: 100 }), null);
  const zs = [{ id: 'a', volLocked: true, volCap: 40 }, { id: 'b', volLocked: false, volCap: 10 }];
  assert.equal(d.zoneCap(zs, { deviceIds: ['a', 'b'] }), 70);
  assert.equal(d.zoneCap(zs, { deviceIds: ['b'] }), null);
  assert.equal(d.clampToCap(90, 40), 40); assert.equal(d.clampToCap(30, 40), 30); assert.equal(d.clampToCap(90, null), 90);
});
test('J4 tag rows: order + zone count wording', async () => {
  const d = await imp('devices');
  const t = d.cardTags3({ id: 'a', enabled: false, connected: false, muted: true, volLocked: true, volCap: 60, outputs: [] }).map(x => x.text);
  assert.deepEqual(t.slice(0, 3), ['OFF', 'OFFLINE', 'MUTED']); assert.ok(t.includes('CAPPED 60%'));
  const zt = d.zoneTags3([{ id: 'a', name: 'A', volume: 10, outputs: [] }], { deviceIds: ['a'], active: true }).map(x => x.text);
  assert.deepEqual(zt.slice(0, 2), ['1 DEVICE', 'PLAYING']);
  assert.match(d.zoneTags3([{ id: 'a', outputs: [] }, { id: 'b', outputs: [] }], { deviceIds: ['a', 'b'] })[0].text, /^2 DEVICES$/);
});
test('J10 tiles + decades', async () => {
  const l = await imp('libsort');
  const a = l.tileSpec('Ambient'); assert.deepEqual(a, l.tileSpec('Ambient')); assert.ok(l.TILE_PATTERNS.includes(a.pattern));
  assert.equal(l.tileCount({ tracks: 1, albums: 2 }), '1 song · 2 albums');
  const g = l.byDecade([{ name: '1999' }, { name: '1991' }, { name: '1985' }, { name: '' }]);
  assert.deepEqual(g.map(x => [x.key, x.rows.length]), [['1990s', 2], ['1980s', 1], ['Unknown', 1]]);
  assert.doesNotMatch(src('library.js').match(/function tilePattern[\s\S]{0,1500}/)?.[0] ?? '', /#[0-9a-f]{3,6}\b/i, 'tile art uses theme colors only');
});
test('J11 drop label', async () => {
  const u = await imp('ui');
  assert.equal(u.dropLabel(17, 3), 'Drop here: 17 songs at #4'); assert.equal(u.dropLabel(1, 0), 'Drop here: 1 song at #1'); assert.equal(u.dropLabel(null, 0), 'Drop here at #1');
});
test('J14 jukebox stage fit divides by display size', async () => {
  const s = src('jukebox-kiosk.js'); const m = s.match(/export function stageFit[^\n]+/)[0].replace('export ', '');
  const stageFit = new Function(m + '; return stageFit;')();
  assert.equal(stageFit(3840, 2160).modern, 2); assert.equal(stageFit(1920, 1080).modern, 1); assert.equal(stageFit(3840, 2160, 2).modern, 1);
  assert.ok(Math.abs(stageFit(1960, 1102).retro - 2) < 0.01);
});
test('J17 mini transparency: solid on hover unless adjusting; Settings + Player menu wired', async () => {
  const s = src('mini.js'); const m = s.match(/export const shownOpacity[^\n]+/)[0].replace('export const shownOpacity =', 'return');
  const shown = new Function(m)();
  assert.equal(shown(40, { hover: true }), 100); assert.equal(shown(40, { hover: true, adjusting: true }), 40); assert.equal(shown(40), 40);
  assert.match(src('appearance.js'), /Mini player[\s\S]*Transparency/);
  const forms = readFileSync(new URL('../../src/WavWiz.Player/Forms.cs', import.meta.url), 'utf8');
  assert.match(forms, /case "menu"/); assert.match(forms, /Transparency/);
});
test('J7 what\'s new version compare', async () => {
  const s = src('about.js'); const m = s.match(/export const verCmp = ([^\n]+)/)[1];
  const verCmp = new Function('return ' + m)();
  assert.equal(verCmp('0.3.5', '0.3.5'), 0); assert.equal(verCmp('9.9.9', '0.3.5'), 1); assert.equal(verCmp('0.3.10', '0.3.9'), 1); assert.equal(verCmp('0.3.4', '0.3.5'), -1);
});
test('J12 switches are labeled pills with 3px corners; no hex in 0.3.5 css', () => {
  const css = readFileSync(join(web, 'app.css'), 'utf8'); const i = css.indexOf('0.3.5'); assert.ok(i > 0);
  assert.doesNotMatch(css.slice(i), /#[0-9a-f]{3,8}\b(?![\w-])/i);
});

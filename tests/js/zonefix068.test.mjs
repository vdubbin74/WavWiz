// WavWiz 0.6.8 zone fix (t1800u): the zone name shows with one zone, a deleted zone never lingers as a ghost choice, Unassigned speakers carry the
// same tag line as zone speakers (second line), and NO DELAY shows for a speaker that is not the reference and was never measured.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
globalThis.Element ??= class {};
// devices.js pulls in modules that touch window / document at load; a minimal stand-in is enough for its pure helpers
globalThis.window ??= globalThis; globalThis.addEventListener ??= () => {}; globalThis.removeEventListener ??= () => {};
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const cls = () => ({ toggle() {}, add() {}, remove() {}, contains: () => false });
globalThis.document ??= { addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], body: { classList: cls() },
  documentElement: { style: { setProperty() {} }, classList: cls(), dataset: {} }, createElement: () => ({ style: {}, classList: cls(), setAttribute() {}, append() {} }) };
const js = process.env.JS_DIR;
const src = n => readFileSync(`${js}/${n}.js`, 'utf8'), css = () => readFileSync(`${js}/../app.css`, 'utf8');
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const out = (kind, notCalibrated) => ({ deviceId: 'd', active: true, connected: true, kind, notCalibrated });

test('cardTags3: NO DELAY for a speaker that is not the reference and not measured; REF instead of NO DELAY; ANALOG first', async () => {
  const { cardTags3 } = await imp('devices');
  const lone = { id: 1, enabled: true, connected: true, reference: false, outputs: [out('analog', true)], activeDeviceId: 'd' };
  assert.deepEqual(cardTags3(lone).map(t => t.text), ['ANALOG', 'NO DELAY']);
  assert.deepEqual(cardTags3({ ...lone, reference: true }).map(t => t.text), ['ANALOG', 'REF']);
  assert.deepEqual(cardTags3({ ...lone, outputs: [out('analog', false)] }).map(t => t.text), ['ANALOG']);   // measured: nothing to say
});

test('resolve: a deleted zone falls back to a remaining real zone; no zones = no choice', async () => {
  const { resolve } = await imp('zones40');
  const groups = [{ id: 1, name: 'Everywhere', playbackId: 'default' }];
  assert.equal(resolve(groups, null, 'g:7').name, 'Everywhere');
  assert.equal(resolve([], null, 'g:7'), null);
});

test('sync forgets a stale zone even when no zone is left', () => {
  assert.match(src('zones40'), /if \(Array\.isArray\(S\.groups\) && loadSel\(\) && \(!c \|\| loadSel\(\) !== c\.key\)\) saveSel\(null\);/);
});

test('"on <zone>" names the zone with one zone (no caret, no menu); the CONTROLLING picker chip still needs two', () => {
  const z = src('zones40');
  assert.match(z, /const has = b\._link \? !!c : many;/);
  assert.match(z, /b\.querySelector\('\.zs-car'\)\.hidden = !many;/);
  assert.match(z, /if \(choicesNow\(\)\.length < 2\) return; menu && menu\._for === b/);
  assert.match(css(), /\.zlink \.zs-car\[hidden\]\{display:none\}/);
  // Now Playing (phone and narrow windows alike): the plain label only covers "No zone selected"
  assert.match(src('now'), /phoneZone\.hidden = !!choice;/);
});

test('Queue panel: QUEUE · <zone> with one zone; the hidden picker never shows as an empty box', () => {
  const l = src('listtable');
  assert.match(l, /const paintQz = \(\) => \{ const c = view \? viewChoice\(\) : Z\.current\(\); qzone\.textContent = c \?/);
  assert.match(css(), /\.wwdd\[hidden\]\{display:none!important\}/);
});

test('Unassigned speakers: name with the tag line under it, like a speaker in a zone', () => {
  const t = src('tree42'), un = t.slice(t.indexOf("const unBox"), t.indexOf("root.append(unBox)"));
  assert.match(un, /h\('span', \{ class: 'sp42-nt' \}, h\('button', \{ type: 'button', class: 'dname sp42-n ell'/);
  assert.match(un, /h\('span', \{ class: 'dtagrow sp42-tags' \}, tagEls3\(cardTags3\(z\)\)\)/);
  assert.match(css(), /\.sp42-nt\{[^}]*flex-direction:column/);   // stacked: the tags sit on the second line
});

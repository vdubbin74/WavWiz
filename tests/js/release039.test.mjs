// 0.3.9 pure-logic + source checks (L50-L57). Run through run.sh like the others.
import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; import path from 'node:path';
globalThis.Element ??= class {}; const dir = process.env.JS_DIR; const src = f => readFileSync(path.join(dir, f), 'utf8'); const css = readFileSync(path.join(dir, '..', 'app.css'), 'utf8');
const imp = n => import('file://' + path.join(dir, n + '.js'));
test('L52 viewForMode: wide clears the tab page, narrow never stays blank', async () => {
  const { viewForMode } = await imp('viewmode');
  assert.deepEqual(viewForMode({ wide: true, view: 'now', hasContent: true }), { view: 'library', clearContent: true });
  assert.deepEqual(viewForMode({ wide: false, view: 'library', hasContent: false }), { view: 'now', clearContent: false });
  assert.deepEqual(viewForMode({ wide: false, view: 'library', hasContent: true }), { view: 'library', clearContent: false });
  assert.deepEqual(viewForMode({ wide: false, view: 'devices', hasContent: true }), { view: 'devices', clearContent: false });
  assert.equal(viewForMode({ wide: false, view: '' }).view, 'now');
});
test('L52 main.js applies the mode on resize and on the breakpoint change', () => {
  const m = src('main.js'); assert.match(m, /applyMode = \(\)/); assert.match(m, /addEventListener\('resize', \(\) => \{ applyMode\(\)/); assert.match(m, /matchMedia\('\(max-width:900px\)'\)\.addEventListener\('change'/);
});
test('L55 the mini player under the Queue uses the standard border in every state', () => {
  for (const line of css.split('\n').filter(l => /\.mp\{[^}]*border:1px solid/.test(l))) assert.doesNotMatch(line, /border:1px solid var\(--accent\)/, line.slice(0, 120));
  assert.match(css, /\.minicol \.mp\{border:1px solid var\(--line\)/);
});
test('L54 no expand arrow on speaker / zone cards; the card itself is the click target', () => {
  const d = src('devices.js'); const card3 = d.slice(d.indexOf('function card3('), d.indexOf('function zcard3('));
  assert.doesNotMatch(card3, /settingsOpener\(|settingsToggle\(|class: 'dexpand/);
  assert.match(card3, /classList\.add\('clickable'\)/); assert.match(card3, /closest\('button,input,select,textarea,a,\[role=switch\],\.vbar/);
  const z = d.slice(d.indexOf('function zcard3('), d.indexOf('function zoneInline('));
  assert.match(z, /classList\.add\('clickable'\)/); assert.match(z, /onEdit\(g\.id\)/); assert.doesNotMatch(z, /dexpand/);
  assert.match(css, /\.dc3\.clickable,\.zc3\.clickable\{cursor:pointer\}/);
});
test('L51 zoneNowTiles: the one global song on zones that are on, "Off" on the rest', async () => {
  const { zoneNowTiles } = await imp('devices');
  const zones = [{ id: 1, enabled: true }, { id: 2, enabled: false }, { id: 3, enabled: true }];
  const groups = [{ id: 'a', name: 'Basement', deviceIds: [1] }, { id: 'b', name: 'Test', deviceIds: [2] }, { id: 'c', name: 'Kitchen', deviceIds: [3] }];
  const S = { zones, now: { state: 'playing', positionMs: 30000, durationMs: 60000, item: { title: 'Song 1', artist: 'Atlas Drift' } } };
  const t = zoneNowTiles(S, groups);
  assert.deepEqual(t.map(x => x.state), ['playing', 'off', 'playing']); assert.equal(t[0].title, 'Song 1'); assert.equal(t[0].progress, 50); assert.equal(t[1].title, 'Off - nothing playing');
  const idle = zoneNowTiles({ zones, now: { state: 'stopped' } }, groups); assert.deepEqual(idle.map(x => x.title), ['Nothing playing', 'Off - nothing playing', 'Nothing playing']);
  assert.deepEqual(zoneNowTiles({ zones }, []), []);
});
test('L53/L56 CSS: master row spaced + capped; card volume edge to edge; mute bottom right; 2-wide grid', () => {
  assert.match(css, /\.devpanel\.expanded \.dexp-top \.dmaster \.dvol-master\{[^}]*flex:0 1 640px/s); assert.match(css, /\.mallrow\{flex:0 0 auto;margin:0 0 0 auto;gap:10px/);
  assert.match(css, /\.dc3foot \.mutebtn\{margin-left:auto/); assert.match(css, /\.dc3l3 \.vbar\{flex:1 1 auto/); assert.match(css, /\.slist,\.devpanel\.expanded \.e1 \.scol \.ulist\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(200px,1fr\)\)/);
});
test('L50 collapsed bar drops optional parts earlier when pins are shown; pins sit above', () => {
  assert.match(css, /\.np-ctlpanel \.pane-h \.scrow\{flex:none;position:relative;z-index:2\}/); assert.match(css, /\.np-ctlpanel\.collapsed \.np-strip\{overflow:hidden\}/);
  assert.match(css, /@container npctl \(max-width:1100px\)\{ \.np-ctlpanel\.collapsed:has\(\.scrow \.scbtn\)/);
});
test('L57 mini player: Devices-style volume bar (.dvol .vbar .pct) in its own row, mute by the transport', () => {
  const m = src('mini.js'); assert.match(m, /class: 'vbar' \}, vol/); assert.match(m, /class: 'pct'/); assert.match(m, /mp-vol dvol/); assert.match(m, /'\/zones\/master', \{ set: \+vol\.value \}/);
  assert.match(m, /h\('div', \{ class: 'mp-tr' \}, prev, play, next, mute\)/); assert.match(m, /\/zones\/mute-all/);
});
test('0.3.9 What\'s new leads with the new items', async () => { const a = await imp('about'); assert.ok(['0.3.9', '0.4.0', '0.4.1', '0.4.2', '0.4.3', '0.4.4', '0.4.5', '0.4.6'].includes(a.WHATS_NEW_VERSION)); assert.ok(a.WHATS_NEW.some(([t]) => /Devices/.test(t))); });

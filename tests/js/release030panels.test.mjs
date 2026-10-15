// WavWiz 0.3.0 §6 / panels-spec must-pass: states rail · normal · expanded, one key, auto-rail, keys, 2 buttons per header.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
globalThis.Element ??= class {};
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
const css = readFileSync(join(js, '../app.css'), 'utf8');
const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };

test('§6: Rail → Normal → Expanded → Esc returns to the exact previous layout; never two expanded', async () => {
  const P = await imp('panels');
  let p = P.normPanels({ lib: 'rail', dev: 'normal' });
  p = P.chevron(p, 'lib'); assert.equal(P.shown(p, 'lib'), 'normal');
  const before = { lib: p.lib, dev: p.dev };
  p = P.expand(p, 'lib'); assert.equal(P.shown(p, 'lib'), 'expanded'); assert.equal(P.shown(p, 'dev'), 'rail', 'the other shows as a real rail');
  p = P.railClick(p, 'dev'); assert.equal(P.shown(p, 'dev'), 'expanded'); assert.equal(P.shown(p, 'lib'), 'rail', 'focus handed over: still only one expanded');
  p = P.esc(p); assert.deepEqual({ lib: P.shown(p, 'lib'), dev: P.shown(p, 'dev') }, before, 'Esc restores both exactly');
  p = P.expand(p, 'dev'); p = P.chevron(p, 'dev'); assert.equal(P.shown(p, 'dev'), 'rail', 'chevron from expanded goes straight to rail'); assert.equal(p.exp, null);
});
test('§6: the chevron points where the panel will move; labels and every click changes something', async () => {
  const P = await imp('panels');
  const n = P.normPanels({});
  assert.equal(P.chevronGlyph(n, 'lib'), '‹'); assert.equal(P.chevronGlyph({ ...n, lib: 'rail' }, 'lib'), '›');
  assert.equal(P.chevronGlyph(n, 'dev'), '›'); assert.equal(P.chevronGlyph({ ...n, dev: 'rail' }, 'dev'), '‹');
  assert.equal(P.chevronGlyph({ ...n, exp: 'lib' }, 'lib'), '‹');
  for (const st of [n, { ...n, lib: 'rail' }, { ...n, exp: 'lib' }, { ...n, exp: 'dev' }]) for (const k of ['lib', 'dev']) {
    const a = P.chevron(st, k); assert.notDeepEqual([P.shown(a, 'lib'), P.shown(a, 'dev')], [P.shown(st, 'lib'), P.shown(st, 'dev')], `chevron ${k} on ${JSON.stringify(st)} changes the layout`);
  }
});
test('§6: one key wavwiz.panels; the 0.2.x keys migrate once; state survives reload', async () => {
  const P = await imp('panels');
  const s = mem({ 'wavwiz.libcollapsed': '1', 'wavwiz.devsize': 'expanded', 'wavwiz.listcollapsed': '1', 'wavwiz.npctlcollapsed': '1' });
  const p = P.loadPanels(s); assert.deepEqual(p, { lib: 'rail', dev: 'normal', exp: 'dev', list: 'collapsed', ctl: 'collapsed', ctlSet: true });
  assert.ok(s.getItem(P.PANELS_KEY)); s.setItem('wavwiz.libcollapsed', '0');
  assert.deepEqual(P.loadPanels(s), p, 'migrated once; the new key wins');
  P.savePanels({ ...p, exp: 'lib' }, s); assert.equal(P.loadPanels(s).exp, 'lib');
});
test('§6: 1000 px window keeps Now Playing ≥ 420 px (auto-rail, not saved); phone width drops expanded for this load only', async () => {
  const P = await imp('panels');
  const p = P.normPanels({ lib: 'normal', dev: 'normal' });
  for (const w of [901, 920, 1000, 1100, 1280, 1920]) { const e = P.effective(p, w, { opened: 'lib' }); assert.ok(P.npWidth(e, w) >= 420, `${w}px: ${P.npWidth(e, w)}`); }
  const e = P.effective(p, 920, { opened: 'lib' }); assert.equal(e.dev, 'rail'); assert.equal(e.auto, 'dev'); assert.equal(p.dev, 'normal', 'not saved');
  assert.equal(P.effective({ ...p, exp: 'lib' }, 800).exp, null);
});
test('§6: keyboard [ ] Shift variants Esc; ignored while typing', async () => {
  const P = await imp('panels'); const p = P.normPanels({});
  assert.equal(P.keyAction(p, { code: 'BracketLeft', target: {} }).lib, 'rail');
  assert.equal(P.keyAction(p, { code: 'BracketRight', shiftKey: true, target: {} }).exp, 'dev');
  assert.equal(P.keyAction({ ...p, exp: 'dev' }, { key: 'Escape', target: {} }).exp, null);
  assert.equal(P.keyAction(p, { code: 'BracketLeft', target: { tagName: 'INPUT' } }), null);
});
test('§6: at most 2 buttons per header, 3 grid tracks always, 240 ms timing, no display:none on the big areas when expanded, viz resizes on transitionend', () => {
  const m = src('main.js'), d = src('devices.js');
  const libHead = m.match(/h\('div', \{ class: 'pane-h' \}, colBtn, [^\n]*?expBtn\)/)[0]; assert.equal((libHead.match(/Btn/g) || []).length, 2);
  const devHead = d.match(/h\('div', \{ class: 'pane-h devhead' \}, [^\n]*?colBtn\)/)[0]; assert.equal((devHead.match(/Btn/g) || []).length, 2);
  assert.match(css, /\.desk\.libexpanded,\.desk\.devexpanded\{grid-template-columns:var\(--libw\) minmax\(0,1fr\) var\(--rightw\)/);
  assert.match(css, /\.desk\{transition:grid-template-columns 240ms cubic-bezier\(\.4,0,\.2,1\)/);
  assert.match(css, /\.desk\.libexpanded \.nowcol,\.desk\.devexpanded \.nowcol,\.desk\.libexpanded \.listpanel,\.desk\.devexpanded \.listpanel\{display:flex;visibility:hidden;opacity:0/);
  assert.match(m, /desk\.addEventListener\('transitionend', ev => \{ if \(ev\.target === desk && \/grid-template\/\.test\(ev\.propertyName\)\) \{ nowc\.viz\?\.resize\?\.\(\)/);
  assert.match(css, /\.prail-t\{writing-mode:vertical-rl;color:var\(--accent-text,var\(--accent\)\)/); assert.match(css, /\.libpanel\.israil:hover,\.devpanel\.israil:hover\{border-color:var\(--accent\)\}/);
  assert.match(m, /'aria-expanded': 'true'/); assert.match(m, /'aria-pressed': 'false'/);
  assert.match(src('menu.js'), /ctl\.toggleDevExpanded\(true\)/, 'Devices & zones opens Devices expanded');
});

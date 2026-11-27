// 0.7.3 fix073d (iPhone report): (1) the Queue row ⋯ sheet closed again right after it opened; (2) Settings > Jukebox > Default speakers
// row was squeezed on a phone (label "De" / "sp", hint a one-word column behind the speaker list).
// Also (steering): the phone Queue / Now Playing zone pill on the title line (t2264u-t2267u) and the Library selected-pill shape (t2268u).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const js = process.env.JS_DIR || join(here, '../../src/WavWiz.Server/wwwroot/js');
const read = f => readFileSync(join(js, f), 'utf8');
const css = () => readFileSync(join(js, '../app.css'), 'utf8');
const { queuePaintSkip } = await import(pathToFileURL(join(js, 'qpaint.js')).href);

test('fix073d queuePaintSkip: an unchanged tick keeps the open ⋯ sheet (the bug), a real change still rebuilds', () => {
  // no menu: identical paint is skipped, any change repaints
  assert.equal(queuePaintSkip({ sig: 'A', painted: 'A', hasRows: true }), true);
  assert.equal(queuePaintSkip({ sig: 'B', painted: 'A', hasRows: true }), false);
  assert.equal(queuePaintSkip({ sig: 'A', painted: 'A', hasRows: false }), false);
  assert.equal(queuePaintSkip({ sig: null, painted: null, hasRows: true }), false);
  // menu open, nothing changed since it opened: the once-a-second server tick must NOT tear it down (it did before)
  assert.equal(queuePaintSkip({ sig: 'A', painted: 'A', hasRows: true, menuUp: true, menuSig: 'A' }), true);
  // menu open but the state moved on (e.g. lock / unlock without a paint in between): rebuild, which closes the stale menu
  assert.equal(queuePaintSkip({ sig: 'A', painted: 'A', hasRows: true, menuUp: true, menuSig: 'B' }), false);
  assert.equal(queuePaintSkip({ sig: 'A', painted: 'A', hasRows: true, menuUp: true, menuSig: null }), false);
  // a real change while the menu is open always repaints
  assert.equal(queuePaintSkip({ sig: 'C', painted: 'A', hasRows: true, menuUp: true, menuSig: 'A' }), false);
});

test('fix073d main.js: the menu records the state it opened in, drawQueue uses queuePaintSkip, ticks still reach drawQueue', () => {
  const s = read('main.js');
  assert.match(s, /import \{ queuePaintSkip \} from '\.\/qpaint\.js';/);
  assert.match(s, /let qMenuSig = null;/);
  assert.match(s, /onOpen: \(\) => \{ qReorder\?\.cancel\(\); qMenuSig = qPaintSignature\(\); \}/);
  assert.match(s, /if \(queuePaintSkip\(\{ sig, painted: qPaintSig, hasRows: !!root\.firstChild, menuUp: !!document\.querySelector\('dialog\.songsheet\[open\], \.qmenu'\), menuSig: qMenuSig \}\)\) return;/);
  assert.doesNotMatch(s, /root\.firstChild && !document\.querySelector\('dialog\.songsheet\[open\], \.qmenu'\)\) return;/, 'the old rule tore the sheet down on every tick');
  assert.match(s, /if \(S\.view === 'queue'\) drawQueue\(\)/);
  // the ⋯ opens through attachQueueMenu's onOpen (so qMenuSig is set for every row menu / long-press)
  assert.match(read('queuemenu.js'), /const open = \(x, y\) => \{ if \(!valid\(\)\) return; cancel\(\); phone\.onOpen\?\.\(\);/);
});

test('fix073d Jukebox zone: Default speakers stacks on the phone look (label + hint on top, checklist full width below)', () => {
  const s = read('settingsui.js'), c = css();
  assert.match(s, /h\('div', \{ class: 'setrow jbspkrow', style: 'align-items:flex-start' \}, h\('div', \{ class: 'grow' \}, h\('div', null, 'Default speakers'\)/);
  assert.match(c, /html\.phonelook #sec-jbzone>\.setrow\.jbspkrow\{flex-direction:column;align-items:stretch;gap:8px\}/);
  assert.match(c, /html\.phonelook #sec-jbzone>\.setrow\.jbspkrow>\.grow\{flex:none;width:100%;min-width:0\}/);
  assert.match(c, /html\.phonelook #sec-jbzone>\.setrow\.jbspkrow>\.jbspk76\{flex:none;width:100%;max-width:100%;min-width:0;box-sizing:border-box\}/);
  // the desktop side-by-side rule stays as it was
  assert.match(c, /#sec-jbzone \.jbspk76\{max-height:156px;flex:0 1 340px;min-width:0\}/);
  // the phone rules are top level (not indented inside a media block) so a narrow PC window (phonelook) gets them too
  assert.match(c, /\nhtml\.phonelook #sec-jbzone>\.setrow\.jbspkrow\{/);
});

test('fix073d Allowed music: Folders / Playlists stack full width on the phone look and long paths wrap', () => {
  const s = read('settingsui.js'), c = css();
  assert.match(s, /h\('div', \{ class: 'row wrap jbsrcrow', style: 'align-items:flex-start;gap:20px' \}, h\('div', null, h\('b', \{ class: 'small' \}, 'Folders'\)/);
  assert.match(c, /html\.phonelook #sec-jbsources \.jbsrcrow\{flex-direction:column;align-items:stretch!important;gap:12px!important\}/);
  assert.match(c, /html\.phonelook #sec-jbsources \.jbsrcrow>div\{width:100%;min-width:0\}/);
  assert.match(c, /html\.phonelook #sec-jbsources \.jbsrc label\{min-width:0;overflow-wrap:anywhere\}/);
});

test('fix073d Queue header (t2264u): "QUEUE" + the Now Playing "on <zone> ▾" pill (zones40 zoneLink + themed panel) on one line; picking switches the queue', () => {
  const m = read('main.js');
  assert.match(m, /function phonePick\(\) \{[\s\S]*?return Z\.current\(\) \? Z\.zoneLink\('zl-queue'\) : null;\n\}/);
  assert.doesNotMatch(m, /wsel\(\{ class: 'qzpick pq'/, 'no native zone dropdown in the phone Queue');
  assert.doesNotMatch(m, /import \{ wsel \} from '\.\/wwselect\.js'/, 'unused import removed');
  assert.match(m, /h\('div', \{ class: 'qtitle-stack qtitle-row' \}, h\('h1', \{ class: 'qeyebrow' \}, 'Queue'\), phonePick\(\) \|\| h\('span', \{ class: 'qzone-none dim' \}, 'No zone selected'\)\)/);
  assert.match(m, /window\.addEventListener\('wavwiz:zone', \(\) => \{[^\n]*if \(S\.view === 'queue' && !wide\(\)\) setTimeout\(\(\) => Promise\.resolve\(refreshAll\(\)\)\.then\(\(\) => drawQueue\(\)\), 150\);/);
  const c = css();
  assert.match(c, /\.phone-queue \.qtitle-stack\.qtitle-row\{flex-direction:row;align-items:center;gap:10px;flex-wrap:nowrap\}/);
  assert.match(c, /\.phone-queue \.qtitle-row \.zlink\.zl-queue,\.np-phone-head \.np-phone-zone \.zlink\.zl-fullphone\{[^}]*border-radius:999px;[^}]*white-space:nowrap;overflow:hidden/, 'one shared pill style');
  assert.match(c, /\.zlink\.zl-queue \.zl-name,[^{]*\.zl-fullphone \.zl-name\{[^}]*text-overflow:ellipsis/, 'long zone names end in …');
  assert.match(c, /html\.handset \.phone-queue \.qtitle-row \.zlink\.zl-queue,html\.handset \.np-phone-head \.np-phone-zone \.zlink\.zl-fullphone\{min-height:44px\}/, '44px touch target on a phone');
  // the panel the pill opens is the zones40 one (dot, bold name, track, accent bar on current, Manage zones footer)
  const z = read('zones40.js');
  assert.match(z, /export function zoneLink\(/);
  assert.match(z, /Manage zones in Devices/);
});

test('fix073d Now Playing (t2266u): the zone pill sits on the title line right after "Now Playing"; the freed row goes to the art', () => {
  const n = read('now.js');
  assert.match(n, /h\('header', \{ class: 'np-phone-head' \}, phoneCollapse, h\('div', \{ class: 'np-phone-htitle' \}, h\('b', \{\}, 'Now Playing'\), h\('div', \{ class: 'np-phone-zone' \}, phoneZone, zoneLink\('zl-fullphone'\)\)\), phoneMore\),\n\s*(\/\/[^\n]*\n\s*)*phoneArt,/);
  assert.doesNotMatch(n, /phoneMore\),\n\s*h\('div', \{ class: 'np-phone-zone' \}/, 'no separate zone row under the header');
  assert.match(n, /wavwiz:zonesync[^\n]*phoneZone\.textContent = zc\?\.name \|\| 'No zone selected'; phoneZone\.hidden = !!zc;/, 'pill and "No zone selected" never show together');
  const c = css();
  assert.match(c, /#p-now>\.np-phone-full\{display:grid;grid-template-rows:auto minmax\(0,1fr\) auto auto auto auto auto auto;/, 'header, art (1fr), then 6 rows');
  assert.match(c, /\.np-phone-head \.np-phone-htitle\{display:flex;align-items:center;justify-content:flex-start;gap:8px;min-width:0/);
  assert.match(c, /\.np-phone-head \.np-phone-zone\{display:flex;flex:0 1 auto;min-width:0/);
});

test('fix073d Library pills (t2268u): the selected pill has no drop glow (the scrolling row clipped it square); toggle segments follow the rounded corners', () => {
  const c = css();
  assert.match(c, /\.view \.lib \.tabs:not\(\.libsrc-tabs\) button\.on\{background:color-mix\(in srgb,var\(--accent\) 88%,transparent\);box-shadow:none\}/);
  assert.doesNotMatch(c, /\.lib \.tabs:not\(\.libsrc-tabs\) button\.on\{[^}]*box-shadow:0 4px 14px/);
  assert.match(c, /\.lib \.libtools \.seg button:first-child\{border-radius:2px 0 0 2px\}/);
  assert.match(c, /\.lib \.libtools \.seg button:last-child\{border-radius:0 2px 2px 0\}/);
  assert.match(c, /\.lib \.libtools \.seg button:only-child\{border-radius:2px\}/);
});

// 0.7.1 t2117u: the phone drawer (html.handset) reuses the narrow-PC compact menu (File / Library / Playback /
// Devices / Help). Phone-only differences are gated on html.handset, never on window width.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const www = new URL('../../src/WavWiz.Server/wwwroot/', import.meta.url);
const js = f => readFileSync(new URL('js/' + f, www), 'utf8');
const css = readFileSync(new URL('app.css', www), 'utf8');
const menu = js('menu.js');
const elevate = js('elevate.js');
const flat = s => s.replace(/\s+/g, '');
const phoneFn = (() => {
  const i = menu.indexOf('export function createPhoneDrawerNav');
  const j = menu.indexOf('\nfunction createCompactPcNav', i);
  return menu.slice(i, j > 0 ? j : undefined);
})();
const compact = (() => {
  const i = menu.indexOf('function createCompactPcNav');
  return menu.slice(i);
})();
const ruleAfter = (sel, after) => {
  const f = flat(css), start = after ? f.indexOf(flat(after)) : 0;
  const i = f.indexOf(flat(sel) + '{', start);
  assert.ok(i >= 0, `rule not found: ${sel}`);
  return f.slice(i, f.indexOf('}', i));
};

test('phone drawer reuses createCompactPcNav and keeps the WavWiz BETA + Done header on html.handset only', () => {
  assert.match(phoneFn, /const phone = htmlHandset\(\)/);
  assert.match(phoneFn, /createCompactPcNav\(S, ctl, \{ onClose, desktop: !phone \}\)/);
  assert.match(phoneFn, /if \(!phone\) return nav/);
  assert.match(phoneFn, /class: 'row drawer-head'/);
  assert.match(menu, /import \{ brandMark \} from '\.\/brand\.js'/);
  assert.match(phoneFn, /brandMark\(\)/);
  assert.doesNotMatch(phoneFn, /h\('b', null, 'WavWiz'\)/);
  assert.match(phoneFn, /class: 'beta'/);
  assert.match(phoneFn, /versionLabel \|\| 'BETA'/);
  assert.match(phoneFn, /class: 'drawer-close'/);
  assert.match(phoneFn, /'Done'/);
  assert.doesNotMatch(phoneFn, /max-width/);
});

test('drawer header wordmark is the shared brandMark (theme colors, not a plain white WavWiz)', () => {
  assert.match(js('main.js'), /titlebarLogo\(\(\) => brandMark\(\)\)/, 'title bar already uses brandMark');
  assert.match(js('brand.js'), /wav\.className = 'wm-wav'/);
  assert.match(js('brand.js'), /wiz\.className = 'wm-wiz'/);
  assert.match(js('brand.js'), /if \(LOGO\.header && opts\.emblem !== false\) wrap\.append\(emblem\('pf-emblem brand-emblem'\)\)/);
  // colors come from the existing wordmark / emblem CSS variables — the drawer adds no hex colors
  const tag = '0.7.1 t2117u: the phone drawer reuses';
  const block = css.slice(css.indexOf(tag), css.indexOf('A–Z letter finder'));
  assert.match(block, /html\.handset \.drawer nav\.desk-menus \.drawer-head \.wordmark/);
  assert.match(block, /html\.handset \.drawer nav\.desk-menus \.drawer-head \.brand-emblem/);
  assert.doesNotMatch(block, /#[0-9A-Fa-f]{3,8}/);
  assert.match(css, /\.wordmark \.wm-wav\{color:var\(--accent-text,var\(--accent\)\)/);
  assert.match(css, /\.wordmark \.wm-wiz\{color:var\(--accent2-text,var\(--accent2\)\)/);
  assert.doesNotMatch(block, /@media\s*\(max-width/);
});

test('handset File group is the same spec as the PC menu, with the same admin rows and hide predicates', () => {
  const file = menu.slice(menu.indexOf('file: ['), menu.indexOf('library: ['));
  assert.match(file, /\['Sign in as admin…', \(\) => signInAsAdmin\(S\), null, \(\) => admin\(\)\]/);
  assert.match(file, /\['Leave admin mode', \(\) => leaveAdmin\(S\), null, \(\) => !S\.auth\?\.elevated\]/);
  assert.match(file, /\['Sign out'/);
  // both the menubar and the compact drawer fill File from A.file
  assert.equal((menu.match(/topSpec\('File', 'file'\)/g) || []).length, 2);
  assert.match(compact, /topSpec\('File', 'file'\)/);
  assert.match(compact, /topSpec\('Library', 'library'\)/);
  assert.match(compact, /topSpec\('Playback', 'playback'\)/);
  assert.match(compact, /topSpec\('Devices', 'devices'\)/);
  assert.match(compact, /topSpec\('Help', 'help'\)/);
});

test('Phone role… stays in Devices (phones only, not Player WebView); no pins / shortcut hints on html.handset', () => {
  assert.match(menu, /\['Phone role…', \(\) => changePhoneRole\(\), null, \(\) => !isPhoneUa\(\) \|\| isPlayerUa\(\)\]/);
  assert.match(compact, /const pins = !htmlHandset\(\), kbds = !htmlHandset\(\)/);
  assert.match(compact, /adorn\([^;]+, pins, kbds\)/);
  assert.match(compact, /if \(htmlHandset\(\)\) return false/);
  assert.match(menu, /const htmlHandset = \(\) => typeof document !== 'undefined' && !!document\.documentElement\?\.classList\?\.contains\('handset'\)/);
  assert.doesNotMatch(compact, /max-width:900px/);
});

test('narrow non-handset compact menu is unchanged: pins, shortcuts, flyout-when-it-fits, no header', () => {
  assert.doesNotMatch(compact, /class: 'row drawer-head'/);
  assert.doesNotMatch(compact, /brandMark\(\)/);
  assert.doesNotMatch(compact, /h\('b', null, 'WavWiz'\)/);
  assert.doesNotMatch(compact, /'Done'/);
  assert.match(compact, /FLYOUT_MIN_W = 220/);
  assert.match(compact, /innerWidth - r\.right - 6 >= FLYOUT_MIN_W/);
  assert.match(compact, /onmouseenter: \(\) => \{ if \(!isAcc\(\)\) openFly\(\); \}/);
  assert.match(menu, /if \(o\?\.pin && pins\) btn\.append\(pinSpan\(o\.pin\)\)/);
  assert.match(menu, /if \(o\?\.kbd && kbds\) btn\.append\(h\('span', \{ class: 'kbd' \}, o\.kbd\)\)/);
  // default compact path is desktop: true (side panels when the window is wide)
  assert.match(compact, /function createCompactPcNav\(S, ctl, \{ onClose, desktop = true \} = \{\}\)/);
  assert.match(compact, /menuActions\(S, ctl, desktop\)/);
  // the desktop menubar still adorns with the default (pins and shortcuts on)
  const bar = menu.slice(menu.indexOf('export function createMenuBar'), menu.indexOf('export function createPhoneDrawerNav'));
  assert.match(bar, /adorn\(f\.querySelector\(':scope > button'\), o\)/);
  assert.match(bar, /adorn\(b, o\)/);
});

test('CSS: larger rows, hidden kbd/pins, and wider accordion are html.handset only; narrow PC sizes stay 32px / 13px', () => {
  const tag = '0.7.1 t2117u: the phone drawer reuses';
  assert.ok(css.includes(tag));
  const block = css.slice(css.indexOf(tag), css.indexOf('A–Z letter finder'));
  assert.match(block, /html\.handset \.drawer nav\.desk-menus\{width:min\(320px,86vw/);
  assert.match(block, /html\.handset \.drawer nav\.desk-menus \.mtop,/);
  assert.match(block, /min-height:48px;font-size:16px/);
  assert.match(block, /html\.handset \.drawer nav\.desk-menus \.kbd,\s*html\.handset \.drawer nav\.desk-menus \.mpin\{display:none\}/);
  assert.doesNotMatch(block, /@media\s*\(max-width/);
  // the new rules sit at top level (same check as the 0.6.8f accordion tests)
  const i = css.indexOf(tag); const before = css.slice(0, i).replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"\n]*"/g, '""');
  const opens = (before.match(/\{/g) || []).length, closes = (before.match(/\}/g) || []).length;
  assert.ok(opens <= closes, 'html.handset phone-menu rules must sit at top level, outside any @media block');
  // narrow PC compact menu sizes are unchanged
  assert.match(ruleAfter('.drawer nav.desk-menus .mtop', '0.6.8: narrow PC hamburger'), /min-height:32px/);
  assert.match(ruleAfter('.drawer nav.desk-menus .mtop', '0.6.8: narrow PC hamburger'), /font-size:13px/);
  assert.match(css, /\.drawer nav\.desk-menus\{width:min\(200px,72vw/);
  assert.match(css, /\.drawer nav\.desk-menus\.desk-acc\{width:min\(260px,86vw/);
  const mq = css.slice(css.indexOf('@media (max-width:900px){\n  .drawer nav.desk-menus button'), css.indexOf('.drawer nav.desk-menus .mpanel button{padding:7px 14px}') + 80);
  assert.match(mq, /min-height:32px;font-size:13px/);
});

test('Admin chip is tappable on html.handset only when elevated, and offers Leave admin mode', () => {
  assert.match(elevate, /document\.documentElement\?\.classList\?\.contains\('handset'\)/);
  assert.match(elevate, /handset\(\) && !!S\.auth\?\.elevated/);
  assert.match(elevate, /classList\.toggle\('adminchip-tap', tap\)/);
  assert.match(elevate, /ask\('Leave admin mode'/);
  assert.match(elevate, /if \(ok\) await leaveAdmin\(S\)/);
  assert.match(css, /html\.handset \.adminchip\.adminchip-tap\{cursor:pointer/);
});

test('phone (html.handset) hides Import/Restore, Tag & cover fix, Tidy up library, and Keyboard shortcuts; Export settings and Back up now stay', () => {
  const file = menu.slice(menu.indexOf('file: ['), menu.indexOf('library: ['));
  const library = menu.slice(menu.indexOf('library: ['), menu.indexOf('playback: ['));
  const help = menu.slice(menu.indexOf('help: ['), menu.indexOf('\n  };'));
  assert.match(file, /\['Import settings…', \(\) => importSettings\(S, refreshAll\), \(\) => !admin\(\), \(\) => htmlHandset\(\)\]/);
  assert.match(file, /\['Restore backup…', \(\) => restoreBackup\(S, refreshAll\), \(\) => !admin\(\), \(\) => htmlHandset\(\)\]/);
  // Export settings / Back up now have no handset hide (still admin-disabled only)
  assert.match(file, /\['Export settings', \(\) => exportSettings\(S\), \(\) => !admin\(\)\]/);
  assert.match(file, /\['Back up now', \(\) => backUpNow\(S\), \(\) => !admin\(\)\]/);
  assert.doesNotMatch(file, /\['Export settings'[^|\n]*, \(\) => htmlHandset\(\)/);
  assert.doesNotMatch(file, /\['Back up now'[^|\n]*, \(\) => htmlHandset\(\)/);
  assert.match(library, /\['Tag & cover fix', \(\) => go\('tags'\), \(\) => !admin\(\), \(\) => htmlHandset\(\)\]/);
  assert.match(library, /\['Tidy up library', \(\) => go\('cleanup'\), \(\) => !admin\(\), \(\) => htmlHandset\(\)\]/);
  assert.match(help, /\['Keyboard shortcuts', \(\) => dialog\('Keyboard shortcuts', shortcutsBody\(h\), \[\{ text: 'Close', cls: 'primary' \}\]\), null, \(\) => htmlHandset\(\)\]/);
  // other Help rows are not hidden on a phone
  for (const row of ['Getting started', "What's new", 'Diagnostics', 'About WavWiz']) {
    assert.match(help, new RegExp('\\[' + (row.includes("'") ? `"${row}"` : `'${row}'`)));
    const line = help.split('\n').find(l => l.includes(row === "What's new" ? '"What\\\'s new"' : `'${row}'`) || l.includes(row));
    assert.ok(line, `Help row present: ${row}`);
    if (row !== 'Keyboard shortcuts') assert.doesNotMatch(line, /htmlHandset/);
  }
  // gated on html.handset, never window width, and not on the Player app UA
  assert.doesNotMatch(file + library + help, /isPlayerUa\(\)|isPhoneUa\(\)|max-width/);
});

test('visibleSpec drops hidden rows and dangling or doubled hr separators; a non-handset spec is unchanged', () => {
  const i = menu.indexOf('function visibleSpec(spec)');
  const j = menu.indexOf('\nfunction adorn', i);
  const src = menu.slice(i, j);
  const visibleSpec = new Function(src + '; return visibleSpec;')();
  const keep = ['Export settings', () => {}, () => false];
  const hide = ['Import settings…', () => {}, () => false, () => true];
  const show = ['Restore backup…', () => {}, () => false, () => false];
  assert.deepEqual(visibleSpec(['hr', hide, keep, 'hr']).map(s => s === 'hr' ? 'hr' : s[0]), ['Export settings']);
  assert.deepEqual(visibleSpec([keep, 'hr', hide, 'hr']).map(s => s === 'hr' ? 'hr' : s[0]), ['Export settings']);
  assert.deepEqual(visibleSpec([keep, 'hr', 'hr', show]).map(s => s === 'hr' ? 'hr' : s[0]), ['Export settings', 'hr', 'Restore backup…']);
  // narrow PC / Player (hide predicates false): File-like group keeps Import, Restore, and both separators
  const fileLike = [
    ['New', () => {}],
    'hr',
    ['Import settings…', () => {}, () => false, () => false],
    ['Restore backup…', () => {}, () => false, () => false],
    ['Export settings', () => {}, () => false],
    ['Back up now', () => {}, () => false],
    'hr',
    ['Sign out', () => {}],
  ];
  assert.deepEqual(visibleSpec(fileLike).map(s => s === 'hr' ? 'hr' : s[0]),
    ['New', 'hr', 'Import settings…', 'Restore backup…', 'Export settings', 'Back up now', 'hr', 'Sign out']);
  const phoneFile = fileLike.map(s => Array.isArray(s) && (s[0] === 'Import settings…' || s[0] === 'Restore backup…')
    ? [s[0], s[1], s[2], () => true] : s);
  assert.deepEqual(visibleSpec(phoneFile).map(s => s === 'hr' ? 'hr' : s[0]),
    ['New', 'hr', 'Export settings', 'Back up now', 'hr', 'Sign out']);
  // Help: only Keyboard shortcuts is hidden; no leftover hr (Help has none)
  const help = [
    ['Getting started', () => {}],
    ["What's new", () => {}],
    ['Keyboard shortcuts', () => {}, null, () => true],
    ['Diagnostics', () => {}],
    ['About WavWiz', () => {}],
  ];
  assert.deepEqual(visibleSpec(help).map(s => s[0]), ['Getting started', "What's new", 'Diagnostics', 'About WavWiz']);
});

test('both the menubar and the compact drawer walk visibleSpec, so leftover hrs cannot linger after a hide', () => {
  assert.equal((menu.match(/return visibleSpec\(spec\)\.map\(s => \{/g) || []).length, 2);
  const bar = menu.slice(menu.indexOf('export function createMenuBar'), menu.indexOf('export function createPhoneDrawerNav'));
  assert.match(bar, /return visibleSpec\(spec\)\.map/);
  assert.match(compact, /return visibleSpec\(spec\)\.map/);
});

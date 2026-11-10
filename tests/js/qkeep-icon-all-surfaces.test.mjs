// 0.6.8: Keep playing is the same infinity icon + menu on every queue surface.
// No leftover "Keep playing:" text chip/dropdown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.WW_WWW || join(dirname(fileURLToPath(import.meta.url)), '../../src/WavWiz.Server/wwwroot');
const jsDir = join(root, 'js');
const read = rel => readFileSync(join(root, rel), 'utf8');
const jsFiles = (() => {
  const out = [];
  const walk = d => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) walk(p); else if (n.name.endsWith('.js')) out.push(p); } };
  walk(jsDir);
  return out;
})();

test('keepControl is the glow infinity icon (variant A), not a text chip', () => {
  const src = read('js/queuetools.js');
  assert.match(src, /KEEP_ICON_STYLE = 'glow'/);
  assert.match(src, /icon\('keep'\)/);
  assert.match(src, /class: 'qkeep qkeep-ic /);
  // Same chrome as the queue lock: .plus.pllock, with .on toggled when a mode is active.
  assert.match(src, /class: 'qkeep-sel plus pllock'/);
  assert.match(src, /sel\.classList\.toggle\('on', on\)/);
  assert.match(src, /aria-pressed/);
  // The visible control is the icon button; the lbl node is only a hidden mirror of the tooltip.
  assert.match(src, /class: 'qkeep-lbl'/);
  assert.doesNotMatch(src, /h\('select'/);
});

test('every product queue surface mounts keepControl (icon + menu)', () => {
  const list = read('js/listtable.js');
  // Docked desktop Queue, expanded/full Queue, per-zone queues (zone picker / Open queue),
  // and a pinned Queue all share this one listpanel header.
  assert.match(list, /keepControl\(\{ zid: \(\) => viewZid\(\), can: \(\) => canControl\(S\) \}\)/);
  assert.match(list, /iconRow = h\('span', \{ class: 'row plbtns' \}, keepEl,/);

  const main = read('js/main.js');
  // Compact / phone Queue page — Keep playing lives in the desktop-matching icon row
  assert.match(main, /keepControl\(\{ can: \(\) => canControl\(S\) \}\)/);
  assert.match(main, /class: 'row plbtns pq-tools'/);
  assert.match(main, /phoneKeep\(\)/);
});

test('CSS never shows the old Keep playing label/chip on any surface', () => {
  const css = read('app.css');
  // Variant A: the lbl is forced hidden everywhere (including phone).
  assert.match(css, /\.qkeep\.qkeep-ic \.qkeep-lbl\{display:none!important\}/);
  assert.doesNotMatch(css, /\.qkeep-lbl\{display:(inline|block|flex|grid|contents)/);
  // Phone stretch-chip (flex 140px + horizontal padding as a text button) is gone.
  assert.doesNotMatch(css, /\.phone-queue \.qkeep-line \.qkeep-sel\{[^}]*flex:1 1 140px/);
  assert.doesNotMatch(css, /\.phone-queue \.qkeep-line \.qkeep\.qkeep-ic \.qkeep-lbl\{display:inline/);
  // Compact PC: 22px like desktop; real handset: 44px tap target.
  assert.match(css, /\.phone-queue \.pq-tools \.qkeep\.qkeep-ic \.qkeep-sel\{width:22px;height:22px;min-width:22px;min-height:22px/);
  assert.match(css, /\.phone-queue\.pq-handset \.pq-tools \.qkeep\.qkeep-ic \.qkeep-sel\{width:44px;height:44px;min-width:44px;min-height:44px/);
});

test('Keep playing reuses the lock button chrome (.plus.pllock / .on), no bespoke glow', () => {
  const css = read('app.css');
  // Shared lock + keep rules (not listpanel-only).
  assert.match(css, /\.plus\.pllock\{border-color:var\(--line\);color:var\(--dim\);background:transparent\}/);
  assert.match(css, /\.plus\.pllock\.on\{border-color:var\(--accent\);color:var\(--accent\);box-shadow:0 0 8px var\(--accent\),inset 0 0 6px/);
  // No custom keep-on/off glow that diverged from the lock.
  assert.doesNotMatch(css, /\.qkeep\.qkeep-ic\.qkeep-on \.qkeep-sel\{[^}]*box-shadow/);
  assert.doesNotMatch(css, /\.qkeep\.qkeep-ic\.qkeep-off \.qkeep-sel\{[^}]*opacity:\.7/);
  // Legacy chip opacity/transparent-border must not hit the icon variant.
  assert.doesNotMatch(css, /\.qkeep\.qkeep-off\{opacity:\.6\}/);
  assert.match(css, /\.qkeep:not\(\.qkeep-ic\)\.qkeep-off\{opacity:\.6\}/);
});

test('no JS queue view still renders the old Keep playing: chip', () => {
  const skip = new Set(['queuetools.js']); // keepTip / hidden lbl / toast may mention the words
  const offenders = [];
  for (const p of jsFiles) {
    const name = p.slice(jsDir.length + 1);
    if (skip.has(name) || name.startsWith('preview') || name.includes('preview-')) continue;
    const s = readFileSync(p, 'utf8');
    // Old chip markup: a visible "Keep playing:" span, or a qkeep without qkeep-ic, or a native <select> keep control.
    if (/class: 'qkeep-lbl'/.test(s) && name !== 'queuetools.js') offenders.push(`${name}: qkeep-lbl`);
    if (/class: 'qkeep'(?![-a-z])/.test(s) && !/qkeep-ic/.test(s)) offenders.push(`${name}: bare qkeep without qkeep-ic`);
    // Reconstruct of the pre-0.6.8 chip: labelled text + mode name as the button caption.
    if (/qkeep-lbl['"][^;]*Keep playing:/.test(s) && name !== 'queuetools.js') offenders.push(`${name}: visible Keep playing: label`);
    if (/h\('button'[^;]*class: 'qkeep-sel'[^;]*\)\s*,\s*'/.test(s)) offenders.push(`${name}: qkeep-sel with text caption`);
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

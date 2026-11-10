// 0.6.8: desktop Queue header tool icons stay right-aligned with the pin,
// whether or not Up next is showing, and for 0 / 1 / many tracks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const www = process.env.WW_WWW || join(here, '../../src/WavWiz.Server/wwwroot');
const rd = (rel) => readFileSync(join(www, rel), 'utf8');

test('Queue tool icons take the header auto-margin, grouped left of the pin and chevrons', () => {
  const s = rd('app.css');
  const main = rd('js/main.js');
  const list = rd('js/listtable.js');
  // Pin still sits immediately left of the expand/collapse wrap (e85c62b placement).
  assert.match(main, /if \(hd\.closest\('\.listpanel'\)\) \{ const wrap = hd\.querySelector\(':scope > \.listcolwrap, :scope > \.row\.listcolwrap'\); if \(wrap\) \{ hd\.insertBefore\(b, wrap\); return; \} \}/);
  // Header children: title, then sort chip, then the count (wide view puts the count
  // in the right cluster); icon row is a sibling before the pin wrap.
  assert.match(list, /const head = h\('div', \{ class: 'pane-h' \}, title, sortChip, meta, iconRow, h\('span', \{ class: 'row listcolwrap' \}/);
  assert.match(list, /iconRow = h\('span', \{ class: 'row plbtns' \}/);
  // Narrow (Library-expanded) auto-margin still starts at .plbtns so the tools
  // sit on the right. Wide view moves that auto-margin to the track count
  // (asserted in the wide Up next test below).
  assert.match(s, /\.desk \.listpanel>\.pane-h>\.plbtns\{margin-left:auto\}/);
  assert.match(s, /\.desk \.listpanel>\.pane-h>\.plus\.tpin\{margin-left:4px\}/);
  // Narrow single-row header (no Up next, so no .nb2): do not let listcolwrap
  // (often display:none) steal the auto-margin from the tool icons.
  assert.match(s, /\.desk\.libexpanded \.listpanel>\.pane-h:not\(\.nb2\) \.listcolwrap\{margin-left:0\}/);
  // Narrow + Up next already reserved this layout; keep it.
  assert.match(s, /\.desk\.libexpanded \.listpanel>\.pane-h\.nb2>\.plbtns\{[^}]*margin-left:auto/);
});

test('Queue header auto-margin rules are desktop-only and do not change phone Queue', () => {
  const s = rd('app.css');
  const phone = s.slice(s.indexOf('.phone-queue'));
  // The new auto-margin is scoped to .desk .listpanel > .pane-h, never .phone-queue.
  assert.doesNotMatch(s, /\.phone-queue[^{}]*\.plbtns\{margin-left:auto\}/);
  assert.doesNotMatch(s, /\.phone-queue[^{}]*\.plus\.tpin\{margin-left:4px\}/);
  // Existing phone Up next / tools rules stay in place (0.6.8 phone overlap fix).
  assert.match(s, /\.phone-queue \.pq-upnext/);
  assert.match(s, /\.phone-queue \.pq-tools/);
  assert.ok(phone.includes('.pq-upnext'), 'phone Up next rules still present');
});

test('wide Queue: Up next after the zone picker, track count immediately left of the tools', () => {
  const list = rd('js/listtable.js');
  const main = rd('js/main.js');
  const s = rd('app.css');
  // rightEdge is the left of the right cluster: count, tools, pin, chevrons.
  // The sort chip stays left after the zone picker and is not part of this edge.
  assert.match(list, /const rightEdge = \(\) => Math\.min\(\.\.\.\[meta, head\.querySelector\('\.tpin'\), iconRow, upBtn, colBtn\]/);
  // leftEdge clears the zone picker, then a visible sort chip — not the count.
  assert.match(list, /const sr = sortChip\?\.getBoundingClientRect\(\); if \(sr\?\.width\) L = Math\.max\(L, sr\.right\)/);
  assert.doesNotMatch(list, /for \(const e of \[meta, sortChip\]\)/);
  // placeNext sizes and hides from that gap; on a wide (not libexpanded) desk, Up next starts at L.
  assert.match(main, /const L = listt\.leftEdge\(\) \+ 16, Rr = listt\.rightEdge\(\) - 16, gap = Rr - L/);
  assert.match(main, /nb\.style\.left = Math\.round\(\(x - hd\.left\) \/ zf\) \+ 'px'; nb\.hidden = gap < \(wide \? 160 : 110\) \* zf/);
  assert.match(main, /x = !desk\.classList\.contains\('libexpanded'\) \? L \+ w \/ 2/);
  // Wide-only: the auto-margin starts at the track count so it sits immediately
  // left of the tools, even when Up next is hidden. Not a phone or libexpanded rule.
  assert.match(s, /\.desk:not\(\.libexpanded\) \.listpanel>\.pane-h>\.plmeta\{margin-left:auto;flex:none\}/);
  assert.match(s, /\.desk:not\(\.libexpanded\) \.listpanel>\.pane-h>\.plbtns\{margin-left:0\}/);
  assert.doesNotMatch(s, /@media \(max-width:\d+px\)\{[^}]*\.desk:not\(\.libexpanded\) \.listpanel>\.pane-h>\.plmeta/);
  // Narrow two-line header and phone Queue stay on their existing rules.
  assert.match(s, /\.desk\.libexpanded \.listpanel>\.pane-h\.nb2>\.plnext:not\(\[hidden\]\)\{position:static;transform:none;order:99;flex:1 0 100%/);
  assert.match(s, /\.desk\.libexpanded \.listpanel>\.pane-h\.nb2>\.plbtns\{[^}]*margin-left:auto/);
  assert.match(s, /\.phone-queue \.pq-upnext/);
  // Narrow still uses the plbtns auto-margin (locked right cluster).
  assert.match(s, /\.desk \.listpanel>\.pane-h>\.plbtns\{margin-left:auto\}/);
});

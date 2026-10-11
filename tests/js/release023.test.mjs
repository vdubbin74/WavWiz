// WavWiz 0.2.3 (U1-U10): fine-tunes on top of 0.2.2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
const css = readFileSync(join(js, '../app.css'), 'utf8');
globalThis.Element ??= class {};

test('0.2.3 U1: minimized Now Playing is ONE line - thumbnail, title · artist over the progress bar, then every control', () => {
  const n = src('now.js');
  assert.match(n, /h\('div', \{ class: 'ns-song' \}, sArt, h\('div', \{ class: 'ns-main' \}, h\('div', \{ class: 'ns-titles' \}, sT1,[^\n]*h\('div', \{ class: 'ns-seek' \}, sElv, sProg, sDur\)\)\)/);
  assert.match(n, /h\('div', \{ class: 'ns-x', role: 'group', 'aria-label': 'Transport' \}, sHeart, sShuffle, sPrev, sPlay, sNext, sRepeat\)/);
  assert.match(n, /h\('div', \{ class: 'ns-vol' \}, icon\('volume'\), sVol, sPct, sMute, sEq\)/);
  assert.match(n, /for \(const r of \[vol, barVol, sVol\]\)/);
  assert.match(n, /for \(const b of \[muteBtn, barMute, sMute\]\)/);
  assert.doesNotMatch(n, /songBlock|plsong|np-strip-c/);          // nothing moves to the Playlist title bar any more, no forced centering
  assert.match(css, /\.np-ctlpanel\.collapsed \.np-strip\{display:flex;/);
  assert.match(css, /\.np-ctlpanel\.collapsed \.np-ctlnow,\.np-ctlpanel\.collapsed \.np-ctltitle,/);
  assert.doesNotMatch(css, /\.plsong|np-strip-l|grid-template-columns:1fr auto 1fr/);
  // scaled to fit: pieces drop out by priority as the column narrows (container queries on the panel)
  for (const w of [860, 720, 600, 440]) assert.match(css, new RegExp(`@container npctl \\(max-width:${w}px\\)\\{[\\s\\S]{0,220}\\.ns-`));
});

test('0.2.3 U2: minimized Playlist shows "Up next: Title · Artist" centered on the Now Playing column; Save / Clear stay at the right', () => {
  const n = src('now.js'), m = src('main.js'), l = src('listtable.js');
  assert.match(n, /const nextBlock = h\('div', \{ class: 'plnext', 'aria-label': 'Up next', hidden: true \}, h\('span', \{ class: 'pln-lbl' \}, 'UP NEXT'\), nxArt, nxT1,/);
  assert.match(n, /drawNext\(nxt\);/);
  assert.match(n, /'Nothing queued after this'/);
  assert.match(l, /const setNextBlock = el => \{ head\.insertBefore\(el, meta\); \}/);
  assert.match(m, /const on = desk\.classList\.contains\('listcollapsed'\)/);
  assert.match(m, /const c = col\.left \+ col\.width \/ 2, room = Math\.min\(c - \(listt\.leftEdge\(\) \+ 16\), listt\.rightEdge\(\) - 16 - c\)/);
  assert.match(m, /listt\.setCollapsed\?\.\(c\); placeNext\(\);/);
  assert.match(css, /\.desk\.listcollapsed \.plnext:not\(\[hidden\]\)\{display:flex;[^}]*transform:translateX\(-50%\)/);
  assert.doesNotMatch(css, /\.desk\.listcollapsed \.listpanel \.pane-h \.small,\.desk\.listcollapsed \.listpanel \.pane-h \.row:not\(\.listcolwrap\)\{display:none\}/);
});

test('0.2.3 U3: the one-line bar wears the selected panel style (all four) in the theme colors', () => {
  for (const st of ['classic', 'center', 'stack', 'horizon']) assert.match(css, new RegExp(`\\.pn-${st} \\.(np-strip|ns-)`), st);
  assert.match(css, /\.pn-classic \.ns-art\{[^}]*conic-gradient\(var\(--accent\) calc\(var\(--ns-frac,0\) \* 1turn\)/);   // ring around the thumb
  assert.match(css, /\.pn-center \.ns-wave\{display:block\}/);                                                              // waveform seek
  assert.match(css, /\.pn-stack \.ns-led\{display:block;/);                                                                 // LED blocks
  assert.match(css, /\.pn-horizon \.ns-prog \.bar\{background:linear-gradient\(90deg,var\(--accent\),var\(--line\) 40%\)\}/); // line from the cover
  // effects follow the panel's 0-100 % sliders (inherited --fx-* custom properties), colors only from theme variables
  const block = css.slice(css.indexOf('0.2.3 U1:'), css.lastIndexOf('0.2.3 U2:'));
  assert.match(block, /var\(--fx-glow\)/); assert.match(block, /var\(--fx-motion\)/);
  assert.doesNotMatch(block.replace(/#08090A|#000\b/g, ''), /#[0-9a-f]{3,6}\b/i);
  const n = src('now.js');
  assert.match(n, /for \(const box of \[waveBase, waveTop, sWaveBase, sWaveTop\]\)/);
  assert.match(n, /ctlStrip\.style\.setProperty\('--ns-frac', frac\.toFixed\(4\)\)/);
});

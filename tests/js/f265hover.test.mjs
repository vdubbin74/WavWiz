// F265: Devices hover (PC app) - real-mouse hover detection keeps hovered zone parts (mute, now-line, ON/OFF, PLAYING, REF) across polls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom } from './minidom.mjs';
installDom(); globalThis.window ??= globalThis; globalThis.addEventListener ??= () => {}; globalThis.removeEventListener ??= () => {}; globalThis.dispatchEvent ??= () => true;
const js = process.env.JS_DIR;
const mm = map => q => ({ matches: !!map[q] });

test('F265 hoverReal: a mouse/pen pointer is trusted even when (hover: hover) is false (WebView2 touch-capable PC)', async () => {
  const { hoverReal } = await import(pathToFileURL(join(js, 'devices.js')).href);
  const noHover = mm({});
  assert.equal(hoverReal('mouse', noHover), true); assert.equal(hoverReal('pen', noHover), true);
  assert.equal(hoverReal('touch', mm({ '(hover: hover)': true, '(any-hover: hover)': true })), false, 'phone sticky hover never defers');
  assert.equal(hoverReal(null, mm({ '(any-hover: hover)': true })), true); assert.equal(hoverReal(null, mm({ '(hover: hover)': true })), true);
  assert.equal(hoverReal(null, noHover), false); assert.equal(hoverReal(null, null), false);
});
test('F265 hov42: any hovered spot inside a live part keeps it (PLAYING text, REF tag, mute, ON/OFF pill, now-line)', () => {
  const d = readFileSync(join(js, 'devices.js'), 'utf8');
  assert.match(d, /const hov42 = x => !!\(hoverReal\(lastPtr42\) && x\?\.matches\?\.\(':hover'\)\);/);
  assert.doesNotMatch(d, /matchMedia\('\(hover: hover\)'\)\.matches && \(x\.matches/, 'old media-only gate is gone');
  assert.match(d, /for \(const t of \['pointermove', 'pointerover', 'pointerdown'\]\) document\.addEventListener\(t, e => \{ lastPtr42 = e\.pointerType \|\| 'mouse'; \}, \{ capture: true, passive: true \}\);/);
  // every swap path still consults hov42
  assert.match(d, /const hovZone42 = x => hov42\(x\) \|\| hov42\(x\?\.closest\?\.\('section\.qb42,\.zcard42'\)\);/);
  for (const re of [/\|\| hovZone42\(x\)\) \{ all = 2; continue; \} x\.replaceWith\(y\);/, /\|\| hovZone42\(x\);\n/, /if \(old && fresh && old\.isConnected && hov42\(old\)\) return old;/, /&& hov42\(tnode\)\) return tnode;/, /!hov42\(pnl\)/]) assert.match(d, re);
});

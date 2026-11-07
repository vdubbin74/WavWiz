// F260: the phone calibration mic page always has a way back to the player (user t1377u).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR, www = join(js, '..');
const cm = readFileSync(join(js, 'calmic.js'), 'utf8');
const html = readFileSync(join(www, 'calmic.html'), 'utf8');
const css = readFileSync(join(www, 'calmic.css'), 'utf8');
const exitFn = cm.slice(cm.indexOf('export async function exitCal'), cm.indexOf('function backBtn'));

test('F260: header has a .ww-close close button wired to exitCal', () => {
  assert.match(html, /<header><button id="calx" class="ww-close" type="button" aria-label="Close calibration">/);
  assert.match(cm, /getElementById\('calx'\)\?\.addEventListener\('click', \(\) => exitCal\(\)\)/);
});
test('F260: close style mirrors F254 (3px square, ink X, accent focus ring, 44x44 coarse)', () => {
  assert.match(css, /header \.ww-close\{[^}]*border-radius:3px[^}]*color:var\(--ink\)/);
  assert.match(css, /header \.ww-close:focus-visible\{outline:2px solid var\(--accent\);outline-offset:2px\}/);
  assert.match(css, /\(max-width:900px\),\(pointer:coarse\)\{header \.ww-close\{width:44px;height:44px\}\}/);
});
test('F260: Stop becomes Stop & exit; start, error and nothing-to-measure cards get Back to player', () => {
  assert.match(cm, /onclick: \(\) => exitCal\(\) \}, 'Stop & exit'\)/);
  assert.doesNotMatch(cm, /const cancel = async/);
  assert.ok((cm.match(/backBtn\(\)/g) || []).length >= 4);   // definition + reload card + start card + error card
});
test('F260: exitCal cancels once, stops the mic (incl. a pending request), ends the session with keepalive, never auto-resumes', () => {
  assert.match(exitFn, /exiting = true; canceled = true; clearInterval\(helloTimer\); releaseMic\(pending\);/);
  assert.match(exitFn, /sessions\/\$\{id\}\/end`, \{ method: 'POST', body: \{ reason: 'canceled' \}, keepalive: true \}/);
  assert.doesNotMatch(exitFn, /stream\/resume|\/play\b/);
  assert.match(exitFn, /still paused/);
  assert.match(cm, /history\.back\(\); else location\.replace\('\/'\)/);   // target restricted by backTarget (F260-A)
  assert.match(cm, /keepalive: !!keepalive/);
});
test('F260: countdown, capture and group loops see the module-level canceled flag; a late session is ended', () => {
  assert.match(cm, /^let canceled = false, exiting = false, pending = null, creating = null;/m);
  assert.ok(cm.includes("if (n <= 0 || canceled || stopped)") && cm.includes('if (canceled || stopped) return null;'));
  assert.match(cm, /creating = null; sid = s\.id; if \(canceled\) \{ sid = null; call\(`\/calibration\/sessions\/\$\{s\.id\}\/end`/);
});
test('F260: swipe-back / pagehide ends an active session with keepalive', () => {
  assert.match(cm, /\n  if \(sid\) \{ const id = sid; sid = null; canceled = true; releaseMic\(\); call\(`\/calibration\/sessions\/\$\{id\}\/end`[^)]*keepalive: true/);
});

// F260-A: real-module behavior of the calmic exit (H1 bounded exit, M1 pending create, L1 late mic, L2 back target, L3 bfcache).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url)), js = process.env.JS_DIR;
const run = env => execFileSync(process.execPath, [join(here, 'f260-harness.mjs')], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 30000 });

test('F260-A H1: a stalled /end cannot trap the exit; it navigates within the bound', () => {
  const o = run({ SC: 'stall-bounded', END: 'stall' });
  assert.match(o, /fetch POST \/calibration\/sessions\/S1\/end \[keepalive\]/);
  assert.match(o, /location\.replace \//); assert.match(o, /exit returned after ms<=4000: true/);
});
test('F260-A H1: a second tap while /end is pending still navigates', () => {
  const o = run({ SC: 'active-stall', END: 'stall' });
  assert.ok(o.indexOf('second exit click') < o.indexOf('location.replace /'));
});
test('F260-A M1: left is sent before waiting; a pending create is bounded and ended when it lands', () => {
  const o = run({ SC: 'session-race', SESS: 'pending' });
  assert.ok(o.indexOf('{"state":"left"}') < o.indexOf('location.replace /'));
  assert.match(o.slice(o.indexOf('late session response')), /sessions\/S1\/end \[keepalive\]/);
});
test('F260-A: active exit stops the mic, ends the session and never auto-resumes', () => {
  const o = run({ SC: 'active-resume', END: 'resume' });
  assert.match(o, /track\.stop[\s\S]*ctx\.close[\s\S]*wake\.release/); assert.match(o, /autoresume fetch\? false/); assert.match(o, /Calibration canceled/);
});
test('F260-A L1: a microphone granted after exit is released and nothing continues (no wake lock, no session)', () => {
  const o = run({ SC: 'late-gum-l1', GUM: 'pending' });
  assert.match(o, /wake after exit: false/); assert.doesNotMatch(o, /POST \/calibration\/sessions\n/); assert.match(o, /ctx\.close/); assert.match(o, /tracksStopped=[12]/);
});
test('F260-A L2: back only to the player root', async () => {
  const src = readFileSync(join(js, 'calmic.js'), 'utf8'); const fn = src.match(/export function backTarget[\s\S]*?\n/)[0].replace('export ', '');
  const backTarget = new Function(fn + '; return backTarget;')();
  assert.equal(backTarget('https://h/', 'https://h', 2), 'back');
  assert.equal(backTarget('https://h/index.html', 'https://h', 3), 'back');
  assert.equal(backTarget('https://h/calmic.html?cal=X', 'https://h', 3), 'root');
  assert.equal(backTarget('https://h/tls/setup', 'https://h', 3), 'root');
  assert.equal(backTarget('https://other/', 'https://h', 3), 'root');
  assert.equal(backTarget('https://h/', 'https://h', 1), 'root');
  assert.equal(backTarget('', 'https://h', 3), 'root');
  assert.match(run({ SC: 'initial', REF: 'https://h/calmic.html' }), /location\.replace \//);
  assert.match(run({ SC: 'initial', REF: 'https://h/' }), /history\.back/);
});
test('F260-A L3: a canceled page restored from bfcache goes to the player', () => {
  const o = run({ SC: 'bfcache' }); assert.equal((o.match(/location\.replace \//g) || []).length, 2);
});

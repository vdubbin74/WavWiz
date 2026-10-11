// WavWiz 0.2.4: the server's /ping answers app 'wavwiz' (0.2.3 and older said 'unison'); the phone set-up page accepts both, so the
// "Check my phone" test keeps working against any server version.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const t = readFileSync(`${process.env.JS_DIR}/tls-setup.js`, 'utf8');

test('0.2.4: tls-setup.js accepts both ping names and nothing else', () => {
  const line = t.match(/const isOurApp = (app => [^;\n]+);/); assert.ok(line, 'isOurApp present');
  const isOurApp = new Function('return (' + line[1] + ')')();
  assert.equal(isOurApp('wavwiz'), true); assert.equal(isOurApp('unison'), true);
  for (const x of ['WavWiz', 'other', '', undefined, null]) assert.equal(isOurApp(x), false);
  assert.match(t, /return j && isOurApp\(j\.app\) \?/);
  assert.doesNotMatch(t, /j\.app === 'unison'/);
});

test('0.2.4: a phone that trusted an earlier certificate is told to install the new one', () => {
  assert.match(t, /Set this phone up before\? WavWiz may have a new certificate/);
});

test('0.2.4: What\'s new and CHANGELOG name the 0.2.4 fixes in words (no internal codes)', () => {
  const a = readFileSync(`${process.env.JS_DIR}/about.js`, 'utf8');
  assert.match(a, /WHATS_NEW_VERSION = '0\.2\.4'/);
  for (const x of ['Phone set-up page fixed', 'QR code goes straight to calibration', 'Install steps when needed', 'Certificate says WavWiz']) assert.ok(a.includes(x), x);
  const cl = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(cl, /## \[0\.2\.4\] - 2026-10-11 \(beta\)/); assert.ok(cl.indexOf('## [0.2.4]') < cl.indexOf('## [0.2.3]'));
  const sec = cl.slice(cl.indexOf('## [0.2.4]'), cl.indexOf('## [0.2.3]'));
  for (const x of ['works with the HTTPS redirect on', 'goes straight to calibration', 'Install steps when the phone does not trust', 'Certificate and profile names say WavWiz', 'install and trust the new certificate once']) assert.ok(sec.includes(x), x);
  assert.doesNotMatch(sec, /\b[UTF]\d+\b|Unison/);
});

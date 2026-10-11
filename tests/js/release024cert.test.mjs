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

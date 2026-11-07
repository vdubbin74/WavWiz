// F255: phone NP zone pill vertically centers label (beat .zlink baseline).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const www = process.env.WW_WWW || join(dirname(fileURLToPath(import.meta.url)), '../../src/WavWiz.Server/wwwroot');
test('F255 .zl-fullphone centers; base .zlink stays baseline', () => {
  const s = readFileSync(join(www, 'app.css'), 'utf8');
  assert.match(s, /\.zlink\{display:inline-flex;align-items:baseline/);
  assert.match(s, /\.np-phone-zone \.zl-fullphone\{[^}]*align-items:center;justify-content:center/);
  assert.match(s, /\/\* F255/);
});

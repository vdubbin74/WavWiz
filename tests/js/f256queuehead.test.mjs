// F256: phone Queue head regroup — meta alone, Keep row, 2×2 square actions, no Save pill.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const www = process.env.WW_WWW || join(dirname(fileURLToPath(import.meta.url)), '../../src/WavWiz.Server/wwwroot');
const css = () => readFileSync(join(www, 'app.css'), 'utf8');
const main = () => readFileSync(join(www, 'js/main.js'), 'utf8');

test('F256 drawQueue builds qkeep-line + qactions grid (not qsecondary wrap with Save)', () => {
  const s = main();
  assert.match(s, /class: 'qkeep-line'/);
  assert.match(s, /class: 'qactions'/);
  assert.match(s, /F256: phone Queue head/);
  // Save no longer on qcount-line
  const head = s.slice(s.indexOf('F256: phone Queue head'), s.indexOf("h('h2', { class: 'qrows-heading'"));
  assert.match(head, /qcount-line.*tracks/s);
  assert.doesNotMatch(head, /qcount-line[\s\S]*qsave-open/);
  assert.match(head, /qactions[\s\S]*saveBtn[\s\S]*recentBtn/);
});

test('F256 CSS: no Save pill; qactions 2-col; Keep 44px', () => {
  const s = css();
  assert.match(s, /\/\* F256: phone Queue head/);
  assert.match(s, /\.phone-queue \.qactions\{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:1fr/);
  assert.match(s, /\.phone-queue \.qkeep-line \.qkeep-sel\{min-height:44px/);
  assert.doesNotMatch(s, /\.phone-queue \.qsave-open\{border-radius:999px/);
  assert.match(s, /\.phone-queue \.qactions>\.btn,\.phone-queue \.qsave-open\{min-height:44px;height:100%;border-radius:3px/);
  assert.match(s, /align-items:stretch/);
});

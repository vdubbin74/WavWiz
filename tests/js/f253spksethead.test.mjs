// F253: phone Speaker Settings .spk-head — title own row under .pd42-sheet; actions nowrap / never clip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const www = process.env.WW_WWW || join(here, '../../src/WavWiz.Server/wwwroot');
const css = () => readFileSync(join(www, 'app.css'), 'utf8');
const js = () => readFileSync(join(www, 'js/spkset.js'), 'utf8');

test('F253 phone .pd42-sheet .spk-head wraps; title takes full first row', () => {
  const s = css();
  assert.match(s, /\/\* F253: phone Speaker Settings head/);
  assert.match(s, /\.pd42-sheet \.spk-head\{\s*flex-wrap:wrap;/);
  assert.match(s, /\.pd42-sheet \.spk-title\{\s*flex:1 0 100%;/);
});

test('F253 phone head actions override .pd42 * shrink + nowrap', () => {
  const s = css();
  assert.match(s, /\.pd42-sheet \.spk-head :is\(\.spk-rename,\.spk-cancel,\.spk-done,\.spk-preview,\.spk-status\)\{\s*flex:0 0 auto;\s*min-width:auto;\s*max-width:none;\s*white-space:nowrap;/);
  assert.match(s, /\.pd42-sheet \.spk-head > \.grow\{flex:1 1 auto;min-width:8px\}/);
});

test('F253 desktop base .spk-head stays single-row (no global wrap)', () => {
  const s = css();
  // Base rule must remain nowrap flex (no flex-wrap on the unscoped rule).
  assert.match(s, /\.spk-head\{display:flex;align-items:center;gap:10px\}/);
  assert.doesNotMatch(s, /(?<!\.pd42-sheet )\n?\.spk-head\{[^}]*flex-wrap:wrap/);
  // Phone rules are scoped under .pd42-sheet only.
  const phone = s.slice(s.indexOf('/* F253: phone Speaker Settings head'));
  const next = phone.indexOf('/* 0.4.6 F42:');
  const block = phone.slice(0, next);
  assert.ok(block.includes('.pd42-sheet .spk-head'));
  assert.ok(!/(?:^|\n)(?!\.pd42-sheet)\.spk-head\{[^}]*flex-wrap:wrap/.test(block));
});

test('F253 head still hosts Rename / Previewing / Cancel / Done (DIG session UI)', () => {
  const s = js();
  assert.match(s, /class: 'spk-head'/);
  assert.match(s, /class: 'small dim spk-preview'/);
  assert.match(s, /data-act': 'spk-cancel'/);
  assert.match(s, /data-act': 'spk-done'/);
  assert.match(s, /data-act': 'spk-rename'/);
});

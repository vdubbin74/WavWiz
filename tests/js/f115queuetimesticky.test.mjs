// WavWiz 0.5.0 F115 - queue Time header stays sticky (no position:relative on th.dur).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
test('th.dur never gets position:relative', () => {
  for (const r of rules) if (/th\.dur/.test(r.sel)) assert.ok(!/position\s*:\s*relative/.test(r.body), r.sel);
});
test('.qtable th is sticky with panel2 bg + z-index', () => {
  const r = rules.find(r => r.sel === '.qtable th' && /sticky/.test(r.body));
  assert.ok(r && /background:var\(--panel2\)/.test(r.body) && /z-index/.test(r.body));
});
test('td.dur and td.lastc keep position:relative', () => {
  assert.ok(rules.some(r => r.sel === '.qtable td.dur' && /position:relative/.test(r.body)));
  assert.ok(rules.some(r => r.sel === '.qtable td.lastc' && /position:relative/.test(r.body)));
});

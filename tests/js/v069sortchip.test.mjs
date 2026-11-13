// WavWiz 0.6.9 item 7: the Z–A sort chip ("reversed") keeps readable accent lettering. The generic `.lib .chipbtn.on{color:var(--accent-ink)}`
// rule (dark ink meant for a solid accent fill) came after `.libtools .libflip.on` and won, so the text was dark on the dark panel2 face.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
test('0.6.9 #7: a later, more specific .libflip.on rule restores accent text on the panel2 face', () => {
  const ink = css.indexOf('.lib .chipbtn.on{color:var(--accent-ink)}');
  const fix = css.indexOf('.lib .libtools .chipbtn.libflip.on');
  assert.ok(ink > 0 && fix > ink, 'fix comes after the accent-ink rule');
  const rule = css.slice(fix, css.indexOf('}', fix));
  assert.match(rule, /color:var\(--accent-text,var\(--accent\)\)/);
  assert.match(rule, /background:var\(--panel2\)/);
  // nothing after the fix turns the flip chip back to accent-ink
  assert.doesNotMatch(css.slice(fix + rule.length), /libflip[^{]*\{[^}]*accent-ink/);
});

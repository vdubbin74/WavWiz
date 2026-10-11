// WavWiz 0.2.4 fix (found in the 0.2.4 main-feature pass): on phones (<= 900 px) Now Playing showed no song title or artist. 0.1.3 hid the control
// panel's titles as duplicates of the meta row; 0.2.0 then hid the meta row on phones, so neither showed. The control panel titles must stay visible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');

/** The bodies of every @media (max-width:900px) block (brace-matched). */
function phoneBlocks(src) {
  const out = []; const re = /@media \(max-width:900px\)\s*\{/g; let m;
  while ((m = re.exec(src))) { let i = re.lastIndex, depth = 1; while (depth && i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; } out.push(src.slice(re.lastIndex, i - 1)); }
  return out;
}

test('0.2.4 fix: phones hide the meta row, so the control panel title + artist are NOT hidden on phones', () => {
  const blocks = phoneBlocks(css); assert.ok(blocks.length >= 2, 'phone media blocks found');
  assert.ok(blocks.some(b => /\.nowcol\.np12 > \.np-row\{display:none!important\}/.test(b)), 'the meta row is hidden on phones');
  for (const b of blocks) {
    for (const rule of b.split('}')) {
      const [sel, decl = ''] = rule.split('{');
      if (/display\s*:\s*none/.test(decl)) assert.doesNotMatch(sel, /\.np-tablemeta \.t[12]|\.np-tabletitles|\.pn-titlerow/, `phone rule hides the Now Playing title: ${rule.trim()}`);
    }
  }
});

test('0.2.4 fix: the control panel title row still exists and is styled', () => {
  assert.match(css, /\.np-tablemeta \.t1\{font-size:17px;font-weight:700/);
  assert.match(css, /\.pn-titlerow\{display:flex/);
});

test('0.2.4 fix: What\'s new and CHANGELOG mention the phone title fix in words', () => {
  const a = readFileSync(`${process.env.JS_DIR}/about.js`, 'utf8');
  assert.ok(a.includes("['Song title on phones',"));
  const cl = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
  const sec = cl.slice(cl.indexOf('## [0.2.4]'), cl.indexOf('## [0.2.3]'));
  assert.ok(sec.includes('Song title and artist on phones'));
});

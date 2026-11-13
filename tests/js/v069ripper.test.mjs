// 0.6.9 ripper (t1858/t1859): "The ripper list is now cutting off the information" / "the recent jobs list is cutting into the main portion".
// Cause: the disc + tracks grid had flex:1 0 0% with a 320px floor and overflow:hidden inside a page capped to the pane, so the Ripping card and
// the Recent job cards (flex:none) took the height and the grid was clipped (Year / Format / MP3 quality and tracks 6+ cut off); each track title
// was a generic 40px bordered input box. Now: the grid keeps its natural height, jobs flow below it, Recent jobs are a compact capped list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const js = process.env.JS_DIR || join(here, '../../src/WavWiz.Server/wwwroot/js');
const rd = f => readFileSync(join(js, '..', f), 'utf8');

test('ripper: the disc + tracks section keeps its natural height; Ripping + Recent jobs sit below it in flow', () => {
  const css = rd('app.css');
  assert.match(css, /\.rip-layout\{[^}]*flex:none;min-height:0;overflow:visible\}/);
  assert.doesNotMatch(css, /\.rip-layout\{[^}]*min-height:320px/, 'no squeezable 320px floor');
  assert.doesNotMatch(css, /\.rip-trackcard\{[^}]*height:100%/);
  assert.match(css, /\.rip-tracks\{[^}]*max-height:clamp\(16rem,calc\(56vh \/ var\(--z,1\)\),40rem\);overflow-x:hidden;overflow-y:auto/, 'a long disc scrolls inside Tracks');   // 0.7.0 merge: 56vh divided by the Display-size zoom like every vh/vw (release008)
  const r = rd('js/rip.js'), page = r.slice(r.indexOf('export function ripPage'), r.indexOf('export function recentJobs'));
  assert.ok(page.indexOf("class: 'rip-jobs'") > page.indexOf("class: 'rip-layout'"), 'jobs after the grid, as a sibling');
});

test('ripper: compact list rows - title has no box unless hovered / focused (beats the .lib input !important box); renaming still works', () => {
  const css = rd('app.css'), r = rd('js/rip.js');
  assert.match(css, /\.rip-page \.rip-tracks \.rip-tr \.rip-tt\{min-height:0;height:auto;[^}]*border:1px solid transparent!important;background:transparent!important/);
  assert.match(css, /\.rip-page \.rip-tracks \.rip-tr \.rip-tt:focus\{border-color:var\(--accent\)!important/);
  assert.match(css, /\.rip-tr:hover\{background:color-mix/);
  assert.match(r, /h\('input', \{ type: 'text', class: 'rip-tt'[^\n]*\n\s*oninput: ev => act\.onTrackTitle/, 'the title is still an editable field');
  assert.doesNotMatch(css.slice(css.indexOf('.rip-jlist{'), css.indexOf('@container rip (max-width:520px)')), /#[0-9a-f]{3,6}\b/i, 'theme colors only');
});

test('ripper: Recent jobs = compact rows (status, folder, format · percent, error line) in a capped scroller', async () => {
  const r = rd('js/rip.js'), css = rd('app.css');
  assert.match(r, /export function recentJobs\(list, act = \{\}\)/);
  assert.match(r, /recentJobs\(\(m\.jobs \|\| \[\]\)\.filter\(j => !job \|\| j\.id !== job\.id\)\.slice\(0, 8\), act\)/);
  assert.match(r, /class: 'rip-jrow ' \+ \(j\.status \|\| ''\)/); assert.match(r, /class: 'mono small rip-jdest ell'/); assert.match(r, /class: 'err small rip-jerr ell'/);
  assert.doesNotMatch(r, /class: 'card rip-job past/, 'no more tall job cards');
  assert.match(css, /\.rip-jlist\{[^}]*max-height:13\.5rem;overflow-y:auto/);
  assert.match(css, /@container rip \(max-width:520px\)\{\.rip-jrow\{grid-template-columns:minmax\(0,1fr\) auto\}/, 'narrow panel: folder on its own line (container query, not a phone rule)');
  assert.match(r, /class: 'small rip-job-line ell'/, 'Ripping card: one compact header line');
});

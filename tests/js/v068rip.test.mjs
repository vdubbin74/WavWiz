import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const W = new URL('../../src/WavWiz.Server/wwwroot/', import.meta.url);
const rd = p => readFileSync(new URL(p, W), 'utf8');
globalThis.Element ??= class {};
globalThis.document ??= undefined;
const dir = process.env.JS_DIR ? 'file://' + process.env.JS_DIR + '/' : new URL('js/', W).href;

test('format payload keeps the chosen format, including MP3 quality', async () => {
  const { formatPayload, jobPercent, RIP_INFO, isLiveJob, isTerminalJob, featuredJob, jobStatusLabel, liveLockTitle } = await import(dir + 'rip.js');
  assert.deepEqual(formatPayload('aac'), { format: 'aac' });
  assert.deepEqual(formatPayload('flac'), { format: 'flac' });
  assert.deepEqual(formatPayload('mp3'), { format: 'mp3', quality: 'v0' });
  assert.deepEqual(formatPayload('mp3', 'v2'), { format: 'mp3', quality: 'v2' });
  assert.deepEqual(formatPayload('mp3', 'cbr320'), { format: 'mp3', quality: 'cbr320' });
  assert.equal(jobPercent({ progress: 0.05 }), 5);
  assert.equal(jobPercent({ progress: 0.42 }), 42);
  // 16-track rip: 25% of track 1 is ~1.3% overall and used to display as 0%.
  const t1 = { status: 'ripping', track: 1, trackTotal: 16, progress: (0.25 * 0.85) / 16, trackProgress: 0.25 };
  assert.equal(jobPercent(t1), 25);
  assert.equal(jobPercent({ status: 'ripping', progress: (0.25 * 0.85) / 16, track: 1, trackTotal: 16 }), 1); // no trackProgress: still overall
  assert.equal(jobPercent({ status: 'done', progress: 1, trackProgress: 0.25 }), 100);
  assert.doesNotMatch(RIP_INFO, /MP3 is not bundled/i);
  const r = rd('js/rip.js');
  assert.match(r, /wavwiz:rip/);
  assert.match(r, /Start rip/);
  assert.match(r, /Cancel/);
  assert.match(r, /d\.disc === 'inserted'/);
  assert.match(r, /d\.disc === 'ejected'/);
  assert.doesNotMatch(r, /MP3 is not bundled/);
  assert.match(rd('js/main.js'), /wavwiz:rip/);
  assert.match(rd('app.css'), /\.rip-disc-main/);
  assert.match(rd('app.css'), /\.rip-prog/);
  assert.match(rd('app.css'), /\.rip-layout/);
  assert.match(rd('app.css'), /\.rip-title/);
  assert.match(rd('app.css'), /\.lib\.extratab \.azstrip/);
  assert.match(rd('js/about.js'), /LAME \(libmp3lame\)/);
  assert.match(r, /onRetry/);
  assert.match(r, /Retry/);
  assert.match(r, /refresh=true/);
  assert.doesNotMatch(r, /refresh=1/);
  assert.match(r, /isLiveJob/);
  assert.match(r, /A rip is in progress on/);
  assert.match(r, /rip-info/);
  assert.match(r, /class: 'rip-title'/);
  assert.equal(isLiveJob({ status: 'ripping' }), true);
  assert.equal(isLiveJob({ status: 'queued' }), true);
  assert.equal(isLiveJob({ status: 'interrupted' }), false);
  assert.equal(isLiveJob({ status: 'cancelled' }), false);
  assert.equal(jobStatusLabel({ status: 'interrupted' }), 'Interrupted');
  assert.equal(liveLockTitle({ status: 'ripping', drive: 'E:' }), 'A rip is in progress on E:');
  assert.equal(isTerminalJob({ status: 'error' }), true);
  assert.equal(isTerminalJob({ status: 'cancelled' }), true);
  assert.equal(isTerminalJob({ status: 'ripping' }), false);
  const stale = { id: 9, status: 'error', format: 'mp3', quality: 'v0', drive: 'E:' };
  const live = { id: 10, status: 'ripping', format: 'flac', drive: 'E:' };
  // Opening the page onto a ready disc must not feature an old failed job.
  assert.equal(featuredJob([stale], {}), null);
  assert.equal(featuredJob([stale], { followId: null }), null);
  assert.equal(featuredJob([stale], { followId: 9 }).id, 9);
  assert.equal(featuredJob([stale], { followId: 9, dismissedIds: new Set([9]) }), null);
  assert.equal(featuredJob([stale], { followId: 9, dismissedIds: new Set(['9']) }), null);
  assert.equal(featuredJob([live, stale], { followId: 9 }).id, 10); // live always wins
  assert.equal(featuredJob([stale], { followId: 8 }), null); // followed a different job
  const css = rd('app.css');
  assert.match(css, /grid-template-columns:auto 2\.25em minmax\(0,1fr\) 4\.75em/);
  assert.match(css, /scrollbar-gutter:stable/);
  assert.match(css, /\.rip-meta-row\{display:grid;grid-template-columns:5\.5em minmax\(0,1fr\)/);
  assert.match(css, /\.rip-meta-row:has\(\.rip-qual\)/);
  assert.match(css, /libextra\[data-extra=rip\]/);
  assert.match(css, /phone-library:has\(\.libextra\[data-extra=rip\]\)/);
  assert.match(css, /\.rip-job-clear/);
  assert.match(r, /featuredJob/);
  assert.match(r, /onDismiss/);
  assert.match(r, /rip-job-clear/);
  assert.match(r, /followJobId/);
  assert.match(r, /class: 'rip-num'/);
  assert.doesNotMatch(css, /\.rip-tracks\{[^}]*max-height:min\(58vh/);
  const lib = rd('js/library.js');
  assert.match(lib, /stripPlan/);
  assert.match(lib, /stale list\(\) cannot leak the rail/);
});

test('Recent jobs stay in their own area and never overlay Drive or Tracks', async () => {
  const css = rd('app.css');
  const r = rd('js/rip.js');
  // Jobs are a sibling of the Drive/Tracks grid, not a child and not absolutely positioned.
  assert.match(r, /class: 'rip-layout'/);
  assert.match(r, /class: 'rip-jobs'/);
  const pageFn = r.slice(r.indexOf('export function ripPage'), r.indexOf('export function ripView'));
  const jobsAt = pageFn.indexOf("class: 'rip-jobs'");
  const layoutAt = pageFn.indexOf("class: 'rip-layout'");
  assert.ok(layoutAt >= 0 && jobsAt > layoutAt, 'rip-jobs must be rendered after rip-layout, as a sibling');
  // Desktop fill-pane: the grid may grow but must not shrink below its content
  // (min-height:0 let Recent jobs collapse the grid so the cards painted over the form).
  // 0.6.9 ripper (t1858/t1859): the grid now keeps its full natural height (flex:none, nothing clipped) and jobs flow below it
  assert.match(css, /\.rip-layout\{[^}]*flex:none;min-height:0;overflow:visible/);
  assert.match(css, /\.rip-trackcard\{[^}]*overflow:hidden/);
  assert.match(css, /\.rip-tracks\{[^}]*flex:1 1 auto;min-height:8rem;max-height:clamp\(/);
  assert.match(css, /\.rip-page\{[^}]*flex:1 1 auto;min-height:100%;max-height:100%/);
  assert.match(css, /\.rip-jobs\{[^}]*flex:none/);
  assert.doesNotMatch(css, /\.rip-jobs\{[^}]*(position:\s*(absolute|fixed)|grid-area:)/);
  assert.doesNotMatch(css, /\.rip-recent\{[^}]*(position:\s*(absolute|fixed)|grid-area:)/);
  assert.doesNotMatch(css, /\.rip-layout\{[^}]*flex:1;min-height:0\}/);
  // Growing page + libcontent overflow:auto is what scrolls when form + jobs exceed the pane.
  assert.match(css, /libextra\[data-extra=rip\]>\.rip-page\{flex:1 1 auto;min-height:100%;max-height:100%/);
  assert.match(css, /container-name:rip/);
  assert.match(css, /@container rip \(max-width:700px\)/);
  // Narrow window still stacks; jobs stay in flow (not a pinned overlay).
  assert.match(css, /@media \(max-width:900px\)\{[^}]*\.rip-layout\{grid-template-columns:1fr;flex:none/);
});

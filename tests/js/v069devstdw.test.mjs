// 0.6.9 #23 (t1867/t1870/t1871): Auto layout (resolving to the slide-over) - picking a speaker made the zones / speakers column take the whole window and
// the speaker settings column 0 px. Cause: the slide-over never caches the docked Speakers width, so setSize's "measure if missing" ran AFTER
// applyPanels had added .devexpanded and pinned the EXPANDED body (~1858 px at 1920) as --devstdw. Switching Auto -> Full -> Auto hid it (Full cached a
// good width first). cacheStd now refuses to measure once the desk / panel is expanded; the expanded grid then uses its clamp (or the last good width).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const src = n => readFileSync(join(js, n), 'utf8');
const css = readFileSync(join(js, '../app.css'), 'utf8');

/** The real cacheStd source, run against fake desk / panel / body nodes. */
function makeCache() {
  const d = src('devices.js');
  const code = d.slice(d.indexOf('const cacheStd = () =>'), d.indexOf('const setSize ='));
  assert.ok(code.length > 50 && code.length < 3000, 'cacheStd found');
  const cls = (...c) => { const s = new Set(c); return { contains: x => s.has(x), add: x => s.add(x), remove: x => s.delete(x) }; };
  const env = { size: 'standard', w: 380 };
  const desk = { classList: cls() };
  const props = {};
  const root = { classList: cls(), closest: () => desk, style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: k => { delete props[k]; } } };
  const body = { isConnected: true, get offsetWidth() { return env.w; } };
  const f = new Function('env', 'root', 'body', 'HASWIN', 'window', `let size; const run = () => { size = env.size; return cacheStd(); }; ${code}; return run;`);
  return { run: f(env, root, body, true, { innerWidth: 1920 }), env, desk, root, props };
}

test('Auto slide-over -> pick a speaker: the expanded body is never pinned as the Speakers width', () => {
  const c = makeCache();
  // 1) applyPanels just dropped .tight; the panel is still the 30 px tab strip -> too small, ignored
  c.env.w = 28; c.run(); assert.equal(c.props['--devstdw'], undefined);
  // 2) .devexpanded is on, size is still 'standard' (setSize's sync measure) and the body is the whole window -> must NOT be taken
  c.desk.classList.add('devexpanded'); c.env.w = 1858; c.run();
  assert.equal(c.props['--devstdw'], undefined, 'no 1858px Speakers track');
  c.desk.classList.add('devfull'); c.run(); assert.equal(c.props['--devstdw'], undefined);
  c.desk.classList.remove('devexpanded'); c.desk.classList.remove('devfull'); c.root.classList.add('expanded'); c.run();
  assert.equal(c.props['--devstdw'], undefined, 'an expanded panel is never measured either');
});

test('Full / Default: the docked panel is still measured (380 px) and that width survives the expand', () => {
  const c = makeCache();
  c.env.w = 380; c.run(); assert.equal(c.props['--devstdw'], '380px');
  c.desk.classList.add('devexpanded'); c.env.w = 1858; c.run();
  assert.equal(c.props['--devstdw'], '380px', 'the speaker settings column keeps its room');
});

test('Roomy, the Auto slide-over (.tight) and a glide never measure', () => {
  for (const k of ['roomy', 'tight', 'devhold']) { const c = makeCache(); c.desk.classList.add(k); c.env.w = 400; c.run(); assert.equal(c.props['--devstdw'], undefined, k); }
});

test('expanded Devices grid: the Speakers track is --devstdw with a clamp fallback, the settings column is minmax(0,1fr)', () => {
  assert.match(css, /\.desk\.devfull \.devpanel\.expanded \.dexp-main\.e42,\.desk\.roomy\.devfull \.devpanel\.expanded \.dexp-main\.e42\{grid-template-columns:clamp\(250px,calc\(22vw \/ var\(--z,1\)\),380px\) minmax\(0,1fr\) var\(--devstdw,clamp\(250px,calc\(22vw \/ var\(--z,1\)\),380px\)\)!important\}/);
  const d = src('devices.js');
  assert.match(d, /if \(size === 'standard' && s === 'expanded' && \(!root\._stdw \|\| root\._stdw < 240\)\) cacheStd\(\);/, 'the sync measure still goes through the guarded cacheStd');
});

// WavWiz 0.7.2 (t2143u): Zone edge light - Heartbeat, Heartthrob and Gradient replace Clean comet, Pulse and Dual streak; saved old choices migrate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const css = readFileSync(join(dir, '../app.css'), 'utf8');
const mem = init => { const m = new Map(Object.entries(init || {})); return { m, getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const E = () => import(pathToFileURL(join(dir, 'edgelight.js')).href);

test('0.7.2 edge light: the six styles; the old three are gone from the picker', async () => {
  const e = await E();
  assert.deepEqual(e.EDGE_STYLES.map(([id]) => id), ['wave', 'pipe', 'heartbeat', 'heartthrob', 'gradient', 'off']);
  for (const old of ['comet', 'pulse', 'dual']) assert.ok(!e.EDGE_STYLES.some(([id]) => id === old), old);
  assert.equal(e.DEFAULT_EDGE, 'wave');
});

test('0.7.2 edge light: saved comet / pulse / dual become heartbeat / heartthrob / gradient and are saved that way', async () => {
  const e = await E();
  assert.deepEqual(e.EDGE_MIGRATE, { comet: 'heartbeat', pulse: 'heartthrob', dual: 'gradient' });
  for (const [old, now] of Object.entries(e.EDGE_MIGRATE)) {
    const st = mem({ [e.EDGE_KEY]: old });
    assert.equal(e.loadEdge(st), now); assert.equal(st.m.get(e.EDGE_KEY), now, 'migrated value written back');
    assert.equal(e.normEdge(old), now); assert.equal(e.applyEdge(old, mem()), now);
  }
  const keep = mem({ [e.EDGE_KEY]: 'pipe' }); assert.equal(e.loadEdge(keep), 'pipe'); assert.equal(keep.m.get(e.EDGE_KEY), 'pipe');
  assert.equal(e.loadEdge(mem()), 'wave'); assert.equal(e.loadEdge(mem({ [e.EDGE_KEY]: 'bogus' })), 'wave');
  assert.equal(e.loadEdge({ getItem() { throw new Error('blocked'); } }), 'wave');
});

test('0.7.2 edge light CSS: one rule per new style, composited keyframes, still under reduced motion, swatches; old rules removed', () => {
  for (const id of ['heartbeat', 'heartthrob', 'gradient']) {
    assert.match(css, new RegExp(`html\\[data-edgelight="${id}"\\] \\.tree42 \\.qb42\\.playing > \\.cgrip69::after \\{`), id);
    assert.match(css, new RegExp(`\\.edsw\\.${id}\\{`), id + ' swatch');
  }
  for (const old of ['comet', 'pulse', 'dual']) { assert.doesNotMatch(css, new RegExp(`data-edgelight="${old}"`), old); assert.doesNotMatch(css, new RegExp(`\\.edsw\\.${old}\\{`), old + ' swatch'); }
  assert.doesNotMatch(css, /@keyframes ww-lp-(dual|shim|beat)\b/);
  for (const k of ['lubdub', 'throb', 'flow']) {
    const m = css.match(new RegExp(`@keyframes ww-lp-${k} \\{([^\\n]*)\\}`)); assert.ok(m, k);
    assert.doesNotMatch(m[1], /\b(top|height|left|box-shadow|filter|background)\s*:/, k + ': transform / opacity only');
  }
  assert.match(css, /animation: ww-lp-lubdub var\(--el-beat, \.83s\)/, 'Heartbeat 72 bpm');
  assert.match(css, /animation: ww-lp-throb 3\.2s ease-in-out infinite/);
  assert.match(css, /animation: ww-lp-flow 4\.5s linear infinite/);
  const i = css.indexOf('@media (prefers-reduced-motion: reduce) {\n  html .tree42 .qb42.playing > .cgrip69'); const b = css.slice(i, css.indexOf('\n}\n', i));
  assert.match(b, /html\[data-edgelight="heartbeat"\][^{]*::after, html\[data-edgelight="heartthrob"\][^{]*::after \{ opacity: \.35 !important; \}/);
  assert.match(b, /html\[data-edgelight="gradient"\][^{]*::after \{ opacity: 1 !important; \}/);
});

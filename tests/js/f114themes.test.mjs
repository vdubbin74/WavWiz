// WavWiz 0.5.0 F114 - theme pass: Blue Steel + Lime Circuit gone, Crimson Lounge + Ocean Abyss added, Daylight contrast rework.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const css = () => readFileSync(`${js}/../app.css`, 'utf8'), src = n => readFileSync(`${js}/${n}.js`, 'utf8');
const theme = await import(`${js}/theme.js`);
const ratio = (a, b) => { const x = theme.luminance(a), y = theme.luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const memStore = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('F114: ten presets, exact table, HOT', () => {
  assert.deepEqual(Object.keys(theme.PRESETS), ['default', 'pepecoin', 'ember', 'arctic', 'violet', 'mono', 'daylight', 'nebula', 'crimson', 'ocean']);
  assert.deepEqual(theme.PRESETS.daylight, { name: 'Daylight', accent: '#D63A12', accent2: '#0B7A6E', hl: '#5B3FD4', bg: '#EDE9E3', ink: '#14171C' });
  assert.deepEqual(theme.PRESETS.crimson, { name: 'Crimson Lounge', accent: '#E84A5F', accent2: '#D4A574', hl: '#F5E6C8', bg: '#1A0C10', ink: '#F8EDE8' });
  assert.deepEqual(theme.PRESETS.ocean, { name: 'Ocean Abyss', accent: '#2EC4B6', accent2: '#3D8BFF', hl: '#FF8A5B', bg: '#07151F', ink: '#E6F1F8' });
  assert.ok(!theme.PRESETS.steel && !theme.PRESETS.lime && !theme.HOT.steel && !theme.HOT.lime);
  assert.equal(theme.HOT.crimson, '#C62F22'); assert.equal(theme.HOT.ocean, '#E5533D'); assert.equal(theme.HOT.daylight, '#C62F22');
  for (const id of ['crimson', 'ocean']) assert.ok(ratio(theme.PRESETS[id].hl, theme.PRESETS[id].bg) >= 3, `${id} highlight`);
});

test('F114: saved steel / lime load Midnight Neon', () => {
  const st = memStore(); globalThis.localStorage = st;
  try { for (const p of ['steel', 'lime']) { st.setItem('wavwiz.theme.v1', JSON.stringify({ v: 4, accent: '#8DB6E0', bg: '#18202A', preset: p })); assert.equal(theme.loadTheme().preset, 'default', p); } }
  finally { delete globalThis.localStorage; }
});

test('F114: Daylight ink/dim/accent-text >= 4.5:1 on bg/panel/panel2', () => {
  const v = theme.derive(theme.PRESETS.daylight);
  for (const fg of ['--ink', '--dim', '--accent-text']) for (const bg of ['--bg', '--panel', '--panel2']) {
    const r = ratio(v[fg], v[bg]); assert.ok(r >= 4.5, `${fg} on ${bg} = ${r.toFixed(2)}`);
  }
});

test('F114: data-scheme marker + light-scheme CSS', () => {
  assert.match(src('theme'), /document\.documentElement\.dataset\.scheme = scheme/);
  const c = css();
  assert.match(c, /:root\[data-scheme=light\]\{color-scheme:light\}/);
  assert.match(c, /:root\[data-scheme=light\] \.devbody \.drow,:root\[data-scheme=light\] \.qtable td/);
});

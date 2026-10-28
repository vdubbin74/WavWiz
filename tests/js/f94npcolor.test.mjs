// 0.5.0 F94: Now Playing Color intensity (subtle | spicy | max, default spicy), theme accent only.
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path';
const J = process.env.JS_DIR; const m = await import(path.join(J, 'npstyle.js'));
const css = fs.readFileSync(path.join(J, '..', 'app.css'), 'utf8');
test('color defaults to spicy and clamps unknown', () => {
  assert.equal(m.NP_DEFAULT.color, 'spicy'); assert.equal(m.normNpPrefs(null).color, 'spicy');
  assert.equal(m.normNpPrefs({ style: 'center' }).color, 'spicy'); assert.equal(m.normNpPrefs({ color: 'hot' }).color, 'spicy');
  for (const c of ['subtle', 'spicy', 'max']) assert.equal(m.normNpPrefs({ color: c }).color, c);
  assert.deepEqual(m.NP_COLORS.map(x => x[1]), ['Subtle', 'Spicy', 'Max']);
});
test('save/load round-trips color', () => {
  const st = new Map(), store = { getItem: k => st.get(k) ?? null, setItem: (k, v) => st.set(k, v) };
  m.saveNpPrefs({ color: 'max' }, store); assert.equal(m.loadNpPrefs(store).color, 'max');
});
test('applyNpColor sets data-npcolor', () => { const r = { dataset: {} }; m.applyNpColor({ color: 'subtle' }, r); assert.equal(r.dataset.npcolor, 'subtle'); m.applyNpColor({}, r); assert.equal(r.dataset.npcolor, 'spicy'); });
test('stage + play glow use theme vars, no navy/orange hardcode', () => {
  const stage = css.match(/^\.stage\{[^}]*\}/m)[0], play = css.match(/^\.tbtn\.play\{box-shadow[^}]*\}/m)[0];
  assert.ok(!/#0d1526|#050811/i.test(stage) && stage.includes('var(--np-stage)'));
  assert.ok(!/rgba\(255,\s*60,\s*0/.test(play) && play.includes('--np-play-glow'));
  assert.ok(/:root\[data-npcolor="subtle"\]/.test(css) && /:root\[data-npcolor="max"\]/.test(css));
  assert.ok(!/#0d1526|#050811/i.test(fs.readFileSync(path.join(J, 'wzviz.js'), 'utf8')));
});
test('Appearance has the Color intensity bar and Reset effects keeps color', () => {
  const a = fs.readFileSync(path.join(J, 'appearance.js'), 'utf8');
  assert.ok(a.includes("'Color intensity'") && a.includes('How hard Now Playing leans into the active theme'));
  assert.ok(a.includes('saveNpPrefs({ seek: q.seek, buttons: q.buttons, art: q.art, color: q.color })'));
});

// ---- 0.5.0 F95: mixable Now Playing (Track bar x Buttons x Color intensity) ----
test('F95: old package style migrates to seek + buttons; unknown ids clamp; style is not written back', async () => {
  const m = await import(path.join(J, 'npstyle.js'));
  const mig = { classic: ['line', 'round'], center: ['wave', 'soft'], stack: ['led', 'square'], horizon: ['line', 'ring'], undefined: ['line', 'round'] };
  for (const [s, [seek, buttons]] of Object.entries(mig)) { const n = m.normNpPrefs(s === 'undefined' ? {} : { style: s }); assert.equal(n.seek, seek, s); assert.equal(n.buttons, buttons, s); assert.equal(n.color, 'spicy'); assert.ok(!('style' in n)); }
  assert.deepEqual([m.normNpPrefs({ seek: 'eq', buttons: 'ring', color: 'max' })].map(n => [n.seek, n.buttons, n.color])[0], ['eq', 'ring', 'max']);
  assert.equal(m.normNpPrefs({ seek: 'disc', buttons: 'blob' }).seek, 'line'); assert.equal(m.normNpPrefs({ seek: 'disc', buttons: 'blob' }).buttons, 'round');
  assert.equal(m.normNpPrefs({ style: 'center', seek: 'eq' }).seek, 'eq');   // an explicit pick beats the legacy package
  assert.deepEqual(m.npClasses({ seek: 'eq', buttons: 'ring' }), ['pn-seek-eq', 'pn-btn-ring', 'pn-art-square']);
  const b = m.eqBars('song', 20); assert.equal(b.length, 20); assert.ok(b.every(v => v >= 0.25 && v <= 1)); assert.deepEqual(b, m.eqBars('song', 20));
});
test('F95: no package classes remain; EQ seek is its own slider; Appearance has Track bar + Buttons pickers', () => {
  const css = fs.readFileSync(path.join(J, '..', 'app.css'), 'utf8'), n = fs.readFileSync(path.join(J, 'now.js'), 'utf8'), a = fs.readFileSync(path.join(J, 'appearance.js'), 'utf8');
  assert.doesNotMatch(css, /\.pn-(classic|center|stack|horizon)\b/);
  assert.match(css, /\.pn-eqbars\{[^}]*align-items:flex-end/); assert.match(css, /\.pn-seek-eq \.pn-eq\{display:block/);
  assert.match(n, /class: 'pn-eq', role: 'slider'/); assert.match(n, /applyNpClasses\(ctlPanel, p\)/);
  assert.ok(a.includes("'Track bar'") && a.includes("'Buttons'") && !a.includes('NP_STYLES'));
});

// ---- 0.5.0 F96: Album art axis (square | disc | sleeve) ----
test('F96: art defaults to square, clamps, never forced from legacy style; classes + data-art', async () => {
  const m = await import(path.join(J, 'npstyle.js'));
  assert.deepEqual(m.NP_ARTS.map(a => a[0]), ['square', 'disc', 'sleeve', 'cassette']); assert.equal(m.NP_DEFAULT.art, 'square');
  assert.equal(m.normNpPrefs(null).art, 'square'); assert.equal(m.normNpPrefs({ art: 'blob' }).art, 'square');
  for (const s of ['classic', 'center', 'stack', 'horizon']) assert.equal(m.normNpPrefs({ style: s }).art, 'square', s);
  for (const a of ['square', 'disc', 'sleeve']) assert.equal(m.normNpPrefs({ art: a }).art, a);
  assert.deepEqual(m.npClasses({ seek: 'eq', buttons: 'ring', art: 'sleeve' }), ['pn-seek-eq', 'pn-btn-ring', 'pn-art-sleeve']);
  const cl = new Set(['pn-art-disc', 'pn-center', 'x']), el = { classList: { [Symbol.iterator]: () => cl.values(), remove: c => cl.delete(c), add: (...c) => c.forEach(x => cl.add(x)) }, dataset: {} };
  m.applyNpClasses(el, { art: 'sleeve' }); assert.ok(cl.has('pn-art-sleeve') && !cl.has('pn-art-disc') && !cl.has('pn-center') && cl.has('x')); assert.equal(el.dataset.art, 'sleeve');
});
test('F96: CSS per art mode, phone keeps art, Appearance Album art row between Buttons and Color', () => {
  const css = fs.readFileSync(path.join(J, '..', 'app.css'), 'utf8'), a = fs.readFileSync(path.join(J, 'appearance.js'), 'utf8'), n = fs.readFileSync(path.join(J, 'now.js'), 'utf8');
  assert.match(css, /\.pn-art-square \.pn-ring\{display:block/); assert.match(css, /\.pn-art-disc\.playing \.pn-cover\{animation:pnspin calc\(6s \/ \(0\.2 \+ var\(--fx-motion/);
  assert.match(css, /\.pn-art-sleeve \.pn-disc\{display:block[^}]*--np-frac/s); assert.match(css, /prefers-reduced-motion:reduce\)\{ \.pn-art-disc\.playing \.pn-cover\{animation:none/);
  assert.doesNotMatch(css, /:is\(\.pn-ring,\.pn-ringdot,\.pn-disc,\.pn-clock,\.pn-lcdrow\)\{display:none!important/);
  assert.match(n, /setProperty\('--np-frac'/);
  const iB = a.indexOf("'Buttons'), pick("), iA = a.indexOf("'Album art'), pick("), iC = a.indexOf("'Color intensity'),");
  assert.ok(iB > 0 && iA > iB && iC > iA, 'order'); assert.ok(a.includes('album art and color intensity'));
  const s = fs.readFileSync(path.join(J, 'npstyle.js'), 'utf8');
  for (const t of ['Outline follows track time.', 'Spins while playing.', 'Vinyl slides out with progress.']) assert.ok(s.includes(t), t);
});

// ---- 0.5.0 F97: Album art Cassette ----
test('F97: cassette art id, tip, classes; unknown still square', async () => {
  const m = await import(path.join(J, 'npstyle.js'));
  assert.equal(m.NP_ARTS.length, 4); assert.deepEqual(m.NP_ARTS[3], ['cassette', 'Tape', 'Matte tape · wheels spin, tape winds across.']);
  assert.equal(m.normNpPrefs({ art: 'cassette' }).art, 'cassette'); assert.equal(m.normNpPrefs({ art: 'tape' }).art, 'square'); assert.equal(m.NP_DEFAULT.art, 'square');
  assert.deepEqual(m.npClasses({ seek: 'eq', buttons: 'ring', art: 'cassette' }), ['pn-seek-eq', 'pn-btn-ring', 'pn-art-cassette']);
  const cl = new Set(['pn-art-disc']), el = { classList: { [Symbol.iterator]: () => cl.values(), remove: c => cl.delete(c), add: (...c) => c.forEach(x => cl.add(x)) }, dataset: {} };
  m.applyNpClasses(el, { art: 'cassette' }); assert.ok(cl.has('pn-art-cassette') && !cl.has('pn-art-disc')); assert.equal(el.dataset.art, 'cassette');
});
test('F97: cassette markup, hubs spin only while playing, tape tracks --np-frac, 4 art cards, phone keeps it', () => {
  const css = fs.readFileSync(path.join(J, '..', 'app.css'), 'utf8'), n = fs.readFileSync(path.join(J, 'now.js'), 'utf8'), g = fs.readFileSync(path.join(J, 'pgrid.js'), 'utf8'), mi = fs.readFileSync(path.join(J, 'npmini.js'), 'utf8');
  assert.match(n, /class: 'pn-cass'/); assert.match(n, /pnDisc, pnCass, pnCover/); assert.match(mi, /id === 'cassette'/);
  assert.match(css, /\.pn-art-cassette\.playing \.pc-hub\{animation:pnspin calc\(3s \/ \(0\.2 \+ var\(--fx-motion/);
  assert.match(css, /\.pc-l \.pc-tape\{width:calc\([^}]*1 - var\(--np-frac/); assert.match(css, /\.pc-r \.pc-tape\{width:calc\([^}]*var\(--np-frac/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{ \.pn-art-cassette\.playing \.pc-hub\{animation:none/);
  assert.match(css, /\.pgrid-npart\{grid-template-columns:repeat\(4,/); assert.match(g, /npart: 4/);
  assert.match(css, /\.nowcol \.np-ctlpanel\.pn-art-cassette \.pn-art\{aspect-ratio:1\.52/);
});

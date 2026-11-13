// WavWiz 0.7.0 item 4 - Parallel Flow logo: one swap point (logo.js LOGO), approved geometry unchanged, TOP wave = Wav color,
// BOTTOM wave = Wiz color (the wordmark's own theme variables), current wordmark font kept, static icons regenerated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const src = n => readFileSync(`${js}/${n}.js`, 'utf8'), css = () => readFileSync(`${js}/../app.css`, 'utf8');
const L = await import(`${js}/logo.js`);

test('0.7.0 logo: approved Parallel Flow geometry (same path twice, same transforms and viewBox as the pack)', () => {
  assert.equal(L.VIEWBOX, '-10 -17.5 120 120');
  assert.equal(L.TOP_TRANSFORM, 'translate(0,-7) scale(1,.65)');
  assert.equal(L.BOTTOM_TRANSFORM, 'translate(0,28) scale(1,.65)');
  assert.match(L.WAVE_PATH, /^M49\.52,19\.37 C48\.41,19\.53 /); assert.match(L.WAVE_PATH, / Z$/);
  const s = L.emblemSvg(); assert.equal(s.split(L.WAVE_PATH).length, 3, 'the one path, used twice');
});

test('0.7.0 logo: top = Wav color, bottom = Wiz color, the same variables as the wordmark spans', () => {
  assert.deepEqual({ top: L.LOGO.top, bottom: L.LOGO.bottom }, { top: 'wav', bottom: 'wiz' });
  const s = L.emblemSvg();
  assert.match(s, /class="pf-top" data-role="wav" transform="translate\(0,-7\) scale\(1,\.65\)"><path style="fill:var\(--accent-text,var\(--accent\)\)"/);
  assert.match(s, /class="pf-bot" data-role="wiz" transform="translate\(0,28\) scale\(1,\.65\)"><path style="fill:var\(--accent2-text,var\(--accent2\)\)"/);
  assert.match(css(), /\.wordmark \.wm-wav\{color:var\(--accent-text,var\(--accent\)\)\}/);
  assert.match(css(), /\.wordmark \.wm-wiz\{color:var\(--accent2-text,var\(--accent2\)\)\}/);
  // static export colors (Midnight Neon raw): top orange, bottom teal
  const st = L.emblemSvg({ colors: { top: '#FF3C00', bottom: '#12D6C2' } });
  assert.ok(st.indexOf('#FF3C00') < st.indexOf('#12D6C2'));
  assert.match(L.emblemSvg(), /aria-hidden="true"/); assert.match(L.emblemSvg({ title: 'WavWiz' }), /role="img" aria-label="WavWiz"/);
});

test('0.7.0 logo: header and About use the inline emblem; the wordmark keeps the current app font', () => {
  assert.match(src('brand'), /if \(LOGO\.header && opts\.emblem !== false\) wrap\.append\(emblem\('pf-emblem brand-emblem'\)\)/);
  assert.match(src('about'), /LOGO\.about \? emblem\('pf-emblem about-emblem'\)/);
  assert.match(css(), /\.wordmark\{display:inline-flex;align-items:baseline;gap:0;flex:none;font:800 26px\/1\.05 system-ui/);
  assert.doesNotMatch(src('logo'), /font-family|Inter/);   // no new typeface
  assert.match(css(), /\.logo \.brand-emblem\{height:30px/);
});

test('0.7.0 logo: static icons use the app\'s exact Midnight Neon wordmark colors, read from the theme (t1694u), not hard-coded', async () => {
  const g = readFileSync(new URL('../../build/logo/make-icons.mjs', import.meta.url), 'utf8');
  assert.match(g, /export const COLORS = \{ top: vars\['--accent-text'\], bottom: vars\['--accent2-text'\] \}/);
  assert.match(g, /theme\.derive\(\{ \.\.\.theme\.PRESETS\[THEME_ID\], preset: THEME_ID \}\)/);
  assert.match(g, /export const BG = vars\['--bg'\]/);
  assert.doesNotMatch(g.replace(/^\/\/.*$/gm, ''), /#[0-9A-Fa-f]{6}\b/, 'no hex literal in the generator code');
  assert.match(g, /emblemSvg\(\{ cls: 'e', colors: COLORS \}\)/);
  assert.match(g, /'wavwiz\.ico'/); assert.match(g, /favicon\.ico/); assert.match(g, /logo-maskable-/); assert.match(g, /apple-touch-icon\.png/);
  // the generated master matches what the app paints for Wav / Wiz in Midnight Neon (#F9663A over #12D6C2 today)
  const T = await import(`${js}/theme.js`), v = T.derive({ ...T.PRESETS.default, preset: 'default' });
  const svg = readFileSync(new URL('../../assets/logo/wavwiz-parallel-flow.svg', import.meta.url), 'utf8');
  const fills = [...svg.matchAll(/fill:(#[0-9A-Fa-f]{6})/g)].map(m => m[1].toUpperCase());
  assert.deepEqual(fills, [v['--accent-text'].toUpperCase(), v['--accent2-text'].toUpperCase()]);
  assert.equal(fills[0], '#F9663A');
});

test('0.7.0 logo: Setup wizard BMPs are generated from the same theme colors and Parallel Flow emblem (t1933)', () => {
  const g = readFileSync(new URL('../../build/logo/make-icons.mjs', import.meta.url), 'utf8');
  assert.match(g, /wizard-large-/);
  assert.match(g, /wizard-small-/);
  assert.match(g, /\[164, 314\]/);
  assert.match(g, /\[246, 471\]/);
  assert.match(g, /\[328, 628\]/);
  assert.match(g, /\[55, 83, 110\]/);
  assert.match(g, /function encodeBmp24/);
  assert.match(g, /COLORS\.top/);
  assert.match(g, /COLORS\.bottom/);
  assert.match(g, /background:\$\{BG\}/);
  assert.match(g, /<span style="color:\$\{COLORS\.top\}">Wav<\/span><span style="color:\$\{COLORS\.bottom\}">Wiz<\/span>/);
});

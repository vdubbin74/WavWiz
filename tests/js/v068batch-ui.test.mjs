// 0.6.8 UI batch: mini player dock, panel pins, menu grid, A–Z rail, themed icons, USA countries, phone Up next.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitAzLetters, LETTERS, visibleCssHeight } from '../../src/WavWiz.Server/wwwroot/js/libsort.js';

const here = dirname(fileURLToPath(import.meta.url));
const www = process.env.WW_WWW || join(here, '../../src/WavWiz.Server/wwwroot');
const rd = (rel, enc = 'utf8') => readFileSync(join(www, rel), enc);
const js = rel => rd('js/' + rel);
const css = () => rd('app.css');
const miniCss = () => rd('mini.css');

function loadExport(src, name) {
  const m = src.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `export function ${name} not found`);
  return new Function('return ' + m[0].replace(/^export /, ''))();
}

test('mini player: volume dock left of right-aligned transport; horizontal pin strip uses overflow menu', () => {
  const mini = js('mini.js');
  const sc = js('shortcuts.js');
  const mc = miniCss();
  assert.match(mini, /shortcutsSide\(\{[^}]*horizontal: true/);
  assert.match(mini, /const dock = h\('div', \{ class: 'mp-dock' \}, volRow, ctl\)/);
  assert.match(sc, /horizontal = false/);
  assert.match(sc, /vertical: !horizontal/);
  assert.match(sc, /import \{ openCtx \} from '\.\/ctxmenu\.js'/);
  assert.match(sc, /openCtx\(/);
  assert.match(mc, /\.mp-dock/);
  assert.match(mc, /\.mp-dock \.mp-vol/);
  assert.match(mc, /flex:1 1 auto/);
  assert.match(mc, /\.mp-dock \.mp-ctl/);
  assert.doesNotMatch(mc, /mp-sthd[^}]*width:calc\(100% \+ 13px\)/);
  assert.match(mc, /\.mp\.mp-sttitle > \.mp-sthd\{[^}]*width:100%/);
  assert.match(mc, /\.mp\.mp-sttitle \.mp-scside\{[^}]*overflow-x:hidden/);
  // standalone 420px window must not inherit the phone 44px close
  assert.doesNotMatch(mc, /@media \(max-width:900px\),\(pointer:coarse\)\{[\s\S]*?\.mp:not\(\.embedded\) \.mp-side \.mp-x[\s\S]*?min-width:44px/);
  assert.match(mc, /body:not\(\.minibody\) \.mp \.mp-x/);
  assert.match(mc, /:is\(body\.minibody,\.minicol\) \.mp:not\(\.slim\) \.mp-txt\{[^}]*padding-right:0/);
});

test('shortcutsSide stays vertical by default (embedded / NP strip cap unchanged)', () => {
  const sc = js('shortcuts.js');
  assert.match(sc, /export function shortcutsSide\(\{ run, home, cls = '', onChange, horizontal = false \} = \{\}\)/);
  assert.match(sc, /vertical: !horizontal/);
});

test('panel header pins insert on the right, grouped with expand / collapse', () => {
  const main = js('main.js');
  const s = css();
  assert.match(main, /querySelector\(':scope > \.libexp'\)/);
  assert.match(main, /insertBefore\(b, exp\)/);
  assert.match(main, /querySelector\(':scope > \.devcol'\)/);
  assert.match(main, /insertBefore\(b, col\)/);
  assert.match(main, /listcolwrap/);
  assert.match(main, /insertBefore\(b, wrap\)/);
  assert.match(s, /\.libpanel:not\(\.israil\) \.pane-h \.tpin\{order:2\}/);
  assert.match(s, /\.libpanel:not\(\.israil\) \.pane-h \.libexp\{order:3/);
  assert.match(s, /\.devpanel:not\(\.israil\) \.devhead \.tpin\{order:3\}/);
  assert.match(s, /\.devpanel:not\(\.israil\) \.devhead \.devexp\{order:4/);
});

test('menu rows: label | pin | shortcut | arrow grid; adorn pins before kbd; labels wrapped', () => {
  const menu = js('menu.js');
  const s = css();
  assert.match(menu, /const mlbl = t => h\('span', \{ class: 'mlbl' \}, t\)/);
  assert.match(menu, /function adorn\(btn, o, pins = true\) \{/);
  assert.match(menu, /if \(o\?\.pin && pins\) btn\.append\(pinSpan\(o\.pin\)\);\s*if \(o\?\.kbd\) btn\.append\(h\('span', \{ class: 'kbd' \}, o\.kbd\)\)/);
  assert.match(s, /grid-template-columns:6px minmax\(max-content,1fr\) var\(--col-pin\) var\(--col-kbd\) var\(--col-arr\) 6px/);
  assert.match(s, /\.mpanel button>\.mpin[\s\S]*?grid-column:3/);
  assert.match(s, /\.mpanel button>\.kbd[\s\S]*?grid-column:4/);
  assert.match(s, /msub>button::after[\s\S]*?grid-column:5/);
  assert.match(s, /\.mpanel button>\.mpin[\s\S]*?width:18px;height:18px;min-width:18px;min-height:18px/);
});

test('fitAzLetters packs all letters when tall enough and dots when short', () => {
  const full = fitAzLetters(400);
  assert.equal(full.length, LETTERS.length);
  assert.ok(full.every(x => x.kind === 'letter'));
  assert.deepEqual(full.map(x => x.ch), LETTERS);
  const short = fitAzLetters(60, LETTERS, 11);
  assert.ok(short.some(x => x.kind === 'dot'));
  assert.equal(short[0].kind, 'letter');
  assert.equal(short[0].ch, LETTERS[0]);
  assert.equal(short.at(-1).kind, 'letter');
  assert.equal(short.at(-1).ch, LETTERS.at(-1));
  const letters = short.filter(x => x.kind === 'letter').map(x => x.ch);
  assert.ok(letters.length < LETTERS.length);
  assert.ok(letters.length >= 3);
});

test('fitAzLetters uses every other letter with dots in the mid-height band', () => {
  const mid = fitAzLetters(200, LETTERS, 11);
  assert.ok(mid.some(x => x.kind === 'dot'));
  const letters = mid.filter(x => x.kind === 'letter').map(x => x.ch);
  assert.equal(letters[0], LETTERS[0]);
  assert.equal(letters.at(-1), LETTERS.at(-1));
  assert.ok(letters.includes('A') && letters.includes('C') && !letters.includes('B'));
  assert.ok(letters.length < LETTERS.length);
  assert.ok(letters.length >= Math.ceil(LETTERS.length / 2));
  // Dots only sit in skipped gaps; they are not a letter-sized slot in CSS.
  assert.ok(mid.filter(x => x.kind === 'dot').length >= 1);
});

test('visibleCssHeight scales a clipped border-box back to CSS pixels', () => {
  assert.equal(visibleCssHeight(400, 400, 400), 400);
  assert.equal(visibleCssHeight(800, 800, 200), 200);
  assert.equal(visibleCssHeight(0, 100, 50), 0);
  assert.equal(visibleCssHeight(200, 0, 50), 200);
  assert.equal(visibleCssHeight(100, 200, 50), 25);
  assert.equal(visibleCssHeight(100, 200, 400), 100);
  assert.equal(visibleCssHeight(100, 200, -10), 0);
});

test('Library A–Z rail uses fitAzLetters, drag-scrub, bubble; CSS overrides boxed .lib button', () => {
  const lib = js('library.js');
  const s = css();
  assert.match(lib, /fitAzLetters/);
  assert.match(lib, /visibleCssHeight/);
  assert.match(lib, /azClipHeight/);
  assert.match(lib, /class: 'azbubble'/);
  assert.match(lib, /pointerdown/);
  assert.match(lib, /pointermove/);
  assert.match(lib, /setProperty\('--az-fs'/);
  assert.match(lib, /addEventListener\('scroll', azResize, true\)/);
  assert.match(s, /\.libpanel \.azstrip button,\s*\.lib \.azstrip button/);
  assert.match(s, /border:0!important/);
  assert.match(s, /\.azstrip \.azbubble/);
  assert.match(s, /@media \(pointer:coarse\)\{/);
  assert.match(s, /\.lib\.expanded:not\(\.extratab\) \.libscroll\{overflow:hidden\}/);
  // Fit the visible pane: fill the Library body, only the list scrolls, letters flex-shrink and scale.
  assert.match(s, /\.libpanel \.libbody\{overflow:hidden;display:flex;flex-direction:column\}/);
  assert.match(s, /\.libpanel \.libbody>\.lib\{flex:1;min-height:0/);
  assert.match(s, /flex:1 1 0/);
  assert.match(s, /\.azstrip button[^{]*\{[^}]*min-height:0/);
  assert.match(s, /container-type:size/);
  assert.match(s, /font-size:var\(--az-fs,clamp\(6px,calc\(100cqh \/ 28\),11px\)\)/);
  assert.match(s, /\.azdot\{flex:0 0 auto/);
  // These fit rules are shared, not gated on a phone max-width query.
  const azBlock = s.slice(s.indexOf('A–Z letter finder'), s.indexOf('.cover>.ic,.cover>.cover-ic'));
  assert.doesNotMatch(azBlock, /@media \(max-width:900px\)/);
  assert.ok(!/\.azstrip[^{]*\{[^}]*overflow:\s*auto/.test(s));
});


test('Library folder and generic placeholders are themed SVGs, not emoji', () => {
  const lib = js('library.js');
  const icons = js('icons.js');
  const art = js('art.js');
  assert.match(icons, /folder:\s*'<path/);
  assert.match(icons, /note:\s*'<path/);
  assert.match(icons, /radio:\s*'<rect/);
  assert.match(art, /export function coverGlyph/);
  assert.match(art, /coverGlyph\(glyph\)/);
  assert.match(lib, /icon\('folder'/);
  assert.match(lib, /coverGlyph\('folder'\)/);
  assert.doesNotMatch(lib, /📁/);
  assert.match(css(), /\.cover>\.ic,\.cover>\.cover-ic/);
});

test('Radio Browser pins United States after Any country', () => {
  const src = js('radiofinder.js');
  assert.match(src, /export function pinCountries/);
  assert.match(src, /pinCountries\(cs\)/);
  const pinCountries = loadExport(src, 'pinCountries');
  const cs = [
    { code: 'DE', name: 'Germany' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'US', name: 'United States' },
    { code: 'FR', name: 'France' },
  ];
  assert.deepEqual(pinCountries(cs).map(c => c.code), ['US', 'DE', 'GB', 'FR']);
  const alt = [{ code: 'CA', name: 'Canada' }, { code: 'USA', name: 'United States of America' }];
  assert.equal(pinCountries(alt)[0].code, 'USA');
  assert.deepEqual(pinCountries(null), []);
});

test('phone Queue Up next is a static full-width row (beats .desk .plnext absolute centering)', () => {
  const s = css();
  assert.match(s, /\.desk \.view \.phone-queue \.plnext\.pq-upnext:not\(\[hidden\]\)/);
  assert.match(s, /\.phone-queue \.pq-upnext\{[^}]*position:static/);
  assert.match(s, /\.phone-queue \.pq-upnext\{[^}]*transform:none/);
  assert.match(s, /\.phone-queue \.pq-upnext\{[^}]*flex:1 0 100%/);
  // desktop compact header rule is unchanged
  assert.match(s, /\.desk \.plnext:not\(\[hidden\]\)\{display:flex;[^}]*position:absolute;[^}]*transform:translateX\(-50%\)/);
});

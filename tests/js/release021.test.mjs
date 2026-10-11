// WavWiz 0.2.1 (F1-F20): the user's 0.2.0 test feedback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
const css = readFileSync(join(js, '../app.css'), 'utf8');
globalThis.Element ??= class {};
const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('0.2.1 F5: the Library filter box is never re-created or re-parented while typing; filtering is debounced', () => {
  const l = src('library.js');
  assert.doesNotMatch(l, /head\.replaceChildren\(h\('div', \{ class: 'row libhead' \}/, 'the header row (holding the filter box) is no longer rebuilt per draw');
  assert.match(l, /tabsSlot\.replaceChildren\(tabs\(\)\)/);
  assert.match(l, /const placeSearch = parent => \{\s*if \(searchField\.parentElement === parent\) return;/);
  assert.match(l, /search\.focus\(\{ preventScroll: true \}\); try \{ search\.setSelectionRange\(a, b\)/);
  assert.match(l, /search\._t = setTimeout\([^]*?, 250\)/);
  assert.match(css, /\.libtabslot\{display:contents\}/);
});

test('0.2.1 F16: a silent install returns 9 (not 0) when the final setup step fails or hangs; documented', () => {
  const iss = readFileSync(new URL('../../installer/WavWiz.iss', import.meta.url), 'utf8');
  assert.match(iss, /function GetCustomSetupExitCode: Integer;\s*begin\s*if SetupFailed then Result := 9 else Result := 0;/);
  assert.match(iss, /or \(Code <> 0\) then\s*begin\s*SetupFailed := True;/);    // both "hung / never reported" and a non-zero script exit set it
  const doc = readFileSync(new URL('../../docs/INSTALLER.md', import.meta.url), 'utf8');
  assert.match(doc, /`9` the files were copied but the final setup step/); assert.doesNotMatch(doc, /the installer still returns `0`/);
});

test('0.2.1 F1: Devices header = collapse arrow + separate Expand button (no size toggle, no cycling); Esc returns', async () => {
  const d = await imp('devices');
  assert.equal(d.nextSize, undefined); assert.equal(d.SIZE_LABEL, undefined);
  assert.equal(d.arrowSize('standard'), 'collapsed'); assert.equal(d.arrowSize('expanded'), 'collapsed'); assert.equal(d.arrowSize('collapsed'), 'standard');
  assert.equal(d.expandSize('standard'), 'expanded'); assert.equal(d.expandSize('collapsed'), 'expanded'); assert.equal(d.expandSize('expanded'), 'standard');
  const s = src('devices.js'), m = src('main.js');
  assert.doesNotMatch(s, /segsize/); assert.doesNotMatch(css, /segsize/);
  assert.match(s, /class: 'plus devcol'/); assert.match(s, /class: 'plus devexp'/); assert.match(s, /ctl\.toggleDevExpanded/);
  assert.match(m, /function toggleDevExpanded\(force\)/); assert.match(m, /setDevSize\(arrowSize\(devp\.size\)\)/);
  assert.match(m, /else if \(desk\.classList\.contains\('devexpanded'\)\) toggleDevExpanded\(false\)/);
  assert.match(css, /\.desk\.devexpanded \.devpanel \.pane-h \.eschint\{display:inline-block\}/);
});

test('0.2.1 F2: no "Expanded library" menu item; Browse library always opens the Expanded Library', () => {
  const menu = src('menu.js');
  assert.doesNotMatch(menu, /'Expanded library'/);
  assert.match(menu, /const browseLib = \(\) => \(desktop && wideNow\(\) && ctl\.toggleLibExpanded \? ctl\.toggleLibExpanded\(true\) : go\('library'\)\)/);
});

test('0.2.1 F3: no VISUALIZER title and no look-name label on the visualizer panel; the small buttons stay', () => {
  const n = src('now.js');
  assert.doesNotMatch(n, /'VISUALIZER'/); assert.doesNotMatch(n, /np-vlabel/); assert.doesNotMatch(n, /vlabel\.textContent/);
  assert.match(n, /const vizPanel = h\('section', \{ class: 'np-vizpanel', 'aria-label': 'Visualizer' \}, stage\);/);
  assert.match(n, /'Looks'/); assert.match(n, /'Full screen visualizer'/); assert.match(n, /'Open the visualizer in its own window'/);
});

test('0.2.1 F4: Expanded Library opens in tiles on every tab (Large), list toggle remembered per tab, the narrow panel keeps its own choice', async () => {
  const L = await imp('libsort');
  const st = memStore(); const p = L.loadLibPrefs(st);
  assert.equal(p.defView, 'grid'); assert.equal(p.tileSize, 'large'); assert.equal(p.remember, true); assert.equal(p.defSort, 'artist'); assert.equal(p.compactView, 'list');
  for (const k of ['albums', 'artists', 'genres', 'years', 'recent', 'folders', 'favorites']) assert.equal(L.tabView(p, k), 'grid', k);
  assert.equal(L.tabView(p, 'songs'), 'list');
  p.views.genres = 'list'; L.saveLibPrefs(p, st); const q = L.loadLibPrefs(st);
  assert.equal(L.tabView(q, 'genres'), 'list'); assert.equal(L.tabView(q, 'albums'), 'grid');                // remembered per tab
  q.remember = false; assert.equal(L.tabView(q, 'genres'), 'grid'); assert.equal(L.tabView(q, 'genres', { genres: 'list' }), 'list');   // not remembered: session only
  const old = memStore(); old.setItem('wavwiz.libprefs.v1', JSON.stringify({ view: 'grid', sort: {}, flip: {} }));
  const o = L.loadLibPrefs(old); assert.equal(o.compactView, 'grid'); assert.equal(L.tabView(o, 'artists'), 'grid');  // 0.2.0 save carries over to the narrow panel
  L.saveLibPrefs(o, old); assert.equal(JSON.parse(old.getItem('wavwiz.libprefs.v1')).view, undefined);
  const r = L.resetLibView({ ...q, tileSize: 'small', defView: 'list', views: { albums: 'list' } }); assert.equal(r.tileSize, 'large'); assert.equal(r.defView, 'grid'); assert.deepEqual(r.views, {});
  const l = src('library.js');
  for (const t of ['artistTile', 'genreTile', 'yearTile', 'folderTile']) assert.match(l, new RegExp(`list\\('\\w+', [^)]*\\)?, ${t}\\)|, ${t}\\)`), t);
  assert.match(l, /tabView\(P, kind, session\) === 'grid'/); assert.match(l, /root\.dataset\.tiles = P\.tileSize/);
  assert.match(css, /\.lib\.expanded \.tilegrid\{grid-template-columns:repeat\(auto-fill,minmax\(var\(--tmin\),1fr\)\)/);
  const lib = L; assert.deepEqual(lib.blockColors('Jazz'), lib.blockColors('Jazz')); assert.notDeepEqual(lib.blockColors('Jazz'), lib.blockColors('Folk'));
});

test('0.2.1 F6: Windows-style menu bar - click opens, hover switches while a menu is open, click outside / Esc closes', () => {
  const m = src('menu.js');
  assert.match(m, /onmouseenter: \(\) => \{ if \(openGroup && openGroup !== group\) toggle\(group, btn\); \}/);
  assert.match(m, /document\.addEventListener\('click', \(\) => closeAll\(\)\)/); assert.match(m, /ev\.key === 'Escape'\) closeAll\(\)/);
  assert.match(m, /ArrowRight/);
});

// F7: zones sidebar in Expanded Devices (variant B)
test('0.2.1 F7: zone filter + state helpers, sidebar on the right, edit view never redrawn under typing', async () => {
  const d = src('devices.js');
  assert.match(d, /export function zoneFilter/); assert.match(d, /export function zoneState/);
  assert.match(d, /zonesSidebar\(/); assert.match(d, /'All devices'/); assert.match(d, /dexp-main/);
  assert.match(d, /size === 'expanded' && zedit !== null\) return/);
  assert.match(css, /\.dexp-main\{display:grid;grid-template-columns:minmax\(0,1fr\) 184px/);
  assert.match(css, /\.zsrow\.on::before/);
  const body = d.slice(d.indexOf('export function zoneFilter'));
  const fnSrc = body.slice(0, body.indexOf('\n}\n') + 2).replace('export ', '');
  const zoneFilter = new Function(fnSrc + '; return zoneFilter;')();
  const zones = [{ id: 1 }, { id: 2 }, { id: 3 }], groups = [{ id: 7, deviceIds: [1, 2] }];
  assert.deepEqual(zoneFilter(zones, groups, null).map(z => z.id), [1, 2, 3]);
  assert.deepEqual(zoneFilter(zones, groups, 7).map(z => z.id), [1, 2]);
  assert.deepEqual(zoneFilter(zones, groups, 99).map(z => z.id), [1, 2, 3], 'a deleted zone falls back to All devices');
});

test('0.2.1 F8: five menus with one home per item; Settings tabs Appearance/Devices/Library/Network; Library view card; Status in Diagnostics; finder is a radio tab', () => {
  const m = src('menu.js'), st = src('settings.js'), main = src('main.js'), ap = src('appearance.js'), dg = src('diag.js');
  for (const t of ['File', 'Library', 'Playback', 'Devices', 'Help']) assert.match(m, new RegExp(`'${t}'`));
  assert.doesNotMatch(m, /'View'|'Theme…'|'Visualizer…'|'Display size'|'Radio finder'|\['Playlist',/);
  const block = k => m.split(`    ${k}: [`)[1].split('\n    ],')[0];
  assert.deepEqual([...block('library').matchAll(/\['([^']+)'/g)].map(x => x[1]), ['Browse library', 'Playlists', 'Queue', 'Rescan folders', 'Tidy up library', 'Tag & cover fix…', 'CD ripper…']);
  assert.deepEqual([...block('playback').matchAll(/\['([^']+)'/g)].map(x => x[1]), ['Play / Pause', 'Next', 'Previous', 'Internet radio', 'Sound / EQ…']);
  assert.deepEqual([...block('devices').matchAll(/\['([^']+)'/g)].map(x => x[1]), ['Devices & zones', 'Scenes', 'Schedules', 'Calibrate speakers…', 'Pair a player…', 'Away-from-home…']);
  assert.deepEqual([...block('help').matchAll(/\[(?:'([^']+)'|"([^"]+)")/g)].map(x => x[1] ?? x[2]), ['Getting started', 'Diagnostics', "What's new", 'About WavWiz…']);
  assert.match(m, /accordion\('Devices', \(\) => fromSpec\(A\.devices\)\)/, 'the phone menu mirrors the same tree');
  assert.match(st, /\['appearance', 'Appearance'\],\n  \['devices', 'Devices'\],\n  \['library', 'Library'\],\n  \['network', 'Network'\],\n\];/);
  assert.doesNotMatch(st, /'about'|id: 'sec-status'/);
  assert.match(dg, /id: 'sec-status'/);
  assert.match(ap, /theme\.el, viz\.el, np\.el, eqs\.el, disp\.el/);
  assert.match(st, /panes\.library\.push\(libViewCard\(\)\);/);
  for (const t of ["'Default view'", "'Tile size'", "'Default sort'", "'Remember view per tab'", "'Reset to defaults'", "'wavwiz:libprefs'"]) assert.ok(st.includes(t), t);
  assert.match(main, /\[\['mine', 'My stations'\], \['finder', 'Radio finder'\]\]/);
  assert.doesNotMatch(main, /\['finder', 'Finder'\]/);
});

test('0.2.1 F9: Appearance shows a live preview built from the real panel (clone + example data), updated on every pick', () => {
  const pv = src('nppreview.js'), now = src('now.js'), st = src('settings.js'), ap = src('appearance.js');
  assert.match(now, /export const npPanelTemplate = \(\) => panelTpl;/); assert.match(now, /panelTpl = ctlPanel;/);
  assert.match(pv, /fillSample\(tpl\.cloneNode\(true\), p\)/); assert.match(pv, /'LIVE PREVIEW'/); assert.match(pv, /'EXAMPLE DATA'/); assert.match(pv, /'Updates as you pick\.'/);
  assert.match(pv, /setAttribute\('inert', ''\)/);
  assert.match(pv, /addEventListener\('wavwiz:theme', onTheme\); window\.addEventListener\('wavwiz:npstyle', onTheme\)/);
  assert.match(st, /preview: \(\) => npPreview\(\)/);
  assert.match(ap, /preview\?\.update\(\)/);
  assert.match(css, /\.npprev-stage>\.np-ctlpanel\{position:absolute;left:0;top:0;transform-origin:0 0/);
});

test('0.2.1 F10: no three-dot menu and no Stop on the panel; EQ is a regular button; Classic heart is a round transport button', () => {
  const n = src('now.js'), f = src('fav.js');
  assert.doesNotMatch(n, /np-volpop|np-volbtn|barMore|'aria-label': 'Stop'|act\('\/stream\/stop'\) \}, icon\('stop'\)/);
  assert.match(n, /const mkEq = \(\) => h\('button', \{ class: 'tbtn eqbtn', 'aria-label': 'Sound \(EQ\)'/);
  assert.match(n, /muteBtn, h\('div', \{ class: 'np-vol' \}, eqBtn/); assert.match(n, /barMute, barEq\)\)/);
  assert.match(n, /\{ class: 'transport np-tablexport', role: 'group', 'aria-label': 'Transport' \}, xHeart, shuffle/);
  assert.match(f, /round \? 'heart tbtn ico' : 'heart'/);
  assert.match(css, /\.np-ctlpanel\.pn-classic \.np-xheart\{display:contents\}/);
  assert.match(css, /@container npctl \(max-width:900px\)/);
});

test('0.2.1 F11: the NOW PLAYING header keeps only its label (+ collapsed song line) and the collapse arrow; no status chips or live dot', () => {
  const n = src('now.js');
  assert.match(n, /h\('div', \{ class: 'pane-h' \}, h\('span', \{ class: 'np-ctltitle' \}, 'NOW PLAYING'\), ctlNow, h\('span', \{ class: 'grow' \}\), h\('span', \{ class: 'row listcolwrap' \}, ctlColBtn\)\)/);
  assert.doesNotMatch(n, /np-hchips|np-spk|class: 'np-dot'|liveDot|np-mutedtag/);
  assert.match(n, /h\('div', \{ class: 'np-vol' \}, eqBtn\)\)\)/);
});

test('0.2.1 F12: three EQ looks over the same DSP; LED bars default; ±12 dB in 0.5 dB steps; keys/drag/wheel; glow 50 % default; Save asks a name', async () => {
  const m = await imp('eqstyle');
  assert.deepEqual(m.EQ_STYLES.map(s => s[0]), ['led', 'faders', 'curve']);
  assert.deepEqual(m.EQ_STYLES.map(s => s[1]), ['LED bars', 'Studio faders', 'Spectrum curve']);
  const st = memStore();
  assert.deepEqual(m.loadEqPrefs(st), { style: 'led', glow: 50 });
  m.saveEqPrefs({ style: 'curve', glow: 140 }, st); assert.deepEqual(m.loadEqPrefs(st), { style: 'curve', glow: 100 });
  m.saveEqPrefs({ style: 'nope', glow: -5 }, st); assert.deepEqual(m.loadEqPrefs(st), { style: 'led', glow: 0 });
  assert.equal(m.snapDb(3.26), 3.5); assert.equal(m.snapDb(30), 12); assert.equal(m.snapDb(-30), -12); assert.equal(m.snapDb(-0.1), 0);
  assert.equal(m.fracToDb(0), 12); assert.equal(m.fracToDb(1), -12); assert.equal(m.fracToDb(0.5), 0); assert.equal(m.dbToFrac(6), 0.25);
  assert.equal(m.keyStep('ArrowUp', 2), 2.5); assert.equal(m.keyStep('ArrowDown', -12), -12); assert.equal(m.keyStep('PageUp', 11), 12); assert.equal(m.keyStep('Home', 0), 12); assert.equal(m.keyStep('x', 0), null);
  assert.deepEqual(m.EQ_BANDS, [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
  assert.ok(Math.abs(m.colX(31) - 0.05) < 1e-9 && Math.abs(m.colX(16000) - 0.95) < 1e-9);
  assert.deepEqual(m.glowWords('curve'), ['Spectrum glow', 'Brightness of the live-music fill']);
  const r = m.approxResponse(m.EQ_EXAMPLE, 40); assert.equal(r.hz.length, 40); assert.ok(r.db.every(Number.isFinite));
  const v = src('eqview.js'), e = src('eq.js'), ap = src('appearance.js');
  assert.match(v, /role: 'slider'/); assert.match(v, /addEventListener\('wheel'/); assert.match(v, /setPointerCapture/); assert.match(v, /ArrowLeft' \|\| ev\.key === 'ArrowRight'/);
  assert.match(v, /dbToFrac\(r\.db\[k\] - pg\)/, 'the curve overlay shows the EQ shape (pre-gain added back)');
  assert.match(e, /\/dsp\/preview/); assert.match(e, /\/dsp\/response/); assert.match(e, /'Save as a new preset'/); assert.doesNotMatch(e, /'aria-label': 'Preset name', oninput/);
  for (const t of ["'Auto pre-gain'", "'Loudness'", "'Limiter'", "'Bypass'", "'Flat'", "'Revert'", "'Save & use on this speaker'", "'Previewing live'"]) assert.ok(e.includes(t), t);
  assert.match(ap, /'EQ style'/); assert.match(ap, /interactive: false/);
  assert.match(src('viz.js'), /export function spectrumTap\(onFrame\)/);
});

test('0.2.1 F13: generated covers + portraits are deterministic, unique per album, themed; year under album tiles; album page; artist photos', async () => {
  const g = await imp('gencover');
  assert.equal(g.initials('Low Tide Radio'), 'LT'); assert.equal(g.initials('Northbound'), 'N'); assert.equal(g.initials('The Glass Harbor'), 'GH');
  assert.equal(g.initials('Cedar & Smoke'), 'CS'); assert.equal(g.initials('!!!'), '');
  assert.deepEqual(g.coverSpec('Room Tone', 'Glow Society'), g.coverSpec('Room Tone', 'Glow Society'), 'same album = same cover everywhere');
  const names = ['Room Tone', 'Northbound', 'Low Tide Radio', 'Slow Motion Summer', 'Quiet Engines', 'Signal Fires'];
  const sigs = new Set(names.map(n => { const c = g.coverSpec(n, 'x'); return `${c.angle}/${c.mixA}/${c.mixB}/${c.waveCount}`; }));
  assert.equal(sigs.size, names.length, 'each cover differs');
  const svg = g.coverSvg('Room Tone', 'Glow Society');
  assert.match(svg, /var\(--accent\)/); assert.match(svg, /var\(--accent2\)/); assert.match(svg, />RT</); assert.match(svg, /♫/); assert.ok((svg.match(/<path /g) || []).length >= 5, 'wave pattern');
  assert.match(g.portraitSvg('Blue Lantern'), />BL</);
  assert.match(g.wavePath(50, 5, 2, 0), /^M0\.0 50\.00/);
  const art = src('art.js');
  assert.match(art, /export const artistArt = \(name, size = 384\) => name \? `\$\{base\}\/artist\?name=/);
  assert.match(art, /gen\.portrait != null \? genNode\('artist', gen\.portrait\) : genNode\('album', gen\.album, gen\.artist\)/);
  const lib = src('library.js');
  assert.match(lib, /artistCover\(a\.name, a\.artTrackIds, 'lg rnd', 384\)/);      // 0.2.2 T4d: photo, else album covers, else portrait
  assert.match(lib, /h\('div', \{ class: 't2 ell' \}, albumSub\(al\)\)/);
  for (const t of ["'ALBUM'", "'TITLE'", "'TIME'", "'albplay'", "playShuffled(ids)", "{ round: true }", "--dom"]) assert.ok(lib.includes(t.replace(/'albplay'/, 'albplay')), t);
  assert.match(src('ui.js'), /export async function playShuffled\(ids\)/);
  // pure bits of library.js without a DOM: albumSub + dominantOf
  const body = lib.slice(lib.indexOf('export function dominantOf'), lib.indexOf('/** Tag-based library'));
  const dominantOf = new Function(body.replace('export function dominantOf', 'return function') )();
  const px = (r, g2, b, n) => Array.from({ length: n }, () => [r, g2, b, 255]).flat();
  assert.equal(dominantOf(new Uint8ClampedArray([...px(230, 90, 40, 60), ...px(30, 200, 180, 30), ...px(20, 20, 20, 10)])), 'rgb(230,90,40)', 'the biggest colorful hue wins, not a muddy average');
  assert.equal(dominantOf(new Uint8ClampedArray(px(120, 120, 120, 16))), 'rgb(120,120,120)');
  assert.match(css, /\.albhead\{--dom:/); assert.match(css, /\.albhead \.cover\.albcover\{[^}]*border-radius:4px/, 'album header art keeps the tight corner rule');
});

test('0.2.1 F14 + F15: Highlight is a third theme color (agreed hexes, >= 3:1 on the background), Custom has five pickers; new theme order', async () => {
  const theme = await imp('theme');
  assert.deepEqual(Object.values(theme.PRESETS).map(p => p.name), ['Midnight Neon', 'Pepecoin', 'Ember', 'Arctic', 'Violet Pulse', 'Monochrome', 'Daylight', 'Nebula', 'Blue Steel', 'Lime Circuit']);
  const want = { default: '#F5C542', pepecoin: '#C07A4E', ember: '#4FC3F7', arctic: '#6EF7B2', violet: '#2EE6D6', mono: '#FF5A5F', daylight: '#6B4EE6', nebula: '#F472B6', steel: '#E0B15A', lime: '#F472D0' };
  const ratio = (a, b) => { const x = theme.luminance(a), y = theme.luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  for (const [id, hl] of Object.entries(want)) {
    assert.equal(theme.PRESETS[id].hl, hl, id);
    assert.ok(ratio(hl, theme.PRESETS[id].bg) >= 3, `${id} highlight contrast ${ratio(hl, theme.PRESETS[id].bg).toFixed(2)}`);
    assert.equal(theme.derive(theme.PRESETS[id])['--hl'], hl);
  }
  assert.equal(theme.derive({ bg: '#000000', accent: '#123456' })['--hl'], '#123456', 'unset = Main (the 0.2.0 look)');
  const st = memStore(); globalThis.localStorage = st;
  try {
    theme.saveTheme({ ...theme.PRESETS.pepecoin, preset: 'pepecoin' }); assert.equal(theme.loadTheme().hl, '#C07A4E');
    theme.saveTheme({ accent: '#112233', accent2: '#445566', hl: '#ABCDEF', bg: '#000000', ink: '#FFFFFF', preset: 'custom' }); assert.equal(theme.loadTheme().hl, '#ABCDEF');
    st.setItem('wavwiz.theme.v1', JSON.stringify({ v: 4, accent: '#112233', accent2: '#445566', bg: '#000000', ink: '#FFFFFF', preset: 'custom' })); assert.equal(theme.loadTheme().hl, '#112233', '0.2.0 custom saves keep Main');
  } finally { delete globalThis.localStorage; }
  const tv = src('themes.js');
  assert.match(tv, /picker\('bg', 'Background'.*picker\('accent', 'Main'.*picker\('accent2', 'Second'.*picker\('hl', 'Highlight'.*picker\('ink', 'Text'/s);
  for (const sel of ['.heart.on{color:var(--hl', '.settings-nav button.on{background:none;border-color:var(--hl', '.lib.expanded .xtabs button.on{background:none;color:var(--ink);border-bottom-color:var(--hl', '.eqb-cap{', '.zsrow.on::before', '.zsrow.on .zscount{border-color:var(--hl', '.newchip{', '.eqa-tip{'])
    assert.ok(css.includes(sel), sel);
  assert.match(css, /\.tbtn\.play\{width:64px;height:64px;border-radius:50%;background:var\(--accent\)/, 'Play stays Main');
  const vc = await imp('vizcore');
  assert.deepEqual(vc.palette({}, { accent: '#FF3C00', accent2: '#19C3B1', hl: '#F5C542' }).h?.length, 3, 'visualizer peak caps get the Highlight');
  assert.equal(vc.palette({}, { accent: '#FF3C00', accent2: '#19C3B1' }).h, undefined);
  assert.match(src('vizgl.js'), /P\.h \|\| hot/);
  assert.match(src('about.js'), /h\('span', \{ class: 'newchip' \}, 'NEW'\)/);
});

test('0.2.1 F17: Mute all on the master volume strip (per-device Mute stays separate)', async () => {
  const d = src('devices.js');
  assert.match(d, /h\('div', \{ class: 'dvol' \}, icon\('volume'\), sl, pct, muteAllButton\(S, ctl\)\)/);
  assert.match(d, /ctl\.act\('\/zones\/mute-all', \{ muted: want \}\)/);
  assert.match(d, /m \? 'Unmute all' : 'Mute all'/);
  assert.match(d, /function muteButton\(S, ctl, z\)/, 'each device keeps its own Mute');
  const body = d.slice(d.indexOf('export const allMuted'), d.indexOf('\n', d.indexOf('export const allMuted')));
  const allMuted = new Function('return ' + body.replace('export const allMuted = ', ''))();
  assert.equal(allMuted([]), false); assert.equal(allMuted([{ muted: true }, { muted: false }]), false); assert.equal(allMuted([{ muted: true }, { muted: true }]), true);
  assert.match(css, /\.dmaster \.dvol \.mutealls\{/);
});

test('0.2.1 F18 + F19: Calibrate + Test sound live in each card\'s own settings view; the device Details pop-up is gone', () => {
  const d = src('devices.js');
  const face = d.slice(d.indexOf('function expandedCard('), d.indexOf('function standardRow('));
  const face2 = face.slice(face.indexOf('const { vol, pct, mute }'));
  assert.doesNotMatch(face2, /test-sound|openCalibration|'🔔 Test sound'|'Calibrate'/, 'no Calibrate / Test sound on the card face');
  assert.match(face, /cardSettings\(S, ctl, z, flip\)/); assert.match(face, /'aria-label': `Settings for \$\{z\.name\}`/);
  const set = d.slice(d.indexOf('function cardSettings('), d.indexOf('async function delayHistory('));
  for (const t of ["'SOUND CHECK'", "'🎤 Calibrate'", "'Set delay by ear'", "'🔔 Test sound'", "'Sound / EQ…'", "'Delay history…'", "'CONNECTION'", "'Rename…'", "'Forget device…'", "'Set as reference'", "exactDelay("]) assert.ok(set.includes(t), t);
  assert.doesNotMatch(d, /openZone|zone\.js|'Details…'/);
  assert.throws(() => src('zone.js'), /ENOENT/, 'the pop-up module is removed');
  assert.match(css, /\.dsettings\{/);
});

test('0.2.1 F20: Pepecoin logo files are the brand-kit onDark files byte for byte; wording is exactly "Pepecoin"', async () => {
  const { readFileSync, readdirSync, existsSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const root = new URL('../../src/WavWiz.Server/wwwroot/', import.meta.url);
  const shipped = readdirSync(new URL('assets/pepecoin/', root));
  assert.deepEqual(shipped, ['Pepecoin_onDark_RGB.svg'], 'only the onDark logo with wordmark ships');
  const kit = '/workspace/pepecoin-brand-kit/Pepecoin_onDark_RGB [Converted].svg';
  const sha = b => createHash('sha256').update(b).digest('hex');
  const ours = readFileSync(new URL('assets/pepecoin/Pepecoin_onDark_RGB.svg', root));
  if (existsSync(kit)) assert.equal(sha(ours), sha(readFileSync(kit)), 'identical to the brand kit');
  assert.equal(sha(ours), '296955f2c5c42c8d' + sha(ours).slice(16), 'the known kit file');
  const tv = src('themes.js');
  assert.match(tv, /PEPE_LOGO = '\/assets\/pepecoin\/Pepecoin_onDark_RGB\.svg'/); assert.match(tv, /'aria-label': 'Pepecoin'/);
  const all = ['themes.js', 'theme.js', 'about.js', 'settings.js', 'appearance.js', 'nppreview.js'].map(src).join('\n') + css;
  assert.doesNotMatch(all, /PepeCoin|Pepe coin|Pepe Coin|PEPECOIN/);
  for (const c of ['#269B4D', '#208241', '#212121', '#C07A4E']) assert.ok(src('theme.js').includes(c), c);
  assert.match(css, /\.pepe-note\{[^}]*background:#212121/);
});

test('0.2.1: What\'s new lists the 0.2.1 changes in US English, each with a NEW chip', async () => {
  const a = src('about.js');
  assert.match(a, /WHATS_NEW_VERSION = '0\.2\.1'/);
  for (const t of ['A Library that looks like an album shelf', 'Zones get their own sidebar', 'Calmer device cards', 'A new Sound (EQ) dialog', 'Highlight color', 'Fixes']) assert.ok(a.includes(t), t);
  assert.doesNotMatch(a, /\b(colour|favourite|grey|centre)\b/i);
});

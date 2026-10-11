// WavWiz 0.2.2 (T1-T11): the user's 0.2.1 test notes.
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
void imp;

test('0.2.2 T4: artist tiles fall back to the artist\'s album covers (mosaic of 4 or one cover) before the generated portrait; live swap on "art"', () => {
  const a = src('art.js');
  assert.match(a, /export function artistCover\(name, ids = \[\], cls = 'lg rnd', size = 384\)/);
  assert.match(a, /ok\.length >= 4 \? ok\.slice\(0, 4\) : \[ok\[0\]\]/);
  assert.match(a, /if \(!ok\.length\) \{ m\.remove\(\); return; \}\s*\/\/ no album art either: the generated portrait stays/);
  assert.match(a, /export function artPushed\(d\)/);
  assert.match(src('main.js'), /m\.type === 'art'\) \{ artPushed\(m\.data\)/);
  const l = src('library.js');
  assert.match(l, /const artistArt = a => artistCover\(a\.name, a\.artTrackIds, 'lg rnd', 384\)/);
  assert.match(l, /artistCover\(a\.name, a\.artTrackIds, 'sm rnd', 96\)/);
  assert.match(css, /\.acover \.amosaic\{position:absolute;inset:0;display:grid/);
});

test('0.2.2 T4e: Settings > Library has the Online art card (counts, switch, Retry missing photos, sources)', () => {
  const s = src('settings.js');
  assert.match(s, /panes\.library\.push\(onlineArtCard\(settings, admin\)\)/);
  assert.match(s, /api\('\/library\/online-art'\)/);
  assert.match(s, /api\('\/library\/online-art\/retry', \{ method: 'POST' \}\)/);
  assert.match(s, /'Retry missing photos'/);
  assert.match(s, /TheAudioDB \(theaudiodb\.com\)/);
  assert.match(s, /'library\.onlineArt': ev\.target\.checked/);
});

test('0.2.2 T3: collapsed Now Playing = one-line strip with every control, Play/Pause on the exact center line', () => {
  const n = src('now.js');
  assert.match(n, /h\('div', \{ class: 'np-strip-l' \}, sHeart, sShuffle, sPrev\)/);
  assert.match(n, /h\('div', \{ class: 'np-strip-c' \}, sPlay\)/);
  assert.match(n, /h\('div', \{ class: 'np-strip-r' \}, sNext, sRepeat, h\('span', \{ class: 'np-strip-vol' \}, icon\('volume'\), sVol, sPct\), sMute, sEq\)/);
  assert.match(n, /'NOW PLAYING'\), ctlNow, ctlStrip,/);
  assert.match(n, /for \(const r of \[vol, barVol, sVol\]\)/);
  assert.match(n, /for \(const b of \[muteBtn, barMute, sMute\]\)/);
  assert.match(css, /\.np-ctlpanel\.collapsed \.np-strip\{display:grid;grid-template-columns:1fr auto 1fr/);
  assert.match(css, /\.np-strip-l\{justify-self:end\} \.np-strip-r\{justify-self:start\} \.np-strip-c\{justify-self:center\}/);
  assert.match(css, /\.np-strip \.tbtn\{width:28px;height:28px;[^}]*border-radius:50%/);
});

test('0.2.2 T3: song block (thumb, title · artist, progress + times) moves into the Playlist title bar, lined up with the NP column', () => {
  const n = src('now.js'), m = src('main.js'), l = src('listtable.js');
  assert.match(n, /const songBlock = h\('div', \{ class: 'plsong'/);
  assert.match(n, /psElv, psProg, psDur/);
  assert.match(n, /return \{ el, mini, npbar, songBlock, ctlPanel, draw,/);
  assert.match(l, /const setSongBlock = el => \{ head\.insertBefore\(el, meta\); \}/);
  assert.match(m, /const l = Math\.max\(col\.left, listt\.leftEdge\(\) \+ 14\), r = Math\.min\(col\.right, listt\.rightEdge\(\) - 14\)/);
  assert.match(m, /desk\.classList\.toggle\('npcollapsed', on\)/);
  assert.match(css, /\.desk\.npcollapsed \.listpanel > \.pane-h\{min-height:42px\}/);
  assert.match(css, /\.desk\.npcollapsed\.listcollapsed\{--listh:44px\}/);
});

test('0.2.2 T5: Devices header is a true mirror of Library; one arrow rule (Expanded -> normal -> collapsed); same labels; accent title', async () => {
  const d = await imp('devices');
  assert.equal(d.arrowSize('expanded'), 'standard'); assert.equal(d.arrowSize('standard'), 'collapsed'); assert.equal(d.arrowSize('collapsed'), 'standard');
  assert.equal(d.expandSize('collapsed'), 'expanded');
  for (const w of ['Library', 'Devices']) {
    assert.equal(d.arrowLabel(w, 'collapsed'), `Open the ${w} panel`); assert.equal(d.arrowLabel(w, 'standard'), `Collapse the ${w} panel`);
    assert.equal(d.arrowLabel(w, 'expanded'), 'Back to the normal layout'); assert.equal(d.expandLabel(w, false), `Expand the ${w} panel`);
  }
  const s = src('devices.js'), m = src('main.js');
  assert.match(s, /h\('div', \{ class: 'pane-h devhead' \}, expBtn, colBtn, escHint, h\('span', \{ class: 'devtitle' \}, 'DEVICES'\)/);
  assert.match(m, /h\('span', \{ class: 'libtitle' \}, 'LIBRARY'\), h\('span', \{ class: 'grow' \}\), escHint, colBtn, expBtn\)/);
  assert.match(m, /if \(force === undefined && exp\) \{ toggleLibExpanded\(false\); return; \}/);
  assert.match(m, /setDevSize\(arrowSize\(devp\.size\)\)/);
  assert.match(css, /\.devpanel \.devhead > \.devtitle:not\(\.grow\),\.libpanel \.pane-h > \.libtitle\{color:var\(--accent\)\}/);
  assert.doesNotMatch(css, /\.desk\.libexpanded \.libpanel \.pane-h \.plus:not\(\.libexp\)\{display:none\}/);
});

test('0.2.2 T8: Menu > Devices > Devices & zones always opens the EXPANDED Devices view on the desktop; phone keeps the page', () => {
  const mn = src('menu.js'), m = src('main.js');
  assert.match(mn, /const devPanel = \(\) => \(desktop && wideNow\(\) && ctl\.toggleDevExpanded \? ctl\.toggleDevExpanded\(true\) : go\('devices'\)\)/);
  assert.match(m, /if \(k === 'devices'\) \{ if \(pageDlg\) \{ pageDlg\.close\(\); pageDlg = null; \} toggleDevExpanded\(true\); return; \}/);
  assert.match(m, /if \(sz !== 'collapsed' && desk\.classList\.contains\('libexpanded'\)\) toggleLibExpanded\(false\)/);
});

test('0.2.2 T2: Appearance has a left sub-nav (Theme, Visualizer, EQ, Now Playing, Display size), one page each with a live preview', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {} };
  const ap = src('appearance.js'), th = src('themes.js'), vp = src('vizpage.js'), st = src('settings.js');
  assert.match(ap, /export const APP_SUBS = \[\['theme', 'Theme'\], \['viz', 'Visualizer'\], \['eq', 'EQ'\], \['np', 'Now Playing'\], \['display', 'Display size'\]\]/);
  assert.match(ap, /h\('nav', \{ class: 'appnav', 'aria-label': 'Appearance sections' \}/);
  // Theme = the 0.2.0 Themes page layout (theme cards + Custom colors card) + live app preview that recolors on hover
  assert.match(th, /function previewCard\(id, p, current, onPick, onHover\)/); assert.match(th, /class: 'themegrid'/); assert.match(th, /h\('h3', null, 'Custom colors'\)/);
  assert.match(th, /export function appPreview\(\)/); assert.match(th, /Recolors as you hover or pick/);
  for (const l of ['Background', 'Main', 'Second', 'Highlight', 'Text']) assert.match(th, new RegExp(`picker\\('[a-z0-9]+', '${l}'`));
  assert.match(th, /Object\.entries\(PRESETS\)\.map\(\(\[id, p\]\) => previewCard/, 'F15 order = PRESETS order');
  const theme = await imp('theme'); assert.deepEqual(Object.keys(theme.PRESETS), ['default', 'pepecoin', 'ember', 'arctic', 'violet', 'mono', 'daylight', 'nebula', 'steel', 'lime']);
  // Visualizer = the 0.2.0 Visualizer page + live mini visualizer of the active look
  assert.match(ap, /visualizerView\(\{ nested: true \}\)/); assert.match(ap, /new Viz\(stage, \{ engine: p\.engine, preview: true \}\)/);
  assert.match(vp, /export function visualizerView\(\{ nested = false \} = \{\}\)/); assert.match(vp, /fold\('Graphics \(this device\)'/);
  // EQ = fuller page: big try-out preview, other styles, glow 0-100 % (50 % default)
  assert.match(ap, /interactive: true \}\);   \/\/ try-out only: no onChange, nothing is sent/); assert.match(ap, /'Other styles'/); assert.match(ap, /min: 0, max: 100, step: 1, value: p\.glow/);
  assert.match(ap, /interactive: false/);
  // Now Playing keeps the F9 preview; Display size gets a preview slice
  assert.match(ap, /preview \? preview\.el : null/); assert.match(ap, /class: 'npprev dsprev'/);
  assert.match(st, /section: APP_SECTION\[section\]/); assert.match(st, /else app\?\.resume\?\.\(\)/);
  assert.match(css, /\.appsplit\{display:grid;grid-template-columns:150px minmax\(0,1fr\)/);
  assert.match(css, /\.themecard\{border-radius:6px\}/);
});

test('0.2.2 T10: "Connected" lives only in the top-right indicator; the status bar shows "Reconnecting…" only when the connection drops', () => {
  const m = src('main.js'), body = m.split('function drawStatus() {')[1].split('\n}\n')[0];
  assert.doesNotMatch(body, /'Connected'/);
  assert.match(body, /S\.connected === false \? h\('span', \{ class: 'sb sbconn', role: 'status' \}, h\('span', \{ class: 'dot bad' \}\), 'Reconnecting…'\) : null/);
  assert.match(body, /device\$\{S\.zones\.length === 1 \? '' : 's'\} online/); assert.match(body, /Playing on /);
  assert.match(m, /setConn\(true, 'Connected'\)/, 'the top-right indicator keeps its text');
});

test('0.2.2 T9: Calibrate speakers offers "Use your phone as the microphone" (QR + short link, four steps, live Phone connected / waiting)', async () => {
  globalThis.window ??= globalThis; globalThis.navigator ??= { userAgent: 'node' };
  const c = src('calibrate.js'), m = src('main.js'), t = src('tls-setup.js');
  assert.match(c, /export const PHONE_STEPS = \['Scan the QR code with your phone\.', 'If asked, install the WavWiz certificate \(one time\)\.', 'Allow the microphone\.', 'Stand at the listening spot and follow the prompts \(music pauses automatically\)\.'\]/);
  assert.match(c, /h\('h3', null, 'Use your phone as the microphone'\)/);
  assert.match(c, /src: `\/api\/v1\/calibration\/phone-link\/\$\{link\.token\}\/qr\.svg`/);
  assert.match(c, /window\.addEventListener\('wavwiz:calphone', onPush\)/);
  assert.match(c, /const admin = isAdmin\(S\) \|\| !!opts\.linkAdmin/); assert.match(c, /linkToken: opts\.link/);
  const cal = await imp('calibrate');
  assert.deepEqual(cal.phoneStatusText(null), ['wait', 'Waiting for your phone…']);
  assert.deepEqual(cal.phoneStatusText({ connected: true, state: 'opened', device: 'iPhone' }), ['ok', 'Phone connected: iPhone - follow the prompts on the phone']);
  assert.deepEqual(cal.phoneStatusText({ connected: false, state: 'left', device: 'iPhone' }), ['wait', 'iPhone left. Waiting for your phone…']);
  assert.equal(cal.phoneStatusText({ expired: true })[0], 'bad');
  assert.match(m, /if \(CAL\.cal\) startPhoneCal\(CAL\.cal\); else maybeWhatsNew\(S\)/);
  assert.match(m, /api\('\/auth\/pair', \{ method: 'POST', body: \{ code: CAL\.pair, name: deviceName\(\) \} \}\)/);
  assert.match(m, /m\.type === 'calphone'/);
  assert.match(t, /setTimeout\(\(\) => location\.replace\(secureHome\(\)\), 900\)/);
  assert.match(css, /\.pm-status \.dot\.ok\{/);
});

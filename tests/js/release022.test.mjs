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

// 0.2.2 T3 (Play-centered strip + song block in the Playlist bar) was replaced by 0.2.3 U1/U2 - see release023.test.mjs.

test('0.2.2 T5: Devices header is a true mirror of Library; one arrow rule (Expanded -> normal -> collapsed); same labels; accent title', async () => {
  const d = await imp('devices');
  assert.equal(d.arrowSize('expanded'), 'standard'); assert.equal(d.arrowSize('standard'), 'collapsed'); assert.equal(d.arrowSize('collapsed'), 'standard');
  assert.equal(d.expandSize('collapsed'), 'expanded');
  for (const w of ['Library', 'Devices']) {
    assert.equal(d.arrowLabel(w, 'collapsed'), `Open the ${w} panel`); assert.equal(d.arrowLabel(w, 'standard'), `Collapse the ${w} panel`);
    assert.equal(d.arrowLabel(w, 'expanded'), 'Back to the normal layout'); assert.equal(d.expandLabel(w, false), `Expand the ${w} panel`);
  }
  const s = src('devices.js'), m = src('main.js');
  assert.match(s, /h\('div', \{ class: 'pane-h devhead' \}, expBtn, colBtn, escHint, h\('span', \{ class: 'grow devtitle' \}\), count, h\('span', \{ class: 'devtitle' \}, 'DEVICES'\)\)/);   // 0.2.3 U7: title at the right edge
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
  assert.match(ap, /prev = eqArea\(\{ style: p\.style, gains: gains\(\), glow: p\.glow, interactive: true, locked:/);   // 0.2.3 U10: the real EQ, locked by default
  assert.match(ap, /'Other styles'/); assert.match(ap, /min: 0, max: 100, step: 1, value: p\.glow/);
  assert.match(ap, /interactive: false/);
  // Now Playing keeps the F9 preview (0.2.3 U4: Display size has no preview any more - see release023)
  assert.match(ap, /preview \? preview\.el : null/);
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

test('0.2.2 T1: the Auto pre-gain badge sits on its own line under the hint, never over the Loudness switch', () => {
  const e = src('eq.js');
  assert.match(e, /h\('span', null, h\('b', null, lbl\), h\('span', \{ class: 'small dim' \}, hint\), extra \? h\('span', \{ class: 'eqsw-extra' \}, extra\) : null\)/);
  assert.match(e, /sw\('Auto pre-gain', 'Prevents clipping when boosting', \(\) => cur\.autoPreamp, v => \{ cur\.autoPreamp = v; \}, preGain\)/);
  assert.match(css, /\.eqsw-extra\{display:flex;margin-top:3px;min-width:0\}/); assert.match(css, /\.eqpregain\{white-space:nowrap;flex:none\}/);
});

test('0.2.2 T6: the Pepecoin logo in the Themes menu is about 20% smaller; still the official unedited file', () => {
  assert.match(css, /\.pepe-note \.pepe-logo\{--pw:160px;/);
  assert.doesNotMatch(css, /\.pepe-note \.pepe-logo\{--pw:200px;/);
  const th = src('themes.js');
  assert.match(th, /PEPE_LOGO = '\/assets\/pepecoin\/Pepecoin_onDark_RGB\.svg'/); assert.match(th, /t\.preset === 'pepecoin' \? pepeNote\(\) : null/);
});

test('0.2.2: What\'s new lists the 0.2.2 changes in US English; CHANGELOG has the 0.2.2 entry; TheAudioDB credited', () => {
  const a = src('about.js');
  assert.match(a, /WHATS_NEW_VERSION = '0\.2\.[2-9]'/);
  for (const t of ['Now Playing folds down to one line', 'Appearance in sections', 'Use your phone as the microphone', 'Devices works like the Library', 'More artist pictures', 'Smoother updates on Windows', 'Fixes']) assert.ok(a.includes(t), t);
  assert.doesNotMatch(a, /\b(colour|favourite|grey|centre|licence)\b/i);
  const cl = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(cl, /## \[0\.2\.2\] - 2026-10-10 \(beta\)/); assert.ok(cl.indexOf('## [0.2.2]') < cl.indexOf('## [0.2.1]'));
  const n = readFileSync(new URL('../../THIRD-PARTY-NOTICES.txt', import.meta.url), 'utf8');
  assert.match(n, /TheAudioDB \(https:\/\/www\.theaudiodb\.com\/\)/); assert.match(n, /Wikidata \/ Wikimedia Commons/);
});

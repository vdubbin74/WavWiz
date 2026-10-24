// WavWiz 0.2.0: every browser is a speaker (1), safe start (3), Getting started (11/24), no phone page (2), admin elevation (31), key migration (12).
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

const UA = {
  lg: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.128 Safari/537.36 WebAppManager',
  samsung: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36',
  fire: 'Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7633) AppleWebKit/537.36 (KHTML, like Gecko) Silk/112 like Chrome/112 Safari/537.36',
  bravia: 'Mozilla/5.0 (Linux; Android 10; BRAVIA 4K VH2 Build/QTG3.200305.006.S292) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108 Mobile Safari/537.36',
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  pixel: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  player: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0 WavWizPlayer/0.2.0',
};

test('0.2.0 item 1: TVs are detected, every browser auto-joins except the Player window, and speakers get readable names', async () => {
  const pj = await imp('phonejoin');
  for (const k of ['lg', 'samsung', 'fire', 'bravia']) assert.equal(pj.isTvUa(UA[k]), true, k);
  for (const k of ['chromeWin', 'edge', 'firefoxMac', 'iphone', 'pixel']) assert.equal(pj.isTvUa(UA[k]), false, k);
  assert.equal(pj.isPhoneUa(UA.bravia, 0), false);                    // an Android TV is a TV, not a phone
  for (const k of ['lg', 'chromeWin', 'edge', 'firefoxMac', 'iphone']) assert.equal(pj.wantsAutoJoin(null, false, UA[k]), true, k);
  assert.equal(pj.wantsAutoJoin('0', true, UA.chromeWin), false);    // switched off on this browser
  assert.equal(pj.wantsAutoJoin(null, true, UA.player), false);       // the Player window already plays through Windows
  assert.equal(pj.deviceName(UA.lg), 'LG TV browser');
  assert.equal(pj.deviceName(UA.samsung), 'Samsung TV browser');
  assert.equal(pj.deviceName(UA.fire), 'Fire TV browser');
  assert.equal(pj.deviceName(UA.chromeWin), 'Chrome on Windows');
  assert.equal(pj.deviceName(UA.edge), 'Edge on Windows');
  assert.equal(pj.deviceName(UA.firefoxMac, 0), 'Firefox on Mac');
  assert.equal(pj.deviceName(UA.iphone), 'iPhone');
  assert.equal(pj.deviceName(UA.pixel), 'Android phone');
  const r = src('room.js');
  assert.match(r, /export function installAutoJoin/); assert.match(r, /if \(isPlayerUa\(\)\) return;/);
  assert.match(r, /Press OK to start sound/);                          // TV remote OK unlocks audio (keydown is a gesture)
  assert.match(r, /'touchend', 'click', 'pointerup', 'keydown'/);
});

test('0.2.0 item 1: TV / lite mode and D-pad focus movement', async () => {
  const tv = await imp('tv');
  assert.equal(tv.tvMode('', UA.lg), true); assert.equal(tv.tvMode('?lite', UA.chromeWin), true); assert.equal(tv.tvMode('', UA.chromeWin), false); assert.equal(tv.tvMode('?tv=0', UA.lg), false);
  const a = { x: 0, y: 0, w: 50, h: 50 }, right = { x: 100, y: 0, w: 50, h: 50 }, below = { x: 0, y: 100, w: 50, h: 50 }, farRight = { x: 300, y: 10, w: 50, h: 50 };
  assert.equal(tv.nextFocus(a, [a, right, below, farRight], 'right'), right);
  assert.equal(tv.nextFocus(a, [a, right, below], 'down'), below);
  assert.equal(tv.nextFocus(a, [a, right, below], 'left'), null);
  assert.match(css, /html\.tv \.libpanel,html\.tv \.devpanel,html\.tv \.listpanel/); assert.match(css, /html\.tv :focus-visible/);
});

test('0.2.0 item 3: ?lite / ?viz=off never start WebGL, TVs default off, Auto starts Low on TVs, the stall watchdog goes Low then Off', async () => {
  const vc = await imp('vizcore');
  assert.equal(vc.safeStart({ search: '?lite' }).forceOff, true); assert.equal(vc.safeStart({ search: '?viz=off' }).forceOff, true); assert.equal(vc.safeStart({ search: '?lite=0' }).forceOff, false);
  assert.equal(vc.safeStart({ tv: true }).defaultOn, false); assert.equal(vc.safeStart({ tv: true, storedOn: true }).defaultOn, true); assert.equal(vc.safeStart({ tv: false }).defaultOn, true);
  assert.equal(vc.safeStart({ search: '?lite', storedOn: true }).defaultOn, false);
  assert.equal(vc.startsLow({ tv: true, renderer: 'ANGLE (NVIDIA RTX 4090)' }), true); assert.equal(vc.startsLow({ renderer: '' }), true); assert.equal(vc.startsLow({ renderer: 'ANGLE (NVIDIA RTX 4090)' }), false);
  // smooth frames: nothing happens
  let w = new vc.StallWatchdog({ startTier: 'high' }); let steps = []; for (let i = 0; i < 600; i++) { const s = w.push(16.7); if (s) steps.push(s); } assert.deepEqual(steps, []);
  // a forced stall: Low first, then Off
  w = new vc.StallWatchdog({ startTier: 'high' }); steps = []; for (let i = 0; i < 60; i++) { const s = w.push(200); if (s) steps.push(s); } assert.deepEqual(steps, ['low', 'off']);
  // already at Low: straight to Off
  w = new vc.StallWatchdog({ startTier: 'low' }); steps = []; for (let i = 0; i < 20; i++) { const s = w.push(200); if (s) steps.push(s); } assert.deepEqual(steps, ['off']);
  // a single hiccup in a good second is not a stall; after the watch period nothing more is reported
  w = new vc.StallWatchdog({ startTier: 'high', watchMs: 3000 }); steps = []; for (let i = 0; i < 59; i++) w.push(16.7); w.push(300); for (let i = 0; i < 1000; i++) { const s = w.push(i > 300 ? 200 : 16.7); if (s) steps.push(s); } assert.deepEqual(steps, []);
  const v = src('viz.js');
  assert.match(v, /await whenInteractive\(\)/); assert.match(v, /vizPrefs\(\)\.forced/); assert.match(v, /useFallback\('too slow on this device'\)/);
  assert.ok(v.indexOf('await whenInteractive()') < v.indexOf('this.useEngine(this.engine); feedSub'), 'WebGL (useEngine) only after the page is interactive');
});

test('0.2.0 items 11 + 24 + 2: Help > Getting started opens the Getting started dialog; first run opens it once; no phone page', async () => {
  const m = src('menu.js');
  assert.match(m, /\['Getting started', \(\) => \(ctl\.openSetup \? ctl\.openSetup\(true\)/); assert.match(m, /\['Diagnostics', \(\) => go\('diag'\)\]/);
  assert.doesNotMatch(m, /go\('phone'\)/);
  const main = src('main.js'); assert.doesNotMatch(main, /views\.phone|roomView/); assert.match(main, /maybeAutoSetup/); assert.match(main, /gettingStartedBody/);
  globalThis.localStorage = memStore();
  const d = await imp('diag');
  assert.equal(d.shouldAutoOpenSetup({ done: false, dismissed: false }, false, false), true);
  assert.equal(d.shouldAutoOpenSetup({ done: false, dismissed: false }, false, true), false);    // only the first time on this browser
  assert.equal(d.shouldAutoOpenSetup({ done: true, dismissed: false }, false, false), false);
  assert.equal(d.shouldAutoOpenSetup({ done: false, dismissed: true }, false, false), false);
  const g = src('diag.js'); assert.match(g, /Pick a music folder/); assert.match(g, /Check that a speaker shows up in Devices/); assert.match(g, /Play a test song or a test sound/);
  assert.match(g, /An administrator adds music folders/);                                    // read-only guidance for non-admins
});

test('0.2.0 item 12: unison.* keys move to wavwiz.* once (checklist, web speaker, theme, visualizer)', async () => {
  const st = memStore(); globalThis.localStorage = st;
  st.setItem('unison.checklist.dismissed', '1');
  const d = await imp('diag'); assert.equal(d.checklistDismissedLocal(), true); assert.equal(st.getItem('wavwiz.checklist.dismissed'), '1'); assert.equal(st.getItem('unison.checklist.dismissed'), null);
  const pj = await imp('phonejoin');
  st.setItem('unison.webRoom.id', 'web-abc'); assert.equal(pj.migrateKey(st, 'unison.webRoom.id', 'wavwiz.webRoom.id'), 'web-abc'); assert.equal(st.getItem('wavwiz.webRoom.id'), 'web-abc');
  st.setItem('unison.webRoom.id', 'web-old'); assert.equal(pj.migrateKey(st, 'unison.webRoom.id', 'wavwiz.webRoom.id'), 'web-abc');   // new key wins
  assert.match(src('theme.js'), /'wavwiz\.theme\.v1'/); assert.match(src('viz.js'), /'wavwiz\.viz\.v1'/); assert.match(src('room.js'), /'wavwiz\.webRoom\.id'/);
  for (const f of ['main.js', 'now.js', 'devices.js', 'settings.js']) assert.doesNotMatch(src(f), /'unison\./, f);
});

test('0.2.0 item 31 + 28: File > Sign in as admin… / Leave admin mode, Admin chip, admin-only menu items read-only (never hidden)', () => {
  const m = src('menu.js');
  assert.match(m, /\['Sign in as admin…', \(\) => signInAsAdmin\(S\), null, \(\) => admin\(\)\]/); assert.match(m, /\['Leave admin mode', \(\) => leaveAdmin\(S\), null, \(\) => !S\.auth\?\.elevated\]/);
  assert.match(m, /disabled: !!dis\?\.\(\)/); assert.doesNotMatch(m, /if \(dis\?\.\(\)\) return null;/);
  const e = src('elevate.js'); assert.match(e, /'\/auth\/elevate'/); assert.match(e, /'\/auth\/leave-admin'/); assert.match(e, /'wavwiz:auth'/); assert.doesNotMatch(e, /location\.reload/);
  assert.match(src('main.js'), /adminChip\(S\)/);
});

test('0.2.0 items 10 + 26 + 27 + 28 + 30: three Devices sizes, master on top, mute per speaker, output line + per-output delay 0-1000, read-only rules, reference badge', async () => {
  const d = await imp('devices');
  assert.deepEqual(d.SIZES, ['collapsed', 'standard', 'expanded']);   // 0.2.1 F1: no cycling any more (see release021 F1)
  const st = memStore(); assert.equal(d.loadDevSize(st), 'standard'); st.setItem('wavwiz.devcollapsed', '1'); assert.equal(d.loadDevSize(st), 'collapsed');   // 0.1.x flag carries over
  d.saveDevSize('expanded', st); assert.equal(d.loadDevSize(st), 'expanded');
  assert.equal(d.outputLabel({ kind: 'hdmi', name: 'LG TV' }), 'HDMI · LG TV'); assert.equal(d.outputLabel({ kind: 'spdif', name: '' }), 'Optical (TOSLINK)'); assert.equal(d.outputLabel({ kind: 'analog', name: 'Realtek' }), 'Speakers (Realtek)');
  const o = (id, extra = {}) => ({ deviceId: id, endpointDbId: id.length, kind: 'analog', name: id, connected: true, active: false, latencyMs: 0, notCalibrated: true, ...extra });
  assert.equal(d.showOutputLine({ outputs: [o('a', { active: true })] }), false);                              // single output: no line
  assert.equal(d.showOutputLine({ outputs: [o('a', { active: true }), o('bb')] }), true);
  assert.equal(d.showOutputLine({ outputs: [o('a')], outputUnavailable: true }), true);                        // chosen output gone: amber line
  assert.equal(d.chosenOutput({ outputs: [o('a', { connected: false }), o('bb')], chosenDeviceId: 'a' }).deviceId, 'a');   // never silently the other one
  assert.equal(d.masterLevel([{ enabled: true, volume: 40 }, { enabled: true, volume: 70 }, { enabled: false, volume: 100 }]), 70);   // off speakers skipped
  const s = src('devices.js');
  assert.match(s, /'MASTER', h\('span', \{ class: 'mvword' \}, ' VOLUME'\)/);   // 0.3.3 G10: one-line "MASTER" in the slim panel assert.match(s, /'\/zones\/master', \{ set:/); assert.match(s, /mutebtn/);
  assert.match(s, /latencyControl\(\{ label: `\$\{z\.name\} delay`/); /* 0.2.5: the delay slider moved into Settings (approved render v2) */ assert.match(s, /Output unavailable/); assert.match(s, /'\/calibration\/reference', \{ method: 'PUT'/);
  assert.match(s, /k: 'ref', text: 'REF'/); /* 0.2.5 tag (render v2) */ assert.match(s, /Set as reference/); assert.match(s, /canTune\(S, z\)/); assert.match(s, /Forget device…/); assert.match(s, /'Rename'/); /* 0.3.5 J9 #3: inline rename */
  assert.doesNotMatch(s, /can \? h\('button'/, 'no control is hidden because of the role');
  const ui = await imp('ui');
  const S = { auth: { role: 'control' }, zones: [{ id: 1, playerId: 'web-1', connected: true, mine: true }, { id: 2, playerId: 'pc', connected: true, mine: false }] };
  assert.equal(ui.canTune(S, S.zones[0]), true); assert.equal(ui.canTune(S, S.zones[1]), false); assert.equal(ui.canTune({ auth: { role: 'admin' } }, S.zones[1]), true);
  assert.equal(ui.thisDevice(S, 'web-1').id, 1); assert.equal(ui.thisDevice({ zones: [{ id: 5, playerId: 'pc', connected: true, mine: true }] }, 'web-x').id, 5);
  const m = src('main.js'); assert.match(m, /function setDevSize/); assert.match(m, /devexpanded/); assert.match(css, /\.desk\.devexpanded\{/); assert.match(css, /\.dcard\.hl\{/);
});

test('0.2.0 item 9: the panel volume and Mute are this device only; chips are status only with +N; master left the panel', () => {
  const n = src('now.js');
  assert.doesNotMatch(n, /'Master volume'/); assert.doesNotMatch(n, /'\/zones\/master'/);
  assert.match(n, /act\(`\/zones\/\$\{z\.id\}`, \{ volume: v \}, 'PATCH'\)/); assert.match(n, /\{ muted: z\.muted \}/);
  // 0.2.1 F11 supersedes the header chips / "This device muted" tag: no device status in the panel at all (the Mute button shows its own state)
  assert.doesNotMatch(n, /np-spk|CHIP_MAX|This device muted/);
  assert.match(n, /class: 'npbar'/);
});

test('0.2.0 item 29: calibration ends its session (music resumes), re-syncs before every recording, walk pause with Wi-Fi meter', async () => {
  const c = src('calibrate.js');
  assert.match(c, /\/calibration\/sessions\/\$\{id\}\/end/); assert.match(c, /cleanup = \(\) => \{[^\n]*endSession\(\)/);
  // 0.2.5: the phone measures on its own mic-only page from the listening spot (no walk pauses); it still re-syncs the clock before every recording
  const mp = src('calmic.js'); assert.match(mp, /try \{ off = await syncClock\(\); \}/); assert.match(mp, /for \(const r of (steps|g\.steps)\)/ /* 0.3.1 B3: grouped per speaker */);
  assert.match(c, /mode: 'ear'/); assert.match(c, /max: 1000, step: 1/);
  const ce = await imp('calerrors');
  assert.equal(ce.wifiStability([5, 6, 5, 7, 6, 5]).stable, true); assert.equal(ce.wifiStability([5, 300, 20, 900, 40, 5]).stable, false); assert.equal(ce.wifiStability([5, 5]).stable, false);
  assert.equal(ce.wifiStability([5, 6, 1500, 5, 6, 5]).level, 1);
  assert.match(ce.describe('WIFI_UNSTABLE').title, /Wi-Fi/); assert.doesNotMatch(ce.describe('SESSION_FAILED').fix.join(' '), /playing is stopped/);
});

test('0.2.0 item 8: four panel styles, Classic default, per-browser, effects 50 % default / 100 % max, master scales them', async () => {
  const m = await imp('npstyle');
  assert.deepEqual(m.NP_STYLES.map(s => s[0]), ['classic', 'center', 'stack', 'horizon']);
  const st = memStore();
  assert.deepEqual(m.loadNpPrefs(st), { style: 'classic', fx: 50, glow: 50, motion: 50, reflect: 50 });
  m.saveNpPrefs({ style: 'stack', glow: 140, motion: -3 }, st);
  const p = m.loadNpPrefs(st); assert.equal(p.style, 'stack'); assert.equal(p.glow, 100); assert.equal(p.motion, 0); assert.equal(p.fx, 50);
  assert.equal(m.normNpPrefs({ style: 'terrain' }).style, 'classic');
  assert.equal(m.effectLevel({ fx: 50, glow: 50 }, 'glow'), 0.5);
  assert.equal(m.effectLevel({ fx: 0, glow: 100 }, 'glow'), 0);
  assert.equal(m.effectLevel({ fx: 100, glow: 100 }, 'glow'), 1);
  assert.equal(m.npVars(null)['--fx-reflect'], '0.500');
  assert.deepEqual(m.waveBars('a', 10), m.waveBars('a', 10)); assert.ok(m.waveBars('a').every(v => v >= 0.2 && v <= 1));
  assert.ok(Math.abs(m.ringFrac(0, 0, 10, 0) - 0.25) < 1e-9); assert.ok(Math.abs(m.ringFrac(0, 0, 0, 10) - 0.5) < 1e-9);
  const s = src('appearance.js'); assert.match(s, /np = npStyleCard\(/); assert.match(s, /disp = displaySizeCard\(\)/); assert.match(s, /'Panel effects'/);      // 0.2.1 F8: moved to appearance.js
  for (const k of ['.pn-classic', '.pn-center', '.pn-stack', '.pn-horizon', '--fx-glow']) assert.ok(css.includes(k), k);
  assert.match(src('now.js'), /pnArt, tableMeta/);
});

test('0.2.0 items 4-7: ten presets with the agreed hexes, four-color custom, old three-color saves migrate, Pepecoin polish', async () => {
  const theme = await imp('theme');
  const want = { default: ['#FF3C00', '#19C3B1', '#14171A', '#E8EDF0'], pepecoin: ['#269B4D', '#208241', '#212121', '#FFFFFF'], ember: ['#FF5A1F', '#FFB347', '#160E0A', '#E8EDF0'], arctic: ['#3BA7FF', '#A8E6FF', '#0B1218', '#E8EDF0'], violet: ['#A855F7', '#C084FC', '#1A1028', '#F5F3FF'], mono: ['#E8EDF0', '#9AA6AE', '#0E1012', '#E8EDF0'],
    daylight: ['#E03500', '#0E8F82', '#F3F1EE', '#1A1D21'], nebula: ['#8B5CF6', '#2DD4BF', '#0F0B1A', '#EDE9FE'], steel: ['#A9BCCF', '#5F7488', '#18202A', '#E3EAF2'], lime: ['#A3E635', '#22D3EE', '#0B120E', '#ECFCCB'] };
  assert.deepEqual(Object.keys(theme.PRESETS), Object.keys(want));
  for (const [id, [a, a2, bg, ink]] of Object.entries(want)) assert.deepEqual([theme.PRESETS[id].accent, theme.PRESETS[id].accent2, theme.PRESETS[id].bg, theme.PRESETS[id].ink], [a, a2, bg, ink], id);
  assert.equal(theme.PRESETS.steel.name, 'Blue Steel');
  const st = memStore(); globalThis.localStorage = st;
  try {
    st.setItem('wavwiz.theme.v1', JSON.stringify({ accent: '#112233', accent2: '#AABBCC', bg: '#000000', ink: '#FFFFFF', preset: 'custom' }));   // 0.1.x save: second was derived
    const t = theme.loadTheme(); assert.equal(t.accent2, theme.companionAccent('#112233'));
    assert.equal(JSON.parse(st.getItem('wavwiz.theme.v1')).v, 4, 'migrated once');
    theme.saveTheme({ ...t, accent2: '#123456' }); assert.equal(theme.loadTheme().accent2, '#123456', 'second is stored, not derived');
    st.setItem('wavwiz.theme.v1', JSON.stringify({ accent: '#A9BCCF', bg: '#18202A', preset: 'steel' })); assert.equal(theme.loadTheme().preset, 'steel');
  } finally { delete globalThis.localStorage; }
  const tv = src('themes.js'); for (const l of ['Background', 'Main', 'Second', 'Text']) assert.match(tv, new RegExp(`'${l}'`));
  assert.match(tv, /pepeNote/);   // 0.2.1 F14/F20: copper is now the official Pepecoin Highlight; the note shows the kit's onDark logo (see release021) assert.match(tv, /not affiliated/);
  assert.match(css, /@media \(max-width:420px\)\{ \.pepe-note\{flex-direction:column/);
});

test('0.2.0 items 13-16: sort on every tab + flip + letter strip, remembered per tab; grid/list and Expanded remembered', async () => {
  const m = await imp('libsort');
  for (const k of ['artists', 'albums', 'genres', 'years', 'recent', 'folders', 'favorites', 'songs']) assert.ok(m.SORTS[k]?.length >= 2, k);
  assert.deepEqual(m.SORTS.artists.map(s => s[0]), ['name', 'albums', 'songs', 'recent']);
  for (const k of ['oldest', 'longest', 'shuffle', 'artist', 'name', 'year', 'recent']) assert.ok(m.SORTS.albums.some(s => s[0] === k), k);
  assert.deepEqual(m.SORTS.songs.map(s => s[0]), ['track', 'title', 'length', 'added']);
  const st = memStore(); const p = m.loadLibPrefs(st);
  assert.equal(p.sort.albums, 'artist'); assert.equal(p.compactView, 'list'); assert.equal(p.expanded, false);   // 0.2.1 F4: view -> compactView + per-tab views
  p.sort.artists = 'songs'; p.flip.artists = true; p.compactView = 'grid'; p.expanded = true; m.saveLibPrefs(p, st);
  const q = m.loadLibPrefs(st); assert.equal(q.sort.artists, 'songs'); assert.equal(q.flip.artists, true); assert.equal(q.flip.albums, false); assert.equal(q.compactView, 'grid'); assert.equal(q.expanded, true);
  const artists = [{ name: 'beta', albums: 1, tracks: 9, addedAt: '2026-01-02' }, { name: 'Alpha', albums: 3, tracks: 2, addedAt: '2026-03-01' }, { name: '10cc', albums: 2, tracks: 5, addedAt: '2025-01-01' }];
  assert.deepEqual(m.sortRows('artists', artists, 'name').map(a => a.name), ['10cc', 'Alpha', 'beta']);
  assert.deepEqual(m.sortRows('artists', artists, 'name', true).map(a => a.name), ['beta', 'Alpha', '10cc']);
  assert.deepEqual(m.sortRows('artists', artists, 'albums').map(a => a.name), ['Alpha', '10cc', 'beta']);
  assert.deepEqual(m.sortRows('artists', artists, 'songs').map(a => a.name), ['beta', '10cc', 'Alpha']);
  assert.deepEqual(m.sortRows('artists', artists, 'recent').map(a => a.name), ['Alpha', 'beta', '10cc']);
  const albums = [{ artist: 'B', album: 'x', year: 2001, durationMs: 5 }, { artist: 'A', album: 'y', year: 1990, durationMs: 9 }, { artist: 'C', album: 'w', durationMs: 1 }];
  assert.deepEqual(m.sortRows('albums', albums, 'oldest').map(a => a.album), ['y', 'x', 'w']);
  assert.deepEqual(m.sortRows('albums', albums, 'longest').map(a => a.album), ['y', 'x', 'w']);
  assert.deepEqual(m.sortRows('albums', albums, 'shuffle', false, 42), m.sortRows('albums', albums, 'shuffle', false, 42));
  const songs = [{ id: 5, title: 'b', trackNo: 2, durationMs: 1 }, { id: 9, title: 'a', trackNo: 1, durationMs: 3 }];
  assert.deepEqual(m.sortRows('songs', songs, 'track').map(s => s.id), [9, 5]); assert.deepEqual(m.sortRows('songs', songs, 'added').map(s => s.id), [9, 5]);
  assert.equal(m.letterOf('Émile'), 'E'); assert.equal(m.letterOf('10cc'), '#');
  assert.deepEqual([...m.letterIndex('artists', m.sortRows('artists', artists, 'name'), 'name')], [['#', 0], ['A', 1], ['B', 2]]);
  assert.ok(m.isLetterSort('albums', 'artist') && !m.isLetterSort('albums', 'year') && !m.isLetterSort('years', 'name'));
  const lib = src('library.js');
  assert.match(lib, /\['favorites', '♥ Favorites'\]/); assert.match(lib, /heartBtn\(S, 'track'/); assert.match(lib, /heartBtn\(S, 'album'/); assert.match(lib, /setExpanded/);
  const main = src('main.js'); assert.match(main, /function toggleLibExpanded/); assert.match(main, /const n = keyAction\(P6, ev\)/);   // 0.3.0 §6: Esc / [ ] go through panels.js
  assert.match(css, /\.desk\.libexpanded\{--rightw:46px/); assert.match(css, /\.desk\.devexpanded \.npbar,\.desk\.libexpanded \.npbar\{display:flex\}/);
  assert.match(src('fav.js'), /Only Control or Admin access can change favorites/);
});

test('0.2.0 item 17: Spectrum replaces Terrain - in the picker, saved terrain migrates, effects 50 % default, no LED segments or peak caps', async () => {
  const vc = await imp('vizcore');
  assert.ok(vc.VIZ_LIST.some(([k, n]) => k === 'spectrum' && n === 'Spectrum')); assert.ok(!vc.VIZ_LIST.some(([k]) => k === 'terrain'));
  assert.equal(vc.normEngine('terrain'), 'spectrum'); assert.equal(vc.normEngine('lightning'), 'geq');
  assert.deepEqual(vc.FX.spectrum.map(d => d[0]), ['bars', 'height', 'smooth', 'reflect', 'glow', 'direction']);
  const d = vc.cleanSettings({}, 'spectrum'); for (const k of ['bars', 'height', 'smooth', 'reflect', 'glow']) assert.equal(d.fx[k], 50, k); assert.equal(d.fx.direction, 'ltr');
  assert.equal(vc.pmap(50, vc.FX.spectrum[0][2]), 64);
  const g = src('vizgl.js'); const body = g.slice(g.indexOf('class SpectrumScene'), g.indexOf('class GeqScene'));
  assert.match(g, /spectrum: SpectrumScene/); assert.doesNotMatch(g, /class TerrainScene/);
  assert.doesNotMatch(body, /this\.cap|segN|fxv\('(segments|caps)'/);
  assert.match(src('about.js'), /WHATS_NEW_VERSION = '0\.(2\.[2-9]|[34]\.\d)'/);   // 0.2.2: What's new lists the 0.2.2 changes (the Terrain note was 0.2.0's)
});

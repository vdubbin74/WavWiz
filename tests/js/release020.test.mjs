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

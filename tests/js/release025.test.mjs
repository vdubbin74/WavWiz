// WavWiz 0.2.5: calibration that works on a real iPhone (mic-only phone page, mic FIRST, play-and-record), the PC-mic way, the phone role,
// and the device cards of the approved render v2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
const html = n => readFileSync(new URL('../../src/WavWiz.Server/wwwroot/' + n, import.meta.url), 'utf8');
const css = readFileSync(join(js, '../app.css'), 'utf8');
globalThis.Element ??= class {};
const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

/** A fake Safari: getUserMedia fails with the real iOS error when the audio session is playback-only or an AudioContext already exists. */
function fakeSafari({ session = true, overconstrained = false } = {}) {
  const events = []; let ctxs = 0;
  const audioSession = session ? { _t: 'auto', get type() { return this._t; }, set type(v) { events.push('session:' + v); this._t = v; } } : undefined;
  const track = { label: 'iPhone Microphone', getSettings: () => ({ echoCancellation: false, noiseSuppression: false, autoGainControl: false }) };
  const nav = { audioSession, mediaDevices: { async getUserMedia(c) {
    events.push('gum' + (c.audio === true ? ':default' : ':raw'));
    if (audioSession && audioSession.type === 'playback') throw Object.assign(new Error('AudioSession category is not compatible with audio capture'), { name: 'InvalidStateError' });
    if (ctxs) throw Object.assign(new Error('AudioSession category is not compatible with audio capture'), { name: 'InvalidStateError' });
    if (overconstrained && c.audio !== true) throw Object.assign(new Error('x'), { name: 'OverconstrainedError' });
    return { getAudioTracks: () => [track] };
  } } };
  class AC { constructor() { ctxs++; events.push('ctx'); this.state = 'suspended'; } async resume() { this.state = 'running'; } }
  return { nav, win: { AudioContext: AC }, events };
}

test('0.2.5 A: the phone page asks for the mic FIRST - audio session play-and-record, then getUserMedia, then a capture-only AudioContext', async () => {
  const c = await imp('calmic-core');
  const f = fakeSafari(); const r = await c.openMicFirst({ nav: f.nav, win: f.win });
  assert.deepEqual(f.events, ['session:play-and-record', 'gum:raw', 'ctx']);
  assert.equal(r.rawOk, true); assert.equal(r.ctx.state, 'running'); assert.equal(r.label, 'iPhone Microphone');
  const g = fakeSafari({ session: false }); await c.openMicFirst({ nav: g.nav, win: g.win }); assert.deepEqual(g.events, ['gum:raw', 'ctx']);   // Android / older iOS
  const o = fakeSafari({ overconstrained: true }); const ro = await c.openMicFirst({ nav: o.nav, win: o.win });
  assert.deepEqual(o.events, ['session:play-and-record', 'gum:raw', 'gum:default', 'ctx']); assert.equal(ro.rawOk, false);
  // the 0.2.4 order (playback session + AudioContext first) reproduces the iPhone error
  const bad = fakeSafari(); bad.nav.audioSession.type = 'playback'; new bad.win.AudioContext();
  await assert.rejects(bad.nav.mediaDevices.getUserMedia({ audio: true }), /AudioSession category is not compatible/);
});

test('0.2.5 A: the phone page never joins as a speaker and never plays', () => {
  const p = src('calmic.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/ \/\/ [^'`\n]*$/gm, '');
  // the only node ever wired to the output is the ScriptProcessor fallback's zero-gain sink (old WebKit only runs a ScriptProcessor that way); silent
  assert.match(p, /mute\.gain\.value = 0/);
  assert.doesNotMatch(p.replace('mute.connect(c.destination)', ''), /from '\.\/room\.js'|joinRoom|\/ws\/room|\.play\(\)|createOscillator|createBufferSource|\.destination\b/);
  assert.match(p, /openMicFirst\(/); assert.match(p, /numberOfOutputs: 0/); assert.match(p, /\/ws\/clock\?cal=/);
  assert.match(p, /'X-WavWiz-Cal'/);
  const i = html('index.html'); assert.ok(i.indexOf('calredirect.js') > 0 && i.indexOf('calredirect.js') < i.indexOf('bootguard'), 'the redirect runs before the app modules');
  assert.match(src('calredirect.js'), /location\.replace\('\/calmic\.html\?/);
  assert.doesNotMatch(html('calmic.html'), /main\.js|room\.js/);
});

test('0.2.5 A: plan, code and page mode (pure)', async () => {
  const c = await imp('calmic-core');
  const plan = c.buildPlan({ quality: 'thorough', reference: { id: 1, name: 'Living Room' }, speakers: [{ id: 1, name: 'Living Room' }, { id: 2, name: 'Kitchen' }, { id: 3, name: 'Patio' }] });
  assert.deepEqual(plan.map(s => s.kind + s.zone), ['ref1', 'ref1', 'ref1', 'dev2', 'dev2', 'dev2', 'dev3', 'dev3', 'dev3', 'ref-end1']);
  assert.deepEqual(c.buildPlan({ speakers: [] }), []);
  assert.equal(c.calCode('?cal=ab12cd'), 'AB12CD'); assert.equal(c.calCode('?cal=x'), null); assert.equal(c.calCode(''), null);
  assert.equal(c.pageMode({ protocol: 'http:', httpsEnabled: true, code: 'AB12CD' }), 'setup-phone');
  assert.equal(c.pageMode({ protocol: 'http:', httpsEnabled: false, code: 'AB12CD' }), 'needs-https');
  assert.equal(c.pageMode({ protocol: 'https:', httpsEnabled: true, code: 'AB12CD' }), 'ready');
  assert.equal(c.pageMode({ protocol: 'https:', httpsEnabled: true, code: null, signedIn: false }), 'no-code');
  assert.equal(c.phoneName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)'), 'iPhone'); assert.equal(c.phoneName('Linux; Android 14; Pixel 8 Mobile'), 'Android phone');
});

test('0.2.5 A: phone role - asked once, remembered per browser, changeable from the Devices menu', async () => {
  const c = await imp('calmic-core'); const st = memStore();
  assert.equal(c.phoneRole(st), null); c.setPhoneRole(st, 'mic'); assert.equal(c.phoneRole(st), 'mic'); c.setPhoneRole(st, 'speaker'); assert.equal(c.phoneRole(st), 'speaker');
  c.setPhoneRole(st, 'bogus'); assert.equal(c.phoneRole(st), null);
  const r = src('room.js'); assert.match(r, /Play music here/); assert.match(r, /Use as a calibration mic/); assert.match(r, /showModal\(\)/);
  assert.match(src('menu.js'), /'Phone role…'/);
});

test('0.2.5 A: PC mic - level meter, PC pick, Bluetooth warns but never blocks; the Calibrate screen order is PC mic, phone, by ear', async () => {
  const k = await imp('calibrate');
  assert.equal(k.micLevelPct(-60), 0); assert.equal(k.micLevelPct(0), 100); assert.equal(k.micLevelPct(-30), 50); assert.equal(k.micLevelPct(null), 0); assert.equal(k.micLevelPct(-120), 0);
  const pcs = [{ playerId: 'a', supportsMic: true, mics: [] }, { playerId: 'b', supportsMic: true, mics: [{ id: 1 }] }, { playerId: 'c', supportsMic: true, mine: true, mics: [{ id: 2 }] }, { playerId: 'd', supportsMic: false, mics: [{ id: 3 }] }];
  assert.equal(k.pickPc(pcs).playerId, 'c'); assert.equal(k.pickPc(pcs.slice(0, 2)).playerId, 'b'); assert.equal(k.pickPc([pcs[3]]), null); assert.equal(k.pickPc([]), null);
  const s = src('calibrate.js');
  assert.ok(s.includes('Bluetooth mics add their own delay, so results may be off. A wired or USB mic is recommended.'));
  assert.ok(s.indexOf('pcMicCard(') < s.indexOf('phoneMicCard(') || s.indexOf('pcMicCard(S') >= 0);
  const body = s.slice(s.indexOf('function openCalibration'));
  // 0.4.4 F22 may insert unlock/BT notes after speakersBox; order stays speakers → (notes) → PC mic → phone → by ear
  assert.match(body, /body\.replaceChildren\(speakersBox\(\), (?:unlockNote, btNote, )?pcCard\.el, usePhone \? phoneCard\.el : null, earCard,/, 'PC mic, then phone, then by ear');
  assert.ok(s.includes('No microphone found on this PC. Plug in a USB or headset mic (or use your phone instead).'));
});

test('0.2.5 B: device card tags (max 2), the one status line and the "Measured with …" note (pure)', async () => {
  const d = await imp('devices');
  const o = (x = {}) => ({ deviceId: 'd', endpointDbId: 1, kind: 'analog', name: 'Realtek', connected: true, active: true, latencyMs: 40, notCalibrated: false, ...x });
  const z = (x = {}) => ({ id: 1, name: 'Kitchen', connected: true, enabled: true, muted: false, reference: false, isWeb: false, outputs: [o()], room: { state: 'ok' }, ...x });
  const t = zz => d.cardTags(zz).map(x => x.text);
  assert.deepEqual(t(z()), ['ANALOG']);
  assert.deepEqual(t(z({ reference: true })), ['ANALOG', 'REF']);
  assert.deepEqual(t(z({ muted: true, outputs: [o({ notCalibrated: true })] })), ['ANALOG', 'MUTED', 'NO DELAY']);
  assert.deepEqual(t(z({ connected: false, reference: true, muted: true })), ['ANALOG', 'OFFLINE', 'REF'], 'type + never more than two');
  assert.deepEqual(t(z({ isWeb: true, name: 'Dana’s iPhone', outputs: [] })), ['SPEAKER']);
  assert.deepEqual(['hdmi', 'spdif', 'bluetooth', 'usb', 'other'].map(k => t(z({ outputs: [o({ kind: k })] }))[0]), ['HDMI', 'TOSLINK', 'BLUETOOTH', 'USB', undefined], '0.5.0 output type tag');
  for (const zz of [z(), z({ isWeb: true, name: 'Chrome on Windows' })]) assert.ok(!t(zz).some(x => /BROWSER|THIS DEVICE/.test(x)));
  assert.equal(d.statusLine(z()), 'Playing · Speakers (Realtek) · 40 ms');
  assert.equal(d.statusLine(z({ room: { state: 'idle' }, outputs: [o({ notCalibrated: true })] })), 'Not playing · Speakers (Realtek)');
  assert.equal(d.statusLine(z({ isWeb: true, name: 'Office browser' }), true), 'Playing · this browser · 40 ms');
  assert.doesNotMatch(d.statusLine(z({ muted: true })), /Muted/);
  const today = new Date(); today.setHours(18, 40, 0, 0);
  assert.equal(d.statusLine(z({ connected: false, lastSeen: today.toISOString() })), 'Last seen 6:40 PM · Speakers (Realtek) · 40 ms');
  const now = new Date(2026, 9, 11, 12);
  assert.equal(d.measuredNote(o({ measuredWith: 'mic:phone', measuredAt: new Date(2026, 9, 9, 20).toISOString() }), now), 'Measured with the phone mic · Oct 9');
  assert.equal(d.measuredNote(o({ measuredWith: 'mic:pc:usb', measuredAt: new Date(2026, 9, 9, 20).toISOString() }), now), 'Measured with a USB mic · Oct 9');
  assert.equal(d.measuredNote(o({ measuredWith: 'ear' }), now), 'Set by ear');
  assert.equal(d.measuredNote(o({ notCalibrated: true }), now), 'Not measured yet. Calibrate measures it.');
  assert.equal(d.micLineText({ device: 'Dana’s iPhone', label: 'connected · ready to measure' }), 'Dana’s iPhone · connected · ready to measure');
  assert.equal(d.deviceIconName(z()), 'monitor'); assert.equal(d.deviceIconName(z({ isWeb: true, name: 'Pixel phone' })), 'phone'); assert.equal(d.deviceIconName(z({ isWeb: true, name: 'Chrome' })), 'globe');
});

test('0.2.5 B: card layout per render v2 - mute on the right, one Settings chevron, Settings sections, mic line, admin-only stays visible read-only', () => {
  const d = src('devices.js');
  const card = d.slice(d.indexOf('function expandedCard('), d.indexOf('function standardRow('));
  assert.match(card, /h\('div', \{ class: 'dvol' \}, vol, pct, mute\)/, 'slider · % · round mute on the right');
  assert.equal((card.match(/settingsToggle\(/g) || []).length, 1);
  const set = d.slice(d.indexOf('function cardSettings('), d.indexOf('const connKey'));
  for (const t of ["sec('OUTPUT'", "sec('DELAY'", "'Test sound'", "'Sound / EQ'", "'More ▾'", "'Rename'", "'Set as reference'", "'Delay history'", "'Forget device…'"]) assert.ok(set.includes(t), t);
  assert.match(d, /'Stop using as mic'/); assert.match(d, /'Calibration mic'/);
  const row = d.slice(d.indexOf('function standardRow('), d.indexOf('// ---- 0.2.5: the "Calibration mic" line'));
  assert.doesNotMatch(row, /settingsToggle|cardSettings/, 'Standard rows have no Settings');
  assert.match(css, /\.dtag\{[^}]*border-radius:3px/); assert.match(css, /\.dtag\.ref\{/); assert.match(css, /\.dcard\.gone /); assert.match(css, /\.dmicline\{/);
  assert.match(src('icons.js'), /mic:/); assert.match(src('icons.js'), /globe:/);
});

test('0.2.5 C: Settings - Appearance sections are sub-tabs under the main tabs, full width; the dialog widens to ~1200 px', async () => {
  const ap = src('appearance.js'), st = src('settings.js');
  assert.match(ap, /h\('nav', \{ class: 'appnav subtabs', 'aria-label': 'Appearance sections' \},/);
  assert.match(ap, /class: 'appearance appstack' \}, nav, host\)/);
  assert.doesNotMatch(ap, /appsplit|appnav-h/);
  const a = await imp('appearance'); assert.deepEqual(a.APP_SUBS.map(x => x[1]), ['Theme', 'Visualizer', 'EQ', 'Now Playing']);   // 0.3.5 J2: Display size lives on the Theme page
  assert.match(st, /cls: 'settings-dlg'/);
  assert.match(css, /dialog\.settings-dlg\{width:min\(1200px,calc\(calc\(100vw \/ var\(--z,1\)\) - 32px\)\)\}/);
  assert.match(css, /\.appnav\.subtabs\{flex-direction:row/);
  assert.match(css, /\.appsub \.pinprev\{position:sticky/, 'previews stay pinned');
});

test('0.2.5 D: What\'s new puts the 0.2.5 items first and keeps the 0.2.4 ones; CHANGELOG has 0.2.5 above 0.2.4 with the iPhone root cause in words', async () => {
  const a = src('about.js');
  assert.match(a, /WHATS_NEW_VERSION = '0\.(2\.5|[34]\.\d)'/);
  const i25 = a.indexOf('Calibrate with your PC’s mic'), i24 = a.indexOf('Phone set-up page fixed');
  assert.ok(i25 > 0 && i24 > i25, '0.2.5 first, 0.2.4 kept');
  for (const x of ['iPhone calibration fixed', 'Phone: speaker or mic', 'Cleaner device cards', 'Wider Settings']) assert.ok(a.includes(x), x);
  const cl = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
  assert.ok(cl.indexOf('## [0.2.5]') > 0 && cl.indexOf('## [0.2.5]') < cl.indexOf('## [0.2.4]'));
  const sec = cl.slice(cl.indexOf('## [0.2.5]'), cl.indexOf('## [0.2.4]'));
  for (const x of ['AudioSession category is not compatible with audio capture', 'mic-only page', 'play-and-record', 'Bluetooth mics add their own delay, so results may be off. A wired or USB mic is recommended.', 'Phone role', 'about 1200 px']) assert.ok(sec.includes(x), x);
  assert.doesNotMatch(sec, /\b[UTF]\d+\b|Unison|colour|behaviour/);
});

test('device card More menu stays closed until More is tapped (display:flex must not override [hidden])', () => {
  assert.match(css, /\.dmenu\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(src('devices.js'), /class: 'dmenu'[^\n]*hidden: true|hidden: true[^\n]*class: 'dmenu'/);
});

test('0.4.1 D: Quick (the default) is one test per speaker, Thorough keeps three plus the drift check', async () => {
  const c = await imp('calmic-core');
  const plan = { reference: { id: 1, name: 'Den' }, speakers: [{ id: 1, name: 'Den' }, { id: 2, name: 'Kitchen' }] };
  const quick = c.buildPlan(plan); assert.deepEqual(quick.map(s => s.kind), ['ref', 'dev', 'ref-end']);
  assert.equal(c.buildPlan({ ...plan, quality: 'thorough' }).filter(s => s.kind === 'dev').length, 3);
});

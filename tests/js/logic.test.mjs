import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const imp = n => import(pathToFileURL(`${process.env.JS_DIR}/${n}.js`).href);
const roomsched = await imp('roomsched'), wire = await imp('wire'), cal = await imp('calerrors'), theme = await imp('theme');

// ---------------- roomsched
test('OffsetEstimator finds the true offset from NTP-style samples, ignores a slow outlier, needs 4 samples to be ready', () => {
  const e = new roomsched.OffsetEstimator(); const trueOff = 5_000_000;
  assert.equal(e.ready, false);
  for (let i = 0; i < 10; i++) { const t0 = i * 1e6, rtt = 4000 + (i % 3) * 300; e.add(t0, t0 + rtt / 2 + trueOff, t0 + rtt / 2 + trueOff + 50, t0 + rtt + 50); }
  assert.equal(e.ready, true); assert.ok(Math.abs(e.offsetUs - trueOff) < 300, `offset ${e.offsetUs}`);
  const before = e.offsetUs; e.add(20e6, 20e6 + 900_000 + trueOff, 20e6 + 900_050 + trueOff, 20e6 + 1_800_050);      // a 1.8 s round trip: asymmetric, must not move the estimate
  assert.ok(Math.abs(e.offsetUs - before) < 200);
  assert.equal(e.add(0, 0, 0, 5_000_000), false);   // absurd RTT rejected
  assert.equal(e.add(10, 5, 6, 4), false);          // negative RTT rejected
});
test('pairClocks picks the read with the least scheduling delay', () => {
  const p = roomsched.pairClocks([{ ctxSec: 1.000, perfMs: 5010 }, { ctxSec: 1.003, perfMs: 5006 }, { ctxSec: 1.006, perfMs: 5014 }]);
  assert.equal(p.ctxSec, 1.003); assert.equal(p.perfUs, 5006000); assert.throws(() => roomsched.pairClocks([]));
});
test('ctxTimeFor: later server time = later context time; the room delay starts the audio earlier; output latency too', () => {
  const o = { pair: { ctxSec: 10, perfUs: 2_000_000 }, offsetUs: 1_000_000_000 };
  const a = roomsched.ctxTimeFor(1_000_000_000 + 2_500_000, o), b = roomsched.ctxTimeFor(1_000_000_000 + 2_520_000, o);
  assert.ok(Math.abs(a - 10.5) < 1e-9); assert.ok(Math.abs(b - a - 0.02) < 1e-9);
  assert.ok(Math.abs(roomsched.ctxTimeFor(1_000_000_000 + 2_500_000, { ...o, latencyMs: 120 }) - (10.5 - 0.12)) < 1e-9);
  assert.ok(Math.abs(roomsched.ctxTimeFor(1_000_000_000 + 2_500_000, { ...o, outputLatencySec: 0.04 }) - 10.46) < 1e-9);
});
test('FrameScheduler chains frames, trims tiny errors with the rate, re-anchors big ones, drops hopelessly late frames, resets on a new epoch', () => {
  const s = new roomsched.FrameScheduler();
  let r = s.plan(10, 9.5, 1); assert.equal(r.action, 'play'); assert.equal(r.start, 10); assert.equal(r.rate, 1);
  r = s.plan(10.02, 9.5, 1); assert.equal(r.start, 10.02);
  r = s.plan(10.0405, 9.5, 1); assert.ok(r.rate < 1 && r.rate > 0.996, 'early by 0.5 ms: slow slightly'); assert.equal(s.stats.resyncs, 0);
  r = s.plan(11, 9.5, 1); assert.equal(s.stats.resyncs, 1); assert.equal(r.start, 11);
  r = s.plan(8, 9.5, 1); assert.equal(r.action, 'drop'); assert.equal(s.stats.dropped, 1);
  const s2 = new roomsched.FrameScheduler(); s2.plan(5, 4, 1); s2.plan(5.02, 4, 1); r = s2.plan(20, 4, 2); assert.equal(r.start, 20); assert.equal(s2.stats.resyncs, 0, 'new epoch is a fresh start, not a resync');
  const s3 = new roomsched.FrameScheduler(); r = s3.plan(10.0, 10.0 - 0.0, 1); assert.equal(r.action, 'play'); assert.ok(r.start >= 10.0);       // a few ms late: play now rather than drop
});
test('roomHealth gives a plain message for each state, in priority order', () => {
  const ok = { wsOpen: true, ctxState: 'running', hidden: false, bufferMs: 800, clockReady: true };
  assert.equal(roomsched.roomHealth(ok).state, 'ok');
  assert.equal(roomsched.roomHealth({ ...ok, wsOpen: false }).state, 'reconnecting');
  assert.equal(roomsched.roomHealth({ ...ok, ctxState: 'suspended' }).state, 'paused');
  assert.equal(roomsched.roomHealth({ ...ok, ctxState: 'interrupted' }).state, 'paused');
  assert.equal(roomsched.roomHealth({ ...ok, clockReady: false }).state, 'syncing');
  assert.equal(roomsched.roomHealth({ ...ok, hidden: true }).state, 'background');
  assert.equal(roomsched.roomHealth({ ...ok, bufferMs: 100 }).state, 'buffering');
});
test('volumeToGain matches the Windows player taper', () => {
  assert.equal(roomsched.volumeToGain(0), 0); assert.equal(roomsched.volumeToGain(100), 1); assert.equal(roomsched.volumeToGain(NaN), 0);
  assert.ok(Math.abs(roomsched.volumeToGain(90) - Math.pow(10, -5 / 20)) < 1e-12); assert.equal(roomsched.volumeToGain(500), 1);
});

// ---------------- wire
test('wire: JSON frame round trip, byte-exact header', () => {
  const f = wire.encodeJson(wire.MSG.Hello, 7, { playerId: 'web-1', name: 'Phone' });
  assert.deepEqual([...f.slice(0, 4)], [0x55, 0x4E, 0x53, 0x4E]); assert.equal(f[4], 1); assert.equal(f[5], 1);
  const [m] = new wire.FrameParser().push(f); assert.equal(m.type, 1); assert.equal(m.seq, 7); assert.deepEqual(wire.decodeJson(m.payload), { playerId: 'web-1', name: 'Phone' });
});
test('wire: audio round trip is exact to 24 bits, including negative samples and full scale', () => {
  const l = new Float32Array(960), r = new Float32Array(960); for (let i = 0; i < 960; i++) { l[i] = Math.sin(i / 7) * 0.9; r[i] = i % 2 ? -1 : 1; }
  const [m] = new wire.FrameParser().push(wire.encodeAudio(3, 123_456_789_012, 9, l, r)); const d = wire.decodeAudio(m.payload);
  assert.equal(d.count, 960); assert.equal(d.playAtUs, 123_456_789_012); assert.equal(d.epoch, 9);
  for (let i = 0; i < 960; i++) { assert.ok(Math.abs(d.l[i] - l[i]) < 2e-7); assert.ok(Math.abs(d.r[i] - r[i]) < 2e-7); }
});
test('wire: frames split across chunks, merged in one chunk, and byte-at-a-time all parse', () => {
  const a = wire.encodeJson(2, 1, { x: 1 }), b = wire.encodeJson(10, 2, { reason: 'bye' }), all = new Uint8Array([...a, ...b]);
  let p = new wire.FrameParser(); assert.equal(p.push(all).length, 2);
  p = new wire.FrameParser(); let got = []; for (const byte of all) got.push(...p.push(new Uint8Array([byte]))); assert.deepEqual(got.map(x => x.type), [2, 10]);
  p = new wire.FrameParser(); assert.equal(p.push(all.slice(0, 20)).length, 0); assert.equal(p.push(all.slice(20)).length, 2);
});
test('wire: bad magic, bad version, unknown type and absurd length are refused; epoch frames decode', () => {
  const good = wire.encodeJson(2, 1, {});
  const bad = (i, v) => { const c = good.slice(); c[i] = v; return c; };
  assert.throws(() => new wire.FrameParser().push(bad(0, 0x41)), /bad magic/); assert.throws(() => new wire.FrameParser().push(bad(4, 9)), /version/);
  assert.throws(() => new wire.FrameParser().push(bad(5, 99)), /type/); const big = good.slice(); new DataView(big.buffer).setUint32(12, 2_000_000, true); assert.throws(() => new wire.FrameParser().push(big), /too large/);
  assert.throws(() => wire.decodeAudio(new Uint8Array(5)), /short/); assert.throws(() => wire.decodeEpoch(new Uint8Array(3)));
  const ep = new Uint8Array(12); const dv = new DataView(ep.buffer); dv.setUint32(0, 4, true); dv.setBigInt64(4, 77n, true); assert.deepEqual(wire.decodeEpoch(ep), { epoch: 4, us: 77 });
});

// ---------------- calibration errors
test('classifyMicError maps every browser error to a code', () => {
  const c = n => cal.classifyMicError({ name: n });
  assert.equal(c('NotAllowedError'), 'MIC_DENIED'); assert.equal(c('NotFoundError'), 'MIC_NONE'); assert.equal(c('NotReadableError'), 'MIC_BUSY'); assert.equal(c('OverconstrainedError'), 'MIC_CONSTRAINT');
  assert.equal(c('SecurityError'), 'INSECURE'); assert.equal(c('TypeError'), 'NO_MEDIA_API'); assert.equal(c('Weird'), 'MIC_UNKNOWN'); assert.equal(cal.classifyMicError(null), 'MIC_UNKNOWN');
});
test('every calibration failure code has a title, a reason and at least one fix, for iPhone, Android and desktop', () => {
  const codes = ['IN_APP_BROWSER', 'INSECURE', 'NO_MEDIA_API', 'MIC_DENIED', 'MIC_NONE', 'MIC_BUSY', 'MIC_CONSTRAINT', 'MIC_UNKNOWN', 'MIC_SILENT', 'CTX_SUSPENDED', 'NO_AUDIO_API', 'WORKLET_FAILED', 'CLOCK_WS_FAILED', 'CLOCK_TIMEOUT', 'CLOCK_UNSTABLE', 'SESSION_FAILED', 'UPLOAD_FAILED', 'SCREEN_HIDDEN', 'NOT_HEARD', 'UNKNOWN'];
  for (const env of [{ ios: true, android: false, inApp: false, secure: true }, { ios: false, android: true, inApp: false, secure: false }, { ios: false, android: false, inApp: true, secure: true }])
    for (const code of codes) { const d = cal.describe(code, { ...cal.environment({ userAgent: '' }, {}), ...env }); assert.equal(d.code, code); assert.ok(d.title.length > 5 && d.why.length > 10 && d.fix.length >= 1, code); assert.ok(d.fix.every(x => typeof x === 'string' && x.length > 3)); }
  assert.equal(cal.describe('NOPE').code, 'UNKNOWN');
});
test('server notes and rms and detailsText', () => {
  assert.equal(cal.classifyServerNote('chirp not heard in recording'), 'NOT_HEARD'); assert.equal(cal.classifyServerNote(''), null);
  assert.equal(cal.rms(new Float32Array(0)), 0); assert.ok(Math.abs(cal.rms(new Float32Array([1, -1, 1, -1])) - 1) < 1e-9);
  const e = new cal.CalError('MIC_DENIED', 'x'); assert.equal(e.code, 'MIC_DENIED'); assert.ok(cal.detailsText(e, cal.environment({ userAgent: 'iPhone' }, {})).includes('MIC_DENIED'));
});

// ---------------- theme
test('theme: Midnight Neon default (orange #FF3C00 + teal); five presets incl. Violet Pulse; valid hex', () => {
  assert.equal(theme.PRESETS.default.accent, '#FF3C00'); assert.equal(theme.PRESETS.default.accent2.toUpperCase(), '#19C3B1'); assert.equal(theme.DEFAULT_THEME_ID, 'default'); assert.equal(theme.PRESETS.default.name, 'Midnight Neon');
  assert.deepEqual(Object.keys(theme.PRESETS), ['default', 'ember', 'arctic', 'pepecoin', 'violet']);
  assert.equal(theme.PRESETS.violet.name, 'Violet Pulse'); assert.equal(theme.PRESETS.violet.accent.toUpperCase(), '#A855F7');
  assert.ok(!theme.PRESETS.amber, 'Classic Amber removed');
  assert.ok(!theme.PRESETS.forest && !theme.PRESETS.synthwave && !theme.PRESETS.mono);
  assert.ok(!JSON.stringify(theme.PRESETS).toLowerCase().includes('brown'));
  assert.ok(!JSON.stringify(Object.values(theme.PRESETS).map(p => p.name)).toLowerCase().includes('amber'));
  for (const p of Object.values(theme.PRESETS)) { assert.ok(theme.isHex(p.accent) && theme.isHex(p.accent2) && theme.isHex(p.bg)); }
});
test('theme: a device that saved the 0.0.2 default preset id loads as Default', () => {
  const store = {}; globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
  store['unison.theme.v1'] = JSON.stringify({ accent: '#FF3C00', accent2: '#19C3B1', bg: '#14171A', preset: 'b' + 'rowns' });
  assert.equal(theme.loadTheme().preset, 'default'); delete globalThis.localStorage;
});
test('theme: hex helpers, luminance, derive makes readable text on every preset', () => {
  assert.equal(theme.isHex('#ff3c00'), true); assert.equal(theme.isHex('ff3c00'), false); assert.equal(theme.isHex('#ff3c0'), false); assert.equal(theme.isHex(null), false);
  assert.deepEqual(theme.hexToRgb('#FF3C00'), [255, 60, 0]); assert.equal(theme.rgbToHex([255, 60, 0]), '#FF3C00'); assert.equal(theme.rgbToHex([300, -5, 0.4]), '#FF0000');
  assert.ok(theme.luminance('#FFFFFF') > 0.99 && theme.luminance('#000000') === 0);
  const ratio = (a, b) => { const x = theme.luminance(a), y = theme.luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  for (const [id, p] of Object.entries(theme.PRESETS)) { const d = theme.derive(p); assert.equal(d['--accent'], p.accent); assert.ok(ratio(d['--ink'], p.bg) > 7, id + ' text contrast'); assert.ok(ratio(d['--accent-ink'], p.accent) > 3.5, id + ' button text contrast'); }
  assert.equal(theme.readableOn('#FFFFFF'), '#111111'); assert.equal(theme.readableOn('#000000'), '#FFFFFF');
});

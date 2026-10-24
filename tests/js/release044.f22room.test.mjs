// 0.4.4 F22: a web speaker (PhoneRoom) plays play-pattern for mic AND ear sessions; the Delay slider retimes queued frames live.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { installDom } from './minidom.mjs';
installDom();
const base = pathToFileURL((process.env.JS_DIR || '').replace(/\/?$/, '/')).href;
globalThis.localStorage ??= { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.document ??= { hidden: false, addEventListener() {}, removeEventListener() {}, querySelector: () => null, createElement: () => ({ setAttribute() {}, append() {}, style: {} }), body: { append() {} } };
globalThis.window ??= globalThis; globalThis.navigator ??= { userAgent: 'node' }; globalThis.location ??= { protocol: 'http:', search: '' };
const { PhoneRoom } = await import(base + 'room.js');
const { makeChirpPattern } = await import(base + 'chirppattern.js');
const { volumeToGain } = await import(base + 'roomsched.js');

function fakeCtx() {
  const ctx = { currentTime: 10, state: 'running', outputLatency: 0, destination: {}, starts: [], stops: 0,
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; },
    createBuffer(ch, n, rate) { return { length: n, sampleRate: rate, getChannelData: () => new Float32Array(n), copyToChannel() {} }; },
    createBufferSource() { const s = { buffer: null, playbackRate: { value: 1 }, connect() {}, disconnect() {}, start(t) { ctx.starts.push(t); s.t = t; }, stop() { ctx.stops++; } }; return s; } };
  return ctx;
}
function room() {
  const r = new PhoneRoom({ name: 't' }); const ctx = fakeCtx(); r.ctx = ctx; r.gain = ctx.createGain();
  r.pair = { ctxSec: 10, perfUs: 1_000_000 }; r.est = { ready: true, offsetUs: 0, rttUs: 1000 };
  const sent = []; r.send = (type, body) => sent.push(body); globalThis.performance = { now: () => 1000 };   // perf 1 s == server 1 s == ctx 10 s
  return { r, ctx, sent };
}

for (const [kind, cmd] of [['mic', { action: 'play-pattern', sessionId: 's1', atUs: 2_000_000, levelDb: -12, label: 'device', req: 'abc', testVolume: 60 }],
                           ['ear', { action: 'play-pattern', sessionId: 'ear', atUs: 2_000_000, levelDb: -20, label: 'device', testVolume: 85 }]]) {
  test(`F22 web speaker plays play-pattern in a ${kind} session at atUs (level + test volume honored)`, () => {
    const { r, ctx, sent } = room(); r.zone.latencyMs = 250;   // saved delay must NOT shift the test sound (it is being measured)
    r.onCal(cmd);
    assert.ok(!sent.some(b => b.status === 'unsupported'), 'never unsupported');
    if (cmd.req) assert.ok(sent.some(b => b.status === 'pattern-ack' && /^ok/.test(b.note) && b.req === 'abc'));
    const n = Math.ceil(makeChirpPattern().signal.length / 960);
    assert.equal(ctx.starts.length, n, 'every 20 ms frame scheduled');
    assert.ok(Math.abs(ctx.starts[0] - 11) < 0.002, 'first sample at server atUs (ctx 11 s), latency ignored: ' + ctx.starts[0]);
    assert.ok(Math.abs(r._calGain.gain.value - volumeToGain(cmd.testVolume)) < 1e-9);
    assert.equal(r._lastCal.played, n); assert.equal(r._lastCal.dropped, 0);
  });
}

test('F22 play-pattern on a locked phone acks "locked" (UI shows tap to unlock) instead of silence', () => {
  const { r, ctx, sent } = room(); ctx.state = 'suspended'; ctx.resume = () => Promise.resolve();
  try { r.onCal({ action: 'play-pattern', sessionId: 's', atUs: 2_000_000, req: 'q' }); } catch { /* showUnlock needs a DOM */ }
  assert.ok(sent.some(b => b.note === 'locked')); assert.equal(ctx.starts.length, 0);
});

test('F22 Delay slider retimes queued music frames live (same epoch, no restart, no new frames needed)', async () => {
  const { r, ctx } = room(); r.epoch = 7;
  for (let i = 0; i < 50; i++) r.onAudio({ epoch: 7, playAtUs: 2_000_000 + i * 20_000, count: 960, l: new Float32Array(960), r: new Float32Array(960) });
  assert.ok(Math.abs(ctx.starts[0] - 11) < 0.002);
  const n0 = ctx.starts.length, epochBefore = r.epoch;
  r.zone.latencyMs = 120; r.retime();                     // what ZoneUpdate does when latencyMs changes
  const moved = ctx.starts.slice(n0);
  assert.equal(moved.length, 50, 'every queued frame rescheduled'); assert.equal(ctx.stops, 50);
  assert.ok(Math.abs(moved[0] - (11 - 0.12)) < 0.002, '120 ms earlier at once: ' + moved[0]);
  assert.equal(r.epoch, epochBefore); assert.equal(r.sources.length, 50); assert.equal(r.stats.retimes, 1);
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('room.js', base), 'utf8'), /if \(this\.zone\.latencyMs !== prevLat\) this\.retime\(\)/);
});

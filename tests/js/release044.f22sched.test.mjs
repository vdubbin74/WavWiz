import test from 'node:test';
import assert from 'node:assert/strict';
import { makeChirpPattern, scheduleChirpOnScheduler, simulateMeasuredOffsetMs } from '/workspace/wavwiz-public/src/WavWiz.Server/wwwroot/js/chirppattern.js';
import { FrameScheduler, ctxTimeFor } from '/workspace/wavwiz-public/src/WavWiz.Server/wwwroot/js/roomsched.js';

/** Minimal AudioContext stub that records scheduled starts. */
function fakeCtx(now = 100) {
  const starts = [];
  return {
    currentTime: now,
    sampleRate: 48000,
    createBuffer(ch, count, rate) {
      return { numberOfChannels: ch, length: count, sampleRate: rate,
        getChannelData() { return new Float32Array(count); } };
    },
    createBufferSource() {
      const src = {
        buffer: null, playbackRate: { value: 1 },
        connect() {}, disconnect() {},
        start(t) { starts.push({ t, rate: src.playbackRate.value, n: src.buffer?.length }); },
        stop() {},
      };
      return src;
    },
    _starts: starts,
  };
}

test('F22 scheduleChirpOnScheduler: frames play on FrameScheduler at server atUs (latencyMs=0)', () => {
  const pat = makeChirpPattern(-20);
  const ctx = fakeCtx(10);
  const gain = { connect() {}, gain: { value: 1 } };
  const pair = { ctxSec: 10, perfUs: 1_000_000 };
  const offsetUs = 0; // serverUs == perfUs
  const atUs = 1_000_000 + 500_000; // 0.5 s ahead of "now" in perf → ctx ~10.5
  const sched = new FrameScheduler();
  const r = scheduleChirpOnScheduler(ctx, pat.signal, atUs, {
    pair, offsetUs, outputLatencySec: 0, latencyMs: 0, sched, ctxTimeFor, gainNode: gain,
  });
  assert.ok(r.played > 100, 'many 20ms frames, played=' + r.played);
  assert.equal(r.dropped, 0);
  assert.equal(r.samplesPerFrame, 960);
  assert.ok(ctx._starts.length === r.played);
  // first frame starts near ctxTimeFor(atUs) ≈ 10.5
  const expect0 = ctxTimeFor(atUs, { pair, offsetUs, latencyMs: 0, outputLatencySec: 0 });
  assert.ok(Math.abs(ctx._starts[0].t - expect0) < 0.03, `start0=${ctx._starts[0].t} expect~${expect0}`);
  // with injected output latency in the acoustic model, measured offset includes it
  assert.equal(simulateMeasuredOffsetMs(atUs, { outputLatencyMs: 180 }), 180);
});

test('F22 latencyMs=0 so injected output delay is NOT pre-compensated away from the mic', () => {
  const pair = { ctxSec: 10, perfUs: 1_000_000 };
  const atUs = 1_500_000;
  const withLat = ctxTimeFor(atUs, { pair, offsetUs: 0, latencyMs: 200, outputLatencySec: 0 });
  const without = ctxTimeFor(atUs, { pair, offsetUs: 0, latencyMs: 0, outputLatencySec: 0 });
  assert.ok(without - withLat > 0.19 && without - withLat < 0.21, '200ms latency would start earlier; we use 0 so mic hears it');
});

console.log('sched tests defined');

// Execute the actual PhoneRoom class with deterministic clock/network/audio doubles; no phone proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { FrameScheduler, OffsetEstimator, pairClocks } from '../../src/WavWiz.Server/wwwroot/js/roomsched.js';
const src = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/room.js', import.meta.url), 'utf8');
const cls = src.slice(src.indexOf('export class PhoneRoom'), src.indexOf('/* 0.2.0 item 2:')).replace('export class', 'class');
const doc = { hidden: false }, store = new Map();
const ctx = vm.createContext({ FrameScheduler, OffsetEstimator, pairClocks, document: doc,
  Date: class extends Date { static now() { return 100000; } }, performance: { now: () => 1000 },
  sleep: async () => {}, console: { info() {} }, outputDelaySec: () => 0,
  localStorage: { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v) } });
const PhoneRoom = vm.runInContext(cls + '; PhoneRoom', ctx);
function room() {
  doc.hidden = false; const r = new PhoneRoom({}); r.running = true;
  r.ctx = { state: 'running', currentTime: 1, resume: async () => { r.ctx.state = 'running'; } };
  r.ws = { readyState: 1 }; r.cws = { readyState: 1 }; r.rx = r.clockRx = 99000;
  for (let i = 0; i < 5; i++) r.est.add(0, 500, 500, 1000);
  r.pair = { ctxSec: 1, perfUs: 1000000, edge: true }; r.epoch = 123;
  r.sources = [{ stop() { throw new Error('healthy audio was stopped'); }, disconnect() {} }];
  r.sched.next = 2; r.emit = () => {}; r.kickNet = () => { r.kicks = (r.kicks || 0) + 1; };
  r.pingClock = () => { r.pings = (r.pings || 0) + 1; }; r.watchdog = () => {};
  return r;
}
test('healthy repeated foreground retains sources, scheduler, epoch and estimator (including paused/no sources)', async () => {
  const r = room(), sources = r.sources, offset = r.est.offsetUs; r.resync = () => { throw new Error('unnecessary hard recovery'); };
  for (let i = 0; i < 10; i++) await r.onVisible();
  assert.equal(r.sources, sources); assert.equal(r.sched.next, 2); assert.equal(r.epoch, 123); assert.equal(r.est.offsetUs, offset);
  r.sources = []; await r.onVisible(); assert.equal(r.sources.length, 0); assert.equal(r.epoch, 123);
});
test('suspended context resumes and real recovery drops/reanchors once', async () => {
  const r = room(); r.ctx.state = 'suspended'; let drops = 0;
  r.dropAudio = () => { drops++; r.sources = []; }; r.pairEdge = async () => r.pair;
  await r.onVisible(); assert.equal(r.ctx.state, 'running'); assert.equal(drops, 1); assert.equal(r.epoch, null); assert.equal(r.sched.next, null);
});
test('missing/closed/stale links or unready clock request hard recovery', async () => {
  for (const change of [r => r.ws = null, r => r.cws.readyState = 3, r => r.rx = 80000, r => r.clockRx = 80000, r => r.est.reset(), r => r.pair = null]) {
    const r = room(); change(r); let why; r.resync = async s => { why = s; }; await r.onVisible(); assert.equal(why, 'visible recovery'); assert.equal(r.kicks, 1);
  }
});
test('measured audio clock drift uses the existing edge re-pair without audio drop', async () => {
  const r = room(); r.pair.perfUs = 900000; let edges = 0;
  r.pairEdge = async () => { edges++; return r.pair; }; r.resync = () => { throw new Error('drift need not drop'); };
  await r.onVisible(); assert.equal(edges, 1); assert.equal(r.epoch, 123); assert.equal(r.sched.next, 2);
});
test('hidden/stopped/remote-mic teardown and failed resume cannot restart playback', async () => {
  const r = room(); r.resync = () => { throw new Error('must stay silent'); };
  doc.hidden = true; await r.onVisible(); doc.hidden = false; r.running = false; await r.onVisible();
  r.running = true; r.ctx.state = 'suspended'; r.ctx.resume = async () => { throw new Error('gesture required'); }; await r.onVisible();
  r.ctx.resume = async () => { r.ctx.state = 'running'; r.running = false; }; await r.onVisible(); assert.equal(r.epoch, 123);
});
test('actual resync is coalesced and cannot drop audio after device stop', async () => {
  const r = room(); let drops = 0; r.dropAudio = () => { drops++; }; r.pairEdge = async () => r.pair;
  const first = r.resync('ctx suspended>running'), second = r.resync('visible recovery'); await Promise.all([first, second]); assert.equal(drops, 1);
  r.pingClock = () => { r.running = false; }; await r.resync('visible recovery'); assert.equal(drops, 1);
});
test('visibility listener uses health gate; silent role autojoin and clock reconnect recovery stay wired', () => {
  assert.match(src, /if \(!document.hidden\) this.onVisible\(\)/); assert.doesNotMatch(src, /resync\('visible'\)/);
  assert.match(src, /resync\('clock reconnect'\)/);
  for (const role of ['mic', 'remote']) assert.ok(src.includes(`role === '${role}') { show${role === 'mic' ? 'Mic' : 'Remote'}Banner(); return; }`));
});

// 0.7.1 t2044u / t2045u: an incoming call or switching apps on an iPhone speaker must drop out only that phone, never pause the zone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { notePhone, isSystemPause, isSystemPlay, guardMedia, WINDOW_MS } from '../../src/WavWiz.Server/wwwroot/js/phonepause.js';
const js = f => readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/' + f, import.meta.url), 'utf8');
const fresh = () => ({ active: false, ctxState: 'running', interruptedAt: 0, resumedAt: 0, hiddenAt: 0, silentPaused: false, skipped: [] });
// run a guarded handler with a fake clock/timer: `before` happens before the action, `after` during the short wait
function fire(s, kind, { t0 = 100000, before, after } = {}) {
  let now = t0; const calls = [];
  before?.(s, now);
  const h = guardMedia(kind, () => calls.push(kind), { s, clock: () => now, timer: (fn, ms) => { now += 50; after?.(s, now); now += ms - 50; fn(); } });
  h(); return calls;
}

test('incoming call: the AudioContext is interrupted -> the lock-screen pause is NOT sent to the zone (either order)', () => {
  const s = fresh(); notePhone('active', 'running', 1, s);
  assert.deepEqual(fire(s, 'pause', { before: (s, t) => notePhone('ctx', 'interrupted', t, s) }), []);
  const s2 = fresh(); notePhone('active', 'running', 1, s2);
  assert.deepEqual(fire(s2, 'pause', { after: (s, t) => notePhone('ctx', 'interrupted', t, s) }), [], 'the interruption may arrive just after the pause action');
  assert.equal(s2.skipped.length, 1);
});
test('backgrounded suspend and another app taking the audio (media element paused) -> not a zone pause', () => {
  const s = fresh(); notePhone('active', 'running', 1, s);
  assert.deepEqual(fire(s, 'pause', { after: (s, t) => notePhone('ctx', 'suspended', t, s) }), []);
  const s2 = fresh(); notePhone('active', 'running', 1, s2);
  assert.deepEqual(fire(s2, 'pause', { before: (s, t) => notePhone('silent-pause', null, t, s) }), []);
  assert.deepEqual(fire(s2, 'stop', { before: (s, t) => notePhone('silent-pause', null, t, s) }), [], 'stop is treated like pause');
});
test('app switch: visibilitychange hidden / pagehide just before the pause -> not a zone pause', () => {
  const s = fresh(); notePhone('active', 'running', 1, s);
  assert.deepEqual(fire(s, 'pause', { before: (s, t) => notePhone('hidden', null, t, s) }), []);
  const s2 = fresh(); notePhone('active', 'running', 1, s2);
  assert.deepEqual(fire(s2, 'pause', { after: (s, t) => notePhone('hidden', null, t, s) }), []);
});
test('the user pressing Pause (no interruption) still pauses the zone, also on a locked phone long after it went hidden', () => {
  const s = fresh(); notePhone('active', 'running', 1, s);
  assert.deepEqual(fire(s, 'pause'), ['pause']);
  notePhone('hidden', null, 1000, s);
  assert.deepEqual(fire(s, 'pause', { t0: 1000 + WINDOW_MS + 500 }), ['pause']);
  assert.equal(isSystemPause(s, 1000 + WINDOW_MS + 500), false);
});
test('when the interruption ends: the phone rejoins and iOS\'s "play" does not resume a zone the user paused', () => {
  const s = fresh(); notePhone('active', 'running', 1, s);
  notePhone('ctx', 'interrupted', 5000, s); notePhone('ctx', 'running', 60000, s);
  assert.equal(s.resumedAt, 60000); assert.equal(isSystemPlay(s, 60500), true);
  assert.deepEqual(fire(s, 'play', { t0: 60100 }), []);
  assert.deepEqual(fire(s, 'play', { t0: 60000 + WINDOW_MS + 1000 }), ['play'], 'a later user Play works');
  notePhone('silent-play', null, 70000, s); assert.equal(s.silentPaused, false);
});
test('not a phone speaker (desktop, phone remote): handlers run at once, unchanged', () => {
  const s = fresh(); const calls = []; let timed = false;
  guardMedia('pause', () => calls.push('p'), { s, timer: () => { timed = true; } })();
  assert.deepEqual(calls, ['p']); assert.equal(timed, false);
  assert.equal(guardMedia('nexttrack', calls.push), calls.push, 'next/previous are never delayed');
});
test('wiring: lock-screen + media-key pause/play/stop are guarded; room.js reports ctx / visibility / pagehide / media pause and rejoins', () => {
  const now = js('now.js'), media = js('media.js'), room = js('room.js');
  assert.match(now, /pause: guardMedia\('pause', \(\) => act\('\/stream\/pause'\)\)/);
  assert.match(now, /play: guardMedia\('play', \(\) => act\('\/stream\/resume'\)\)/);
  assert.match(now, /stop: guardMedia\('stop'/);
  assert.match(media, /setActionHandler\(name, guardMedia\(name, /);
  assert.match(room, /notePhone\('ctx', st\)/);
  assert.match(room, /notePhone\(document\.hidden \? 'hidden' : 'shown'\)/);
  assert.match(room, /addEventListener\?\.\('pagehide', this\.hide\)/);
  assert.match(room, /silentEl\.addEventListener\?\.\('pause', \(\) => notePhone\('silent-pause'\)\)/);
  assert.match(room, /!== 'running'\) resumeSilent\(\)/);
  assert.match(room, /notePhone\('inactive'\)/);
  assert.doesNotMatch(room, /stream\/pause/, 'the phone speaker never pauses the zone by itself');
});

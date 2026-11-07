// Deterministic Media Session regression harness; NOT proof of iPhone lock-screen behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.Element = class {}; globalThis.document = { createElement: () => ({}) };
let clock = 10000, writes = 0, positions = [], images = [];
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true });
globalThis.MediaMetadata = class { constructor(o) { Object.assign(this, o); writes++; } };
globalThis.Image = class { constructor() { images.push(this); } };
const ms = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState(p) { positions.push(p); } };
Object.defineProperty(globalThis, 'navigator', { value: { mediaSession: ms }, configurable: true });
const { setMediaSession: set, updateMediaSessionPosition: position, mediaSessionTrackKey: trackKey } = await import('../../src/WavWiz.Server/wwwroot/js/art.js');
const a = { kind: 'track', id: 'queue-a', refId: 17, title: 'Song A', artist: 'Artist', album: 'Album' };
const b = { ...a, id: 'queue-b', refId: 18, title: 'Song B' };
const now = (item = a, state = 'playing', pos = 45000, durationMs = 200000) => ({ item, state, positionMs: pos, durationMs });
const reset = () => { set({ state: 'stopped', item: null }); images = []; positions = []; writes = 0; };
const load = () => { for (const image of images.splice(0)) image.onload?.(); };
const logo = () => ms.metadata?.artwork?.[0]?.src === '/assets/logo-512.png';

test('repeated ticks and queue-id churn retain the same loaded cover without metadata rewrites', () => {
  reset(); set(now()); load(); assert.equal(logo(), false); const count = writes;
  for (let i = 0; i < 20; i++) { clock += 1000; const n = now({ ...a, id: 'queue-' + i }, 'playing', 45000 + i * 1000); set(n, {}, n.positionMs); position(n, n.positionMs); }
  assert.equal(writes, count); assert.equal(logo(), false); assert.ok(positions.every(p => p && p.position >= 45));
});
test('slim art/duration polls preserve the exact last-good artwork and position duration', () => {
  reset(); set(now()); load(); const art = ms.metadata.artwork;
  const slim = { kind: 'url', refId: a.refId, id: 'another-queue-id', title: a.title };
  set(now(slim, 'playing', 46000, 0)); position(now(slim, 'playing', 47000, NaN), 47000, true);
  set(now(slim, 'playing', 0, 0)); position(now(slim, 'playing', 0, 0), 0, true);
  assert.deepEqual(ms.metadata.artwork, art); assert.equal(logo(), false);
  assert.ok(positions.every(p => p && p.duration === 200 && p.position >= 45));
});
test('missing playing item advances last clock; paused empty ticks freeze it; true stop clears', () => {
  reset(); set(now()); load(); const count = writes; clock += 2000;
  set({ state: 'playing', item: null, positionMs: 0, durationMs: 0 }); assert.equal(positions.at(-1).position, 47);
  clock += 1000; set({ state: 'paused', item: null }); assert.equal(positions.at(-1).position, 48);
  clock += 5000; set({ state: 'paused', item: null }); assert.equal(positions.at(-1).position, 48);
  position({ state: 'playing', item: null }, 0, true); assert.equal(positions.at(-1).position, 48);
  assert.equal(writes, count); assert.equal(logo(), false); assert.equal(ms.playbackState, 'paused');
  set({ state: 'stopped', item: null }); assert.equal(ms.metadata, null); assert.equal(positions.at(-1), undefined);
});
test('cover load from a previous track (including A-B-A) cannot overwrite the current cover', () => {
  reset(); set(now()); const oldA = images.shift(); set(now(b, 'playing', 0)); const oldB = images.shift();
  set(now(a, 'playing', 7000)); const currentA = images.shift();
  oldA.onload(); oldB.onload(); assert.equal(logo(), true);
  currentA.onload(); assert.equal(logo(), false); assert.match(ms.metadata.artwork[3].src, /track\/17/); assert.ok(positions.at(-1).position >= 7);
});
test('competing artwork requests use latest text and keep the cover on failed replacement', () => {
  reset(); set(now()); load(); const art = ms.metadata.artwork;
  set(now({ ...a, artUrl: '/cover-v2.png' })); const old = images.shift();
  set(now({ ...a, artUrl: '/cover-v3.png', title: 'Corrected title' })); const current = images.shift();
  old.onload(); assert.deepEqual(ms.metadata.artwork, art); current.onerror(); assert.deepEqual(ms.metadata.artwork, art);
  set(now({ ...a, artUrl: '/cover-v3.png', title: 'Corrected title' })); load();
  assert.equal(ms.metadata.title, 'Corrected title'); assert.equal(ms.metadata.artwork[0].src, '/cover-v3.png');
});
test('pause/resume changes playback and position but not metadata; real seek and new track can start at zero', () => {
  reset(); set({ ...now(), version: 1, index: 0 }); load(); const count = writes;
  set({ ...now(a, 'paused', 47000), version: 2, index: 0 }); clock += 2000;
  set({ ...now(a, 'playing', 47000), version: 3, index: 0 }); assert.equal(writes, count);
  // Real seek: Conductor.Bump() → version change. New track changes identity.
  position({ ...now(a, 'playing', 0), version: 4, index: 0 }, 0, true); assert.equal(positions.at(-1).position, 0);
  set({ ...now(b, 'playing', 0), version: 5, index: 1 }); load();
  assert.match(ms.metadata.artwork[3].src, /track\/18/); assert.equal(positions.at(-1).position, 0);
});
test('never-art track shows logo once; live transition clears stale finite scrubber', () => {
  reset(); const bare = { kind: 'url', id: 'bare', title: 'No art' }; set(now(bare)); const count = writes;
  for (let i = 0; i < 5; i++) set(now(bare)); assert.equal(logo(), true); assert.equal(writes, count);
  set(now({ kind: 'radio', refId: 9, title: 'Radio' }, 'playing', 0, 0)); load(); assert.equal(positions.at(-1), undefined);
});

// Wiz R1: now.js supplies localPos + render delay, NOT the raw poll's literal zero.
test('R1 incomplete raw poll and positive render-delay ticks retain the last-good moving clock', () => {
  reset(); set(now()); load(); const count = writes;
  const poll = now(a, 'playing', 0, 0); const receivedAt = clock;
  clock += 16; set(poll, {}, poll.positionMs + (clock - receivedAt));
  clock += 1000; position(poll, poll.positionMs + (clock - receivedAt));
  assert.equal(positions.at(-1).position, 46.016);
  clock += 1000; position(poll, poll.positionMs + (clock - receivedAt));
  assert.equal(positions.at(-1).position, 47.016);
  // A second incomplete poll resets the caller's localAt/localPos, not our trusted clock.
  const nextPoll = now({ ...a, id: 'queue-churn' }, 'playing', 0, 0), nextAt = clock;
  clock += 23; set(nextPoll, {}, clock - nextAt); clock += 1000; position(nextPoll, clock - nextAt);
  assert.equal(positions.at(-1).position, 48.039); assert.equal(writes, count);
  assert.ok(positions.every(p => p && p.duration === 200 && p.position >= 45));
});
test('R1 incomplete paused/resumed polls freeze/continue the good clock instead of trusting render delay', () => {
  reset(); set(now()); load(); clock += 16;
  const paused = now(a, 'paused', 0, 0); set(paused, {}, 16); assert.equal(positions.at(-1).position, 45.016);
  clock += 5000; position(paused, 5016, true); assert.equal(positions.at(-1).position, 45.016);
  const resumed = now(a, 'playing', 0, 0); set(resumed, {}, 16);
  clock += 1000; position(resumed, 1016, true); assert.equal(positions.at(-1).position, 46.016);
});
test('R1 known-duration versioned zero seek/StartAt/restart still accept the caller clock immediately', () => {
  // Explicit Seek / StartAt bump version; natural same-index Repeat One does not (covered by F248).
  for (const event of ['seek', 'start-at-with-repeat-one', 'restart']) {
    reset(); set({ ...now(), version: 1, index: 0 }); load(); const count = writes;
    const n = { ...now({ ...a, id: 'queue-' + event }, 'playing', 0, 200000), repeat: event === 'start-at-with-repeat-one' ? 'one' : 'off', version: 2, index: 0 };
    clock += 16; set(n, {}, 16); position(n, 16, true); assert.equal(positions.at(-1).position, 0.016, event);
    clock += 1000; position(n, 1016, true); assert.equal(positions.at(-1).position, 1.016, event);
    assert.equal(writes, count, event);
  }
  set({ ...now(a, 'paused', 0, 200000), version: 3, index: 0 }, {}, 0);
  position({ ...now(a, 'paused', 0, 200000), version: 3, index: 0 }, 0, true); assert.equal(positions.at(-1).position, 0);
});

test('R2 equal library/radio IDs are different source domains, while slim library IDs remain stable', () => {
  const radio = { kind: 'radio', id: 'radio-queue', refId: a.refId, title: 'Radio' };
  assert.notEqual(trackKey(a), trackKey(radio));
  assert.equal(trackKey(a), trackKey({ kind: 'url', refId: a.refId, id: 'slim-queue', title: a.title }));
  assert.equal(trackKey(a), trackKey({ ...a, id: 'another-queue', artTrackId: a.refId }));
});
test('R2 library to equal-ID radio clears finite position and never retains an unrelated album after art failure', () => {
  reset(); set(now()); load(); assert.equal(logo(), false);
  const radio = { kind: 'radio', refId: a.refId, id: 'station', title: 'Radio', artist: 'Internet radio' };
  const n = now(radio, 'playing', 0, 0); set(n); const stationImage = images.shift();
  assert.equal(logo(), true); assert.equal(positions.at(-1), undefined);
  stationImage.onerror(); set(n); const retry = images.shift();
  assert.equal(logo(), true); position(n, 1016, true); assert.equal(positions.at(-1), undefined);
  // A delayed station response cannot overwrite the album when returning to the same-number library track.
  set(now(a, 'playing', 12000)); const albumImage = images.shift(); retry.onload();
  assert.equal(logo(), true); assert.equal(positions.at(-1).duration, 200); assert.equal(positions.at(-1).position, 12);
  albumImage.onload(); assert.match(ms.metadata.artwork[3].src, /track\/17/);
});
test('R2 equal-ID radio to library restores finite position; delayed/failed album art cannot retain station art', () => {
  reset(); const radio = { kind: 'radio', refId: a.refId, id: 'station', title: 'Radio' };
  const n = now(radio, 'playing', 0, 0); set(n); load(); assert.match(ms.metadata.artwork[3].src, /radio\/17/);
  set(now(a, 'playing', 7000)); const albumImage = images.shift();
  assert.equal(logo(), true); assert.equal(positions.at(-1).duration, 200); assert.equal(positions.at(-1).position, 7);
  albumImage.onerror(); set(now(a, 'playing', 8000)); const retry = images.shift(); assert.equal(logo(), true);
  position(now(a, 'playing', 9000), 9000, true); assert.equal(positions.at(-1).position, 9);
  set(n); retry.onload(); assert.equal(logo(), true); assert.equal(positions.at(-1), undefined);
  load(); assert.match(ms.metadata.artwork[3].src, /radio\/17/); assert.equal(positions.at(-1), undefined);
});

// F248 R2: real pause/resume and non-seek mutations bump Conductor's generic version counter.
test('F248 R2/F243 matrix: versioned incomplete pause/resume/mutation retains duration, elapsed and exact art; complete seek-to-0 recovers', () => {
  for (const duration of [0, null, undefined, NaN, Infinity, -1]) {
    reset(); clock = 10000; set({ ...now(), version: 7, index: 0 }); load();
    const art = ms.metadata.artwork;
    clock += 1000;
    const pause = { ...now(a, 'paused', 0, duration), durationMs: duration, version: 8, index: 0 };
    set(pause, {}, 0); position(pause, 0, true); assert.equal(positions.at(-1).position, 46, String(duration));
    clock += 5000; position(pause, 0, true); assert.equal(positions.at(-1).position, 46);
    const resume = { ...pause, state:'playing', version:9 }; set(resume, {}, 0);
    clock += 1000; position(resume, 0, true); assert.equal(positions.at(-1).position, 47);
    const mutation = { ...resume, version:10 }; set(mutation, {}, 0); position(mutation, 0, true);
    assert.equal(positions.at(-1).position, 47);
    assert.ok(positions.every(p=>p && p.duration===200 && p.position>=45));
    assert.deepEqual(ms.metadata.artwork, art);
    // Invalid data must not consume version evidence: the first complete same-version seek still lands.
    const complete = { ...now(a, 'paused', 0, 200000), version:10, index:0 };
    set(complete, {}, 0); position(complete, 0, true); assert.equal(positions.at(-1).position, 0);
    assert.deepEqual(ms.metadata.artwork, art);
  }
});
test('F248 R2/F243: finite duration plus NaN position on version/index change cannot manufacture zero', () => {
  reset(); clock = 10000; set({ ...now(), version:7, index:0 }); load(); clock+=1000;
  const bad = { ...now(a,'paused',NaN,200000), version:8, index:1 };
  set(bad, {}, NaN); position(bad, NaN, true); assert.equal(positions.at(-1).position,46);
  const complete = { ...bad, positionMs:0 }; set(complete,{},0); position(complete,0,true);
  assert.equal(positions.at(-1).position,0);
});

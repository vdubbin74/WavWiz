// F248: poll → smooth-clock ingest → Media Session. Deterministic; NOT iPhone lock-screen proof.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.Element = class {}; globalThis.document = { createElement: () => ({}) };
let clock = 10000, writes = 0, positions = [], images = [];
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true });
globalThis.MediaMetadata = class { constructor(o) { Object.assign(this, o); writes++; } };
globalThis.Image = class { constructor() { images.push(this); } };
const ms = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState(p) { positions.push(p); } };
Object.defineProperty(globalThis, 'navigator', { value: { mediaSession: ms }, configurable: true });
const { setMediaSession: set, updateMediaSessionPosition: position, reconcileSmoothPosition, mediaSessionTrackKey } =
  await import('../../src/WavWiz.Server/wwwroot/js/art.js');
const a = { kind: 'track', id: 'queue-a', refId: 17, title: 'Song A', artist: 'Artist', album: 'Album' };
const b = { ...a, id: 'queue-b', refId: 18, title: 'Song B' };
const now = (item = a, state = 'playing', pos = 45000, durationMs = 200000, extra = {}) =>
  ({ item, state, positionMs: pos, durationMs, version: 1, index: 0, ...extra });
const reset = () => { set({ state: 'stopped', item: null }); images = []; positions = []; writes = 0; clock = 10000; };
const load = () => { for (const image of images.splice(0)) image.onload?.(); };

// ---- pure ingest (refreshNow path) ----
test('F248 ingest: alternating valid-duration 45s/0 same version never poisons the smooth clock', () => {
  let smooth = null; clock = 10000;
  const step = (pos, ver = 1) => {
    const n = now(a, 'playing', pos, 200000, { version: ver });
    clock += 1000;
    smooth = reconcileSmoothPosition(smooth, n, n.positionMs, clock);
    return smooth.posMs;
  };
  assert.ok(step(45000) >= 45000);
  const held = step(0);           // blip
  assert.ok(held >= 45000, 'zero blip held');
  const back = step(46000);       // good poll
  assert.ok(back >= 45000 && back < 52000, 'restored without locking at 0');
  assert.ok(step(0) >= 45000);
  assert.ok(step(47000) >= 45000);
  assert.ok(smooth.pending == null || smooth.posMs >= 45000);
});

test('F248 ingest: render-delay tiny positives with valid duration stay on last-good clock', () => {
  let smooth = reconcileSmoothPosition(null, now(a, 'playing', 45000, 200000, { version: 1 }), 45000, clock);
  // Single poisoned redraw: hold. (Consecutive tiny backs without a good poll would bounded-confirm;
  // refreshNow ingestion prevents that pattern by not accepting the zero in the first place.)
  clock += 16; smooth = reconcileSmoothPosition(smooth, now(a, 'playing', 0, 200000, { version: 1 }), 16, clock);
  assert.ok(smooth.posMs >= 45000, '16ms render delay rejected');
  assert.equal(smooth.pending, 16);
  // Interleaved good poll clears pending — the live alternating failure mode.
  clock += 1000; smooth = reconcileSmoothPosition(smooth, now(a, 'playing', 46000, 200000, { version: 1 }), 46000, clock);
  assert.ok(smooth.posMs >= 45000 && smooth.pending == null);
  clock += 1000; smooth = reconcileSmoothPosition(smooth, now(a, 'playing', 0, 200000, { version: 1 }), 1016, clock);
  assert.ok(smooth.posMs >= 45000, 'next tiny back after good poll held again');
});

test('F248 ingest: complete version bump seeks/StartAt/reconnect accept zero immediately', () => {
  let smooth = reconcileSmoothPosition(null, now(a, 'playing', 45000, 200000, { version: 1 }), 45000, clock);
  clock += 500;
  smooth = reconcileSmoothPosition(smooth, now(a, 'playing', 0, 200000, { version: 2 }), 0, clock);
  assert.equal(smooth.posMs, 0);
  // reconnect / new epoch after stop
  smooth = reconcileSmoothPosition(smooth, { state: 'stopped', item: null, positionMs: 0, durationMs: 0, version: 3 }, 0, clock);
  clock += 10;
  smooth = reconcileSmoothPosition(smooth, now(a, 'playing', 12000, 200000, { version: 4 }), 12000, clock);
  assert.equal(smooth.posMs, 12000);
});

test('F248 ingest: same-version zero needs bounded confirmation; then accepts', () => {
  let smooth = reconcileSmoothPosition(null, now(a, 'playing', 45000, 200000, { version: 1 }), 45000, clock);
  clock += 1000;
  smooth = reconcileSmoothPosition(smooth, now(a, 'playing', 0, 200000, { version: 1 }), 0, clock);
  assert.ok(smooth.posMs >= 45000);
  assert.equal(smooth.pending, 0);
  clock += 1000;
  smooth = reconcileSmoothPosition(smooth, now(a, 'playing', 50, 200000, { version: 1 }), 50, clock);
  assert.ok(smooth.posMs <= 100, 'second agreeing near-zero confirms seek');
});

test('F248 ingest: index/track change and pause/resume with version still work', () => {
  let smooth = reconcileSmoothPosition(null, now(a, 'playing', 45000, 200000, { version: 1, index: 0 }), 45000, clock);
  clock += 100;
  smooth = reconcileSmoothPosition(smooth, now(b, 'playing', 0, 180000, { version: 2, index: 1 }), 0, clock);
  assert.equal(smooth.posMs, 0);
  assert.equal(mediaSessionTrackKey(b), smooth.trackKey);
  clock += 2000;
  smooth = reconcileSmoothPosition(smooth, now(b, 'paused', 2000, 180000, { version: 3, index: 1 }), 2000, clock);
  assert.equal(smooth.posMs, 2000);
  clock += 5000; // paused hold via predicted path when same version resumes later
  smooth = reconcileSmoothPosition(smooth, now(b, 'playing', 2000, 180000, { version: 4, index: 1 }), 2000, clock);
  assert.equal(smooth.posMs, 2000);
});

// ---- Media Session path using the same reconciler ----
test('F248 Media Session: alternating valid-duration 45s/0 does not publish 0:00', () => {
  reset(); set(now()); load();
  // Seed ingest state as refreshNow would after the first good poll, then alternate.
  let smooth = reconcileSmoothPosition(null, now(), 45000, clock);
  for (let i = 0; i < 8; i++) {
    clock += 1000;
    const raw = i % 2 === 0 ? 0 : 45000 + i * 400;
    const n = now(a, 'playing', raw, 200000, { version: 1 });
    smooth = reconcileSmoothPosition(smooth, n, n.positionMs, clock);
    set(n, {}, smooth.posMs); position(n, smooth.posMs, true);
  }
  assert.ok(positions.every(p => p && p.duration === 200 && p.position >= 45), positions.map(p => p?.position));
  assert.ok(smooth.posMs >= 45000);
});

test('F248 Media Session: genuine remote seek/explicit restart with version lands at zero; art retained', () => {
  reset(); set(now()); load(); const art = ms.metadata.artwork;
  const seek = now(a, 'playing', 0, 200000, { version: 9 });
  clock += 16; set(seek, {}, 16); position(seek, 16, true);
  assert.equal(positions.at(-1).position, 0.016);
  assert.deepEqual(ms.metadata.artwork, art);
  // Explicit StartAt while Repeat One is enabled, NOT a natural same-index boundary.
  const restart = now({ ...a, id: 'q-restart' }, 'playing', 0, 200000, { version: 10, repeat: 'one' });
  clock += 1000; set(restart, {}, 20); position(restart, 20, true);
  assert.ok(positions.at(-1).position < 1);
  assert.deepEqual(ms.metadata.artwork, art);
});

test('F248 Media Session: F243 art races still keep cover across zero-position blips', () => {
  reset(); set(now()); load(); const art = ms.metadata.artwork; const count = writes;
  let smooth = reconcileSmoothPosition(null, now(), 45000, clock);
  for (let i = 0; i < 10; i++) {
    clock += 1000;
    const slim = { kind: 'url', refId: a.refId, id: 'q-' + i, title: a.title };
    const raw = i % 2 ? 0 : 48000;
    const n = now(slim, 'playing', raw, i % 3 ? 200000 : 0, { version: 1 });
    smooth = reconcileSmoothPosition(smooth, n, n.positionMs, clock);
    set(n, {}, smooth.posMs); position(n, smooth.posMs, true);
  }
  assert.deepEqual(ms.metadata.artwork, art);
  assert.ok(writes <= count + 1, 'metadata stays stable across slim/zero blips');
  assert.ok(positions.every(p => p && p.duration === 200 && p.position >= 45), positions.map(p => p?.position));
});

test('F248 R1: one paused snapshot cannot confirm through set + immediate tick + repeated background ticks',()=>{
  reset(); const seed=now(a,'paused'); set(seed,{},45000); load(); clock+=1000;
  const zero=now(a,'paused',0); set(zero,{},0); position(zero,0,true);
  assert.equal(positions.at(-1).position,45);
  for(let i=0;i<20;i++){clock+=250;position(zero,0,true);set(zero,{},0);}
  assert.ok(positions.every(p=>p && p.position===45));
  // A NEW coherent paused poll can confirm an actual unversioned correction.
  const next=now(a,'paused',0);clock+=1000;set(next,{},0);position(next,0,true);
  assert.equal(positions.at(-1).position,0);
});
test('F248 R1: missing non-stop item retains ingest identity/clock; recovery zero is a first suspicious poll',()=>{
  reset(); let rec=reconcileSmoothPosition(null,now(),45000,clock); clock+=1000;
  rec=reconcileSmoothPosition(rec,{state:'playing',item:null,version:1},0,clock);
  assert.equal(rec.posMs,46000);assert.equal(rec.trackKey,mediaSessionTrackKey(a));clock+=1000;
  rec=reconcileSmoothPosition(rec,now(a,'playing',0),0,clock);
  assert.equal(rec.posMs,47000);assert.equal(rec.pending,0);clock+=1000;
  rec=reconcileSmoothPosition(rec,now(a,'playing',48000),48000,clock);
  assert.equal(rec.posMs,48000);assert.equal(rec.pending,null);
});
test('F248 R3: natural same-index/version Repeat One and one-item All recover on second progressing poll at 1s/3s/8s gaps',()=>{
  for(const repeat of ['one','all']) for(const gap of [1000,3000,8000]){
    reset();const seed=now(a,'playing',199000,200000,{repeat,version:7,index:0});
    let rec=reconcileSmoothPosition(null,seed,199000,clock);set(seed,{},rec.posMs,rec);load();
    for(let i=1;i<=12;i++){
      clock+=gap;const actual=i*gap-1000,n=now(a,'playing',actual,200000,{repeat,version:7,index:0});
      rec=reconcileSmoothPosition(rec,n,n.positionMs,clock);set(n,{},rec.posMs,rec);position(n,rec.posMs,true,rec);
      if(i===1)assert.ok(rec.posMs>=199000);else {assert.equal(rec.posMs,actual);assert.equal(positions.at(-1).position,actual/1000);}
    }
  }
});
test('F248 R3: slow alternating good/zero or tiny-positive polls never confirm; backwards/stationary low samples do not confirm while playing',()=>{
  for(const gap of [1000,3000,8000]){
    reset();let rec=reconcileSmoothPosition(null,now(),45000,clock);
    for(let i=1;i<=120;i++){
      clock+=gap;const raw=i%2? (i%3?0:16) :45000+i*gap;
      rec=reconcileSmoothPosition(rec,now(a,'playing',raw,2000000),raw,clock);
      assert.ok(rec.posMs>=45000);
    }
    clock+=gap;rec=reconcileSmoothPosition(rec,now(a,'playing',16,2000000),16,clock);clock+=gap;
    rec=reconcileSmoothPosition(rec,now(a,'playing',0,2000000),0,clock);assert.ok(rec.posMs>=45000);
    clock+=gap;rec=reconcileSmoothPosition(rec,now(a,'playing',0,2000000),0,clock);assert.ok(rec.posMs>=45000);
  }
});
test('F248 policy: 2000ms dead-band boundary is explicit; no blanket every-zero rejection claim',()=>{
  reset();const rec=reconcileSmoothPosition(null,now(a,'paused',45000),45000,clock);
  assert.equal(reconcileSmoothPosition(rec,now(a,'paused',43000),43000,clock+1000).posMs,43000);
  assert.equal(reconcileSmoothPosition(rec,now(a,'paused',42999),42999,clock+1000).posMs,45000);
  const early=reconcileSmoothPosition(null,now(a,'paused',1500),1500,clock);
  assert.equal(reconcileSmoothPosition(early,now(a,'paused',0),0,clock+1000).posMs,0);
});

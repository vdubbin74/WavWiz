// F212: stable lock-screen art. Node harness with fake navigator.mediaSession / MediaMetadata / Image.
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../src/WavWiz.Server/wwwroot');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
let metaWrites = 0; const pos = [];
globalThis.MediaMetadata = class { constructor(o) { Object.assign(this, o); metaWrites++; } };
const imgs = [];
globalThis.Image = class { constructor() { imgs.push(this); } set src(v) { this._src = v; } get src() { return this._src; } };
const ms = { metadata: null, playbackState: 'none', setActionHandler() {}, setPositionState(p) { pos.push(p); } };
Object.defineProperty(globalThis, 'navigator', { value: { mediaSession: ms }, configurable: true });
globalThis.Element = class { }; globalThis.document = { createElement: () => ({}) };
const { setMediaSession } = await import(path.join(ROOT, 'js/art.js'));
const loadAll = () => { while (imgs.length) imgs.shift().onload?.(); };
const isLogo = () => ms.metadata?.artwork?.[0]?.src === '/assets/logo-512.png';
const item = { id: 7, refId: 7, kind: 'track', title: 'Song', artist: 'A', album: 'B', artTrackId: 7 };
const np = (st, it = item, p = 30000) => ({ item: it, state: st, durationMs: 200000, positionMs: p });

setMediaSession(np('playing'), {}, 30000); loadAll();
ok('first track gets album art after preload', ms.metadata && !isLogo() && /\/art\/track\/7/.test(ms.metadata.artwork[3].src));
let w = metaWrites;
setMediaSession(np('paused'), {}, 31000); setMediaSession(np('playing'), {}, 31000); setMediaSession(np('none'), {}, 31000);
ok('play/pause/none: no new MediaMetadata', metaWrites === w, `${metaWrites - w} writes`);
ok('playbackState still follows state', ms.playbackState === 'none');
setMediaSession(np('playing'), {}, 32000);
const slim = { id: 7, refId: 7, kind: 'url', title: 'Song', artist: 'A', album: 'B' };   // no artTrackId: different (album) URL
const before = ms.metadata.artwork[3].src;
setMediaSession(np('playing', slim), {}, 33000);
ok('same track slim item: old album art kept while new art preloads', !isLogo() && ms.metadata.artwork[3].src === before);
loadAll(); ok('same track slim item: never logo after load', !isLogo());
const nullArt = { id: 7, refId: 7, kind: 'url', title: 'Song' };   // itemArtUrl -> null
setMediaSession(np('playing', nullArt), {}, 34000); loadAll();
ok('same track null art reuses last good art (no logo)', !isLogo() && ms.metadata.artwork?.length === 4);
const bare = { id: 9, refId: 9, kind: 'url', title: 'Other', artist: '', album: '' };
setMediaSession(np('playing', bare), {}, 0); loadAll();
ok('new track with no art gets logo', isLogo());
// metadata rewrite must re-publish real position, not 0
const t2 = { id: 11, refId: 11, kind: 'track', title: 'T2', artist: 'A', album: 'C', artTrackId: 11 };
setMediaSession(np('playing', t2, 5000), {}, 5000);
pos.length = 0; loadAll();
ok('art-settle metadata write keeps position (not 0:00)', pos.length > 0 && pos.at(-1).position >= 5, JSON.stringify(pos));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

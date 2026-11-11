// WavWiz 0.7.0 item 2 - radio now-playing on every surface: one pure helper (livemeta.js) used by Now Playing's neighbours
// (mini player, Devices tiles + strip, zone menu, both queue views, MediaSession for the phone lock screen).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const src = n => readFileSync(`${js}/${n}.js`, 'utf8');
const { liveSong, nowLines, mediaSessionMeta } = await import(`${js}/livemeta.js`);
const radio = { kind: 'radio', refId: 7, title: 'KEXP 90.3' };

test('0.7.0 radio: split artist/song wins, raw StreamTitle is the fallback, non-radio is untouched', () => {
  assert.deepEqual(liveSong({ item: radio, liveSong: 'Heart of Glass', liveArtist: 'Blondie', liveTitle: 'Blondie - Heart of Glass' }), { song: 'Heart of Glass', artist: 'Blondie', station: 'KEXP 90.3' });
  assert.deepEqual(liveSong({ item: radio, liveTitle: 'Station ID' }), { song: 'Station ID', artist: null, station: 'KEXP 90.3' });
  assert.equal(liveSong({ item: radio }), null);
  assert.equal(liveSong({ item: { kind: 'track', title: 'x' }, liveSong: 'y' }), null);
  // a zone's now (flat object from /groups) works too
  assert.equal(liveSong({ kind: 'radio', title: 'KEXP 90.3', liveSong: 'Song', liveArtist: 'A' }).station, 'KEXP 90.3');
});

test('0.7.0 radio: compact lines and lock-screen metadata', () => {
  const n = { item: radio, liveSong: 'Heart of Glass', liveArtist: 'Blondie' };
  assert.deepEqual(nowLines(n), { title: 'Heart of Glass', sub: 'Blondie · KEXP 90.3', artist: 'Blondie', station: 'KEXP 90.3', live: true });
  assert.equal(nowLines({ item: radio, liveTitle: 'News' }).sub, 'KEXP 90.3');
  assert.deepEqual(nowLines({ item: { kind: 'track', title: 'T', artist: 'A' } }), { title: 'T', sub: 'A', artist: 'A', station: null, live: false });
  assert.deepEqual(mediaSessionMeta(n), { title: 'Heart of Glass', artist: 'Blondie', album: 'KEXP 90.3' });
  assert.deepEqual(mediaSessionMeta({ item: radio }), { title: 'KEXP 90.3', artist: '', album: 'WavWiz' });   // nothing from the station = as before
  assert.deepEqual(mediaSessionMeta({ item: { kind: 'track', title: 'T', artist: 'A', album: 'B' } }), { title: 'T', artist: 'A', album: 'B' });
});

test('0.7.0 radio: every surface uses the helper', () => {
  assert.match(src('mini'), /nowLines\(now\)/);
  assert.match(src('mini'), /lab\('Station', nl\.station\)/);
  assert.match(src('devices'), /nowLines\(n, item\)/);
  assert.match(src('devices'), /nowLines\(S\.now\)/);
  assert.match(src('zones40'), /liveSong\(now\)/);
  assert.match(src('art'), /mediaSessionMeta\(now, it\)/);
  assert.match(src('main'), /qLiveLine\(playing \? liveSong\(S\.now, q\) : null\)/);
  assert.match(src('main'), /it\.kind === 'radio' \? S\.now\?\.liveTitle/);   // the queue repaints when the song changes
  assert.match(src('listtable'), /isCur \? liveSong\(V\.now, q\)/);
  assert.match(src('main'), /\(liveSong\(S\.now, item\)\)/);                       // phone queue "Now playing" card
  assert.match(src('zones40'), /liveSong\(now\)\?\.song \|\| now\.title/);              // zone now line in the Devices tree
  assert.match(src('zones40'), /n\?\.liveTitle \|\| null\]\)/);                         // ...repaints when the song changes
  assert.match(src('now'), /radio && \(n\.liveSong \|\| n\.liveTitle\) \? t2\.textContent/);   // phone bottom bar
});

test('0.7.0 radio: zone menu label names the song (source check: zones40.js needs a DOM to import)', () => {
  assert.match(src('zones40'), /\(l \? `\$\{l\.song\} · \$\{l\.station\}` : now\.title\)/);
});

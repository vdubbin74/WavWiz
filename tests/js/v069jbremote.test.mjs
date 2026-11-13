// 0.6.9 #28 (t1878): Remote library songs in the Jukebox guest search - added by "server:song" (rid), the source named in the small artist line,
// covers through the guest Remote route; local songs, the layout and Radio (never in the guest search) are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const JS = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js/', import.meta.url).pathname;
const g = readFileSync(join(JS, 'jukebox-guest.js'), 'utf8');
const line = name => g.split('\n').find(l => l.startsWith(`const ${name} =`));

test('artOf: track id -> guest art, Remote -> the server-named guest route with the code, nothing -> placeholder', () => {
  const artOf = new Function('code', [line('art'), line('artOf'), 'return artOf;'].join('\n'))('AB12');
  assert.equal(artOf({ trackId: 7 }), '/api/v1/jukebox/guest/art/7?size=128&j=AB12');
  assert.equal(artOf({ trackId: null, art: '/api/v1/jukebox/guest/rart/srv1/al-1' }), '/api/v1/jukebox/guest/rart/srv1/al-1?size=128&j=AB12');
  assert.equal(artOf({ title: 'Station' }), '');
  assert.equal(artOf(null), '');
});

test('songKey: the track id, else the Remote rid', () => {
  const songKey = new Function(line('songKey') + '; return songKey;')();
  assert.equal(songKey({ id: 4 }), 4);
  assert.equal(songKey({ id: null, rid: 'srv1:r1' }), 'srv1:r1');
});

test('add sends trackId for Local and rid for Remote; rows, Now playing, Up next and the TV board all use artOf', () => {
  assert.match(g, /call\('\/add', t\.id != null \? \{ guest: gid, name: nameIn\.value\.trim\(\), trackId: t\.id \} : \{ guest: gid, name: nameIn\.value\.trim\(\), rid: t\.rid \}\); added\.add\(songKey\(t\)\)/);
  assert.equal((g.match(/artOf\(/g) || []).length, 5);
  assert.equal((g.match(/trackId \? art\(/g) || []).length, 1, 'only artOf itself picks the track route - no art path left that skips Remote items');
  // the source is subtle: the same small line as the artist, no new element or class (no layout change)
  assert.match(g, /const sub = s\.src \? \[s\.artist, s\.src\]\.filter\(Boolean\)\.join\(' · '\) : s\.artist;/);
  assert.match(g, /el\('small', \{\}, sub\)\), btn\);\n  return el\('div', \{ class: 'jb-row' \}, artBox\(artOf\(\{ trackId: s\.id, art: s\.art \}\), 'jb-thumb'\), el\('div', \{ class: 'jb-t' \}, el\('b', \{\}, s\.title\), el\('small', \{\}, sub\)\), btn\);/);
});

test('the big screen (kiosk) uses the same Remote cover route for Now playing and Up next', () => {
  const k = readFileSync(join(JS, 'jukebox-kiosk.js'), 'utf8');
  assert.match(k, /const kArt = \(x, size\) => x\?\.trackId \? jbArt\(x\.trackId, size\) : x\?\.art && code \? `\$\{x\.art\}\?size=\$\{size\}&j=\$\{encodeURIComponent\(code\)\}` : '';/);
  assert.match(k, /cover = setArt\(cover, kArt\(b\.now, 512\)\);/);
  assert.match(k, /const u = kArt\(n, 512\);/);
  assert.match(k, /thumb\(x\)/);
  assert.doesNotMatch(k, /thumb\(x\.trackId\)|jbArt\(b\.now\.trackId|jbArt\(n\.trackId/);
});

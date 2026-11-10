// 0.6.8: Library artist (and genre/year/folder) rows/tiles drag to the queue; remote artists use the same path as albums.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const www = process.env.WW_WWW || join(dirname(fileURLToPath(import.meta.url)), '../../src/WavWiz.Server/wwwroot');
const lib = readFileSync(join(www, 'js/library.js'), 'utf8');
const ui = readFileSync(join(www, 'js/ui.js'), 'utf8');

test('local artists / genres / years / folders attach a node ref for drag', () => {
  assert.match(lib, /refNode\('artist:' \+ a\.name\)/);
  assert.match(lib, /refNode\(key \+ ':' \+ n\.name\)/); // genre / year countRow + tiles
  assert.match(lib, /refNode\('folder:' \+ f\.path\)/);
  assert.match(lib, /refNode\('decade:' \+ n\.name\)/);
  // attachItem is what sets draggable + MIME payload
  assert.match(ui, /el\.draggable = true/);
  assert.match(ui, /setData\(MIME, JSON\.stringify\(ref\)\)/);
});

test('remote artists use attachItem with {kind:remote, artist} like albums use album', () => {
  assert.match(lib, /rartistDrag = \(el, sid, a/);
  assert.match(lib, /kind: 'remote', server: sid, artist: a\.id/);
  assert.match(lib, /return rartistDrag\(el, sid, a, true\)/); // list rows
  assert.match(lib, /rartistDrag\(h\('li', \{ class: 'tile atile'/); // tiles
  // albums still drag
  assert.match(lib, /kind: 'remote', server: sid, album: al\.id/);
});

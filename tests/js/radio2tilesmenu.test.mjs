// RADIO-2: Find stations tiles follow the Radio view toggle; context menu replaces ★/✕; drag to queue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const www = process.env.WW_WWW || join(here, '../../src/WavWiz.Server/wwwroot');
const js = rel => readFileSync(join(www, 'js', rel), 'utf8');
const css = () => readFileSync(join(www, 'app.css'), 'utf8');

test('RADIO-2 search results use tilegrid when Radio view is grid', () => {
  const f = js('radiofinder.js'), r = js('radiostation.js');
  assert.match(r, /export const radioGridOn/);
  assert.match(f, /radioGridOn\(\)/);
  assert.match(f, /tilegrid tg-radio radfind-grid/);
  assert.match(f, /finderStationTile/);
  assert.match(f, /finderStationRow/);
});

test('RADIO-2 no star or X action buttons on My stations or Find results; favorite is indicator + menu only', () => {
  const t = js('radiotab.js'), f = js('radiofinder.js'), r = js('radiostation.js');
  assert.doesNotMatch(t, /aria-label': 'Favorite'/);
  assert.doesNotMatch(t, /ww-close/);
  assert.doesNotMatch(r, /aria-label': 'Favorite'/);
  assert.doesNotMatch(r, /ww-close/);
  assert.match(r, /rad-favmark/);
  assert.match(r, /heartOn/);
  assert.doesNotMatch(r, /★/);
  assert.match(r, /Add to favorites/);
  assert.match(r, /Remove from favorites/);
  assert.match(r, /attachCtx/);
  assert.doesNotMatch(f, /onclick: \(\) => fav\(/);
  assert.doesNotMatch(f, /'★'/);
});

test('RADIO-2 drag payload matches library queue drops; unsaved play/queue saves first', () => {
  const r = js('radiostation.js');
  assert.match(r, /kind: 'radio', id: r\.id/);
  assert.match(r, /lib: true, ref/);
  assert.match(r, /pointerDragSource/);
  assert.match(r, /\/radio\/finder\/save/);
  assert.match(r, /Play next/);
  assert.match(r, /Add to queue/);
  assert.match(r, /Save to My Stations/);
  assert.match(r, /ask\('Remove station'/);
});

test('RADIO-2 CSS for favorite mark and finder tiles', () => {
  const s = css();
  assert.match(s, /RADIO-2/);
  assert.match(s, /\.rad-favmark/);
  assert.match(s, /\.radfind-grid/);
});

test('RADIO-2 station logos use same-origin art proxy, never raw logoUrl/favicon as <img> src', () => {
  const r = js('radiostation.js'), a = js('art.js');
  assert.match(a, /export const remoteArt/);
  assert.match(a, /\/remote\/\$\{encodeURIComponent\(hash\)\}/);
  assert.doesNotMatch(a, /remote\?url=/);
  // Saved stations: /art/radio/{id} first whenever an id is present (logo_url is fetched server-side).
  assert.match(r, /r\.id != null/);
  assert.match(r, /radioArt\(r\.id, size\)/);
  assert.match(r, /remoteArt\(r\.faviconArt, size\)/);
  // Must not send a raw remote URL to the proxy (SSRF) or use it as <img> src (CSP blocks it → generated fallback).
  assert.doesNotMatch(r, /remoteArt\(r\.favicon\b(?!Art)/);
  assert.doesNotMatch(r, /src = r\.logoUrl \|\| r\.favicon \|\| \(r\.id/);
});

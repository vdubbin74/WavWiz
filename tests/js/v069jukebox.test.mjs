// 0.6.9 Jukebox (t1840/t1841/t1842): J1 no broken-image covers (album-cover fallback + tidy placeholder), J2 Modern Up next does not
// flash (no per-tick rebuild / re-request), J3 limit survives a cleared browser (server side), J4 richer guest phone screen, J5 the
// big-screen visualizer follows the Jukebox zone and is sized in real screen pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installDom, ev } from './minidom.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const js = process.env.JS_DIR || join(here, '../../src/WavWiz.Server/wwwroot/js');
const src = f => readFileSync(join(js, f), 'utf8');
const imp = f => import(pathToFileURL(join(js, f + '.js')).href);
installDom();

test('J1/J2 artBox: placeholder under the picture, a 204 / error never shows a broken image and is never requested again', async () => {
  const v = await imp('jukebox-view');
  const a = v.artBox('/api/v1/jukebox/art/7?size=128', 'jb-th');
  assert.ok(a.classList.contains('jb-art')); assert.ok(!a.classList.contains('has'));
  const img = a.querySelector('img'); assert.ok(img, 'the picture is requested once');
  img.naturalWidth = 0; img.dispatchEvent(ev('load'));                       // 204 No Content = a load with no pixels
  assert.equal(a.querySelector('img'), null, 'no broken image left behind'); assert.ok(v.artFailed.has('/api/v1/jukebox/art/7?size=128'));
  const again = v.artBox('/api/v1/jukebox/art/7?size=128', 'jb-th');
  assert.equal(again.querySelector('img'), null, 'a failed cover is not asked for again on the next paint');
  const ok = v.artBox('/api/v1/jukebox/art/8?size=128'); const i2 = ok.querySelector('img'); i2.naturalWidth = 128; i2.dispatchEvent(ev('load'));
  assert.ok(ok.classList.contains('has')); assert.ok(v.artBox('/api/v1/jukebox/art/8?size=128').classList.contains('has'), 'a loaded cover shows at once next time');
  const e = v.artBox('/api/v1/jukebox/art/9'); e.querySelector('img').dispatchEvent(ev('error')); assert.equal(e.querySelector('img'), null);
  assert.equal(v.artBox('').querySelector('img'), null, 'no url = placeholder only');
});
test('J2 rowsSig: unchanged rows = same signature; a new song, requester or order changes it', async () => {
  const { rowsSig } = await imp('jukebox-view');
  const r = [{ id: 1, trackId: 5, title: 'Amber', artist: '311', by: 'Tbone' }, { id: 2, trackId: 6, title: 'Enter Sadman', artist: 'Metallica', by: 'Tbone' }];
  assert.equal(rowsSig(r, 'x'), rowsSig(r.map(o => ({ ...o, index: 9 })), 'x'));
  assert.notEqual(rowsSig(r), rowsSig([r[1], r[0]])); assert.notEqual(rowsSig(r), rowsSig([{ ...r[0], by: 'Sam' }, r[1]])); assert.notEqual(rowsSig(r, 'a'), rowsSig(r, 'b'));
});
test('J2 kiosk Modern: frame built once, Up next rebuilt only on change, covers via the Jukebox art endpoint', () => {
  const k = src('jukebox-kiosk.js');
  assert.match(k, /if \(sig !== nextSig\) \{/); assert.match(k, /cover = setArt\(cover,/);
  assert.match(k, /\/api\/v1\/jukebox\/art\/\$\{id\}\?size=/);
  assert.doesNotMatch(k, /left\.replaceChildren\(|right\.replaceChildren\(/, 'no whole-panel rebuild every second');
  assert.doesNotMatch(k, /h\('img', \{ class: 'jb-th'/, 'no bare <img> thumbs (broken-image icon on a 204)');
  assert.match(k, /if \(jQr\.getAttribute\('src'\) !== qrSrc\(\)\) jQr\.src = qrSrc\(\)/, 'the QR is not re-requested every tick');
});
test('J5 kiosk visualizer: follows the Jukebox zone while open, crisp under Display size, released on close', () => {
  const k = src('jukebox-kiosk.js'), v = src('viz.js');
  assert.match(k, /setVizZone\(jbOwn \? 'jukebox' : 'default'\)/); assert.match(k, /setVizZone\(undefined\)/); assert.match(k, /new Viz\(bg, \{ preview: false, crisp: true \}\)/);
  assert.match(v, /export function setVizZone\(key\)/); assert.match(v, /if \(zoneOverride !== undefined\) return zoneOverride;/);
  assert.match(v, /this\.crisp \? \(Number\(this\.host\.currentCSSZoom\)/);
});
test('J4 guest helpers: added position line, picks left, vote progress, live position', async () => {
  const c = await imp('jukebox-core');
  assert.equal(c.addedLine(4), 'Added! You’re #4 in line.'); assert.equal(c.addedLine(1), 'Added! You’re up next.'); assert.equal(c.addedLine(0), 'Added! It’s playing now.'); assert.equal(c.addedLine(-1), 'Added to the queue.');
  assert.equal(c.picksLeftLine({ perGuest: 3, playsLeft: 2 }, 'g'), '2 of 3 picks left'); assert.equal(c.picksLeftLine({ perGuest: 1, playsLeft: 0 }, 'g'), '0 of 1 pick left');
  assert.deepEqual(c.voteInfo({ votes: 1, votesNeeded: 3 }), { frac: 1 / 3, label: 'Skip · 1 of 3 votes' });
  assert.equal(c.voteInfo({ votes: 2, votesNeeded: 3, voted: true }).label, 'Voted · 2 of 3 votes');
  assert.equal(c.livePos({ positionMs: 1000, durationMs: 5000, state: 'playing' }, 1500), 2500);
  assert.equal(c.livePos({ positionMs: 1000, durationMs: 5000, state: 'paused' }, 1500), 1000);
  assert.equal(c.livePos({ positionMs: 4900, durationMs: 5000, state: 'playing' }, 9000), 5000);
});
test('J4 guest page: Search & add | Queue tabs, live NP card, own picks removable, vote progress, no login', () => {
  const g = src('jukebox-guest.js');
  assert.match(g, /tabBtn\('search', 'Search & add'\), tabQueue = tabBtn\('queue', 'Queue'\)/);
  assert.match(g, /app\.replaceChildren\(title, npSlot, noteSlot, nameIn, tabs, searchBox, msgSlot, bodySlot, foot\)/);
  assert.match(g, /class: 'jbg-prog'/); assert.match(g, /tickProg\(\)/); assert.match(g, /'Requested by you'/);
  assert.match(g, /call\('\/remove', \{ guest: gid, id: x\.id \}\)/); assert.match(g, /x\.mine && !now/);
  assert.match(g, /flash\(addedLine\(r\?\.position\), true\)/); assert.match(g, /voteInfo\(b\)/); assert.match(g, /picksLeftLine\(b, gid\)/);
  assert.match(g, /if \(sig === queueSig && bodySlot\.firstChild\) return;/); assert.match(g, /if \(sig === tvSig && bodySlot\.firstChild\) return;/);
  assert.doesNotMatch(g, /from '\.\/util\.js'/);
  assert.doesNotMatch(g, /el\('img', \{ src: art\(/, 'no bare <img> covers');
});
test('J1 CSS: placeholder has no fixed colors and the eq animation respects reduced motion', () => {
  const css = readFileSync(join(js, '../jukebox.css'), 'utf8');
  assert.match(css, /span\.jb-art[^{]*\{[^}]*linear-gradient\(135deg,var\(--accent\)/); assert.match(css, /span\.jb-art\.has>img\{opacity:1\}/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.jbg-npc\.playing \.jbg-eq i\{animation:none/);
});

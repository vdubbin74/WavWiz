// WavWiz 0.4.1: pure helpers (iPhone Home Screen prompt, mini keys, menus, drop zones, toast dedupe).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1';

test('0.4.1 E: the Home Screen card is for iPhone Safari that is not installed', async () => {
  const a = await imp('a2hs');
  assert.equal(a.isIosSafari(IOS), true);
  assert.equal(a.isIosSafari(CHROME_IOS), false);
  assert.equal(a.isIosSafari('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537'), false);
  assert.equal(a.shouldOffer({ ua: IOS, standalone: false }), true);
  assert.equal(a.shouldOffer({ ua: IOS, standalone: true }), false, 'hidden once installed');
  assert.equal(a.shouldOffer({ ua: IOS, standalone: false, dismissed: true }), false);
  assert.equal(a.isStandalone({ navigator: { standalone: true } }), true);
  assert.equal(a.isStandalone({ navigator: {}, matchMedia: () => ({ matches: true }) }), true);
  assert.equal(a.isStandalone({ navigator: {}, matchMedia: () => ({ matches: false }) }), false);
});
test('0.4.1 E: the Home Screen start address carries the device id; only a valid one is taken', async () => {
  const a = await imp('a2hs');
  assert.equal(a.roomFromSearch('?wr=abcdef123456'), 'abcdef123456');
  assert.equal(a.roomFromSearch('?wr=<script>'), null);
  assert.equal(a.roomFromSearch(''), null);
  assert.equal(a.rememberedAll({ calibrated: true, named: true, mic: true }), true);
  assert.equal(a.rememberedAll({ calibrated: true, named: false, mic: true }), false);
});
test('0.4.1 C: mini player keys (play/pause, next, previous, volume, mute, close)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(`${js}/mini.js`, 'utf8');
  for (const a of ["'playpause'", "'next'", "'prev'", "'volup'", "'voldown'", "'mute'", "'close'"]) assert.ok(src.includes(a), a);
});
test('0.4.1 B: a drop in the middle links, the edges reorder', async () => {
  const d = await imp('devorder');
  const r = { top: 100, height: 100 };
  assert.equal(d.inMiddle(r, 150), true); assert.equal(d.inMiddle(r, 110), false); assert.equal(d.inMiddle(r, 190), false);
});

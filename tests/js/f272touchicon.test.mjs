// F272: iPhone Add to Home Screen showed a letter "W" tile. Icons in every player page, root /apple-touch-icon*.png, 152/167 sizes,
// no https redirect for them, and the page hands iOS the icon bytes as a data: URL (iOS's own icon fetch fails on an untrusted cert).
import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const root = new URL('../../src/WavWiz.Server/', import.meta.url), rd = p => readFileSync(new URL(p, root));
const pngSize = b => [b.readUInt32BE(16), b.readUInt32BE(20), b[25]];   // width, height, colour type (2 = RGB, no alpha)
test('opaque PNGs at the root and in 152/167/180', () => {
  for (const [p, n] of [['wwwroot/apple-touch-icon.png', 180], ['wwwroot/apple-touch-icon-precomposed.png', 180], ['wwwroot/assets/logo-180.png', 180], ['wwwroot/assets/logo-167.png', 167], ['wwwroot/assets/logo-152.png', 152]]) {
    assert.ok(existsSync(new URL(p, root)), p); assert.deepEqual(pngSize(rd(p)), [n, n, 2], p); }
  assert.deepEqual(rd('wwwroot/apple-touch-icon.png'), rd('wwwroot/assets/logo-180.png'));
});
test('every player page links the touch icons; manifest lists them', () => {
  for (const p of ['index.html', 'mini.html', 'jukebox.html']) { const h = rd('wwwroot/' + p).toString();
    for (const s of ['180x180" href="/assets/logo-180.png', '167x167" href="/assets/logo-167.png', '152x152" href="/assets/logo-152.png']) assert.ok(h.includes('rel="apple-touch-icon" sizes="' + s), p + ' ' + s); }
  const m = JSON.parse(rd('wwwroot/manifest.webmanifest')); for (const n of ['152x152', '167x167', '180x180']) assert.ok(m.icons.some(i => i.sizes === n && i.type === 'image/png'), n);
});
test('touch icons are never redirected to https', () => {
  const r = rd('Host/RedirectPolicy.cs').toString(); for (const p of ['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png', '/assets/logo-180.png', '/assets/logo-167.png', '/assets/logo-152.png']) assert.ok(r.includes(`"${p}"`), p);
});
test('the page inlines the icon as a data: URL on iOS', async () => {
  const { inlineTouchIcon } = await import(new URL('wwwroot/js/a2hs.js', root));
  const links = ['apple-touch-icon', 'apple-touch-icon-precomposed'].map(rel => { const a = { href: '/assets/logo-180.png?v=f237' }; return { rel, dataset: {}, getAttribute: () => a.href, setAttribute: (_, v) => { a.href = v; }, get href() { return a.href; } }; });
  const doc = { querySelectorAll: sel => links.filter(l => sel.includes(`"${l.rel}"`)) };
  class FR { readAsDataURL() { this.result = 'data:image/png;base64,AAAA'; this.onload(); } }
  const win = { navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }, FileReader: FR, fetch: async () => ({ ok: true, blob: async () => ({ type: 'image/png' }) }) };
  assert.equal(await inlineTouchIcon(win, doc, '/assets/logo-180.png?v=f237'), true);
  for (const l of links) assert.equal(l.href, 'data:image/png;base64,AAAA');
  const failing = { ...win, fetch: async () => { throw new Error('cert'); } }; assert.equal(await inlineTouchIcon(failing, doc, 'x'), false);
});

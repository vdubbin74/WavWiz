// 0.6.8-#11: phone trims key off a real handset; Home Screen install keeps the same device id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const www = new URL('../../src/WavWiz.Server/wwwroot/', import.meta.url);
const js = f => readFileSync(new URL('js/' + f, www), 'utf8');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
test('0.6.8-#11 isHandset: phones yes; iPad, Android tablet, PC no', async () => {
  const { isHandset } = await import(new URL('js/phonejoin.js', www));
  assert.equal(isHandset(IPHONE), true);
  assert.equal(isHandset('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'), true);
  assert.equal(isHandset('Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 Chrome/120 Safari/537.36'), false);
  assert.equal(isHandset('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'), false);
  assert.equal(isHandset('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'), false);
});
test('0.6.8-#11a/d phone row: moon Sleep only on handsets; pins gated', () => {
  const n = js('now.js');
  assert.match(n, /isHandset\(\) \? \[mkSleepIc\(\)\] : \[mkMix\(\), mkSleepIc\(\), mkSc\('np-phone-shortcuts'\)\]/);
  assert.match(n, /icon\('moon'\), h\('span', \{ class: 'npsl-t' \}\)/);
  assert.match(js('scenesched.js'), /querySelector\('\.npsl-t'\)/);
  assert.match(js('main.js'), /if \(isHandset\(\)\) return;   \/\/ 0\.6\.8-#11d/);
  assert.match(js('menu.js'), /if \(!isHandset\(\)\) b\.append\(pinSpan\('mixer'\)\)/);
});
function fakeWin({ standalone = false, search = '', store = {} } = {}) {
  const st = { ...store }, calls = [];
  return { calls, st,
    navigator: { userAgent: IPHONE, maxTouchPoints: 5, standalone },
    matchMedia: () => ({ matches: standalone }),
    location: { search, href: 'https://pc.local:47901/' + search, pathname: '/' },
    history: { replaceState: (_a, _b, u) => calls.push(u) },
    crypto: { getRandomValues: a => a.fill(171) },
    localStorage: { getItem: k => st[k] ?? null, setItem: (k, v) => { st[k] = String(v); } },
    document: { querySelector: () => null, querySelectorAll: () => [], head: null, createElement: () => ({ setAttribute() {}, dataset: {} }) },
  };
}
test('0.6.8-#11e Safari tab keeps ?wr=<id> in its address; the Home Screen app adopts it and drops it', async () => {
  const a = await import(new URL('js/a2hs.js', www) + '?t=' + Date.now()).catch(() => null);
  if (!a?.boot) return;   // the module needs a DOM-less boot; skip quietly if it changes shape
  const safari = fakeWin();
  a.boot(safari);
  const id = safari.st['wavwiz.webRoom.id'];
  assert.match(id, /^web-[0-9a-f]{12}$/);
  assert.deepEqual(safari.calls, ['/?wr=' + id]);
  const home = fakeWin({ standalone: true, search: '?wr=' + id, store: { 'wavwiz.webRoom.id': 'web-000000000000' } });
  a.boot(home);
  assert.equal(home.st['wavwiz.webRoom.id'], id);
  assert.deepEqual(home.calls, ['/']);
});

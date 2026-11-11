// WavWiz 0.7.0 item 5: (a) the AirPlay card restored open after a reload scans by itself instead of sitting on "Looking…";
// (b) "Add by IP address" on the Cast card. Real module code on the tiny DOM, with a stubbed fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom } from './minidom.mjs';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const doc = installDom(); globalThis.window ??= globalThis; globalThis.addEventListener ??= () => {}; globalThis.removeEventListener ??= () => {}; globalThis.dispatchEvent ??= () => true;
globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.requestAnimationFrame ??= f => setTimeout(f, 0);
const calls = []; let reply = () => ({});
globalThis.fetch = async (url, init = {}) => { calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null }); const r = reply(url, init); const st = r.__status || 200; delete r.__status; return { ok: st < 400, status: st, text: async () => JSON.stringify(r) }; };
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const S = { zones: [], groups: [] };
const mount = el => { doc.body.replaceChildren(el); return el; };

test('5a: AirPlay card restored OPEN from sessionStorage after a reload starts a scan and shows the speakers (not "Looking…" forever)', async () => {
  sessionStorage.setItem('ww.apsetup.open', '1');                         // the tab had the card open before the reload
  const m = await import(pathToFileURL(join(js, 'airplaysetup.js')).href + '?reload');
  calls.length = 0;
  reply = url => url.endsWith('/airplay/setup/devices') ? { devices: [{ id: 'k1', name: 'Kitchen', airplay2: false, route: 'raop' }], airPlay2Experimental: false } : { ok: true };
  const card = mount(m.airPlaySetupCard(S, {}));
  assert.equal(card.querySelector('.qb42-st').textContent, 'Looking…');   // first paint, before any answer
  await tick(60);
  assert.ok(calls.some(c => c.url === '/api/v1/dev/airplay/query' && c.method === 'POST'), 'scan started by itself');
  assert.ok(calls.some(c => c.url === '/api/v1/airplay/setup/devices'), 'list loaded');
  const now = doc.querySelector('.apsetup-card');
  assert.equal(now.querySelector('.qb42-st').textContent, '1 on this network');
  assert.match(now.querySelector('.apsetup-list').textContent, /Kitchen/);
  // a rebuild (zones redraw) does not start a second scan
  const n = calls.filter(c => c.url.endsWith('/dev/airplay/query')).length; mount(m.airPlaySetupCard(S, {})); await tick(30);
  assert.equal(calls.filter(c => c.url.endsWith('/dev/airplay/query')).length, n);
  m._apReset();
});

test('5a: a failed search says so on the card instead of "Looking…" (the error used to be dropped when no speaker was selected)', async () => {
  sessionStorage.setItem('ww.apsetup.open', '1');
  const m = await import(pathToFileURL(join(js, 'airplaysetup.js')).href + '?fail');
  reply = () => ({ __status: 500, error: 'AirPlay browser is not running' });
  mount(m.airPlaySetupCard(S, {})); await tick(60);
  const c = doc.querySelector('.apsetup-card');
  assert.equal(c.querySelector('.qb42-st').textContent, 'Couldn’t search');
  assert.match(c.querySelector('.apsetup-empty').textContent, /AirPlay browser is not running/);
  m._apReset();
});

test('5b: Cast card "Add by IP address": form posts the address (and optional name), then opens the new row at Play test sound', async () => {
  sessionStorage.setItem('ww.castsetup.open', '1');                       // open state is read when the module loads
  const m = await import(pathToFileURL(join(js, 'castsetup.js')).href + '?byip');
  assert.equal(m.csByIpBody('  ', 'x'), null);
  assert.deepEqual(m.csByIpBody(' 192.168.1.40 ', ''), { address: '192.168.1.40' });
  assert.deepEqual(m.csByIpBody('192.168.1.40', '  Garage '), { address: '192.168.1.40', name: 'Garage' });
  assert.equal(m.csByIpBody('10.0.0.2', 'x'.repeat(60)).name.length, 40);

  let manual = [];
  reply = (url, init) => {
    if (url.endsWith('/cast/setup/byip')) { const b = JSON.parse(init.body); if (b.address === 'nope') return { __status: 400, code: 'input', text: '"nope" is not an IP address.' }; manual = [{ id: 'ip-192.168.1.40', name: b.name, address: '192.168.1.40', port: 8009, kind: 'speaker', manual: true, added: false }]; return { ok: true, id: 'ip-192.168.1.40', name: b.name }; }
    if (url.endsWith('/cast/setup/devices')) return { running: true, devices: manual };
    return { ok: true };
  };
  mount(m.castSetupCard(S, {}));
  try {
  await tick(60);
  let c = doc.querySelector('.castsetup-card');
  const link = c.querySelector('[data-act="castsetup-byip"]'); assert.ok(link, 'Add by IP address link under the list'); link.click();
  c = doc.querySelector('.castsetup-card');
  const ip = c.querySelector('[data-act="castsetup-ip"]'), go = c.querySelector('[data-act="castsetup-ip-go"]');
  assert.ok(ip && go); assert.equal(go.disabled, true, 'Add is off until an address is typed');
  // the 3 s list poll must not rebuild the card while the address is being typed (focus would jump out of the box)
  ip.focus?.(); const before = doc.querySelector('.castsetup-card'); await tick(3300);
  assert.equal(doc.querySelector('.castsetup-card'), before, 'card not repainted while the form is open');
  // a bad address: the server's words show in the form, nothing is added
  ip.value = 'nope'; ip.dispatchEvent({ type: 'input', bubbles: true, target: ip });
  doc.querySelector('[data-act="castsetup-byip-form"]').dispatchEvent({ type: 'submit', bubbles: true, preventDefault() {} }); await tick(30);
  assert.match(doc.querySelector('.castsetup-byip [role="alert"]').textContent, /not an IP address/);
  // a good one with a name
  const ip2 = doc.querySelector('[data-act="castsetup-ip"]'); ip2.value = '192.168.1.40'; ip2.dispatchEvent({ type: 'input', bubbles: true, target: ip2 });
  const nm = doc.querySelector('[data-act="castsetup-ipname"]'); nm.value = 'Garage'; nm.dispatchEvent({ type: 'input', bubbles: true, target: nm });
  doc.querySelector('[data-act="castsetup-byip-form"]').dispatchEvent({ type: 'submit', bubbles: true, preventDefault() {} }); await tick(40);
  const post = calls.filter(x => x.url.endsWith('/cast/setup/byip')).pop();
  assert.deepEqual(post.body, { address: '192.168.1.40', name: 'Garage' });
  c = doc.querySelector('.castsetup-card');
  assert.equal(c.querySelector('.castsetup-byip'), null, 'form closes after a successful add');
  const row = c.querySelector('.apsetup-row.sel'); assert.ok(row, 'the new row is open');
  assert.match(row.textContent, /Garage/); assert.match(row.querySelector('.castsetup-addr').textContent, /192\.168\.1\.40/);
  assert.ok(row.querySelector('[data-act="castsetup-test"]'), 'next step is Play test sound');
  } finally { m._csReset(); }
});

test('5b: the server route and its stored address (source check)', () => {
  const api = readFileSync(new URL('../../src/WavWiz.Server/Api/CastApi.cs', import.meta.url), 'utf8');
  assert.match(api, /g\.MapPost\("\/cast\/setup\/byip"/);
  assert.match(api, /CastSpeakers\.Register\(s, o, ep\)/);
});

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
const S = { auth: { role: 'admin' }, zones: [], groups: [] };
const sheet = () => doc.querySelector('.addspk-dlg') || doc.querySelector('.addspk-root');

test('5a: opening the Add speaker AirPlay tab starts a scan and shows the speakers (not "Looking…" forever)', async () => {
  const m = await import(pathToFileURL(join(js, 'airplaysetup.js')).href);
  const add = await import(pathToFileURL(join(js, 'addspeaker.js')).href);
  add._addSpkReset(); m._apReset();
  calls.length = 0;
  reply = url => String(url).endsWith('/airplay/setup/devices') ? { devices: [{ id: 'k1', name: 'Kitchen', airplay2: false, route: 'raop' }], airPlay2Experimental: false, running: true } : { ok: true };
  add.openAddSpeaker(S, {}, 'airplay');
  await tick(60);
  assert.ok(calls.some(c => String(c.url).endsWith('/dev/airplay/query') && c.method === 'POST'), 'scan started by itself');
  assert.ok(calls.some(c => String(c.url).endsWith('/airplay/setup/devices')), 'list loaded');
  const now = sheet();
  assert.match(now.querySelector('.addspk-status').textContent, /1 new on this network|1 on this network/);
  assert.match(now.querySelector('.apsetup-list').textContent, /Kitchen/);
  const n = calls.filter(c => String(c.url).endsWith('/dev/airplay/query')).length;
  try { window.dispatchEvent(new CustomEvent('wavwiz:devredraw')); } catch {}
  await tick(30);
  assert.equal(calls.filter(c => String(c.url).endsWith('/dev/airplay/query')).length, n);
  m._apReset(); add._addSpkReset();
});

test('5a: a failed search says so on the sheet instead of "Looking…" (the error used to be dropped when no speaker was selected)', async () => {
  const m = await import(pathToFileURL(join(js, 'airplaysetup.js')).href);
  const add = await import(pathToFileURL(join(js, 'addspeaker.js')).href);
  add._addSpkReset(); m._apReset();
  reply = () => ({ __status: 500, error: 'AirPlay browser is not running' });
  add.openAddSpeaker(S, {}, 'airplay'); await tick(60);
  const c = sheet();
  assert.equal(c.querySelector('.addspk-status').textContent, 'Couldn’t search');
  assert.match(c.querySelector('.apsetup-empty').textContent, /AirPlay browser is not running/);
  m._apReset(); add._addSpkReset();
});

test('5b: Cast "Add by IP address": form posts the address (and optional name), then shows the new row with Test', async () => {
  const m = await import(pathToFileURL(join(js, 'castsetup.js')).href);
  const add = await import(pathToFileURL(join(js, 'addspeaker.js')).href);
  add._addSpkReset(); m._csReset();
  assert.equal(m.csByIpBody('  ', 'x'), null);
  assert.deepEqual(m.csByIpBody(' 192.168.1.40 ', ''), { address: '192.168.1.40' });
  assert.deepEqual(m.csByIpBody('192.168.1.40', '  Garage '), { address: '192.168.1.40', name: 'Garage' });
  assert.equal(m.csByIpBody('10.0.0.2', 'x'.repeat(60)).name.length, 40);

  let manual = [];
  reply = (url, init) => {
    const u = String(url);
    if (u.endsWith('/cast/setup/byip')) { const b = JSON.parse(init.body); if (b.address === 'nope') return { __status: 400, code: 'input', text: '"nope" is not an IP address.' }; manual = [{ id: 'ip-192.168.1.40', name: b.name, address: '192.168.1.40', port: 8009, kind: 'speaker', manual: true, added: false }]; return { ok: true, id: 'ip-192.168.1.40', name: b.name }; }
    if (u.endsWith('/cast/setup/devices')) return { running: true, devices: manual };
    return { ok: true };
  };
  add.openAddSpeaker(S, {}, 'cast');
  try {
  await tick(60);
  let c = sheet();
  const link = c.querySelector('[data-act="castsetup-byip"]'); assert.ok(link, 'Add by IP address link under the list'); link.click();
  c = sheet();
  const ip = c.querySelector('[data-act="castsetup-ip"]'), go = c.querySelector('[data-act="castsetup-ip-go"]');
  assert.ok(ip && go); assert.equal(go.disabled, true, 'Add is off until an address is typed');
  // a list poll must not rebuild the form while the address is being typed
  ip.focus?.(); const before = c.querySelector('[data-act="castsetup-ip"]'); await tick(3300);
  assert.equal(sheet().querySelector('[data-act="castsetup-ip"]'), before, 'form not repainted while open');
  ip.value = 'nope'; ip.dispatchEvent({ type: 'input', bubbles: true, target: ip });
  doc.querySelector('[data-act="castsetup-byip-form"]').dispatchEvent({ type: 'submit', bubbles: true, preventDefault() {} }); await tick(30);
  assert.match(doc.querySelector('.castsetup-byip [role="alert"]').textContent, /not an IP address/);
  const ip2 = doc.querySelector('[data-act="castsetup-ip"]'); ip2.value = '192.168.1.40'; ip2.dispatchEvent({ type: 'input', bubbles: true, target: ip2 });
  const nm = doc.querySelector('[data-act="castsetup-ipname"]'); nm.value = 'Garage'; nm.dispatchEvent({ type: 'input', bubbles: true, target: nm });
  doc.querySelector('[data-act="castsetup-byip-form"]').dispatchEvent({ type: 'submit', bubbles: true, preventDefault() {} }); await tick(40);
  const post = calls.filter(x => String(x.url).endsWith('/cast/setup/byip')).pop();
  assert.deepEqual(post.body, { address: '192.168.1.40', name: 'Garage' });
  c = sheet();
  assert.equal(c.querySelector('.castsetup-byip'), null, 'form closes after a successful add');
  const row = [...c.querySelectorAll('.apsetup-row')].find(r => /Garage/.test(r.textContent));
  assert.ok(row, 'the new row is shown');
  assert.match(row.querySelector('.castsetup-addr').textContent, /192\.168\.1\.40/);
  assert.ok(row.querySelector('[data-act="cast-test"]'), 'Test is on the new row');
  } finally { m._csReset(); add._addSpkReset(); }
});

test('5b: the server route and its stored address (source check)', () => {
  const api = readFileSync(new URL('../../src/WavWiz.Server/Api/CastApi.cs', import.meta.url), 'utf8');
  assert.match(api, /g\.MapPost\("\/cast\/setup\/byip"/);
  assert.match(api, /CastSpeakers\.Register\(s, o, ep\)/);
});

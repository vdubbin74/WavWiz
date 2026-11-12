// WavWiz 0.6.9 item 16 (ported from 0.7.0 item 5a): the AirPlay card restored open after a reload scans by itself instead of sitting on "Looking…",
// and a failed search says so. Real module code on the tiny DOM, with a stubbed fetch.
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

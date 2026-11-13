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

// 0.6.9 #22 (t1857): "The AirPlay section still just says Looking…". An empty answer (no speakers heard, or only WavWiz itself, or the
// server's browser not running) looked exactly like "still searching", so the card said "Looking…" for ever. A search now ends.
test('#22 pure: apScanView - searching, list, nothing found, error', async () => {
  const m = await import(pathToFileURL(join(js, 'airplaysetup.js')).href + '?pure22');
  assert.equal(m.apScanView({ phase: 'searching', n: 0 }).note, 'Looking…');
  assert.equal(m.apScanView({ phase: 'searching', n: 2 }).note, '2 on this network');
  const none = m.apScanView({ phase: 'done', n: 0 });
  assert.equal(none.note, 'None found'); assert.equal(none.title, 'No AirPlay speakers found');
  const err = m.apScanView({ phase: 'searching', n: 0, problem: 'boom' });
  assert.equal(err.note, 'Couldn’t search'); assert.equal(err.text, 'boom');
  assert.ok(m.SCAN_MS >= 8000 && m.SCAN_MS <= 10000);
  assert.equal(m.apBrowseProblem({ running: true, devices: [] }), null);
  assert.match(m.apBrowseProblem({ running: false, problem: 'AirPlay browse needs a home-network address (the server is bound to loopback).' }), /only listening on this PC/);
  assert.match(m.apBrowseProblem({ running: false, problem: 'AirPlay browse unavailable: Only one usage of each socket address' }), /couldn’t start its AirPlay search: Only one usage/);
});

// advances mocked timers in small steps and lets the awaited fetches settle between steps (setImmediate stays real)
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
async function advance(t, ms, step = 50) { await flush(); for (let d = 0; d < ms; d += step) { t.mock.timers.tick(Math.min(step, ms - d)); await flush(); } }
async function openedCard(tag, rep) {
  sessionStorage.setItem('ww.apsetup.open', '0');
  const m = await import(pathToFileURL(join(js, 'airplaysetup.js')).href + '?' + tag);
  m._apReset(); calls.length = 0; reply = rep;
  mount(m.airPlaySetupCard(S, {}));
  doc.querySelector('.apsetup-card .qb42-t').click();                   // first open, by click (not the restored-open path)
  return m;
}
const card = () => doc.querySelector('.apsetup-card');
const queries = () => calls.filter(c => c.url.endsWith('/dev/airplay/query')).length;

test('#22: first open by click with an EMPTY answer ends as "No AirPlay speakers found" + Search again (not "Looking…" for ever)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const m = await openedCard('empty22', url => url.endsWith('/airplay/setup/devices') ? { running: true, devices: [] } : { ok: true });
  await advance(t, 10);
  assert.equal(queries(), 1, 'one search started');
  assert.equal(card().querySelector('.qb42-st').textContent, 'Looking…');        // still inside the search window
  assert.equal(card().querySelector('.apsetup-list').getAttribute('aria-busy'), 'true');
  // the Devices tree redraws (state push, #12 reorder rebuild, #21 empty-zone rows) while the search runs: no restart, no reset
  for (let i = 0; i < 3; i++) mount(m.airPlaySetupCard(S, {}));
  await advance(t, 3000);
  assert.equal(queries(), 1, 'tree rebuilds never restart an in-flight search');
  await advance(t, m.SCAN_MS);
  const c = card();
  assert.equal(c.querySelector('.qb42-st').textContent, 'None found');
  assert.match(c.querySelector('.apsetup-empty').textContent, /No AirPlay speakers found/);
  assert.match(c.querySelector('.apsetup-empty').textContent, /Firewall/);
  assert.ok(c.querySelector('[data-act="apsetup-again"]'), 'Search again button');
  // a rebuild after the search keeps the finished result
  mount(m.airPlaySetupCard(S, {}));
  assert.equal(card().querySelector('.qb42-st').textContent, 'None found');
  // Search again starts exactly one new search
  card().querySelector('[data-act="apsetup-again"]').click(); card().querySelector('[data-act="apsetup-rescan"]')?.click();
  await advance(t, 10);
  assert.equal(queries(), 2);
  assert.equal(card().querySelector('.qb42-st').textContent, 'Looking…');
  m._apReset();
});

test('#22: only WavWiz itself on the network counts as nothing found', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const m = await openedCard('self22', url => url.endsWith('/airplay/setup/devices') ? { running: true, devices: [{ id: 'me', name: 'WavWiz - Basement', self: true }] } : { ok: true });
  await advance(t, m.SCAN_MS + 10);
  assert.equal(card().querySelector('.qb42-st').textContent, 'None found');
  m._apReset();
});

test('#22: the server answers but its AirPlay search is not running -> a clear error at once, not "Looking…"', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const m = await openedCard('down22', url => url.endsWith('/airplay/setup/devices')
    ? { running: false, problem: 'AirPlay browse needs a home-network address (the server is bound to loopback).', devices: [] } : { ok: true });
  await advance(t, 10);
  const c = card();
  assert.equal(c.querySelector('.qb42-st').textContent, 'Couldn’t search');
  assert.match(c.querySelector('.apsetup-err').textContent, /Couldn’t search for AirPlay speakers/);
  assert.match(c.querySelector('.apsetup-err').textContent, /only listening on this PC/);
  assert.ok(c.querySelector('.apsetup-err [data-act="apsetup-again"]'));
  m._apReset();
});

test('#22: a server that never answers still ends the search with an error inside the time limit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  sessionStorage.setItem('ww.apsetup.open', '0');
  const m = await import(pathToFileURL(join(js, 'airplaysetup.js')).href + '?hang22');
  m._apReset(); calls.length = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init = {}) => { calls.push({ url, method: init.method || 'GET' }); return new Promise(() => {}); };   // never resolves
  try {
    mount(m.airPlaySetupCard(S, {}));
    card().querySelector('.qb42-t').click();
    await advance(t, m.SCAN_MS + 50);
    await advance(t, m.SCAN_MS + 50);
    const c = card();
    assert.notEqual(c.querySelector('.qb42-st').textContent, 'Looking…');
    assert.equal(c.querySelector('.qb42-st').textContent, 'Couldn’t search');
    assert.match(c.querySelector('.apsetup-err').textContent, /didn’t answer the AirPlay search in time/);
  } finally { globalThis.fetch = realFetch; m._apReset(); }
});

test('#22: speakers found during the search show at once, and a later rebuild keeps them', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const m = await openedCard('found22', url => url.endsWith('/airplay/setup/devices') ? { running: true, devices: [{ id: 'k1', name: 'Kitchen', route: 'raop' }] } : { ok: true });
  await advance(t, 10);
  assert.equal(card().querySelector('.qb42-st').textContent, '1 on this network');
  mount(m.airPlaySetupCard(S, {}));
  assert.match(card().querySelector('.apsetup-list').textContent, /Kitchen/);
  await advance(t, m.SCAN_MS + 10);
  assert.equal(card().querySelector('.qb42-st').textContent, '1 on this network');
  m._apReset();
});

// 0.6.9 #22b (t1860): the server retries a browse that failed to start or died, and the card shows why + when it tries again
test('#22b: status retrying shows the last error and the retry time in "Couldn’t search"', async t => {
  const m = await import(pathToFileURL(join(js, 'airplaysetup.js')).href + '?retry22b');
  const msg = m.apBrowseProblem({ running: false, status: 'retrying', lastError: 'couldn\'t start on 192.168.1.169:5353: An attempt was made to access a socket in a way forbidden by its access permissions.', retryInSec: 12 });
  assert.match(msg, /isn’t working: couldn't start on 192\.168\.1\.169:5353: An attempt was made .* permissions\. It tries again by itself in 12 s\./);
  assert.match(m.apBrowseProblem({ running: false, status: 'retrying', lastError: 'stopped: socket closed', retryInSec: 0 }), /stopped: socket closed\. It is trying again now\./);
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let body = { running: false, status: 'retrying', lastError: 'boom', retryInSec: 5, devices: [] };
  const mm = await openedCard('retry22bcard', url => url.endsWith('/airplay/setup/devices') ? body : { ok: true });
  await advance(t, 10);
  assert.equal(card().querySelector('.qb42-st').textContent, 'Couldn’t search');
  assert.match(card().querySelector('.apsetup-err').textContent, /boom\. It tries again by itself in 5 s/);
  const q = queries();
  body = { running: true, status: 'running', devices: [] };                // the server's retry worked
  await advance(t, 3100);                                                 // next poll sees it -> a fresh search, not straight to "None found"
  assert.equal(queries(), q + 1);
  assert.equal(card().querySelector('.qb42-st').textContent, 'Looking…');
  mm._apReset();
});

test('#30 (t1884): compact buttons, one name ("Search again"), no duplicate footer link while the body offers it; "Searching…" kept', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const m = await openedCard('btn30', url => url.endsWith('/airplay/setup/devices') ? { running: true, devices: [] } : { ok: true });
  await advance(t, 10);
  // while searching: the footer link is there, disabled, "Searching…"
  let foot = card().querySelector('[data-act="apsetup-rescan"]');
  assert.ok(foot); assert.equal(foot.textContent, 'Searching…'); assert.ok(foot.disabled);
  await advance(t, m.SCAN_MS);
  const c = card(), again = c.querySelector('[data-act="apsetup-again"]'), close = c.querySelector('[data-act="apsetup-close"]');
  assert.equal(again.textContent, 'Search again');
  assert.equal(c.querySelector('[data-act="apsetup-rescan"]'), null, 'no second Search again / Scan again in the footer');
  for (const b of [again, close]) { assert.ok(b.classList.contains('btn') && b.classList.contains('sm'), b.dataset.act + ' is a compact btn sm'); assert.ok(!b.classList.contains('primary'), b.dataset.act + ' is not a big filled block'); }
  assert.doesNotMatch(c.textContent, /Scan again/);
  m._apReset();
});

test('#30: the footer link (when shown, e.g. with speakers listed) says "Search again" - "Scan again" is gone from the card', () => {
  const src = readFileSync(join(js, 'airplaysetup.js'), 'utf8');
  assert.doesNotMatch(src, /'Scan again'/);
  assert.match(src, /bodyAgain \? null : h\('button', \{ type: 'button', class: 'linkbtn', 'data-act': 'apsetup-rescan'[^\n]*searching \? 'Searching…' : 'Search again'\)/);
  assert.match(src, /const bodyAgain = !rows\.length && \(view\.kind === 'err' \|\| view\.kind === 'none'\);/);
});

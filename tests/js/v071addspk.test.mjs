// 0.7.1: Add speaker sheet replaces the AirPlay / Cast Devices cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom, ev } from './minidom.mjs';

const www = process.env.WWW_DIR || new URL('../../src/WavWiz.Server/wwwroot', import.meta.url).pathname;
const js = process.env.JS_DIR || join(www, 'js');
const rd = (p, root = www) => readFileSync(join(root, p), 'utf8');
const doc = installDom();
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
globalThis.dispatchEvent ??= ev => { /* window listeners */ return true; };
globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.requestAnimationFrame ??= f => setTimeout(f, 0);
globalThis.location ??= { origin: 'http://192.168.1.10:8080' };

const calls = [];
let reply = () => ({});
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
  const r = reply(url, init) || {};
  const st = r.__status || 200;
  delete r.__status;
  return { ok: st < 400, status: st, json: async () => r, text: async () => JSON.stringify(r) };
};
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, tries = 60) => {
  for (let i = 0; i < tries; i++) { const v = fn(); if (v) return v; await tick(20); }
  throw new Error('waitFor timeout');
};

const admin = (extra = {}) => ({ auth: { role: 'admin' }, zones: [], groups: [], ...extra });

const addMod = await import(pathToFileURL(join(js, 'addspeaker.js')).href);
const apMod = await import(pathToFileURL(join(js, 'airplaysetup.js')).href);
const csMod = await import(pathToFileURL(join(js, 'castsetup.js')).href);
function load() {
  addMod._addSpkReset(); apMod._apReset(); csMod._csReset();
  doc.body.querySelectorAll('dialog, .addspk-dlg').forEach(el => el.remove());
  return { add: addMod, ap: apMod, cs: csMod };
}
const sheet = () => doc.querySelector('.addspk-dlg');
const status = () => sheet()?.querySelector('.addspk-status')?.textContent || '';

test('0.7.1 source: Devices list has no AirPlay/Cast cards; header is New zone then Add speaker', () => {
  const t = rd('js/tree42.js'), d = rd('js/devices.js'), o = rd('js/devorder.js'), css = rd('app.css');
  assert.match(t, /class: 'btn sm zadd-new'/);
  assert.match(t, /class: 'btn sm zadd-spk'/);
  assert.ok(t.indexOf("class: 'btn sm zadd-new'") < t.indexOf("class: 'btn sm zadd-spk'"), 'New zone (+) is left of Add speaker');
  assert.match(t, /'aria-label': 'Add speaker'/);
  assert.match(t, /icon\('volume'\)/);
  assert.match(t, /openAddSpeaker\(S, ctl\)/);
  assert.doesNotMatch(t, /airPlaySetupCard\(S, ctl\)/);
  assert.doesNotMatch(t, /castSetupCard\(S, ctl\)/);
  assert.doesNotMatch(t, /cardList\.push\(\{ key: 'airplay'/);
  assert.doesNotMatch(t, /cardList\.push\(\{ key: 'cast'/);
  assert.doesNotMatch(d, /airplayDevicesStrip/);
  assert.match(o, /RETIRED_CARDS = new Set\(\['airplay', 'cast'\]\)/);
  assert.match(o, /dropRetiredCards/);
  assert.match(css, /\.zadd-spk/);
  assert.match(css, /dialog\.addspk-dlg/);
  const about = rd('js/about.js');
  assert.match(about, /Add speaker/);
  assert.match(about, /Show added/);
});

test('0.7.1 openAirPlaySetup / openCastSetup open the sheet on the matching tab', () => {
  const ap = rd('js/airplaysetup.js'), cs = rd('js/castsetup.js');
  assert.match(ap, /export function openAirPlaySetup/);
  assert.match(ap, /openAddSpeaker\(S, ctl, 'airplay'\)/);
  assert.match(cs, /export function openCastSetup/);
  assert.match(cs, /openAddSpeaker\(S, ctl, 'cast'\)/);
  assert.match(ap, /export function airPlaySetupCard[\s\S]*return null/);
  assert.match(cs, /export function castSetupCard[\s\S]*return null/);
});

test('pure: speaker kinds, tab new counts, show-added filters', async () => {
  const { add } = await load('pure-counts');
  const zones = [
    { id: 1, name: 'Office PC', playerId: 'pc-1', connected: true },
    { id: 2, name: 'Office PC 2', playerId: 'pc-2', connected: true },
    { id: 3, name: 'Phone', playerId: 'web-1', isWeb: true, connected: true },
    { id: 4, name: 'Kitchen', playerId: 'airplay:k1', connected: true },
    { id: 5, name: 'Nest', playerId: 'cast:n1', connected: true },
  ];
  const groups = [{ id: 10, name: 'Living', deviceIds: [2, 4] }];
  assert.equal(add.speakerKind(zones[0]), 'wavwiz');
  assert.equal(add.speakerKind(zones[2]), 'browser');
  assert.equal(add.speakerKind(zones[3]), 'airplay');
  assert.equal(add.speakerKind(zones[4]), 'cast');
  assert.equal(add.tabNewCount('wavwiz', { zones, groups }), 1);
  assert.equal(add.tabNewCount('browser', { zones, groups }), 1);
  const apDevs = [{ id: 'k1', name: 'Kitchen', added: true }, { id: 'bath', name: 'Bath' }, { id: 'me', name: 'This PC', self: true }];
  const csDevs = [{ id: 'n1', name: 'Nest', added: true }, { id: 'den', name: 'Den' }];
  assert.equal(add.tabNewCount('airplay', { apDevs }), 1);
  assert.equal(add.tabNewCount('cast', { csDevs }), 1);
  assert.equal(add.filterFoundList(apDevs, false).map(d => d.id).join(), 'bath');
  assert.equal(add.filterFoundList(apDevs, true).map(d => d.id).join(), 'k1,bath');
  assert.equal(add.filterLocalList(add.wavwizPlayers(zones), groups, false).map(z => z.id).join(), '1');
  assert.equal(add.filterLocalList(add.wavwizPlayers(zones), groups, true).map(z => z.id).join(), '1,2');
});

test('devorder drops leftover airplay/cast keys from a saved card order', async () => {
  const { arrangeCards, dropRetiredCards, setCardOrder, getCardOrder, RETIRED_CARDS } = await import(pathToFileURL(join(js, 'devorder.js')).href + '?retire');
  assert.ok(RETIRED_CARDS.has('airplay') && RETIRED_CARDS.has('cast'));
  assert.deepEqual(dropRetiredCards(['g:1', 'airplay', 'cast', 'unassigned', 'jukebox']), ['g:1', 'unassigned', 'jukebox']);
  const cards = ['g:1', 'g:2', 'jukebox', 'unassigned', 'airplay', 'cast'].map(key => ({ key, keys: [key] }));
  assert.deepEqual(arrangeCards(cards, []).map(c => c.key), ['g:1', 'g:2', 'jukebox', 'unassigned']);
  assert.deepEqual(arrangeCards(cards, ['airplay', 'g:2', 'unassigned', 'g:1', 'jukebox', 'cast']).map(c => c.key), ['g:2', 'unassigned', 'g:1', 'jukebox']);
  setCardOrder(['g:1', 'airplay', 'cast', 'unassigned']);
  assert.deepEqual(getCardOrder(), ['g:1', 'unassigned']);
  setCardOrder(null);
});

test('sheet: admin-only, tabs with new counts, default WavWiz, AirPlay scan, Show added', async () => {
  const { add } = await load('sheet-ui');
  assert.equal(add.openAddSpeaker({ auth: { role: 'user' }, zones: [], groups: [] }, {}), null, 'non-admin is refused');
  reply = url => {
    const u = String(url);
    if (u.includes('/airplay/setup/devices')) return { running: true, devices: [{ id: 'k1', name: 'Kitchen', route: 'raop' }, { id: 'hp', name: 'HomePod', block: 'HomePod is not supported', blockCode: 'homepod' }], airPlay2Experimental: false };
    if (u.includes('/cast/setup/devices')) return { running: true, devices: [{ id: 'c1', name: 'Nest Mini', kind: 'speaker', added: true }, { id: 'c2', name: 'Den TV', kind: 'tv' }] };
    if (u.includes('/tls/info')) return { host: '192.168.1.10', httpPort: 8080 };
    return { ok: true };
  };
  const S = admin({
    zones: [
      { id: 1, name: 'Office PC', playerId: 'pc-1', connected: true },
      { id: 2, name: 'Living PC', playerId: 'pc-2', connected: true },
      { id: 3, name: 'Safari', playerId: 'web-1', isWeb: true, connected: true },
      { id: 4, name: 'Nest Mini', playerId: 'cast:c1', connected: true },
    ],
    groups: [{ id: 10, name: 'Living room', deviceIds: [2, 4] }],
  });
  const dlg = add.openAddSpeaker(S, {});
  assert.ok(dlg?.el);
  assert.equal(add._addSpkState().tab, 'wavwiz');
  await tick(80);
  const el = sheet();
  assert.ok(el);
  const tabs = [...el.querySelectorAll('[data-addspk-tab]')].map(b => b.getAttribute('data-addspk-tab'));
  assert.deepEqual(tabs, ['wavwiz', 'browser', 'airplay', 'cast']);
  const counts = Object.fromEntries([...el.querySelectorAll('[data-addspk-tab]')].map(b => [b.getAttribute('data-addspk-tab'), b.querySelector('.addspk-n').textContent]));
  assert.equal(counts.wavwiz, '1', 'Office PC is not in a zone');
  assert.equal(counts.browser, '1');
  assert.equal(counts.airplay, '2', 'Kitchen + blocked HomePod count as new');
  assert.equal(counts.cast, '1', 'already-added Nest is not new; Den TV is');

  assert.match(el.querySelector('[data-kind="wavwiz"] .apsetup-n').textContent, /Office PC/);
  assert.equal(el.querySelector('[data-id="2"]'), null, 'already-zoned WavWiz player hidden by default');
  el.querySelector('[data-act="addspk-show-added"]').checked = true;
  el.querySelector('[data-act="addspk-show-added"]').dispatchEvent(ev('change', { target: el.querySelector('[data-act="addspk-show-added"]') }));
  // checkbox onchange in the module reads ev.target.checked — we set checked then dispatch
  await tick(10);
  assert.ok(sheet().querySelector('[data-id="2"]'), 'Show added reveals the zoned WavWiz player');
  assert.match(sheet().textContent, /Pair a new WavWiz Player/);
  assert.ok(sheet().querySelector('[data-act="addspk-opensettings"]'));
  const hide = sheet().querySelector('[data-act="addspk-show-added"]');
  hide.checked = false; hide.dispatchEvent(ev('change', { target: hide }));
  await tick(10);

  sheet().querySelector('[data-addspk-tab="browser"]').click();
  await tick(10);
  assert.match(sheet().textContent, /Connect a browser/);
  const qr = sheet().querySelector('.addspk-qr');
  assert.ok(qr);
  assert.equal(qr.getAttribute('src'), '/tls/qr.svg?to=app');
  assert.match(sheet().querySelector('.addspk-url').textContent, /192\.168\.1\.10:8080|http:\/\//);
  assert.ok(sheet().querySelector('[data-act="addspk-copy"]'));

  sheet().querySelector('[data-addspk-tab="airplay"]').click();
  await tick(80);
  assert.match(status(), /2 new on this network|Looking/);
  let kit = await waitFor(() => [...sheet().querySelectorAll('.apsetup-row')].find(r => r.textContent.includes('Kitchen')));
  assert.ok(kit.querySelector('[data-act="airplay-test"]'), 'Test on the row without a prior test');
  assert.equal(kit.querySelector('[data-act="airplay-add"]'), null, 'Add stays hidden until Test is heard');
  assert.equal(kit.querySelector('select.apsetup-zone'), null, 'zone dropdown waits for heard yes');
  const st = window.__wwApUi?.('k1');
  assert.ok(st, 'AirPlay row UI state is shared with the sheet');
  st.heard = 'yes'; st.newName = st.newName || 'Kitchen';
  window.dispatchEvent(new CustomEvent('wavwiz:apsetup-paint'));
  await tick(10);
  kit = [...sheet().querySelectorAll('.apsetup-row')].find(r => r.textContent.includes('Kitchen'));
  assert.ok(kit.querySelector('[data-act="airplay-add"]'), 'Add appears after heard yes');
  assert.ok(kit.querySelector('select.apsetup-zone'));
  const hp = [...sheet().querySelectorAll('.apsetup-row')].find(r => r.textContent.includes('HomePod'));
  assert.ok(hp && hp.className.includes('blocked'));
  assert.match(hp.textContent, /HomePod \/ Apple TV/);
  assert.equal(hp.querySelector('[data-act="airplay-add"]'), null, 'blocked row has no Add');
  assert.match(sheet().textContent, /AirPlay 2 support is experimental/);

  sheet().querySelector('[data-addspk-tab="cast"]').click();
  await tick(80);
  assert.equal(sheet().querySelector('[data-id="c1"]'), null, 'added Cast hidden by default');
  const tv = await waitFor(() => [...sheet().querySelectorAll('.apsetup-row')].find(r => r.textContent.includes('Den TV')));
  assert.ok(tv.querySelector('[data-act="cast-test"]'));
  assert.equal(tv.querySelector('[data-act="cast-add"]'), null, 'Cast Add waits for heard yes');
  const csUi = window.__wwCsUi?.('c2');
  assert.ok(csUi, 'Cast row UI state is shared with the sheet');
  csUi.heard = 'yes';

  window.dispatchEvent(new CustomEvent('wavwiz:cssetup-paint'));
  await tick(10);
  const tv2 = [...sheet().querySelectorAll('.apsetup-row')].find(r => r.textContent.includes('Den TV'));
  assert.ok(tv2.querySelector('[data-act="cast-add"]'), 'Cast Add appears after heard yes');
  assert.match(sheet().textContent, /line up only roughly|Fine-tune with the speaker/);
  assert.ok(sheet().querySelector('[data-act="castsetup-byip"]'), 'Add by IP link');
  add._addSpkReset();
});

test('sheet: Search again only rescans the active tab; opening starts AirPlay and Cast scans together', async (t) => {
  const { add, ap } = load();
  reply = url => {
    const u = String(url);
    if (u.includes('/airplay/setup/devices') || u.includes('/cast/setup/devices')) return { running: true, devices: [] };
    return { ok: true };
  };
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
  calls.length = 0;
  add.openAddSpeaker(admin(), {}, 'airplay');
  await flush();
  const apQ = () => calls.filter(c => String(c.url).endsWith('/dev/airplay/query') && c.method === 'POST').length;
  const csQ = () => calls.filter(c => String(c.url).endsWith('/cast/setup/query') && c.method === 'POST').length;
  assert.ok(apQ() >= 1 && csQ() >= 1, 'both scans start when the sheet opens');
  const again = sheet().querySelector('[data-act="addspk-again"]');
  assert.equal(again.textContent, 'Searching…');
  assert.ok(again.disabled, 'Search again is disabled while the active tab is still searching');
  t.mock.timers.tick(ap.SCAN_MS + 20);
  await flush();
  const ap0 = apQ(), cs0 = csQ();
  const again2 = sheet().querySelector('[data-act="addspk-again"]');
  assert.equal(again2.textContent, 'Search again');
  again2.click();
  await flush();
  assert.equal(apQ(), ap0 + 1, 'Search again on AirPlay hits AirPlay only');
  assert.equal(csQ(), cs0, 'Cast is not rescanned from the AirPlay tab');
  sheet().querySelector('[data-addspk-tab="cast"]').click();
  await flush();
  const again3 = sheet().querySelector('[data-act="addspk-again"]');
  if (!again3.disabled) {
    const cs1 = csQ();
    again3.click();
    await flush();
    assert.equal(csQ(), cs1 + 1);
    assert.equal(apQ(), ap0 + 1);
  }
  add._addSpkReset();
});

test('t1955u sheet: a refresh tick while the Add-to select is focused does not replace it or clear Add-by-IP', async () => {
  const { add, ap, cs } = await load('sheet-hold');
  const dev = { id: 'k1', name: 'Kitchen', airplay2: false, route: 'raop' };
  reply = url => {
    const u = String(url);
    if (u.includes('/airplay/setup/devices')) return { running: true, devices: [dev], airPlay2Experimental: false };
    if (u.includes('/cast/setup/devices')) return { running: true, devices: [{ id: 'c2', name: 'Den TV', kind: 'tv' }] };
    if (u.includes('/airplay/setup/test') || u.includes('/cast/setup/test')) return { ok: true, kind: 'chime' };
    return { ok: true };
  };
  add.openAddSpeaker(admin({ groups: [{ id: 1, name: 'Basement' }, { id: 2, name: 'Upstairs' }] }), {}, 'airplay');
  const row0 = await waitFor(() => [...(sheet()?.querySelectorAll('.apsetup-row') || [])].find(r => r.getAttribute('data-id') === 'k1'));
  assert.equal(row0.querySelector('select.apsetup-zone'), null, 'Add-to waits for heard yes');
  const st = window.__wwApUi?.('k1');
  assert.ok(st); st.heard = 'yes';
  window.dispatchEvent(new CustomEvent('wavwiz:apsetup-paint'));
  await tick(10);
  const row = sheet().querySelector('.apsetup-row[data-id="k1"]');
  const select = row.querySelector('select.apsetup-zone');
  select.focus();
  assert.equal(doc.activeElement, select);
  const before = select;
  await ap._apRefresh();
  assert.equal(sheet().querySelector('.apsetup-row[data-id="k1"] select.apsetup-zone'), before, 'select node kept while focused');
  assert.equal(doc.activeElement, select);

  // Cast Add-by-IP field is not cleared by an AirPlay poll
  sheet().querySelector('[data-addspk-tab="cast"]').click();
  await tick(40);
  sheet().querySelector('[data-act="castsetup-byip"]').click();
  await tick(20);
  const ip = await waitFor(() => sheet().querySelector('.castsetup-ip, [data-act="castsetup-ip"]'));
  ip.focus();
  ip.value = '192.168.1.40';
  ip.dispatchEvent(ev('input', { target: ip }));
  await ap._apRefresh();
  const ip2 = sheet().querySelector('.castsetup-ip, [data-act="castsetup-ip"]');
  assert.ok(ip2, 'Add-by-IP form still open');
  assert.equal(ip2.value, '192.168.1.40', 'typed address kept across an AirPlay poll');
  add._addSpkReset(); ap._apReset(); cs._csReset();
});

test('CSS: phone sheet docks above mini/tabbar on html.phonelook (phone + narrow PC, 0.7.3 t2225u); Search again stays with Show added', () => {
  const css = rd('app.css');
  const at = css.indexOf('0.7.1 Add speaker sheet');
  assert.ok(at >= 0);
  const block = css.slice(at);
  // 0.7.3 t2225u: a narrow PC window looks like the phone - look rules moved from html.handset to html.phonelook (handset implies phonelook)
  assert.match(block, /html\.phonelook dialog\.addspk-dlg/);
  assert.match(block, /var\(--safe-b/);
  assert.match(block, /var\(--addspk-dock/);
  assert.match(block, /\.addspk-bar-acts/);
  assert.doesNotMatch(block, /@media \(max-width:700px\)/, 'no width query of its own (html.phonelook is set by phonelook.js)');
  const src = rd('js/addspeaker.js');
  assert.match(src, /ui\.heard === 'yes'/);
  assert.match(src, /document\.documentElement\.classList\.contains\('phonelook'\)/);
});

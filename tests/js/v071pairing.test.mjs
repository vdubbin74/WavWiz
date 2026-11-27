// WavWiz 0.7.1 t2072u: on the PC that runs the server the sign-in page puts the administrator password first (approval / code are secondary),
// the approval screen there no longer says "On any phone or PC signed in as administrator", and every "Pair a PC" pointer names the same place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom } from './minidom.mjs';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const main = readFileSync(join(js, 'main.js'), 'utf8');
const imp = m => import(pathToFileURL(join(js, m + '.js')).href);
const txt = el => (el.textContent ?? '');
const all = (el, sel) => [...el.querySelectorAll(sel)];

test('t2072 C: server-PC sign-in shows the administrator password box first and signs in with it', async () => {
  installDom(); const { serverPcSignIn } = await imp('pairreq');
  const got = []; const w = serverPcSignIn({ player: true, login: async p => got.push(p), other: m => got.push('other:' + m) });
  assert.match(txt(w.el), /Sign in as administrator/); assert.match(txt(w.el), /PC that runs the WavWiz server/);
  const pw = w.el.querySelector('#pw'); assert.ok(pw, 'password box');
  const kids = [...w.el.children]; const formAt = kids.findIndex(k => k.tagName === 'FORM'), altAt = kids.findIndex(k => (k.className || '').includes('serverpc-alt'));
  assert.ok(formAt >= 0 && altAt > formAt, 'password form before the secondary links');
  pw.value = 'secret-pw'; w.el.querySelector('form').dispatchEvent({ type: 'submit' });
  await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(got, ['secret-pw']);
  const links = all(w.el, 'a'); assert.deepEqual(links.map(a => a.getAttribute('data-alt')), ['approve', 'pair']);
  links[0].click(); assert.equal(got.at(-1), 'other:approve');
});

test('t2072 C: server-PC sign-in shows the server error and, in a browser, offers only the code as the alternative', async () => {
  installDom(); const { serverPcSignIn } = await imp('pairreq');
  const w = serverPcSignIn({ player: false, login: async () => { throw new Error('That password is not right.'); } });
  w.el.querySelector('form').dispatchEvent({ type: 'submit' });
  await new Promise(r => setTimeout(r, 5));
  assert.match(txt(w.el.querySelector('.err')), /not right/);
  assert.deepEqual(all(w.el, 'a').map(a => a.getAttribute('data-alt')), ['pair']);
});

test('t2072 C: the approval screen on the server PC drops "On any phone or PC signed in as administrator" and lists the admin sign-in first', async () => {
  installDom(); const { playerApprovalScreen } = await imp('pairreq');
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'r1', secret: 's', match: '1234', status: 'pending' }) });
  const mem = new Map(); const store = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const here = playerApprovalScreen({ name: 'Server PC', local: true, store, poll: 1e6 });
  assert.doesNotMatch(txt(here.el), /On any phone or PC signed in as administrator/);
  assert.match(txt(here.el), /PC that runs the WavWiz server/);
  assert.equal(txt(all(here.el, 'a')[0]), 'Sign in as administrator');
  here.stop();
  mem.clear();
  const away = playerApprovalScreen({ name: 'Den PC', store, poll: 1e6 });   // another PC: unchanged
  assert.match(txt(away.el), /On any phone or PC signed in as administrator/);
  assert.equal(txt(all(away.el, 'a')[0]), 'Pair with a code instead');
  away.stop();
});

test('t2072 C: main.js sends a local sign-in (thisMachine) to the server-PC page before the approval screen', () => {
  const at = main.indexOf('function renderLogin(');
  const body = main.slice(at, main.indexOf('\n}\n', at));
  const local = body.indexOf('serverPcSignIn('), approval = body.indexOf('playerApprovalScreen(');
  assert.ok(local > 0 && approval > local, 'server-PC sign-in comes first');
  assert.match(body, /const local = !!S\.auth\?\.thisMachine;/);
  assert.match(body, /if \(local && \(!start \|\| start === 'admin'\)\)/);
  assert.match(body, /playerApprovalScreen\(\{ name: deviceName\(\), local,/);
});

test('t2072 E: the code-pairing hint names Settings > Devices > Pair a phone or a PC player', () => {
  assert.match(main, /Settings > Devices > Pair a phone or a PC player/);
  assert.doesNotMatch(main, /Settings > Players/);
});

test('t2072 gap: finishing first-run setup in the Player window tells the Player (setup-done) before the reload', () => {
  const at = main.indexOf('function renderSetup('); const body = main.slice(at, main.indexOf('\n}\n', at));
  assert.match(body, /await api\('\/auth\/setup'[^;]*;\s*setupDone\(\); finishSignIn\(\);/);   // 0.7.3 t2248u: a same-origin navigation instead of the reload (iPhone sign-in loop)
  const fn = main.slice(main.indexOf('function setupDone('), main.indexOf('function renderSetup('));
  assert.match(fn, /isPlayerUa\(\)/); assert.match(fn, /postMessage\(\{ cmd: 'setup-done' \}\)/);
});

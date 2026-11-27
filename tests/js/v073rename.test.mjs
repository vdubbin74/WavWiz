// 0.7.3 t2225u: on the phone, Speaker settings > More ▾ > Rename did nothing. Root cause: More ▾ > Rename still called the 0.3.5 card rename,
// which looks for the old card's .dname; the speaker page (phone sheet and desktop pane) has only .spk-title, so it returned silently.
// The desktop had the same dead menu item (its visible Rename button worked). Now More ▾ > Rename types the name in place on the page title.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom, ev } from './minidom.mjs';

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const src = f => readFileSync(join(js, f), 'utf8');
const css = () => readFileSync(join(js, '..', 'app.css'), 'utf8');
const doc = installDom(); doc.defaultView = globalThis;
globalThis.matchMedia ??= q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.getComputedStyle ??= () => ({ overflowY: 'visible', getPropertyValue: () => '' });
globalThis.requestAnimationFrame ??= f => setTimeout(f, 0);
globalThis.cancelAnimationFrame ??= t => clearTimeout(t);
globalThis.CSS ??= { escape: s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c) };
globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.innerWidth ??= 390; globalThis.innerHeight ??= 844;
const imp = f => import(pathToFileURL(join(js, f)).href);
const { h } = await imp('util.js');

test('renameTarget: the speaker page title when there is no old card (phone sheet + desktop pane), the card name when there is', async () => {
  const { renameTarget } = await imp('devices.js');
  const more = h('div', { class: 'dmore' }, h('button', { class: 'btn dmorebtn' }, 'More ▾'));
  const title = h('h3', { class: 'spk-title' }, 'SPEAKER SETTINGS · KITCHEN');
  const page = h('section', { class: 'spkset', 'data-zone-id': 3 }, h('div', { class: 'spk-head' }, title), h('div', { class: 'row spk-btns' }, more));
  doc.body.append(page);
  const t = renameTarget(more, 3, doc);
  assert.ok(t, 'the speaker page always has a place to type the name (was: nothing, silently)');
  assert.equal(t.kind, 'page'); assert.equal(t.el, title);
  // the old card layout keeps its in-card rename
  const nm = h('b', { class: 'dname' }, 'Den'), w2 = h('div', { class: 'dmore' });
  const card = h('div', { class: 'dc3', 'data-zone-id': 7 }, nm, w2); doc.body.append(card);
  assert.deepEqual(renameTarget(w2, 7, doc), { kind: 'card', el: nm });
  // nothing on screen: null, and rename() falls back to the one-field window (never a no-op)
  assert.equal(renameTarget(null, 99, doc), null);
  page.remove(); card.remove();
});

test('More ▾ > Rename on the speaker page opens the in-place field on its title and saves with PATCH /zones/{id}', async () => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => { calls.push({ method: init.method || 'GET', path: String(url).replace('/api/v1', ''), body: init.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, text: async () => ((init.method || 'GET') === 'GET' ? '[]' : '{}') }; };
  const d = src('devices.js');
  // the menu item goes through rename(), which now never returns before offering a field or the window
  assert.match(d, /item\('Rename', \(\) => rename\(S, ctl, z, wrap\), admin, ADMIN_HINT\)/);
  const body = d.slice(d.indexOf('function rename(S, ctl, z, from)'), d.indexOf('async function setReference'));
  assert.doesNotMatch(body, /if \(!nm\) return;/, 'no silent early return');
  assert.match(body, /inlineName\(tg\.el, \{.*setText: false/, 'the title holds more than the name, so the label text is not overwritten');
  assert.match(body, /promptName\(`Rename \$\{z\.name\}`/);
  assert.match(body, /scrollIntoView/, 'More ▾ is at the bottom of a long phone sheet; the field at the top is brought into view');
  // run it for real on the tiny DOM: inlineName on the page title + save
  const { inlineName } = await imp('popover.js'); const { renameTarget } = await imp('devices.js');
  const title = h('h3', { class: 'spk-title' }, 'SPEAKER SETTINGS · KITCHEN'), more = h('div', { class: 'dmore' });
  const page = h('section', { class: 'spkset', 'data-zone-id': 3 }, h('div', { class: 'spk-head' }, title), more); doc.body.append(page);
  const tg = renameTarget(more, 3, doc);
  const ed = inlineName(tg.el, { value: 'Kitchen', setText: false, save: async v => { await fetch('/api/v1/zones/3', { method: 'PATCH', body: JSON.stringify({ name: v }) }); } });
  assert.ok(page.querySelector('.wwinl-in'), 'field shown'); assert.equal(title.hidden, true);
  ed.input.value = 'Pantry'; ed.input.dispatchEvent(ev('keydown', { key: 'Enter', target: ed.input }));
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(calls.filter(c => c.method === 'PATCH'), [{ method: 'PATCH', path: '/zones/3', body: { name: 'Pantry' } }]);
  assert.equal(title.hidden, false); assert.equal(title.textContent, 'SPEAKER SETTINGS · KITCHEN', 'the live title repaints from the server, not from the field');
  page.remove();
});

test('the label being renamed is hidden (phone rows showed the name twice: .sp42-nt .sp42-n is display:block)', () => {
  assert.match(css(), /\.dname\[hidden\],\.sp42-n\[hidden\],\.spk-title\[hidden\]\{display:none!important\}/);
});

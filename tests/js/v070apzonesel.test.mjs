// t1955u: in Devices, step 3 "Add to zone", opening the "Add to:" <select> was closed by the AirPlay / Cast
// card's ~3 s background refresh, which replaced the card (paintInPlace). A refresh tick while the select
// (or the new-zone name input) is focused must leave the same node in place; the chosen value is kept,
// and the refresh resumes on blur or change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom, ev } from './minidom.mjs';

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const src = f => readFileSync(join(js, f), 'utf8');
const doc = installDom();
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
globalThis.dispatchEvent ??= () => true;
globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.requestAnimationFrame ??= f => setTimeout(f, 0);

const calls = [];
let reply = () => ({});
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
  const r = reply(url, init) || {};
  const st = r.__status || 200;
  delete r.__status;
  return { ok: st < 400, status: st, text: async () => JSON.stringify(r) };
};

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, tries = 50) => {
  for (let i = 0; i < tries; i++) { const v = fn(); if (v) return v; await tick(20); }
  throw new Error('waitFor timeout');
};

const groups = [{ id: 1, name: 'Basement' }, { id: 2, name: 'Upstairs' }];
const S = { zones: [], groups };

test('t1955u wiring: AirPlay and Cast skip a refresh while a select/input in the card is focused, keep the value, resume on blur/change', () => {
  const ap = src('airplaysetup.js'), cs = src('castsetup.js');
  for (const [name, s] of [['AirPlay', ap], ['Cast', cs]]) {
    assert.match(s, /function cardEditing\(card\)/, `${name} has cardEditing`);
    assert.match(s, /el\.closest\?\.\('select,input,textarea'\)/, `${name} treats a focused select or input as editing`);
    assert.match(s, /function armResume\(card\)/, `${name} resumes the held refresh`);
    assert.match(s, /card\.addEventListener\('focusout', go\)/, `${name} resumes on blur`);
    assert.match(s, /card\.addEventListener\('change', go\)/, `${name} resumes on change`);
    assert.match(s, /syncFields\(card\);   \/\/ t1955u: keep the chosen zone \/ new-zone name across a repaint/, `${name} keeps the chosen value across a repaint`);
    assert.match(s, /if \(cardEditing\(card\)\) \{ armResume\(card\); return; \}/, `${name} holds the refresh while editing`);
    assert.match(s, /await refreshIfIdle\(\);/, `${name} poll uses refreshIfIdle`);
    assert.match(s, /if \(seq === scanSeq && !closed && open\) await refreshIfIdle\(\);/, `${name} 1.5s/4s follow-ups use refreshIfIdle`);
  }
  assert.match(ap, /export const _apRefresh = \(\) => refreshIfIdle\(\);/);
  assert.match(cs, /export const _csRefresh = \(\) => refreshIfIdle\(\);/);
  assert.match(cs, /if \(st\(selId\)\.busy \|\| byIp\.open\) return;/, 'Cast still holds while Add by IP is open');
});

async function addToZone(kind, tag) {
  const file = kind === 'airplay' ? 'airplaysetup.js' : 'castsetup.js';
  const openKey = kind === 'airplay' ? 'ww.apsetup.open' : 'ww.castsetup.open';
  const cardSel = kind === 'airplay' ? '.apsetup-card' : '.castsetup-card';
  const devicesUrl = kind === 'airplay' ? '/airplay/setup/devices' : '/cast/setup/devices';
  const testUrl = kind === 'airplay' ? '/airplay/setup/test' : '/cast/setup/test';
  const queryUrl = kind === 'airplay' ? '/dev/airplay/query' : '/cast/setup/query';
  const dev = kind === 'airplay'
    ? { id: 'k1', name: 'Kitchen', airplay2: false, route: 'raop' }
    : { id: 'c1', name: 'Kitchen', kind: 'speaker' };
  sessionStorage.setItem(openKey, '0');
  const m = await import(pathToFileURL(join(js, file)).href + '?' + tag);
  if (kind === 'airplay') m._apReset(); else m._csReset();
  calls.length = 0;
  reply = url => {
    if (url.endsWith(devicesUrl)) return { devices: [dev], airPlay2Experimental: false, running: true };
    if (url.endsWith(testUrl) || url.endsWith(queryUrl)) return { ok: true, kind: 'chime' };
    return { ok: true };
  };
  const mount = el => { doc.body.replaceChildren(el); return el; };
  mount(kind === 'airplay' ? m.airPlaySetupCard(S, {}) : m.castSetupCard(S, {}));
  doc.querySelector(`${cardSel} .qb42-t`).click();
  const row = await waitFor(() => doc.querySelector(`${cardSel} .apsetup-rowhead[data-id="${dev.id}"]`));
  row.click();
  const play = await waitFor(() => doc.querySelector(`${cardSel} [data-act="${kind === 'airplay' ? 'apsetup-test' : 'castsetup-test'}"]`));
  play.click();
  const yes = await waitFor(() => doc.querySelector(`${cardSel} [data-act="${kind === 'airplay' ? 'apsetup-heard' : 'castsetup-heard'}"]`));
  yes.click();
  const select = await waitFor(() => doc.querySelector(`${cardSel} select.apsetup-zone`));
  return { m, select, cardSel, refresh: kind === 'airplay' ? m._apRefresh : m._csRefresh, reset: kind === 'airplay' ? m._apReset : m._csReset };
}

async function runHold(kind, tag) {
  const { select, cardSel, refresh, reset } = await addToZone(kind, tag);
  try {
    select.focus();
    assert.equal(doc.activeElement, select, `${kind}: the Add-to zone select is focused`);
    const card = doc.querySelector(cardSel);
    await refresh();
    assert.equal(doc.querySelector(`${cardSel} select.apsetup-zone`), select, `${kind}: a refresh tick while the select is focused does not replace it`);
    assert.ok(select.isConnected, `${kind}: the same select node stays in the document`);
    assert.equal(doc.querySelector(cardSel), card, `${kind}: the card itself is not replaced`);
    assert.equal(doc.activeElement, select, `${kind}: focus stays on the select`);

    // the chosen value is kept across a later (unfocused) repaint
    const pick = (sel, v) => { for (const o of sel.options) { if (o.value === v) o.setAttribute('selected', ''); else o.removeAttribute('selected'); } };
    pick(select, '1');
    select.dispatchEvent(ev('change', { target: select }));
    const afterChange = doc.querySelector(`${cardSel} select.apsetup-zone`);
    assert.equal(afterChange.value, '1', `${kind}: picking a zone is stored`);
    afterChange.blur();
    await tick(20);
    await refresh();
    const after = doc.querySelector(`${cardSel} select.apsetup-zone`);
    assert.ok(after !== afterChange, `${kind}: after blur, a refresh is allowed to repaint`);
    assert.equal(after.value, '1', `${kind}: the chosen zone is kept across the repaint`);
    assert.equal([...after.options].find(o => o.selected)?.textContent, 'Basement');

    // the new-zone name input is also held
    pick(after, 'new');
    after.dispatchEvent(ev('change', { target: after }));
    const name = await waitFor(() => doc.querySelector(`${cardSel} input.apsetup-name`));
    name.focus();
    name.value = 'Den';
    name.dispatchEvent(ev('input', { target: name }));
    const card2 = doc.querySelector(cardSel);
    await refresh();
    assert.equal(doc.querySelector(`${cardSel} input.apsetup-name`), name, `${kind}: a refresh tick while the name input is focused does not replace it`);
    assert.equal(doc.querySelector(cardSel), card2);
    name.blur();
    await tick(20);
    await refresh();
    const name2 = doc.querySelector(`${cardSel} input.apsetup-name`);
    assert.ok(name2 !== name, `${kind}: after blur, a refresh is allowed to repaint the name field`);
    assert.equal(name2.value, 'Den', `${kind}: the typed name is kept across the repaint`);
  } finally {
    reset();
    doc.body.replaceChildren();
  }
}

test('t1955u: AirPlay Add-to-zone — a refresh tick while the select is focused does not replace it', async () => {
  await runHold('airplay', 't1955u-ap');
});

test('t1955u: Cast Add-to-zone — a refresh tick while the select is focused does not replace it', async () => {
  await runHold('cast', 't1955u-cs');
});

// 0.7.0 t1937: expanding then collapsing the AirPlay speakers card used to drop its ⋮ reorder handle
// (buildCard's collapsed path returned before cardDecor, so paintInPlace's replaceWith built a card with no .cgrip69).
// The handle must stay after any number of expand/collapse cycles. Cast already decorated both paths; this keeps it that way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom } from './minidom.mjs';

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const W = new URL('../../src/WavWiz.Server/wwwroot/', import.meta.url);
const rd = p => readFileSync(new URL(p, W), 'utf8');
const doc = installDom();
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
globalThis.dispatchEvent ??= () => true;
globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.requestAnimationFrame ??= f => setTimeout(f, 0);

const apSrc = rd('js/airplaysetup.js');
const csSrc = rd('js/castsetup.js');

test('t1937 source: AirPlay and Cast both decorate the collapsed card and the open card', () => {
  assert.equal((apSrc.match(/try \{ cardDecor\?\.\(card\); \} catch/g) || []).length, 2, 'AirPlay: collapsed and open card both decorated');
  assert.match(apSrc, /if \(!open\) \{\s*card\.append\(head\);\s*try \{ cardDecor\?\.\(card\); \}/, 'AirPlay collapsed early-return calls cardDecor (Cast already did)');
  assert.equal((csSrc.match(/try \{ cardDecor\?\.\(card\); \} catch/g) || []).length, 2, 'Cast: collapsed and open card both decorated');
  assert.match(csSrc, /if \(!open\) \{ card\.append\(head\); try \{ cardDecor\?\.\(card\); \}/);
});

const decorate = (el, key, label) => {
  el.dataset.card = key;
  if (![...el.children].some(c => (c.className || '').split(/\s+/).includes('cgrip69'))) {
    const g = document.createElement('span');
    g.className = 'cgrip69';
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', '0');
    g.title = 'Drag to reorder';
    g.setAttribute('aria-label', `Reorder ${label} (drag, or Alt+Up / Alt+Down)`);
    g.append(document.createTextNode('⋮'));
    el.prepend(g);
  }
  return el;
};
const hasGrip = el => !!el && [...el.children].some(c => (c.className || '').split(/\s+/).includes('cgrip69'));
const cardOf = sel => doc.querySelector(sel);

test('t1937: AirPlay (and Cast) keep the ⋮ handle after any number of expand/collapse cycles', async () => {
  const ap = await import(pathToFileURL(join(js, 'airplaysetup.js')).href + '?grip1937');
  const cs = await import(pathToFileURL(join(js, 'castsetup.js')).href + '?grip1937');
  ap._apReset(); cs._csReset();
  ap.setApCardDecor(el => decorate(el, 'airplay', 'AirPlay speakers'));
  cs.setCastCardDecor(el => decorate(el, 'cast', 'Cast speakers'));
  const tree = document.createElement('div');
  tree.className = 'tree42';
  tree.append(ap.airPlaySetupCard({ zones: [], groups: [] }, {}), cs.castSetupCard({ zones: [], groups: [] }, {}));
  doc.body.replaceChildren(tree);

  const firstAp = cardOf('.apsetup-card'), firstCs = cardOf('.castsetup-card');
  assert.ok(hasGrip(firstAp), 'AirPlay starts with a handle (first collapsed build)');
  assert.ok(hasGrip(firstCs), 'Cast starts with a handle');
  assert.equal(firstAp.getAttribute('data-card'), 'airplay');
  assert.equal(firstCs.getAttribute('data-card'), 'cast');

  const cycle = (sel, act) => {
    cardOf(sel).querySelector(`[data-act="${act}"]`).click();
    const open = cardOf(sel);
    assert.ok(open.className.split(/\s+/).includes('open'), `${sel} expanded`);
    assert.ok(hasGrip(open), `${sel} still has the ⋮ handle while expanded`);
    cardOf(sel).querySelector(`[data-act="${act}"]`).click();
    const folded = cardOf(sel);
    assert.ok(folded.className.split(/\s+/).includes('qb42-folded'), `${sel} collapsed`);
    assert.ok(hasGrip(folded), `${sel} still has the ⋮ handle after collapse`);
    assert.equal(folded.getAttribute('data-card'), sel.includes('apsetup') ? 'airplay' : 'cast');
  };
  for (let i = 0; i < 3; i++) {
    cycle('.apsetup-card', 'apsetup-fold');
    cycle('.castsetup-card', 'castsetup-fold');
  }
  ap._apReset(); cs._csReset();
});

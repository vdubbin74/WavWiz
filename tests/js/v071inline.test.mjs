// 0.7.1 t2033u / t2035u: one-line name prompts are typed in place (draft card / inline rename), small confirms open next to the
// button that asked (popover; a phone gets a bottom sheet; no anchor on a PC = the old centered window). Runs the real Devices panel
// and tree on the tiny DOM: the rename focus race after a right-click menu, and a poll redraw while a name is being typed.
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
globalThis.innerWidth ??= 1440; globalThis.innerHeight ??= 900;
const imp = f => import(pathToFileURL(join(js, f)).href);
const wait = ms => new Promise(r => setTimeout(r, ms));
const key = (el, k) => el.dispatchEvent(ev('keydown', { key: k, target: el }));
const type = (inp, v) => { inp.value = v; inp.dispatchEvent(ev('input', { target: inp })); };

// every API call the UI makes (method, path, body)
const calls = [];
globalThis.fetch = async (url, init = {}) => { calls.push({ method: init.method || 'GET', path: String(url).replace('/api/v1', ''), body: init.body ? JSON.parse(init.body) : null });
  return { ok: true, status: 200, text: async () => (init.method === 'POST' && /\/groups$/.test(url) ? '{"id":9}' : (init.method || 'GET') === 'GET' ? '[]' : '{}') }; };
const sent = (method, re) => calls.filter(c => c.method === method && re.test(c.path));

const zone = (id, extra = {}) => ({ id, name: `Room ${id}`, playerId: `pc-${id}`, connected: true, enabled: true, volume: 50, muted: false, outputs: [], isWeb: false, ...extra });
const freshS = () => ({ auth: { role: 'admin' }, zones: [zone(1, { name: 'Den' }), zone(2, { name: 'Hall' })],
  groups: [{ id: 1, name: 'Basement', deviceIds: [1], playbackId: 'zg:1' }, { id: 2, name: 'Upstairs', deviceIds: [], playbackId: 'zg:2' }] });
const ctl = { act() {}, refreshAll() {}, setDevSize() {}, toggleDev() {}, toggleDevExpanded() {}, go() {}, openQueue() {}, refreshNow() {} };
async function panel() {
  const d = await imp('devices.js'); const S = freshS();
  const p = d.devicesPanel(S, ctl); doc.body.append(p.el); p.draw?.();
  return { d, S, p, tree: () => p.el.querySelector('.tree42') };
}
const zname = (root, n) => [...root.querySelectorAll('.zname')].find(b => b.textContent === n);
const spkname = (root, n) => [...root.querySelectorAll('.sp42-n')].find(b => b.textContent === n);
/** Right-click a card, then click a menu item - the menu closes and hands focus back to the card first (closeCtx), as in the browser. */
function menuPick(target, id) {
  target.dispatchEvent(ev('contextmenu', { target, clientX: 40, clientY: 40, button: 2 }));
  const item = doc.querySelector(`.ctxmenu [data-ctx="${id}"]`); assert.ok(item, `menu item ${id}`);
  item.dispatchEvent(ev('click', { target: item }));
}

test('t2033u wiring: no one-line name pop-up is left (New zone, renames, Save as preset, New scene, narrow File > New zone)', () => {
  const t = src('tree42.js'), d = src('devices.js'), sp = src('spkset.js'), ss = src('scenesched.js'), m = src('main.js');
  assert.doesNotMatch(t, /promptName\('New zone'/, 'the tree + no longer opens the New zone window');
  assert.match(t, /const create = ev => \{ const hd = root\.querySelector\('\.tree42-h'\); inlineDraft\(root,/);
  assert.match(t, /inlineName\(lab, \{ value: g\.name/); assert.match(t, /inlineName\(lab, \{ value: z\.name/);
  assert.match(t, /'data-zname': id/, 'zone names carry their id so Rename finds the label');
  assert.match(d, /onRename: \(z, btn\) => \{/); assert.match(d, /inlineName\(btn, \{ value: z\.name, label: `Speaker name \(was \$\{z\.name\}\)`, setText: false/);
  assert.match(d, /inlineDraft\(m, \{ before: null, label: 'New zone name'/, 'Add to zone > + New zone… is typed in the menu');
  assert.doesNotMatch(sp, /parts\.promptName/); assert.match(sp, /inlineDraft\(at\.parentNode, \{ before: at\.nextSibling, cls: 'spk-predraft'/);
  assert.doesNotMatch(ss, /dialog\('New scene from current setup'/); assert.match(ss, /function capture\(ev\) \{/);
  assert.match(ss, /if \(editingIn\(body\)\) return;/, 'the 30 s refresh does not wipe a scene name being typed');
  assert.match(m, /if \(!wide\(\)\) \{ if \(kind === 'zone'\) return newZoneNarrow\(\);/);
  // promptName (the old one-field window) is only a fallback when the name is not on screen
  for (const f of [t, d]) for (const line of f.split('\n').filter(l => /promptName\(`Rename/.test(l))) assert.match(line, /\? inlineName\(/, 'promptName only as the fallback: ' + line.slice(0, 80));
});

test('t2033u: the tree + puts a draft zone card under the header with its name focused; Enter creates the zone; Esc leaves nothing', async () => {
  const { p, tree } = await panel(); calls.length = 0;
  const plus = tree().querySelector('.zadd-new'); plus.focus();
  plus.dispatchEvent(ev('click', { target: plus, currentTarget: plus }));
  const draft = tree().querySelector('.wwdraft'); assert.ok(draft, 'a draft card is in the tree');
  assert.equal(draft.previousSibling ?? tree().childNodes[tree().childNodes.indexOf(draft) - 1], tree().querySelector('.tree42-h'), 'right under the header (the + button)');
  assert.equal(doc.querySelectorAll('dialog').length, 0, 'no centered window');
  const inp = draft.querySelector('input'); await wait(5); assert.equal(doc.activeElement, inp, 'the name field has focus');
  key(inp, 'Enter'); assert.ok(draft.isConnected, 'an empty name does not create anything'); assert.equal(sent('POST', /^\/groups$/).length, 0);
  type(inp, 'Downstairs'); key(inp, 'Enter'); await wait(5);
  assert.deepEqual(sent('POST', /^\/groups$/)[0].body, { name: 'Downstairs', deviceIds: [] }); assert.ok(!draft.isConnected, 'the draft goes once saved');
  plus.dispatchEvent(ev('click', { target: plus, currentTarget: plus }));
  const d2 = tree().querySelector('.wwdraft'); key(d2.querySelector('input'), 'Escape');
  assert.ok(!tree().querySelector('.wwdraft'), 'Esc cancels'); await wait(5); assert.equal(doc.activeElement, plus, 'focus goes back to +');
  p.el.remove();
});

test('t2033u focus race: Rename from the right-click menu keeps the caret in the name even when the menu / a redraw hands focus back late', async () => {
  const { p, tree } = await panel(); calls.length = 0;
  const lab = zname(tree(), 'Upstairs'), card = lab.closest('[data-leader-id]') || lab.closest('section');
  menuPick(lab, 'rename');   // right-click on the zone's name (bubbles to the card the menu is wired on)
  const box = tree().querySelector('.wwinl'); assert.ok(box, 'the name became a field in place'); assert.ok(lab.hidden, 'the label steps aside');
  const inp = box.querySelector('input'); assert.equal(inp.value, 'Upstairs');
  // late focus restores in the same tick: the menu's closeCtx / F82 keep-focus put focus on the card, then a removed menu item drops it to <body>
  card.focus(); queueMicrotask(() => doc._blurTo(doc.body));
  await wait(30);
  assert.equal(doc.activeElement, inp, 'focus came back to the field');
  type(inp, 'Upstairs Loft'); key(inp, 'Enter'); await wait(5);
  assert.deepEqual(sent('PATCH', /^\/groups\/2$/)[0].body, { name: 'Upstairs Loft', deviceIds: [] });
  assert.ok(!box.isConnected && !lab.hidden, 'done: the label is back');
  // a focus move to some OTHER control is left alone (the user clicked elsewhere on purpose)
  menuPick(spkname(tree(), 'Den').closest('[data-device-id]'), 'rename');
  const inp2 = tree().querySelector('.wwinl input'); const other = tree().querySelector('.zadd-new');
  await wait(1); other.focus(); await wait(30);
  assert.equal(doc.activeElement, other, 'a deliberate click elsewhere is not stolen back');
  await wait(200); assert.ok(!inp2.isConnected, 'unchanged name + left the field = nothing saved, field closed'); assert.equal(sent('PATCH', /^\/zones\//).length, 0);
  p.el.remove();
});

test('t2033u: a poll redraw while a name is typed keeps the same field and the text; leaving the field saves it', async () => {
  const { S, p, tree } = await panel(); calls.length = 0;
  const lab = spkname(tree(), 'Den'); menuPick(lab.closest('[data-device-id]'), 'rename');
  const inp = tree().querySelector('.wwinl input'); await wait(5); type(inp, 'Den Speakers');
  const t0 = tree();
  for (let i = 0; i < 6; i++) {   // status pushes, a membership change and a forced draw - all would rebuild the tree
    S.zones = S.zones.map(z => ({ ...z, volume: 40 + i, connected: i % 2 === 0 }));
    if (i === 3) S.groups = S.groups.map(g => g.id === 2 ? { ...g, deviceIds: [2] } : g);
    p.draw(i === 5 ? true : undefined);
  }
  assert.equal(tree(), t0, 'the tree was not rebuilt under the field');
  assert.ok(inp.isConnected, 'the same field is still there'); assert.equal(inp.value, 'Den Speakers', 'the typed text is kept'); assert.equal(doc.activeElement, inp);
  doc._blurTo(doc.body); await wait(200);   // click away
  assert.deepEqual(sent('PATCH', /^\/zones\/1$/)[0].body, { name: 'Den Speakers' }, 'leaving the field saved the new name');
  assert.ok(!inp.isConnected);
  await wait(20); p.draw(); assert.ok(!tree().querySelector('.wwinl'), 'the held redraw runs once the edit ends');
  p.el.remove();
});

test('t2035u: ask() opens next to the pressed button; anchor:null / no anchor on a PC = the old centered window; a phone = bottom sheet', async () => {
  const { ask, askAnchor } = await imp('util.js');
  const btn = doc.createElement('button'); btn.textContent = 'Delete'; doc.body.append(btn); btn.focus();
  assert.equal(askAnchor(), btn);
  let r = ask('Delete scene', 'Delete “Party”?', { ok: 'Delete', danger: true }); await wait(5);
  const pop = doc.querySelector('.wwpop'); assert.ok(pop, 'a popover, not a window'); assert.equal(doc.querySelectorAll('dialog').length, 0);
  assert.ok(pop.classList.contains('danger')); assert.equal(doc.activeElement, pop.querySelector('[data-act="pop-cancel"]'), 'danger: Cancel has focus first');
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  pop.querySelector('[data-act="pop-ok"]').click(); assert.equal(await r, true); assert.ok(!pop.isConnected);
  assert.equal(doc.activeElement, btn, 'focus returns to the button');
  r = ask('Q', 'x'); await wait(5); key(doc.querySelector('.wwpop'), 'Escape'); assert.equal(await r, false, 'Esc = no');
  r = ask('Q', 'x'); await wait(5); doc.body.dispatchEvent(ev('pointerdown', { target: doc.body })); assert.equal(await r, false, 'outside click = no');
  // explicit anchor:null -> the centered window
  r = ask('Switch address', 'Restart?', { anchor: null }); await wait(5);
  const dlg = doc.querySelector('dialog'); assert.ok(dlg && dlg._open, 'centered <dialog> fallback'); assert.ok(!doc.querySelector('.wwpop'));
  [...dlg.querySelectorAll('button')].find(b => b.textContent === 'OK').click(); assert.equal(await r, true);
  // nothing pressed / focused on a PC -> centered window too
  btn.remove(); doc._blurTo(doc.body);
  r = ask('Q', 'x'); await wait(5); const dlg2 = doc.querySelector('dialog'); assert.ok(dlg2, 'no anchor on a PC = centered');
  [...dlg2.querySelectorAll('button')].find(b => b.textContent === 'Cancel').click(); assert.equal(await r, false);
  // a real phone (html.handset): a bottom sheet even with nothing to anchor to
  doc.documentElement.classList.add('handset');
  try { r = ask('Q', 'x'); await wait(5); const sh = doc.querySelector('.wwpop'); assert.ok(sh?.classList.contains('wwpop-sheet'), 'phone: bottom sheet'); assert.ok(doc.querySelector('.wwpop-scrim'));
    doc.querySelector('.wwpop-scrim').click(); assert.equal(await r, false, 'tapping the scrim = no'); assert.ok(!doc.querySelector('.wwpop-scrim')); }
  finally { doc.documentElement.classList.remove('handset'); }
});

test('t2035u: Remove zone / Forget / Revoke confirm next to their button; a focused row after a context menu is an anchor too', async () => {
  const { confirmRemoveZone } = await imp('devices.js'); calls.length = 0;
  const S = freshS(), b = doc.createElement('button'); doc.body.append(b);
  confirmRemoveZone(S, S.groups[0], () => {}, b); await wait(5);
  const pop = doc.querySelector('.wwpop'); assert.ok(pop); assert.match(pop.textContent, /Remove zone “Basement”\?/); assert.match(pop.textContent, /1 speaker move to Unassigned \(Den\)/);
  key(pop, 'Escape'); await wait(5); assert.equal(sent('DELETE', /^\/groups\//).length, 0, 'Esc removes nothing');
  confirmRemoveZone(S, S.groups[0], () => {}, b); await wait(5); doc.querySelector('.wwpop [data-act="pop-ok"]').click(); await wait(5);
  assert.equal(sent('DELETE', /^\/groups\/1$/).length, 1);
  const row = doc.createElement('div'); row.setAttribute('tabindex', '0'); doc.body.append(row); row.focus();
  const { askAnchor } = await imp('util.js'); assert.equal(askAnchor(), row, 'a focused row (ctx menu closed onto it) anchors the confirm');
  const big = doc.createElement('div'); big.setAttribute('tabindex', '0'); big.getBoundingClientRect = () => ({ left: 0, top: 0, right: 900, bottom: 800, width: 900, height: 800 }); doc.body.append(big); big.focus();
  assert.equal(askAnchor(), null, 'a whole big list is not an anchor');
  for (const n of [b, row, big]) n.remove();
  const s = src('settings.js'), d = src('devices.js'), sc = src('scenesched.js'), zr = src('zoneref.js'), lt = src('listtable.js'), jk = src('jukebox-kiosk.js');
  assert.match(s, /const near = confirmNear\(undefined, \{ title: `Revoke “\$\{t\.name\}”\?`/);
  assert.match(d, /function forget\(ctl, z, anchor\) \{/); assert.match(d, /forget\(ctl, z, wrap\.querySelector\('button'\)\)/);
  assert.match(sc, /m\.remove\(\); btn\.focus\(\{ preventScroll: true \}\); fn\(\);/, 'scene ⋯ menu: the confirm opens next to ⋯');
  assert.match(zr, /anchor: anchor \|\| \(\(\) => document\.querySelector\(`\.tree42 \[data-device-id="\$\{z\.id\}"\] \.sp42-n`\)/);
  assert.match(lt, /async function applySortAsOrder\(anchor\)/); assert.match(jk, /anchor: \(\) => \{ const c = document\.querySelector\('#jbchip'\)/);
});

test('t2035u popPlace: below by default, above near the bottom, right-aligned in the right half, clamped inside the window', async () => {
  const { popPlace } = await imp('popover.js');
  const view = { vw: 1440, vh: 900, pad: 8, topMin: 40 };
  const a = popPlace({ left: 1200, right: 1226, top: 100, bottom: 126 }, 300, 120, view);
  assert.equal(a.side, 'below'); assert.equal(a.top, 132); assert.equal(a.left, 926, 'right edges line up (opens into the content)'); assert.ok(a.arrowX > 280);
  const b = popPlace({ left: 20, right: 46, top: 850, bottom: 876 }, 300, 120, view);
  assert.equal(b.side, 'above'); assert.equal(b.left, 20); assert.ok(b.top + 120 <= 850 - 6 + 0.01);
  const c = popPlace({ left: 1430, right: 1440, top: 10, bottom: 30 }, 300, 2000, view);
  assert.ok(c.left >= 8 && c.left + 300 <= 1440 - 8); assert.ok(c.top >= 40); assert.ok(c.maxHeight <= 900);
});

test('0.7.1 small fixes: a narrow PC window keeps the desktop song menu (html.handset only); Daylight danger text is readable', () => {
  const u = src('ui.js');
  assert.match(u, /const isPhone = \(\) => typeof document !== 'undefined' && !!document\.documentElement\?\.classList\?\.contains\('handset'\);/);
  assert.doesNotMatch(u.match(/export function attachItem[\s\S]*?longPress\(el, openMenu\);/)[0], /max-width:900px/);
  const c = css();
  assert.match(c, /:root\[data-scheme=light\] \.btn\.danger\{color:color-mix\(in srgb,var\(--red\) 70%,#000\)/);
  assert.match(c, /\.wwpop\.wwpop-sheet\{left:0;right:0;bottom:0/); assert.match(c, /html:not\(\.handset\) \.wwpop\.wwpop-sheet\{/, 'a PC never gets the phone sheet look');
  assert.doesNotMatch(c, /@media \(max-width:900px\)[^{]*\{[^}]*\.wwpop/, 'no width-based phone rules for the popover');
});

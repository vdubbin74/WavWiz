// WavWiz 0.3.2 - logic + markup checks. Browser behavior is covered by tests/ui/ui032.mjs (Chromium), server rules by Release032*Tests.cs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
globalThis.Element ??= class {};
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
const css = readFileSync(join(js, '../app.css'), 'utf8');
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

test('F2: speaker registry - 24 rapid / concurrent on-off toggles never leave more than one live stream (no echo)', async () => {
  const { speakerRegistry } = await imp('speakerreg');
  const all = []; let peak = 0;
  const make = () => { const d = { running: false, async start() { await tick(Math.random() * 5); this.running = true; }, async stop() { await tick(Math.random() * 3); this.running = false; } }; all.push(d); return d; };
  const reg = speakerRegistry(make);
  const live = () => all.filter(d => d.running).length;
  const watch = setInterval(() => { peak = Math.max(peak, live()); }, 0);
  const ops = [];
  for (let i = 0; i < 24; i++) { ops.push(i % 2 ? reg.stop() : reg.start()); if (i % 3 === 0) await tick(1); }   // some overlap, some back to back
  await Promise.all(ops); clearInterval(watch);
  assert.ok(peak <= 1, 'never two streams at once (peak ' + peak + ')'); assert.equal(live(), 0, 'ends stopped (last op was stop)');
  await reg.start(); await Promise.all([reg.start(), reg.start(), reg.start()]); assert.equal(live(), 1, 'repeated starts keep one stream');
  await reg.stop(); assert.equal(live(), 0);
  // a start that fails does not leave a live device
  const bad = speakerRegistry(() => ({ running: false, async start() { throw new Error('denied'); }, async stop() { this.running = false; } }));
  await assert.rejects(bad.start()); assert.equal(bad.liveCount, 0);
});

test('F4: zone slider - zoneShift keeps member offsets through a clamp and returns them on the way back', async () => {
  const s = src('devices.js'); const body = s.slice(s.indexOf('export function zoneShift')); const fn = body.slice(0, body.indexOf('\n')).replace('export ', '');
  const zoneShift = new Function(fn + '; return zoneShift;')();
  const up = zoneShift([90, 60], 95);
  assert.deepEqual(up.virt, [110, 80]); assert.deepEqual(up.real, [100, 80], 'clamped at 100, the offset stays virtual');
  assert.deepEqual(zoneShift(up.virt, 75).real, [90, 60], 'back down: the 30-point offset is intact');
  assert.deepEqual(zoneShift([10, 0], -50).real, [5, 0], 'slider at 0: the average lands on 0, nobody goes negative');
});

test('F13/F15: playlist has three heights; ˄ steps up, ˅ steps down; arrows hide at the ends; center width follows the window', async () => {
  const p = await imp('panels');
  assert.deepEqual(p.LIST_STEPS, ['collapsed', 'open', 'expanded']);
  assert.equal(p.listStep({ list: 'open' }, 'up').list, 'expanded'); assert.equal(p.listStep({ list: 'expanded' }, 'up').list, 'expanded');
  assert.equal(p.listStep({ list: 'expanded' }, 'down').list, 'open'); assert.equal(p.listStep({ list: 'open' }, 'down').list, 'collapsed'); assert.equal(p.listStep({ list: 'collapsed' }, 'down').list, 'collapsed');
  assert.deepEqual(p.listArrows('collapsed'), { up: true, down: false }); assert.deepEqual(p.listArrows('expanded'), { up: false, down: true });
  assert.equal(p.centerWidthFor(1920), 1140); assert.equal(p.centerWidthFor(1280), 690);
  assert.equal(p.normPanels({ list: 'expanded' }).list, 'expanded');
});

test('F1/F5/F6/F17/F21 markup: mirrored rail, round master mute, dividers, 4-column expanded Devices, tags under the volume bar', () => {
  assert.match(css, /\.libpanel \.prail-t\{transform:rotate\(180deg\)\}/);
  const d = src('devices.js');
  assert.match(d, /class: 'mutebtn mastermute'/); assert.doesNotMatch(d, /'Mute all'/);
  assert.match(d, /class: 'pane-h dsec-h devs-h'/); assert.match(d, /class: 'pane-h dsec-h zones-h'/);
  assert.match(css, /\.devpanel\.expanded \.dexp-main\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(d, /h\('div', \{ class: 'dtagrow' \}, tags\)/); assert.match(d, /class: 'dtagrow ztagrow'/);
  assert.match(d, /class: 'dot zdot '/, 'zone cards carry the same dot so names line up');
});

test('F18: padlock by the volume bar when the max-volume lock is on; admin-only cap control', () => {
  const d = src('devices.js');
  assert.match(d, /if \(z\.volLocked\) \{ const lk = h\('span', \{ class: 'vlock'/);
  assert.match(d, /function volCapControl\(S, ctl, z, admin\)/); assert.match(d, /`\/zones\/\$\{z\.id\}\/volcap`/);
  assert.match(d, /'Only an admin can change the max volume\.'/);
});

test('F19: locked EQ is never dimmed; Lock button = danger red, Pepecoin copper', async () => {
  const t = await imp('theme');
  assert.equal(t.derive({ ...t.PRESETS.pepecoin, preset: 'pepecoin' })['--lock-red'], '#C07A4E');
  for (const id of Object.keys(t.PRESETS).filter(k => k !== 'pepecoin')) assert.equal(t.derive({ ...t.PRESETS[id], preset: id })['--lock-red'], 'var(--red)', id);
  assert.match(css, /\.eqarea\.locked \.eqa-plot,\.eqarea\.locked \.eqchips\{opacity:1;filter:none\}/);
  assert.match(css, /\.stage \.vbtns \.ib\.ov-lock\.on\{color:var\(--lock-red\)/);
  assert.match(src('eqview.js'), /if \(isLocked\) el\.title = 'EQ locked'/);
});

test('F20: Button transparency sets only the overlay group; the EQ / visualizer are never faded', async () => {
  const l = await imp('looks');
  assert.equal(l.btnOpacity(0), 1); assert.equal(l.btnOpacity(80), 0.2); assert.equal(l.btnOpacity(100), 0);
  assert.doesNotMatch(css, /\.np-stage\.viz \.vizhost\{opacity:calc/); assert.doesNotMatch(css, /\.np-stage\.eqmode \.eqa-glow\{opacity:var\(--wz-ovf/);
  assert.match(css, /\.stage>\.vbtns\{opacity:var\(--ov-rest,\.5\)!important\}/);
  assert.match(css, /\.stage>\.vbtns:hover,\.stage>\.vbtns:focus-within,\.stage>\.vbtns\.solid/);
});

test('F3: Mini player replaces Remote mode; F10/F11: versioned art URLs; F16: (i) help; What\'s new 0.3.2', async () => {
  const rm = await imp('remotemode'); assert.equal(rm.isRemote({ getItem: () => '1' }, '?remote=1'), false);
  assert.match(src('menu.js'), /\['Mini player'/); assert.match(src('mini.js'), /send\(/);
  const art = await imp('art'); art.setArtCv('3.0.3.2'); assert.match(art.itemArtUrl({ kind: 'track', trackId: 5, refId: 5, id: 5 }) || '', /cv=3\.0\.3\.2/);
  assert.match(src('settingsui.js'), /class: 'infoi'|infoi/);
  const a = await imp('about'); assert.equal(a.WHATS_NEW_VERSION, '0.3.3'); assert.ok(a.WHATS_NEW.some(([t]) => t === 'Album art fixed'));
  assert.ok(!a.WHATS_NEW.some(([t]) => t === 'Remote mode'), 'retired feature not advertised');
});

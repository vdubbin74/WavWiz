// 0.7.3 t2234u / t2235u / t2236u: Audio inputs name box gets a "Display name" with a clear "Source:" line (the PC's name, "This PC" only in a
// browser on that PC; Library > Inputs says the same), the token buttons stack full width on narrow screens, "Spotify Connect" on one line,
// no extra gap under an idle zone box's volume slider (Devices and Volume Mixer), the mixer speaker grip spans the whole speaker block
// (drawer included) and the mixer drawer sliders use the standard thumb.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const src = f => readFileSync(join(js, f), 'utf8');
const css = readFileSync(join(js, '..', 'app.css'), 'utf8');
const b34 = css.slice(css.indexOf('/* 0.7.3 t2234u:'), css.indexOf('/* end 0.7.3 t2234u */'));
const b35 = css.slice(css.indexOf('/* 0.7.3 t2235u / t2236u:'), css.indexOf('/* end 0.7.3 t2235u */'));
const imp = f => import(pathToFileURL(join(js, f)).href);
const PHONE = { thisMachine: false, machineName: null }, SAME = { thisMachine: true, machineName: 'PCBOXV2' };
const LB = { id: 'lb', kind: 'loopback', name: 'PCBOXV2 · Speakers', defaultName: 'PCBOXV2 · Speakers', source: 'PCBOXV2 · Speakers (what you hear)', device: 'Speakers', pc: 'PCBOXV2' };
const MIC = { id: 'm', kind: 'mic', name: 'HyperX QuadCast', defaultName: 'HyperX QuadCast', source: 'PCBOXV2 · Microphone', device: 'HyperX QuadCast', pc: 'PCBOXV2' };

test('sourceLine: "Source: <PC> · Speakers (what that PC plays)"; "This PC … (what this PC plays)" only on that PC', async () => {
  const { sourceLine, pcInput } = await imp('pcname.js');
  assert.equal(sourceLine(pcInput(LB, PHONE)), 'Source: PCBOXV2 · Speakers (what that PC plays)');
  assert.equal(sourceLine(pcInput(LB, SAME)), 'Source: This PC · Speakers (what this PC plays)');
  assert.equal(sourceLine(pcInput({ ...LB, source: 'OFFICE-PC · Speakers (what you hear)' }, SAME)), 'Source: OFFICE-PC · Speakers (what that PC plays)');   // another PC's loopback
  assert.equal(sourceLine(null), ''); assert.equal(sourceLine({ kind: 'aux' }), '');
});

test('sourceLine: microphones and other inputs name their PC the same way; the device shows when the display name is custom', async () => {
  const { sourceLine, pcInput } = await imp('pcname.js');
  assert.equal(sourceLine(pcInput(MIC, PHONE)), 'Source: PCBOXV2 · Microphone');
  assert.equal(sourceLine(pcInput(MIC, SAME)), 'Source: This PC · Microphone');
  const renamed = pcInput({ ...MIC, name: 'Host mic' }, PHONE);
  assert.equal(renamed.name, 'Host mic');   // a custom name is kept
  assert.equal(sourceLine(renamed), 'Source: PCBOXV2 · Microphone · HyperX QuadCast');
  assert.equal(sourceLine(pcInput({ id: 'a', kind: 'aux', name: 'Turntable', source: 'PCBOXV2 · Aux in', device: 'Line In (Realtek)' }, PHONE)), 'Source: PCBOXV2 · Aux in · Line In (Realtek)');
  assert.equal(sourceLine(pcInput({ ...LB, name: 'Desk PC' }, PHONE)), 'Source: PCBOXV2 · Speakers (what that PC plays)');   // loopback: the device is the PC itself
});

test('Settings > Audio inputs: a "Display name" label over the name box (default name as placeholder) and the Source line; Library > Inputs uses the same line', () => {
  const s = src('inputs.js');
  assert.match(s, /import \{ pcInput, sourceLine \} from '\.\/pcname\.js'/);
  assert.match(s, /h\('label', \{ class: 'inp-namef' \}, h\('span', \{ class: 'small inp-namel' \}, 'Display name'\), name\), h\('div', \{ class: 'small dim inp-src' \}, sourceLine\(i\)\)/);
  assert.match(s, /placeholder: i\.defaultName \|\| ''/);
  assert.match(s, /onchange: ev => put\(i\.id, \{ name: ev\.target\.value\.trim\(\) \|\| null \}\)/);   // empty = back to the default; custom names are kept
  assert.match(s, /h\('b', \{ class: 'ell' \}, i\.name\), h\('span', \{ class: 'small dim inp-src' \}, sourceLine\(i\)\)/);   // Library tile (no rename box there)
  assert.doesNotMatch(s, /i\.source \+ \(i\.kind !== 'loopback'/);
  assert.match(b34, /\.inp-src\{white-space:normal;overflow-wrap:break-word;word-break:normal/);
});

test('token buttons: one tok-btns row that stacks full width on the phone look (phone + narrow PC), never wrapping inside a button; Spotify Connect stays on one line', () => {
  const s = src('settings.js');
  assert.equal((s.match(/class: 'row tok-btns'/g) || []).length, 2);
  assert.match(b34, /\.tok-btns \.btn\{white-space:nowrap\}/);
  assert.match(b34, /^html\.phonelook \.tok-btns\{flex-direction:column;align-items:stretch\}$/m); assert.match(b34, /^html\.phonelook \.tok-btns \.btn\{width:100%/m);
  assert.doesNotMatch(b34 + b35, /@media/);   // phone look rules hang on html.phonelook (0.7.3 t2225u), never a width query
  assert.match(s, /h\('label', \{ class: 'row wrap spot-row'/);
  assert.match(b34, /\.spot-row>b\{white-space:nowrap\}/);
});

test('zone box: no stacked gap under the zone volume slider - idle header margin of a removed divider, header padding + zone card padding (Devices and the mixer share it)', () => {
  assert.match(b35, /^\.qb42\.idle \.qb42-head\{margin-bottom:0\}$/m);
  assert.match(b35, /^\.tree42 \.qb42-head:has\(\+\.zwrap42\)\{padding-bottom:2px\}/m);
  assert.match(b35, /^\.tree42\.mx-on \.qb42-head\+\.zwrap42>\.zcard42:first-child\{padding-top:0\}$/m);
  assert.match(css, /\.dmaster,\.dexp-top,\.qb42\.idle \.qb42-head\{border-bottom:0\}/);   // the divider really is gone
  assert.ok(css.indexOf('.qb42.idle .qb42-head{margin-bottom:0}') > css.indexOf('.qb42.idle .qb42-head{border-bottom:1px solid var(--line);margin:0 0 8px}'));
});

test('mixer: the grip spans the speaker block and continues down its open drawer; drawer sliders use the standard 20 px thumb', () => {
  assert.match(b35, /\.tree42 \.sp42\.mx-sp>\.dgrip42\{position:absolute;left:0;top:8px;bottom:4px/);
  assert.match(b35, /\.tree42\.mx-on \.sp42\.mx-sp>\.dgrip42\+\.dot\{margin-left:19px\}/);
  assert.match(b35, /\.sp42\.mx-sp:has\(\+\.mx-drawer:not\(\[hidden\]\)\)>\.dgrip42\{bottom:0/);
  assert.match(b35, /\.tree42\.mx-on \.sp42\.mx-sp\+\.mx-drawer::before\{content:"";position:absolute;left:calc\(-1 \* var\(--mxdl\)\)/);
  assert.match(b35, /html\.phonelook \.tree42\.mx-on \.sp42\.mx-sp\+\.mx-drawer\{--mxdl:8px\}/);
  assert.match(css, /html\.phonelook \.tree42\.mx-on \.mx-drawer\{margin-left:8px\}/);   // --mxdl matches the drawer's indent
  assert.match(css, /\.tree42\.mx-on \.mx-drawer\{margin:0 0 6px 22px\}/);
  assert.match(b35, /\.tree42\.mx-on \.mx-drawer input\.mv-s::-webkit-slider-thumb\{width:20px;height:20px;margin-top:-7px\}/);
  assert.match(css, /input\[type=range\]::-webkit-slider-thumb\{-webkit-appearance:none;width:20px;height:20px;[^}]*margin-top:-7px/);   // = the speaker volume rows
  assert.match(src('tree42.js'), /return r\._mxDr \? \[r, r\._mxDr\] : \[r\]/);   // the drawer still follows its row
});

test('t2237u: the Volume mixer button follows the real mode (aria-pressed), not focus or hover; filled accent + white icon; focus-visible kept', async () => {
  const { installDom } = await import('./minidom.mjs');
  const doc = installDom(); doc.defaultView = globalThis;
  globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
  const m = await imp('mixer.js');
  m.setMixer(false);
  const b = m.mixerButton('mutebtn dmixbtn'); doc.body.append(b);
  assert.equal(b.getAttribute('aria-pressed'), 'false');
  m.setMixer(true);
  assert.equal(b.getAttribute('aria-pressed'), 'true');
  assert.equal(m.mixerButton().getAttribute('aria-pressed'), 'true');   // a button drawn while the mixer is open starts pressed
  b.dispatchEvent({ type: 'blur' }); doc.body.dispatchEvent({ type: 'pointerdown' });   // losing focus (a tap on a blank spot) changes nothing
  assert.equal(b.getAttribute('aria-pressed'), 'true');
  m.setMixer(false);
  assert.equal(b.getAttribute('aria-pressed'), 'false');
  const blk = css.slice(css.indexOf('/* 0.7.3 t2237u:'), css.indexOf('/* end 0.7.3 t2237u */'));
  assert.match(blk, /\.mixbtn\[aria-pressed=true\],\.mixbtn\[aria-pressed=true\]:hover:not\(\[disabled\]\)\{background:var\(--accent\)!important;border-color:var\(--accent\)!important;color:#fff!important\}/);
  assert.match(blk, /\.mixbtn\[aria-pressed=true\]:focus-visible\{outline:2px solid/);
  assert.match(css, /\.mixbtn:focus-visible\{outline:1px solid var\(--accent\)/);
  assert.match(css, /@media \(hover:hover\)\{\.mixbtn:hover:not\(\[disabled\]\)\{/);   // a touch's sticky hover no longer looks like "on"
  assert.doesNotMatch(css, /\.mixbtn:focus(?!-visible)/);
  assert.match(src('mini.js'), /class: 'mutebtn mixbtn mp-mix', 'data-act': 'mixer', 'aria-pressed': String\(document\.documentElement\.classList\.contains\('mx-open'\)\)/);
});

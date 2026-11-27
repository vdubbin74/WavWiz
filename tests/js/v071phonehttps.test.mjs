// 0.7.1 t2042u: hints said "Settings > Phone & HTTPS" (no such page). The card #sec-phone is in Settings > Devices > Calibration.
// The wording is now "Settings > Devices > Phone & HTTPS", and in the web UI that phrase is a link that opens the card and highlights it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installDom, ev } from './minidom.mjs';

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const src = f => readFileSync(join(js, f), 'utf8');
const doc = installDom(); doc.defaultView = globalThis;
globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
const imp = f => import(pathToFileURL(join(js, f)).href);

test('t2042u: no web UI text points to a "Settings > Phone & HTTPS" page any more', () => {
  for (const f of readdirSync(js).filter(f => f.endsWith('.js'))) {
    const s = src(f);
    assert.doesNotMatch(s, /Settings (>|›) Phone & HTTPS|Settings › Calibration › Phone/, `${f}: stale path`);
  }
  for (const f of ['diag.js', 'about.js', 'calerrors.js', 'calmic.js']) assert.match(src(f), /Settings > Devices > Phone & HTTPS/, f);
});

test('t2042u: the phrase is a link; it opens Settings > Devices > Calibration at #sec-phone (an open Settings switches in place)', async () => {
  const u = await imp('util.js');
  assert.equal(u.linkSettings('No link here'), 'No link here');
  const parts = u.linkSettings('Only needed for phones. Settings > Devices > Phone & HTTPS shows how to trust it.');
  const a = parts.find(p => p?.nodeType); assert.ok(a, 'a link');
  assert.equal(a.tagName, 'A'); assert.equal(a.textContent, 'Settings > Devices > Phone & HTTPS'); assert.equal(a.getAttribute('data-go'), 'settings:phone');
  assert.equal(parts[0], 'Only needed for phones. '); assert.equal(parts.at(-1), ' shows how to trust it.');
  // no Settings open: ask the app to go to settings:phone
  const got = []; const on = e => got.push(e.detail); window.addEventListener('wavwiz:go', on);
  a.dispatchEvent(ev('click', { target: a, preventDefault() {} })); assert.deepEqual(got, ['settings:phone']);
  // Settings already open: switch in place, no second window
  const dlg = doc.createElement('dialog'); dlg.className = 'settings-dlg'; dlg.setAttribute('open', ''); const seen = []; dlg._goSec = s => seen.push(s); doc.body.append(dlg);
  a.dispatchEvent(ev('click', { target: a, preventDefault() {} })); assert.deepEqual(seen, ['phone']); assert.deepEqual(got, ['settings:phone'], 'not opened twice');
  dlg.remove(); window.removeEventListener('wavwiz:go', on);
  const st = src('settings.js'), dg = src('diag.js');
  assert.match(st, /const focusSec = section === 'phone' \? 'sec-phone' :/, 'settings:phone lands on the card');
  assert.match(st, /let devSub = section === 'phone' \|\| section === 'calibration' \? 'calibration' : 'players';/, 'in the Calibration sub-section');
  assert.match(st, /sectionFor\(section\)/); assert.match(st, /section === 'phone' \|\| section === 'devices'/);
  assert.match(st, /function showSec\(id\) \{ const el = body\.querySelector\('#' \+ id\); if \(!el\) return; (?:el\._reveal\?\.\(\); )?el\.scrollIntoView\(\{ block: 'start' \}\); pulse\(el\); \}/, 'scrolled to and highlighted');
  assert.match(st, /d\.el\._goSec = sec => \{ active = sectionFor\(sec\); if \(sec === 'phone' \|\| sec === 'calibration'\) devSub = 'calibration'; paint\(\);/);
  assert.match(dg, /'What to do: ', linkSettings\(c\.fix\)/); assert.match(dg, /linkSettings\(w\)/); assert.match(dg, /linkSettings\(i\.detail\)/);
});

test('t2129u: installer, PhoneApi and docs use Settings > Devices > Phone & HTTPS (not the old path)', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const read = rel => readFileSync(join(root, rel), 'utf8');
  const iss = read('installer/WavWiz.iss'), lib = read('installer/scripts/lib.ps1'), phone = read('src/WavWiz.Server/Api/PhoneApi.cs');
  const stale = /Settings (>|›|&rsaquo;) Phone/;
  for (const [name, src] of [['WavWiz.iss', iss], ['lib.ps1', lib], ['PhoneApi.cs', phone], ['FIRST-RUN.md', read('docs/FIRST-RUN.md')]]) {
    assert.doesNotMatch(src, stale, `${name}: stale Settings > Phone path`);
  }
  assert.match(iss, /see WavWiz Settings > Devices > Phone & HTTPS for the exact link/);
  assert.match(iss, /Connect link: see WavWiz Settings > Devices > Phone & HTTPS/);
  assert.match(iss, /For calibrating with the phone microphone, also follow Settings > Devices > Phone & HTTPS\./);   // F273: the what-next steps were reordered (network first)
  assert.match(iss, /Devices > Phone role…/);
  assert.doesNotMatch(iss, /Menu > This phone as a device/);
  assert.equal((lib.match(/Settings > Devices > Phone & HTTPS/g) || []).length, 2);
  assert.match(phone, /press <b>Set up secure connection<\/b> on the PC/);   // F274 W1: the phone page names the one button, not a menu path
  assert.doesNotMatch(phone, /Settings &rsaquo; Phone &amp; HTTPS/);
});

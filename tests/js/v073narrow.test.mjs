// 0.7.3 t2225u: a narrow PC window looks the same as the phone (newest phone look included), but keeps every desktop feature.
// html.phonelook = a real phone OR a window at phone width; LOOK rules use it. Phone-only RESTRICTIONS / touch behavior stay on html.handset
// (never decided by width): drawer pins + shortcut hints, PC-file menu items, bottom-sheet popovers, long-press rows, no text selection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const src = f => readFileSync(join(js, f), 'utf8');
const css = readFileSync(join(js, '..', 'app.css'), 'utf8');
const imp = f => import(pathToFileURL(join(js, f)).href);

test('phoneLook: a real phone always; a PC window only at phone width; follows the window when it is resized', async () => {
  const { phoneLook, installPhoneLook, PHONE_LOOK_MQ } = await imp('phonelook.js');
  assert.equal(PHONE_LOOK_MQ, '(max-width:900px)', 'the same breakpoint as the phone layout (main.js wide())');
  assert.equal(phoneLook(true, false), true); assert.equal(phoneLook(false, true), true); assert.equal(phoneLook(false, false), false);
  const cls = new Set(), doc = { documentElement: { classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) } } };
  let fire = null; const mq = { matches: false, addEventListener: (t, f) => { assert.equal(t, 'change'); fire = f; } };
  assert.equal(installPhoneLook(false, doc, q => { assert.equal(q, PHONE_LOOK_MQ); return mq; }), false); assert.ok(!cls.has('phonelook'));
  mq.matches = true; fire(); assert.ok(cls.has('phonelook'), 'narrowing a PC window switches the look');
  mq.matches = false; fire(); assert.ok(!cls.has('phonelook'), 'widening it switches back');
  cls.clear(); installPhoneLook(true, doc, () => ({ matches: false, addEventListener() {} })); assert.ok(cls.has('phonelook'), 'a phone in landscape keeps the phone look');
  assert.equal(installPhoneLook(false, null, null), false, 'no DOM (node) is fine');
});

test('main.js: html.handset still follows the device only; html.phonelook is set beside it', () => {
  const m = src('main.js');
  assert.match(m, /document\.documentElement\.classList\.toggle\('handset', isRealPhone\(\)\);/);
  assert.match(m, /installPhoneLook\(isRealPhone\(\)\);/);
  assert.match(m, /import \{ installPhoneLook \} from '\.\/phonelook\.js';/);
});

test('look rules moved to html.phonelook: header, tab bar + Sound on Now Playing, Announce, inputs, mixer, Add speaker sheet', () => {
  for (const re of [/html\.phonelook \.topbar:not\(\.wtitlebar\)\{gap:var\(--hdr-gap,8px\)\}/, /html\.phonelook #app>\.desk\[data-view=now\]~\.tabbar\{display:flex\}/,
    /html\.phonelook \.np-phone-full \.np-phone-actions\{display:none\}/, /html\.phonelook \.np-phone-full \.np-phone-xsound\{display:inline-flex/,
    /html\.phonelook \.tree42-h \.annwrap \.annlbl\{display:none\}/, /html\.phonelook \.inp-grid\{grid-template-columns:1fr/, /html\.phonelook dialog\.addspk-dlg\{/,
    /html\.phonelook \.tree42\.mx-on \.mx-drawer \.mv-dnum\{/, /html\.phonelook \.lsx \.pk\{grid-template-columns:1fr\}/]) assert.match(css, re);
  assert.match(src('addspeaker.js'), /classList\.contains\('phonelook'\)\) return 0;/, 'the sheet docks above the same mini player + tab bar on a narrow PC');
  // a narrow PC window has no Queue / Sound pair any more, so its More playback controls row gets Sound - and keeps Master volume + pins
  assert.match(src('now.js'), /class: 'row np-phone-xrow np-xrow-pc' \}, mkSleepIc\(\), mkSoundX\(\), mkMix\(\), shortcutsRow\(\{.*home: false/);
});

test('phone-only restrictions and touch behavior stay on html.handset (a narrow PC keeps pins, shortcut hints, Home and the full menus)', () => {
  assert.match(css, /html\.handset \.drawer nav\.desk-menus \.kbd,\s*html\.handset \.drawer nav\.desk-menus \.mpin\{display:none\}/);
  assert.match(css, /html\.handset \.adminchip\.adminchip-tap\{cursor:pointer/);
  assert.match(css, /html\.handset \.wwpop-sheet \.wwpop-f \.btn\{/);
  assert.match(css, /html\.handset \.tree42 \.sp42,html\.handset \.tree42 \.sp42 \*,/);
  assert.match(css, /html\.handset \.npdrop-over\{/);
  // no phone-look rule hides a desktop feature
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, ''), look = [...bare.matchAll(/([^{}]*html\.phonelook[^{}]*)\{([^}]*)\}/g)];
  assert.ok(look.length >= 30, String(look.length));
  for (const [, sel, body] of look) if (/display:none/.test(body)) assert.match(sel.trim(), /\.annlbl|\.np-phone-actions|\.ann-live \.small|\.spk-head\.wwinl-host>:not\(\.wwinl\)|\.toktbl thead/, 'only duplicates / labels are hidden (t2231u: rename-row buttons while the inline field is open, token header replaced by inline labels): ' + sel.trim());
  for (const [, sel] of look) assert.doesNotMatch(sel, /\.mpin|\.kbd|\.np-xpins|desk-menus|\.home/, sel.trim());
  // JS that decides what is available still asks for a real phone
  assert.match(src('menu.js'), /const htmlHandset = \(\) => [^\n]*classList\?\.contains\('handset'\)/);
  assert.match(src('popover.js'), /export const isHandset = \(\) => [^\n]*contains\('handset'\)/);
  assert.match(src('ctxmenu.js'), /const ROW_PHONE = \(\) => [^\n]*contains\('handset'\)/);
  for (const f of ['menu.js', 'popover.js', 'ctxmenu.js', 'ui.js', 'elevate.js', 'library.js', 'util.js']) assert.doesNotMatch(src(f), /phonelook/, f + ' decides features - never the look class');
});

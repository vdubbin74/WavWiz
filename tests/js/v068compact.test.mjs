// 0.6.8-#5 / 0.6.8 narrow-PC menus: compact PC window keeps desktop features; phone-only rules key off the device; one scroller.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const www = new URL('../../src/WavWiz.Server/wwwroot/', import.meta.url);
const js = f => readFileSync(new URL('js/' + f, www), 'utf8'), css = () => readFileSync(new URL('app.css', www), 'utf8');
test('0.6.8 narrow PC drawer: standard File/Library/Playback/Devices/Help (no views half / All menus)', () => {
  const m = js('menu.js'), s = css();
  assert.match(m, /if \(!isPhoneUa\(\)\) return createCompactPcNav/);
  assert.match(m, /function createCompactPcNav/);
  assert.match(m, /class: 'desk-menus desk-fly'/);
  assert.doesNotMatch(m, /'All menus'/);
  assert.match(m, /\['Now Playing', \(\) => go\('now'\)\]/);
  for (const lab of ['File', 'Library', 'Playback', 'Devices', 'Help']) {
    assert.match(m, new RegExp(`topSpec\\('${lab}'`));
  }
  assert.match(s, /\.drawer nav\.desk-menus/);
  assert.match(s, /\.drawer nav\.desk-menus .mgroup\.open>\.mpanel/);
  assert.match(m, /if \(o\?\.pin && pins\) btn\.append\(pinSpan\(o\.pin\)\)/);
});
test('0.6.8 narrow PC menus: flyout when ~220px free to the right, else accordion; resize rechecks', () => {
  const m = js('menu.js'), s = css();
  assert.match(m, /FLYOUT_MIN_W = 220/);
  assert.match(m, /function flyoutFits/);
  assert.match(m, /innerWidth - r\.right - 6 >= FLYOUT_MIN_W/);
  assert.match(m, /function applyMode/);
  assert.match(m, /desk-acc/);
  assert.match(m, /addEventListener\('resize', applyMode\)/);
  assert.match(m, /ResizeObserver\(applyMode\)/);
  // Flyout mode: hover still opens; accordion: hover does not
  assert.match(m, /onmouseenter: \(\) => \{ if \(!isAcc\(\)\) openFly\(\); \}/);
  assert.match(m, /onmouseenter: \(\) => \{ if \(!isAcc\(\) && openGroup && openGroup !== group\) toggle\(group, btn\); \}/);
  // Accordion: Enter / Space / ArrowRight expand
  assert.match(m, /ev\.key === 'Enter' \|\| ev\.key === ' ' \|\| ev\.key === 'ArrowRight'/);
  assert.match(s, /\.drawer nav\.desk-menus\.desk-acc/);
  assert.match(s, /@keyframes desk-acc-slide/);
  assert.match(s, /prefers-reduced-motion:reduce/);
  assert.match(s, /\.drawer nav\.desk-menus\.desk-acc .mgroup\.open>\.mtop::after/);
});
test('0.6.8 menu pins use themed SVG icon (no emoji pushpin)', () => {
  const m = js('menu.js'), s = css(), ic = js('icons.js');
  assert.match(m, /function pinSpan\(id\)/);
  assert.match(m, /s\.append\(icon\('pin'\)\)/);
  assert.doesNotMatch(m, /📌/);
  assert.match(ic, /pin: '<path d="M9 4h6/);
  assert.match(s, /\.drawer nav\.desk-menus \.mpin/);
  assert.match(s, /\.drawer nav\.desk-menus \.mpin \.ic svg\{width:14px/);
});
test('0.6.8-#5 phone drawer: short F67 list only (no desktop All menus tree)', () => {
  const m = js('menu.js');
  const i = m.indexOf('export function createPhoneDrawerNav');
  const j = m.indexOf('\nfunction createCompactPcNav', i);
  const phone = m.slice(i, j > 0 ? j : undefined);
  assert.match(phone, /leaf\('Now Playing'/);
  assert.match(phone, /leaf\('Settings'/);
  assert.doesNotMatch(phone, /accordion\('File'/);
  assert.doesNotMatch(phone, /'All menus'/);
});
test('0.6.8-#5 phone-only restrictions use the device (isRealPhone), not the viewport width', () => {
  assert.match(js('viz.js'), /export const isRealPhone = \(\) =>/);
  assert.match(js('appearance.js'), /isRealPhone as isPhone \} from '\.\/viz\.js'/);
  assert.match(js('now.js'), /popout: !inDesktopPlayer\(\) && !isRealPhone\(\)/);
  assert.match(js('main.js'), /\(k === 'themes' \|\| isRealPhone\(\)\) \? 'theme' : 'viz'/);
});
test('0.6.8-#5 compact PC: one scroller', () => {
  const s = css();
  assert.match(s, /\.phone-queue\{position:relative\}/);
  assert.match(s, /@media \(max-width:900px\) and \(pointer:fine\)\{ html,body\{overflow:hidden\} \}/);
});

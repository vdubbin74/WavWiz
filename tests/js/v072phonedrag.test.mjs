// 0.7.2 t2190u: on the phone, holding a speaker row to drag it no longer opens the long-press menu or the iOS text callout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const rd = f => readFileSync(new URL('../../src/WavWiz.Server/wwwroot/' + f, import.meta.url), 'utf8');
const tree = rd('js/tree42.js'), ctx = rd('js/ctxmenu.js'), css = rd('app.css');
test('t2190u: no text selection / callout on speaker and zone rows (phone only)', () => {
  assert.match(css, /html\.handset \.tree42 \.sp42,html\.handset \.tree42 \.sp42 \*,[^{]*\{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none\}/);
  assert.doesNotMatch(css, /^\.tree42 \.sp42\{[^}]*touch-callout/m);   // desktop untouched
});
test('t2190u: a touch hold on the row (phone) starts the same drag; buttons and sliders do not', () => {
  assert.match(tree, /ev\.pointerType === 'touch' && document\.documentElement\.classList\.contains\('handset'\) && !ev\.target\.closest\(PHONE_ROW_SKIP\)/);
  assert.match(tree, /const PHONE_ROW_SKIP = 'input,select,textarea,a\[href\],\[role="slider"\],\.sp42-mute,\.mutebtn,\.tagact,\.ctxmenu,button:not\(\.dname\)'/);
  assert.match(tree, /dragFromKey\(S\.groups, id\)\);[^\n]*\n\s+closeCtx\(\);/);   // drag wins over a menu that opened
});
test('t2190u: holding still still opens the menu (also on the name on the phone), never while a drag runs', () => {
  assert.match(ctx, /t = setTimeout\(\(\) => \{ t = 0; if \(!PD\.active\) show\(sx, sy\); \}, 550\)/);
  assert.match(ctx, /ROW_PHONE\(\) \? 'button:not\(\.dname\),input,/);
  assert.match(ctx, /: 'button,input,\.dgrip,\.dgrip42,\.zgut42,\.cgrip69,\.vbar'/);   // desktop / tablet list unchanged
});

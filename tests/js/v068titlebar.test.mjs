// 0.6.8-#16: themed title bar for the Windows app (WavWiz Player / WebView2): only with the host's token, drag region + no-drag controls,
// window buttons post {cmd:'win'}, logo hook for the official Parallel Flow logo later.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.Element ??= class {};
const W = new URL('../../src/WavWiz.Server/wwwroot/', import.meta.url);
const rd = p => readFileSync(new URL(p, W), 'utf8');
const { hasCustomChrome, GLYPH } = await import(new URL('js/titlebar.js', W));
const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0';

test('only the Windows app with the custom-bar token gets the bar; browsers, phones and the classic frame do not', () => {
  assert.equal(hasCustomChrome(EDGE + ' WavWizPlayer/0.6.8 WavWizChrome/1'), true);
  assert.equal(hasCustomChrome(EDGE + ' WavWizPlayer/0.6.8'), false);   // CustomTitleBar off
  assert.equal(hasCustomChrome(EDGE), false);
  assert.equal(hasCustomChrome('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile WavWizChrome/1'), false);
});

test('window buttons post the host protocol; Segoe caption glyphs', () => {
  const t = rd('js/titlebar.js');
  for (const a of ['min', 'max', 'close']) assert.match(t, new RegExp(`btn\\('${a}'`));
  assert.match(t, /send\(\{ cmd: 'win', act \}\)/); assert.match(t, /act: 'ready'/);
  assert.equal(GLYPH.close, '\uE8BB'); assert.equal(GLYPH.restore, '\uE923');
});

test('drag region on the bar, no-drag on its controls; themed hover / glow; logo hook used by the top bar', () => {
  const c = rd('app.css');
  assert.match(c, /html\.wtb \.topbar\.wtitlebar \{[^}]*app-region: drag;[^}]*-webkit-app-region: drag/);
  assert.match(c, /\.wtitlebar :is\(button[^)]*\) \{ app-region: no-drag; -webkit-app-region: no-drag; \}/);
  assert.match(c, /\.wtb-btn:hover[^}]*var\(--accent2/); assert.match(c, /\.wtb-close:hover/);
  const m = rd('js/main.js'); assert.match(m, /titlebarLogo\(\(\) => brandMark\(\)\)/); assert.match(m, /installTitlebar\(bar\)/);
  assert.match(rd('js/titlebar.js'), /export function setTitlebarLogo/);
});

test('caption buttons reserve space via --wtb-ctl-w (in-flow, never overlap ADMIN/Connected)', () => {
  const c = rd('app.css'), t = rd('js/titlebar.js'), m = rd('js/main.js');
  assert.match(c, /--wtb-ctl-w/);
  assert.match(c, /\.wtb-ctl \{[^}]*position: static/);
  assert.match(c, /width: var\(--wtb-ctl-w/);
  assert.match(t, /export const applyCtlInset/);
  assert.match(t, /setProperty\('--wtb-ctl-w'/);
  // Narrow desktop Player only (html.wtb): Connected collapses to the dot; phones keep the text.
  assert.match(c, /html\.wtb \.topbar\.wtitlebar \{[^}]*align-items: center/);
  assert.match(c, /\.wtb-ctl \{[^}]*align-self: stretch/);
  assert.match(c, /html\.wtb \.topbar\.wtitlebar \.conn #conntxt\{position:absolute/);
  assert.match(m, /wrap\.title = label/);
});

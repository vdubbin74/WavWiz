// WavWiz 0.6.9 item 18: title-bar buttons scrunched when maximized at 200 % / Extra small. Root cause: applyCtlInset measured the strip, whose CSS
// width is the very variable it set; under html zoom the measured box is width x zoom, so each resize (maximize / restore) shrank (67 %) or grew it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom } from './minidom.mjs';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
const forms = readFileSync(new URL('../../src/WavWiz.Player/Forms.cs', import.meta.url), 'utf8');
test('0.6.9 #18: the inset is computed from the button count, never from a measured (zoomed) width - stable over any number of resizes', async () => {
  installDom(); const t = await import(pathToFileURL(join(js, 'titlebar.js')).href);
  const props = new Map(), root = { style: { setProperty: (k, v) => props.set(k, v), getPropertyValue: k => props.get(k) || '' } };
  let zoomedWidth = 92.45;   // what a 67 % page reports for a 138 px strip
  const ctl = { children: { length: 3 }, getBoundingClientRect: () => ({ width: zoomedWidth }), offsetWidth: 92 };
  for (let i = 0; i < 6; i++) { assert.equal(t.applyCtlInset(ctl, root), 138); zoomedWidth *= 0.67; }
  assert.equal(props.get('--wtb-ctl-w'), 'calc(138px / var(--z,1))');
  assert.equal(t.ctlInsetPx(2), 92); assert.equal(t.ctlInsetCss(3), 'calc(138px / var(--z,1))');
});
test('0.6.9 #18: buttons keep 46 on-screen px at every Display size', () => {
  const b = css.slice(css.indexOf('---- 0.6.9 #18'));
  assert.match(b, /html\.wtb \.wtb-btn\{flex:0 0 calc\(46px \/ var\(--z,1\)\);width:calc\(46px \/ var\(--z,1\)\);min-width:calc\(46px \/ var\(--z,1\)\)\}/);
  assert.match(b, /html\.wtb \.wtb-g\{font-size:calc\(10px \/ var\(--z,1\)\)\}/);
});
test('0.6.9 #18: the host uses the frame size at the window\'s own DPI for the maximized client top', () => {
  assert.match(forms, /TitleBar\.ClientTop\(before\.Top, workTop, MetricForWindow\(SM_CYFRAME\), MetricForWindow\(SM_CXPADDEDBORDER\)\)/);
  assert.match(forms, /static extern int GetSystemMetricsForDpi\(int index, uint dpi\);/);
  assert.match(forms, /static extern uint GetDpiForWindow\(IntPtr hWnd\);/);
  assert.match(forms, /catch \(EntryPointNotFoundException\) \{ \}\s*return GetSystemMetrics\(index\);/);
});

// WavWiz 0.6.9 item 6: native folder picker through the WebView2 host bridge (Windows app on the server PC only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const { canPickNative, pickFolder } = await import(pathToFileURL(join(js, 'folderpick.js')).href);

function fakeHost(answer) {
  const ls = new Set(); const sent = [];
  return { sent, w: { chrome: { webview: { addEventListener: (_, f) => ls.add(f), removeEventListener: (_, f) => ls.delete(f),
    postMessage: m => { sent.push(m); queueMicrotask(() => { for (const f of [...ls]) f({ data: { cmd: 'folderPicked', id: 'other', path: 'X:\\wrong' } }); for (const f of [...ls]) f({ data: { cmd: 'folderPicked', id: m.id, path: answer } }); }); } } } }, ls };
}

test('0.6.9 #6: offered only in the Windows app on the server PC; browsers / other PCs keep the text field', () => {
  const host = fakeHost('D:\\Music').w;
  assert.equal(canPickNative({ thisMachine: true }, host), true);
  assert.equal(canPickNative({ thisMachine: false }, host), false);
  assert.equal(canPickNative({ thisMachine: true }, {}), false);
});

test('0.6.9 #6: posts pickFolder and resolves with the matching answer (cancel = null)', async () => {
  const a = fakeHost('D:\\Music'); assert.equal(await pickFolder({ initial: 'D:\\' }, a.w), 'D:\\Music');
  assert.equal(a.sent[0].cmd, 'pickFolder'); assert.equal(a.sent[0].initial, 'D:\\'); assert.equal(a.ls.size, 0);
  assert.equal(await pickFolder({}, fakeHost(null).w), null);
  assert.equal(await pickFolder({}, {}), null);
});

test('0.6.9 #6: Settings > Music folders has Browse… beside the path field only when canPickNative', () => {
  const s = readFileSync(join(js, 'settings.js'), 'utf8');
  assert.match(s, /canPickNative\(S\.auth\) \? h\('button', \{ class: 'btn', type: 'button', id: 'lib-browse'/);
  assert.match(s, /pathIn\.value = p/);
});

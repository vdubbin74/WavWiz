// WavWiz 0.2.1 (F1-F20): the user's 0.2.0 test feedback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');
const css = readFileSync(join(js, '../app.css'), 'utf8');
globalThis.Element ??= class {};
const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('0.2.1 F5: the Library filter box is never re-created or re-parented while typing; filtering is debounced', () => {
  const l = src('library.js');
  assert.doesNotMatch(l, /head\.replaceChildren\(h\('div', \{ class: 'row libhead' \}/, 'the header row (holding the filter box) is no longer rebuilt per draw');
  assert.match(l, /tabsSlot\.replaceChildren\(tabs\(\)\)/);
  assert.match(l, /const placeSearch = parent => \{\s*if \(searchField\.parentElement === parent\) return;/);
  assert.match(l, /search\.focus\(\{ preventScroll: true \}\); try \{ search\.setSelectionRange\(a, b\)/);
  assert.match(l, /search\._t = setTimeout\([^]*?, 250\)/);
  assert.match(css, /\.libtabslot\{display:contents\}/);
});

test('0.2.1 F16: a silent install returns 9 (not 0) when the final setup step fails or hangs; documented', () => {
  const iss = readFileSync(new URL('../../installer/WavWiz.iss', import.meta.url), 'utf8');
  assert.match(iss, /function GetCustomSetupExitCode: Integer;\s*begin\s*if SetupFailed then Result := 9 else Result := 0;/);
  assert.match(iss, /or \(Code <> 0\) then\s*begin\s*SetupFailed := True;/);    // both "hung / never reported" and a non-zero script exit set it
  const doc = readFileSync(new URL('../../docs/INSTALLER.md', import.meta.url), 'utf8');
  assert.match(doc, /`9` the files were copied but the final setup step/); assert.doesNotMatch(doc, /the installer still returns `0`/);
});

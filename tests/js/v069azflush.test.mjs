// WavWiz 0.6.9 #1 follow-up (t1835u): in the side-panel Library (narrow PC window, Local + Remote share the rule) the A–Z rail is flush on the right edge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const css = readFileSync(join(js, '..', 'app.css'), 'utf8');

test('side-panel scroller takes back the panel body right padding and the rail has no right margin', () => {
  assert.match(css, /\.libpanel \.libbody,\.devpanel \.devbody\{flex:1;min-height:0;overflow:auto;padding:4px 10px 10px\}/, 'the 10px the scroller cancels');
  assert.match(css, /\n\.libpanel \.libbody>\.lib:not\(\.expanded\)>\.libscroll\{margin-right:-10px\}/);
  assert.match(css, /\n\.libpanel \.lib:not\(\.expanded\)>\.libscroll>\.azstrip\{margin-right:0\}/);
});

test('the flush rule is side-panel only: no phone media query, no expanded Library, the base rail margin is unchanged elsewhere', () => {
  const i = css.indexOf('.libpanel .libbody>.lib:not(.expanded)>.libscroll{margin-right:-10px}');
  const block = css.slice(css.lastIndexOf('/* 0.6.9 #1 follow-up (t1835u)', i), i + 120);
  assert.ok(i > 0 && block.startsWith('/* 0.6.9 #1 follow-up'), 'the commented rule block');
  assert.doesNotMatch(block, /@media|pointer:coarse|max-width/, 'no phone / narrow media query: the side panel only');
  assert.equal(css.slice(i - 1, i), '\n', 'top level, not indented inside a block');
  assert.match(css, /flex:none;width:16px;box-sizing:border-box;margin:0 8px 0 2px;/);
});

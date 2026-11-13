// 0.6.8: standalone mini player keeps album art and the song block on one row.
// F86's flex:1 1 100% + width:100% on .mp-txt wrapped the text under the art and
// grew the window past the 128 CSS px design height / 840x240 site frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const www = process.env.WW_WWW || join(here, '../../src/WavWiz.Server/wwwroot');
const mini = () => readFileSync(join(www, 'mini.css'), 'utf8');

test('standalone mini CSS: art and song block share a row; zone keeps its width', () => {
  const s = mini();
  assert.match(s, /0\.6\.8: standalone mini keeps art and the song block on one row/);
  const blk = s.slice(s.indexOf('0.6.8: standalone mini keeps art and the song block on one row'));
  assert.match(blk, /:is\(body\.minibody,\.minicol\) \.mp:not\(\.slim\):not\(\.embedded\) \.mp-artbox\{flex:0 0 auto/);
  assert.match(blk, /:is\(body\.minibody,\.minicol\) \.mp:not\(\.slim\):not\(\.embedded\) \.mp-txt\{flex:1 1 0;width:auto/);
  assert.doesNotMatch(blk, /:is\(body\.minibody,\.minicol\) \.mp:not\(\.slim\):not\(\.embedded\) \.mp-txt\{[^}]*flex:1 1 100%/);
  assert.doesNotMatch(blk, /:is\(body\.minibody,\.minicol\) \.mp:not\(\.slim\):not\(\.embedded\) \.mp-txt\{[^}]*width:100%/);
  assert.match(blk, /:is\(body\.minibody,\.minicol\) \.mp:not\(\.slim\):not\(\.embedded\) \.mp-txt \.zl-line\{display:flex;flex-direction:row;flex-wrap:nowrap/);
  assert.match(blk, /:is\(body\.minibody,\.minicol\) \.mp:not\(\.slim\):not\(\.embedded\) \.mp-txt \.zl-line \.mp-a\{flex:1 1 0;min-width:0\}/);
  assert.match(blk, /:is\(body\.minibody,\.minicol\) \.mp:not\(\.slim\):not\(\.embedded\) \.mp-txt \.zl-line \.zlink\{flex:0 0 auto;width:max-content;max-width:50%\}/);
});

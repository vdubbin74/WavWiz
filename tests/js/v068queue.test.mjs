// 0.6.8-#10: desktop Queue beside the expanded Library.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
const blk = css.slice(css.indexOf('0.6.8-#10'));
test('0.6.8-#10 zone name not clipped, icons right, count on Up next, boxed pin, no grab on track info', () => {
  assert.match(blk, /\.qtitle \.qzpick\{width:auto;min-width:5\.5em;max-width:14em\}/);
  assert.match(blk, /\.pane-h\.nb2>\.plbtns\{order:50;flex:1 1 auto;justify-content:flex-end\}/);
  assert.match(blk, /\.pane-h\.nb2>\.plmeta\{position:absolute;right:10px;bottom:0/);
  assert.match(blk, /\.pane-h\.nb2>\.plus\.tpin\{order:51;[^}]*border:1px solid var\(--accent\)/);
  assert.match(blk, /\.mp\.embedded \.mp-txt\{cursor:auto\}/);
  assert.match(blk, /\.pane-h\.nb2>\.plnext:not\(\[hidden\]\)\{padding-right:calc\(10px \+ 9\.5em\);min-width:0;overflow:hidden\}/);
  assert.match(blk, /\.plnext\.none \.pln-t1\{flex:none;overflow:visible;text-overflow:clip/);
});

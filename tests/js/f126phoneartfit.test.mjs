import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
const i = css.indexOf('0.5.0 F126'); assert.ok(i > 0, 'F126 block present');
const j = css.indexOf('0.5.0 F130', i); const blk = css.slice(i, j > 0 ? css.lastIndexOf('/*', j) : undefined);   // F130 appends its own (desktop) block after F126
assert.ok(i > css.lastIndexOf('100dvh - 490px'), 'F126 overrides every 490px budget');
assert.ok(!/100dvh - 490px/.test(blk), 'F126 does not use 490px budget');
assert.match(blk, /--np-art:min\(88vw,40dvh,calc\(100dvh - 560px - env\(safe-area-inset-bottom/);
assert.match(blk, /grid-template-rows:40px minmax\(0,1fr\)/);
assert.match(blk, /\.np-ctlpanel \.pn-art\{[^}]*height:auto!important;[^}]*max-height:100%!important/);
assert.match(blk, /pn-art-cassette \.pn-art\{[^}]*max-height:100%!important/);
assert.match(blk, /\.np-ctlpanel\{flex:1 1 auto!important;min-height:0/);
assert.match(blk, /np-upnext\{flex:none!important\}/);
assert.ok(!/overflow(-y)?:\s*(auto|scroll)/.test(blk), 'no NP scroll');
assert.ok(blk.trimEnd().endsWith('}') && !/@media \(min-width/.test(blk), 'phone only');
console.log('f126 ok');

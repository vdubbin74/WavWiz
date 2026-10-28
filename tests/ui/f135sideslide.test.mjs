import fs from 'node:fs'; import assert from 'node:assert';
const css = fs.readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
const mini = fs.readFileSync(new URL('../../src/WavWiz.Server/wwwroot/mini.css', import.meta.url), 'utf8');
// F135: never a hang-below drop-down / flyout for the collapsed strip
for (const m of css.matchAll(/\.np-ctlpanel\.np-flat\.collapsed \.np-scside\{([^}]*)\}/g)) assert.doesNotMatch(m[1], /top:100%|bottom:auto|max-content/);
// F135b: never starts under the header, never pushes the body
for (const m of css.matchAll(/\.np-scside\{([^}]*)\}/g)) assert.doesNotMatch(m[1], /top:var\(--np-sch,/);
assert.doesNotMatch(css, /scopen[^{]*\.np-ctlbody\{[^}]*padding-right/);
// F135d: horizontal pin row overlay, slides in leftward
const f = css.slice(css.indexOf('F135d:'));
assert.match(f, /\.np-flat \.np-scside\{position:absolute;[^}]*z-index:20;[^}]*flex-direction:row;[^}]*overflow-x:auto;overflow-y:hidden;[^}]*animation:np-scslide/);
assert.match(f, /\.np-flat \.np-scside \.scrow\{flex-direction:row;[^}]*flex-wrap:nowrap/);
assert.match(f, /collapsed \.np-scside\{top:0;bottom:0;right:var\(--np-schw,82px\);[^}]*overflow-x:auto;overflow-y:hidden/);
assert.doesNotMatch(f, /flex-direction:column/);
assert.match(f, /\.sctoggle,[^{]*\.listcolwrap\{position:relative;z-index:21\}/);
assert.match(f, /@keyframes np-scslide\{from\{clip-path:inset\(0 0 0 100%\)\}/);
const mf = mini.slice(mini.indexOf('F135d'));
assert.match(mf, /\.mp \.mp-scside\{top:0;[^}]*flex-direction:row;[^}]*overflow-x:auto/);
assert.match(mf, /\.mp \.mp-scside \.scrow\{flex-direction:row/);
assert.doesNotMatch(mf, /bottom:100%|flex-direction:column/);
const js = fs.readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/shortcuts.js', import.meta.url), 'utf8');
for (const k of ["draggable: 'true'", "'dragstart'", "'dragover'", "'drop'", 'Move toward Home', 'Move away from Home', 'Unpin']) assert.ok(js.includes(k), k);
// F135e: expanded band sits on the title bar, not centered on transport
assert.match(f, /:not\(\.collapsed\) \.np-scside\{top:0;bottom:auto;right:var\(--np-schw,82px\);height:var\(--np-hdh,30px\);transform:none/);
assert.doesNotMatch(f, /translateY\(-50%\)|top:calc\(50%/);
console.log('f135sideslide (F135d/F135e horizontal overlay) ok');

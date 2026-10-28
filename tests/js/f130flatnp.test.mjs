import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const rd = f => readFileSync(new URL('../../src/WavWiz.Server/wwwroot/' + f, import.meta.url), 'utf8');
const css = rd('app.css'), now = rd('js/now.js'), sc = rd('js/shortcuts.js');
// Shortcuts: one header toggle -> vertical side strip reusing shortcutsRow (same pins / Home / order)
assert.match(sc, /export function shortcutsSide\(/);
assert.match(sc, /shortcutsRow\(\{ run, home, cls: 'scside-row', vertical: true \}\)/);
assert.match(sc, /if \(vertical\) return 99;/, 'vertical strip never folds pins into More');
assert.match(sc, /class: 'scbtn sctoggle'[^\n]*onclick: \(\) => setOpen\(!open\)/);
assert.match(sc, /strip\.hidden = !open/);
assert.match(sc, /SCSIDE_KEY = 'wavwiz\.scside\.v1'/);
assert.match(now, /shortcutsSide\(\{ run: id => ctl\.runShortcut\?\.\(id\), home: \(\) => ctl\.goHome\?\.\(\)/);
assert.match(now, /h\('span', \{ class: 'grow' \}\), scSide\.toggle, h\('span', \{ class: 'row listcolwrap' \}, ctlColBtn\)\), ctlBody, scSide\.strip\)/);
assert.ok(!/mkSc\('np-sc'\)/.test(now), 'no horizontal pin row in the NP header');
assert.match(now, /mkSc\('npb-sc'\)/, 'bar row unchanged');
assert.ok(now.indexOf('let ctlPanel = null') < now.indexOf('shortcutsSide({'), 'no TDZ on onChange');
// titles: song + labeled Artist / Album; album omitted when missing
assert.match(now, /h\('span', \{ class: 'np-aal' \}, 'Artist'\)/);
assert.match(now, /h\('span', \{ class: 'np-aal' \}, 'Album'\)/);
assert.match(now, /aaAlbumWrap\.hidden = !ovAl\.textContent/);
// zone under the controls (same F119 picker), not in the titles
assert.match(now, /mkSleep\(\)\),[^\n]*\n\s*zoneLink\('zl-ov'\)/);
assert.ok(!/np-tabletitles' \}, [^\n]*zoneLink\('zl-ov'\)/.test(now));
// CSS: F130 block is token-only and desktop-gated; phone hides the new bits
const blk = css.slice(css.indexOf('0.5.0 F130'));
assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(blk), 'no hard-coded hex in F130 CSS');
assert.ok(!/rgba?\(/.test(blk), 'no literal rgb colors in F130 CSS');
assert.match(blk, /@media \(min-width:761px\)\{/);
assert.match(blk, /@media \(max-width:760px\)\{ \.np-ctlpanel \.np-aaline,\.np-ctlpanel \.np-scside,\.np-ctlpanel \.sctoggle\{display:none!important\} \}/);
for (const v of ['--accent', '--line', '--panel2', '--ink', '--dim', '--radius']) assert.ok(blk.includes('var(' + v), v);
// phone grid still places the zone pill
assert.match(css, /\.nowcol \.np-ctlpanel \.zl-ov\{grid-area:zone/);
console.log('f130 ok');
// Amendments 1+2: narrow widths, art styles, collapsed strip, condensed player
assert.match(blk, /@container npctl \(max-width:560px\)\{ \.np-ctlpanel\.np-flat/);
assert.match(blk, /np-flat\.pn-art-cassette \.pn-art/);
assert.match(blk, /np-flat\.collapsed \.np-scside/);
assert.ok(!/:has\(\.scrow \.scbtn/.test(css), 'old header-pin squeeze rules retargeted');
assert.match(now, /F130: collapsed line = Artist · Album/);
const mini = rd('js/mini.js'), mcss = rd('mini.css');
assert.match(mini, /lab\('Artist', it\.artist\)/); assert.match(mini, /lab\('Album', it\.album\)/);
const mb = mcss.slice(mcss.indexOf('0.5.0 F130')); assert.ok(mb.length > 20 && !/#[0-9a-fA-F]{3,8}\b/.test(mb));
console.log('f130 amendments ok');
// Amendment 3: condensed (embedded mini) uses the same Shortcuts toggle -> vertical strip; collapsed reuses the NP header toggle + drop-down strip
assert.match(mini, /const sc = embedded \? \(\(\) => \{ const sd = shortcutsSide\(\{ run: scRun, home: scHome, cls: 'mp-scside'/);
assert.match(mini, /h\('div', \{ class: 'mp-sc mp-sctog' \}, sd\.toggle, sd\.strip\)/);
assert.match(mcss, /\.mp \.mp-scside \.scrow\{flex-direction:column/);
assert.doesNotMatch(blk, /\.np-ctlpanel\.np-flat\.collapsed \.np-scside\{top:100%/); // F135: no drop-down
console.log('f130 amendment 3 ok');

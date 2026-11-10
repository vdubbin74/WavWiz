// 0.6.8: phone Now Playing fits the viewport — art fills leftover height, no page scroll, Queue/Sound stay on screen.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
const i = css.indexOf('0.6.8 phone-fit');
assert.ok(i > 0, '0.6.8 phone-fit block present on F250-P5');
const j = css.indexOf('F250-P6', i);
const blk = css.slice(i, j > 0 ? j : undefined);
assert.ok(!/max\(180px/.test(blk), 'no 180px art floor that overflows short phones');
assert.match(blk, /--np-phone-art:min\(100%,88vw\)/);
assert.match(blk, /#app>\.desk\[data-view=now\]\{overflow:hidden!important/);
assert.match(blk, /padding:0!important/);
assert.match(blk, /#app>\.desk\[data-view=now\]>#p-now\{[^}]*padding:6px 12px 14px!important/);
assert.ok(!/calc\(8px \+ var\(--safe-b\)\)/.test(blk), 'now-view art stack does not reserve a second safe-area gap above the banner');
assert.match(blk, /grid-template-rows:auto auto minmax\(0,1fr\)/);
assert.match(blk, /\.np-phone-art\{[^}]*height:100%;[^}]*aspect-ratio:1/);
assert.match(blk, /max-height:min\(100%,var\(--np-phone-art\)\)/);
assert.match(blk, /aspect-ratio:1/);
assert.match(blk, /-webkit-line-clamp:2/);
assert.ok(!/overflow-y:\s*auto!important/.test(blk.split(':has(.np-phone-extras[open])')[0]), 'default now view does not force scroll');
assert.match(blk, /:has\(\.np-phone-extras\[open\]\)\{overflow-y:auto!important/);
assert.match(blk, /max-height:700px/);

// Header: exactly safe-area + compact padding (no second band); hamburger CSS bars; connected dot stays visible.
const topbar = css.match(/\.topbar\{[^}]+\}/);
assert.ok(topbar, 'base .topbar rule');
assert.match(topbar[0], /padding-top:calc\(8px \+ var\(--safe-t\)\)/);
assert.equal([...css.matchAll(/\.topbar\{[^}]*padding-top:calc\(8px \+ var\(--safe-t\)\)/g)].length, 1, 'topbar safe-t padding is declared once, not doubled');
assert.match(css, /\.hamburger \.hb-bars\{/);
assert.match(css, /\.iconbtn\.hamburger\{[^}]*align-items:center;[^}]*justify-content:center/);
assert.match(css, /@media \(max-width:900px\)\{ \.hamburger\{display:inline-flex;align-items:center;justify-content:center\}/);
assert.match(css, /\.topbar \.conn \.dot,#conn\.dot\{[^}]*visibility:visible/);
assert.match(css, /\.topbar \.conn \.dot\.ok,#conn\.dot\.ok\{background:var\(--green\)\}/);
assert.ok(!/\.topbar[^{]*\{[^}]*\.dot[^}]*display:\s*none/.test(css), 'no rule hides the header connection dot');
// Narrow Windows title bar collapses only the label, never the dot.
assert.match(css, /html\.wtb \.topbar\.wtitlebar \.conn #conntxt\{position:absolute/);
assert.ok(!/html\.wtb[^{]*\{[^}]*#conn\.dot[^}]*display:\s*none/.test(css), 'narrow wtb does not hide the dot');

const main = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/main.js', import.meta.url), 'utf8');
assert.match(main, /class: 'iconbtn hamburger'[\s\S]*class: 'hb-bars'/);
assert.match(main, /class: 'dot', id: 'conn'/);
console.log('v068phonefit ok');

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const rd = f => readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/' + f, import.meta.url), 'utf8');
const art = rd('art.js'), now = rd('now.js');
const fn = art.slice(art.indexOf('export function npCover'), art.indexOf('/** 0.2.2 T4d'));
// radio / receivers return before any artist lookup
assert.ok(fn.indexOf("it.kind === 'radio' || isReceiver(it)) return cover(") < fn.indexOf('artistArt('), 'radio/receiver bail out before artistArt');
// chain: track -> artist photo -> generated album cover; no bare glyph for tracks
assert.match(fn, /img\(src, 'cimg', \(\) => name \? photo\(\) : showGen\(\)/);
assert.match(fn, /else if \(name\) photo\(\); else showGen\(\)/);
assert.match(fn, /genNode\('album'/);
assert.ok(!/'♪'\)/.test(fn.split('return cover(')[1]?.split('\n').slice(1).join('\n') || ''), 'no bare glyph after radio branch');
assert.match(fn, /dataset\.artist = name/);
assert.match(fn, /onReal\?\.\(src\)/);
// now.js: every NP / Up next surface uses npCover, keys include artist
assert.ok(!/\bcover\((src|srcMd|srcSm)\b/.test(now), 'no bare cover(src) left in now.js');
for (const s of ['coverHolder.replaceChildren(npCover', 'art.replaceChildren(npCover', 'miniArtB.setCover(npCover', 'pnCover.replaceChildren(npCover', 'pnRefl.replaceChildren(npCover', 'sArtB.setCover(npCover', 'barArtB.setCover(npCover', 'nxArt.replaceChildren(nxt ? npCover']) assert.ok(now.includes(s), s);
assert.match(now, /setProperty\('--np-bloom', 'none'\)/);
// npKey changes with artist for same missing src
const npArtistName = it => String(it?.albumArtist || it?.artist || '').trim();
const npKey = eval(art.match(/export const npKey = ([^\n]+);/)[1]);
assert.notEqual(npKey({ artist: 'Saliva', album: 'A' }, null), npKey({ artist: 'Tool', album: 'A' }, null));
console.log('ok f123');

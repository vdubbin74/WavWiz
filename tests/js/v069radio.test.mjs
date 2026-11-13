// 0.6.9 #20 (t1850/t1851): Radio station text took too much space ("IBIZA CHILLOUT LOUNGE - Ambient, Deep House, …" wrapped over 20 lines,
// tag strings and URLs wrapped too). Station names clamp to 2 lines, subtitles to 1, in tiles and list rows (My stations + the finder); the
// full name / tags / address are in the tooltip. Overrides the 0.6.9 #2 "no …" rule for Radio only - albums and artists keep full titles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const js = process.env.JS_DIR || join(here, '../../src/WavWiz.Server/wwwroot/js');
const src = f => readFileSync(join(js, f), 'utf8');
const css = () => readFileSync(join(js, '../app.css'), 'utf8');
const IBIZA = 'IBIZA CHILLOUT LOUNGE - Ambient, Deep House, Balearic, Smooth Jazz, Acoustic, Chill House, Lo-Fi, Chillwave, Dream Pop, Electro, Tropical House, Sunset Chill, Café del Mar';

test('#20 stationTip: the tooltip carries the full name, the tags and the address', () => {
  const s = src('radiostation.js');
  const stationTip = new Function('return ' + s.match(/export const stationTip = (r => \{[^]*?\n\};)/)[1].replace(/;$/, ''))();
  assert.equal(stationTip({ name: IBIZA, genre: 'ambient,balearic,deep house', url: 'http://x.example/ibiza' }), `${IBIZA}\nambient,balearic,deep house\nx.example/ibiza`);
  assert.equal(stationTip({ name: 'Absolute Chillout', url: 'https://streaming.live365.com/b05055_128mp3' }), 'Absolute Chillout\nstreaming.live365.com/b05055_128mp3');
  assert.equal(stationTip({ genre: 'jazz', tags: 'jazz' }), 'Station\njazz', 'the same tags are not repeated');
});
test('#20 every station tile / row (My stations + finder) uses the clamped name + one-line subtitle and the tooltip', () => {
  const s = src('radiostation.js');
  for (const f of ['savedStationTile', 'savedStationRow', 'finderStationTile', 'finderStationRow']) {
    const body = s.slice(s.indexOf(`export function ${f}(`)); const fn = body.slice(0, body.indexOf('\n}\n'));
    assert.match(fn, /title: stationTip\(r\)/, f + ' tooltip'); assert.match(fn, /rad-t1'/, f + ' name class'); assert.match(fn, /rad-t2'/, f + ' subtitle class');
  }
  assert.doesNotMatch(s, /card row wrap radfind-row/, 'finder rows no longer wrap the play button onto a new line');
});
test('#20 CSS: name 2 lines, subtitle 1 line with …, even tile rows, one compact list-row height (playing too); Radio only', () => {
  const c = css(), at = c.indexOf('0.6.9 #20'); assert.ok(at > c.indexOf('0.6.9 Library (#1'), 'comes after the 0.6.9 #2 no-truncation rule so it wins');
  const r = c.slice(at);
  assert.match(r, /\.radiotab2 \.tile \.t1\.ell\.rad-t1[^{]*\{\s*display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;[^}]*overflow:hidden;[^}]*text-overflow:ellipsis/);
  assert.match(r, /\.radiotab2 \.tile \.t2\.ell\.rad-t2[^{]*\{\s*display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
  assert.match(r, /\.radiotab2 \.tile \.t1\.ell\.rad-t1\{min-height:2\.5em\}/, 'every tile reserves 2 name lines, so rows line up');
  assert.match(r, /\.radiotab2 \.list \.item\.radrow,\.radiotab2 \.radfind-row\{height:62px;min-height:62px;box-sizing:border-box/);
  assert.doesNotMatch(r, /\.radrow\.playing\{[^}]*(height|padding)/, 'the playing highlight never changes the row size');
  // albums / artists keep the #2 wrap rule (no clamp on their names)
  assert.match(c, /\.lib \.tile \.t1\.ell,\.lib \.tile \.t2\.ell,\.lib \.list \.item \.t \.t1\.ell/);
  for (const sel of r.match(/^[^{\n]+\{/gm) || []) if (/line-clamp|nowrap|height:62px/.test(r.slice(r.indexOf(sel), r.indexOf('}', r.indexOf(sel))))) assert.match(sel, /radiotab2/, 'scoped to Radio: ' + sel);
});

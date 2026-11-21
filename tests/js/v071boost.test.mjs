// WavWiz 0.7.1 t2075u: Settings > Network > AirPlay & Spotify Connect. "AirPlay level" / "Spotify Connect level" read like an AirPlay-OUT volume;
// they are a boost for music a phone sends IN. New labels + one hint that says so; it wraps (never "..."), and "level" still finds it in search.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const set = readFileSync(join(js, 'settings.js'), 'utf8');
const css = readFileSync(join(js, '..', 'app.css'), 'utf8');
const HINT = "Makes music sent from a phone up to 6 dB louder, on top of the phone\\'s volume. Applies to every WavWiz AirPlay / Spotify name a phone can pick. Not used when WavWiz plays to AirPlay speakers.";

test('t2075: the rows are "AirPlay boost" / "Spotify Connect boost" with the hint that says what they do', () => {
  assert.match(set, /levelRow\('airplay\.levelDb', 'AirPlay boost', apLv\)/);
  assert.match(set, /levelRow\('spotify\.levelDb', 'Spotify Connect boost', spLv\)/);
  assert.doesNotMatch(set, /'AirPlay level'|'Spotify Connect level'/);
  assert.ok(set.includes(`export const BOOST_HINT = '${HINT}';`), 'hint wording');
  assert.match(set, /h\('p', \{ class: 'small dim boost-hint' \}, BOOST_HINT\),\n\s+liveLimiterRow\(settings, admin, putSettings\)\)\);/);   // 0.7.2: the live limiter switch follows the hint
  assert.doesNotMatch(set, /\(after phone volume\)/);
});

test('t2075: settings search still finds it by "level" and the text wraps instead of "..."', () => {
  assert.match(set, /h\('span', \{ class: 'dim small boost-range' \}, 'Extra level, 0 to \+6\\u00a0dB'\)/);
  assert.match(css, /#sec-airplay \.boost-hint,#sec-airplay \.boost-range\{white-space:normal!important;overflow:visible!important;text-overflow:clip!important\}/);
});

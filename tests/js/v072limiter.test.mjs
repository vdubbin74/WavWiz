// WavWiz 0.7.2 A: one switch for the shared live limiter (live.limiter, default on) under Settings > Network > AirPlay & Spotify Connect.
// It sits after the boost rows (the limiter runs after the boost) and its hint wraps instead of "...".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const set = readFileSync(join(js, 'settings.js'), 'utf8');
const css = readFileSync(join(js, '..', 'app.css'), 'utf8');

test('0.7.2: the AirPlay & Spotify card ends with the shared limiter switch, after the boost hint', () => {
  const card = set.slice(set.indexOf("id: 'sec-airplay' }"), set.indexOf('panes.network.push(airplayOutCard(admin));'));
  assert.ok(card.indexOf('BOOST_HINT') < card.indexOf('liveLimiterRow(settings, admin, putSettings)'), 'limiter after the boost');
  assert.match(set, /export const LIMITER_LABEL = 'Limiter on AirPlay, Spotify and inputs';/);
});

test('0.7.2: default on (anything but an explicit false), admin-only, writes live.limiter', () => {
  assert.match(set, /const on = settings\['live\.limiter'\] !== false;/);
  assert.match(set, /disabled: !admin, 'aria-label': LIMITER_LABEL, 'data-setting': 'live\.limiter'/);
  assert.match(set, /await put\(\{ 'live\.limiter': ev\.target\.checked \}\)/);
});

test('0.7.2: the limiter hint wraps (never "...")', () => {
  assert.match(css, /\.live-limiter \.live-limiter-hint\{white-space:normal!important;overflow:visible!important;text-overflow:clip!important/);
});

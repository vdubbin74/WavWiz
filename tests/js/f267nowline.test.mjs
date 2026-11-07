// F267: idle now-line keeps the playing layout (track + placeholder time).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR, src = f => readFileSync(join(js, f), 'utf8');
test('F267 nowLine always renders the track; idle shows --:-- / --:--; head line is full width', () => {
  const z = src('zones40.js'), css = src('../app.css');
  assert.match(z, /h\('span', \{ class: 'zl-bar', style: `--p:\$\{\(frac \* 100\)\.toFixed\(1\)\}%` \}, h\('i'\)\),\n/);
  assert.match(z, /!has \? h\('span', \{ class: 'zl-time small dim zl-ph', 'aria-hidden': 'true' \}, '--:-- \/ --:--'\)/);
  assert.match(css, /\.qb42-head>\.zl-now,\.qb42\.idle \.qb42-head>\.zl-now\{align-self:stretch;width:auto;flex:none;justify-content:flex-start\}/);
});

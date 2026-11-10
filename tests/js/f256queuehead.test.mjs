// 0.6.8: compact Queue head — desktop-matching icon row + Up next (replaces F256 2×2 text grid).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const www = process.env.WW_WWW || join(dirname(fileURLToPath(import.meta.url)), '../../src/WavWiz.Server/wwwroot');
const css = () => readFileSync(join(www, 'app.css'), 'utf8');
const main = () => readFileSync(join(www, 'js/main.js'), 'utf8');

test('drawQueue builds icon tools beside the track count (no 2×2 text actions)', () => {
  const s = main();
  assert.match(s, /class: 'row plbtns pq-tools'/);
  assert.match(s, /class: 'plnext pq-upnext'/);
  assert.match(s, /track\$\{nTracks === 1 \? '' : 's'\}/); // 1 track / N tracks
  assert.match(s, /icon\('history'\)/);
  assert.match(s, /icon\('save'\)/);
  assert.match(s, /icon\('trash'\)/);
  assert.match(s, /plus pllock/);
  assert.match(s, /queueNextIndex\(S\.now, S\.queue\)/);
  assert.doesNotMatch(s, /class: 'qactions'/);
  assert.doesNotMatch(s, /class: 'qkeep-line'/);
  assert.doesNotMatch(s, /Save as playlist'/);
  assert.doesNotMatch(s, /`\$\{S\.queue\.length\} tracks/);
});

test('compact Queue CSS: icon row + Up next; handset keeps 44px', () => {
  const s = css();
  assert.match(s, /\.phone-queue \.pq-tools/);
  assert.match(s, /\.phone-queue \.pq-upnext\{display:flex/);
  assert.match(s, /\.phone-queue\.pq-handset \.pq-tools \.plus\{width:44px;height:44px/);
  assert.match(s, /\.phone-queue \.pq-tools \.plus\{width:22px;height:22px/);
  assert.doesNotMatch(s, /\.phone-queue \.qactions\{display:grid;grid-template-columns:1fr 1fr/);
});

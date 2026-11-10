// F254: app-wide dismiss/close × — square 3px, ink (not red), theme --accent focus ring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const www = process.env.WW_WWW || join(here, '../../src/WavWiz.Server/wwwroot');
const css = () => readFileSync(join(www, 'app.css'), 'utf8');
const js = rel => readFileSync(join(www, 'js', rel), 'utf8');

test('F254 Sound sheet close is square 3px (not 50%)', () => {
  const s = css();
  assert.match(s, /dialog\.npeqsheet \.eqsheet-x\{min-width:44px;min-height:44px;border-radius:3px/);
  assert.doesNotMatch(s, /dialog\.npeqsheet \.eqsheet-x\{[^}]*border-radius:50%/);
});

test('F254 shared .ww-close + aliases use 3px, ink, accent focus ring', () => {
  const s = css();
  assert.match(s, /\/\* F254: shared dismiss\/close/);
  assert.match(s, /\.ww-close[\s\S]*?border-radius:3px/);
  assert.match(s, /\.ww-close[\s\S]*?color:var\(--ink\)/);
  assert.match(s, /\.ww-close:focus-visible[\s\S]*?outline:2px solid var\(--accent\)/);
  // global focus already theme-accent
  assert.match(s, /:focus-visible\{outline:2px solid var\(--accent\) !important/);
});

test('F254 INCLUDE sites mark ww-close; EXCLUDE delete ✕ do not', () => {
  assert.match(js('util.js'), /class: 'iconbtn ww-close'/);
  assert.match(js('phonesound.js'), /eqsheet-x ww-close/);
  assert.match(js('songsheet.js'), /songsheet-close ww-close/);
  assert.match(js('about.js'), /iconbtn ww-close/);
  assert.match(js('backupflow.js'), /btn sm ww-close/);
  assert.match(js('jukebox-kiosk.js'), /btn sm ghost ww-close/);
  assert.match(js('devices.js'), /btn sm ghost ww-close/);
  assert.match(js('mini.js'), /mp-b mp-x ww-close/);
  assert.match(js('now.js'), /class: 'x ww-close'/);
  // destructive exclusions — no ww-close on these lines
  assert.doesNotMatch(js('playlists.js'), /Remove from playlist[\s\S]{0,80}ww-close/);
  // RADIO-2: My stations remove moved to context menu (danger item); podcast remove ✕ stays ww-close; no red danger ✕ buttons
  assert.doesNotMatch(js('radiotab.js'), /ww-close/);
  assert.doesNotMatch(js('radiotab.js'), /class: '[^']*danger/);
  assert.doesNotMatch(js('radiofinder.js'), /btn danger/);
  assert.match(js('radiofinder.js'), /btn ww-close.*Remove podcast|class: 'btn ww-close', 'aria-label': 'Remove podcast/);
  assert.doesNotMatch(js('smartpl.js'), /btn danger[\s\S]{0,40}ww-close/);
  assert.doesNotMatch(js('devices.js'), /zbtn danger[\s\S]{0,40}ww-close/);
  assert.doesNotMatch(js('listtable.js'), /class: 'rm'[\s\S]{0,40}ww-close/);
});

test('F254 Sound still autofocuses close (ring on open kept)', () => {
  assert.match(js('phonesound.js'), /x\.focus\(\{ preventScroll: true \}\)/);
});

test('F254 mini.css standalone .mp-x: ink (not dim/red), accent focus; 44px only when not the Player window', () => {
  const mini = readFileSync(join(www, 'mini.css'), 'utf8');
  assert.match(mini, /\.mp \.mp-x\{color:var\(--ink\)/);
  assert.match(mini, /\.mp:not\(\.embedded\) \.mp-side \.mp-x:hover\{color:var\(--ink\)/);
  assert.doesNotMatch(mini, /mp-x:hover\{color:var\(--red/);
  assert.match(mini, /F254 amend R1/);
  assert.match(mini, /\.mp:not\(\.embedded\) \.mp-side \.mp-x[\s\S]*?outline:2px solid var\(--accent\)/);
  // 44px close is for in-page / embedded phone chrome, never body.minibody (the 420px Player window)
  assert.doesNotMatch(mini, /@media \(max-width:900px\),\(pointer:coarse\)\{[\s\S]*?\.mp:not\(\.embedded\) \.mp-side \.mp-x[\s\S]*?min-width:44px/);
  assert.match(mini, /@media \(max-width:900px\),\(pointer:coarse\)\{[\s\S]*?body:not\(\.minibody\) \.mp \.mp-x[\s\S]*?min-width:44px/);
});

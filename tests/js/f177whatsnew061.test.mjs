// F177: About / What's new for 0.6.1 (0.6.1 bullets, then 0.6.0, older kept; credits rows present).
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const s = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/about.js', import.meta.url), 'utf8');
assert.match(s, /export const WHATS_NEW_VERSION = '0\.6\.1';/);
const body = s.slice(s.indexOf('export const WHATS_NEW = ['));
const vers = [...body.matchAll(/\/\/ (\d+\.\d+\.\d+) \(only what shipped\)/g)].map(m => m[1]);
assert.deepEqual(vers.slice(0, 3), ['0.6.1', '0.6.0', '0.5.0']);
for (const c of ['Subsonic / OpenSubsonic API', 'Home Assistant', 'Debian FFmpeg']) assert.ok(s.includes("['" + c), 'credit ' + c);
assert.match(s, /verCmp\(seen, WHATS_NEW_VERSION\) >= 0/, 'maybeWhatsNew keying unchanged');
console.log('f177whatsnew061 ok');

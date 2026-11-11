// F177: About / What's new for 0.6.1 (0.6.1 bullets, then 0.6.0, older kept; credits rows present).
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { whatsNewVersion, vge } from './_ver.mjs';
const s = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/about.js', import.meta.url), 'utf8');
assert.ok(vge(whatsNewVersion(s), '0.6.1'), 'WHATS_NEW_VERSION is 0.6.1 or later');   // 0.7.0 item 5c: later releases move it on
const body = s.slice(s.indexOf('export const WHATS_NEW = ['));
const vers = [...body.matchAll(/\/\/ (\d+\.\d+\.\d+) \(only what shipped\)/g)].map(m => m[1]);
const at = vers.indexOf('0.6.1'); assert.ok(at >= 0); assert.deepEqual(vers.slice(at, at + 3), ['0.6.1', '0.6.0', '0.5.0']);   // 0.7.0 item 5c: newer sections may come first; 0.6.1 then 0.6.0 then 0.5.0 stay in order
for (const c of ['Subsonic / OpenSubsonic API', 'Home Assistant', 'Debian FFmpeg']) assert.ok(s.includes("['" + c), 'credit ' + c);
assert.match(s, /verCmp\(seen, WHATS_NEW_VERSION\) >= 0/, 'maybeWhatsNew keying unchanged');
console.log('f177whatsnew061 ok');

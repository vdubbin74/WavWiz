import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const src = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/about.js', import.meta.url), 'utf8');
assert.ok(src.includes("['Phone remote + Now Playing', 'Use as remote keeps the phone silent"), 'new title');
assert.ok(!src.includes('wow Now Playing'), 'no wow slang');
console.log('f129whatsnewcopy ok');

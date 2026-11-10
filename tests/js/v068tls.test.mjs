// 0.6.8-#11g: the phone set-up page no longer says "All set" just because it is https; Home Screen app is sent to Safari with a copyable link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/tls-setup.js', import.meta.url), 'utf8');
test('https alone is not proof: probe another certificate address, else keep the steps with a note', () => {
  assert.doesNotMatch(src, /good\('You opened this page over HTTPS/);
  const https = src.slice(src.indexOf("if (location.protocol === 'https:') {"), src.indexOf('maybe(); return;'));
  assert.match(https, /for \(const a of alts\)/);
  assert.match(src, /function maybe\(\)[\s\S]*Already installed\? You\\'re set/);
  assert.doesNotMatch(src.slice(src.indexOf('function maybe()'), src.indexOf('function good(')), /classList\.add\('done'\)/);
});
test('Home Screen app: open in Safari card with a copy button', () => {
  assert.match(src, /if \(standalone && enabled\) openInSafariCard\(\)/);
  assert.match(src, /Open this page in Safari/);
  assert.match(src, /navigator\.clipboard\.writeText\(url\)/);
  assert.match(src, /\/tls\/setup`/);
});
test('alt hosts are filtered to IP literals', () => {
  const m = src.match(/const alts = [^\n]+/)[0];
  const f = new Function('X', 'return ' + m.replace('const alts = ', '').replace('B.dataset.alt', 'X').replace(/;\s*\/\/.*$/, '').replace(/;$/, ''));
  assert.deepEqual(f('192.168.1.2,evil.example,[fd7a::1], ,10.0.0.1'), ['192.168.1.2', '[fd7a::1]', '10.0.0.1']);
});

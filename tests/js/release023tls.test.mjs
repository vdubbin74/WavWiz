// WavWiz 0.2.3 fix: the phone set-up page (/tls/check) must show the install steps even if its script cannot run, and in check mode a phone that does not
// trust WavWiz yet gets its download button and the steps highlighted instead of hidden sections.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = process.env.JS_DIR;
const t = readFileSync(`${js}/tls-setup.js`, 'utf8'), css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/tls.css', import.meta.url), 'utf8');

test('0.2.3 fix: the iPhone / Android steps are visible without the script; the script only hides the OTHER phone\'s steps', () => {
  assert.match(css, /\.dev\{display:block\} \.dev\.hide\{display:none\}/);
  assert.doesNotMatch(css, /\.dev\{display:none\}/);
  assert.match(t, /\.dev-ios'\)\.forEach\(e => e\.classList\.toggle\('hide', android\)\)/);
  assert.match(t, /\.dev-android'\)\.forEach\(e => e\.classList\.toggle\('hide', ios\)\)/);
  assert.doesNotMatch(t, /classList\.toggle\('show', ios/);
});

test('0.2.3 fix: check mode, not trusted -> download button for this phone + highlighted install steps', () => {
  assert.match(t, /d\.querySelector\('a\.btn\[href\^="\/tls\/root-ca"\]'\)/);
  assert.match(t, /steps\.forEach\(d => d\.classList\.add\('focus'\)\)/);
  assert.match(t, /\[dl, ul\(adv\)\]/);
  assert.match(t, /Follow the install steps below, then tap Check my phone again\./);
  assert.match(t, /\.dev\.focus'\)\.forEach\(d => d\.classList\.remove\('focus'\)\)/, 'trusted: highlight cleared');
  assert.match(css, /\.card\.focus\{/);
});

test('0.2.3 fix: the script keeps the same ?cal= rules and secure address as the server-rendered "Continue to secure calibration" link', () => {
  assert.match(t, /if \(!\/\^\[A-Za-z0-9\]\{6\}\$\/\.test\(cal\)\) return ''; return 'cal=' \+ cal \+ \(\/\^\[0-9\]\{6\}\$\/\.test\(pair\) \? '&pair=' \+ pair : ''\)/);
  assert.match(t, /const secureHome = \(\) => pairQ \? `https:\/\/\$\{host\}:\$\{https\}\/\?pair=\$\{pairQ\}` : calQ \? `https:\/\/\$\{host\}:\$\{https\}\/calmic\.html\?` \+ calQ\.replace\(\/&pair=\\d\+\/, ''\) : `https:\/\/\$\{host\}:\$\{https\}\/`/);   // 0.2.5: the mic-only page
  assert.match(t, /setTimeout\(\(\) => location\.replace\(secureHome\(\)\), 900\)/, 'trusted phone: still redirects on its own');
});

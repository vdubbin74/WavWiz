// 0.7.3 t2244u: Settings > Home network on the phone - IPs broke mid-number ("192.168.1. / 169"), adapter names split ("Wi-Fi: Wi-Fi / 2") and
// "Use 192.168.1.169" wrapped to three lines. Each address is now a stacked row on the phone look: the IP on one unbroken line, adapter + network
// type under it, a short "Use" on the right (its aria-label keeps the address).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom } from './minidom.mjs';

const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const css = readFileSync(join(js, '..', 'app.css'), 'utf8');
const blk = css.slice(css.indexOf('/* 0.7.3 t2244u:'), css.indexOf('/* end 0.7.3 t2244u */'));
const imp = f => import(pathToFileURL(join(js, f)).href);
const tick = () => new Promise(r => setTimeout(r, 0));

test('the address rows: IP / adapter / type / action cells; Use keeps the full address for screen readers and on a PC', async () => {
  const doc = installDom(); doc.defaultView = globalThis;
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => net, text: async () => JSON.stringify(net) });
  const net = { status: 'ok', problems: [], fixes: [], canRebind: true, bind: '192.168.1.169', listen: { label: 'Home network', addresses: [{ address: '192.168.1.169', kind: 'lan' }] },
    adapters: [{ address: '192.168.1.169', kind: 'Wi-Fi', name: 'Wi-Fi 2', profile: 'Private', isBind: true }, { address: '100.102.134.105', kind: 'Ethernet', name: 'Tailscale', profile: 'Unknown', isBind: false }] };
  const { networkCard } = await imp('diag.js');
  const c = networkCard({ auth: { role: 'admin' } }, { title: 'Home network' }); doc.body.append(c);
  for (let i = 0; i < 5 && !c.querySelector('.nettbl'); i++) await tick();
  const rows = c.querySelectorAll('.nettbl tr');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].children.map(td => td.className), ['mono net-ip', 'net-ad', 'net-pf', 'net-act']);
  const b = rows[1].querySelector('button');
  assert.equal(b.getAttribute('aria-label'), 'Use 100.102.134.105'); assert.equal(b.getAttribute('data-use'), '100.102.134.105');
  assert.equal(b.textContent, 'Use 100.102.134.105'); assert.equal(b.querySelector('.use-ip').textContent, ' 100.102.134.105');
  assert.equal(rows[0].querySelector('.net-act b').textContent, 'in use');
  assert.ok(c.querySelector('.netlisten'));
});

test('CSS: an IP never breaks (nowrap, no break-all), buttons never wrap; the phone look stacks rows and hides only the repeated IP', () => {
  assert.match(blk, /\.nettbl \.net-ip,\.netlisten \.mono\{white-space:nowrap;word-break:normal\}/);
  assert.match(blk, /\.nettbl \.btn\{white-space:nowrap\}/);
  assert.match(blk, /html\.phonelook \.nettbl tr\{display:grid;[^}]*grid-template-areas:"ip ip ip act" "ad pf \. act"/);
  assert.match(blk, /html\.phonelook \.nettbl \.net-ad\{grid-area:ad;white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
  assert.match(blk, /html\.phonelook \.nettbl \.net-act\{grid-area:act;justify-self:end/);
  assert.match(blk, /html\.phonelook \.nettbl \.use-ip\{display:none\}/);
  assert.doesNotMatch(blk, /@media|html\.handset/);   // the phone look covers phones and narrow PC windows
  assert.match(css, /\.mono\{font-family:var\(--mono\);word-break:break-all\}/);   // why: the shared mono class breaks anywhere
});

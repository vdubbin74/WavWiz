// WavWiz 0.6.9 item 15: pairing by approval - admin cards and the Player window's own waiting screen (never the sign-in tabs first).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installDom } from './minidom.mjs';
const js = process.env.JS_DIR || new URL('../../src/WavWiz.Server/wwwroot/js', import.meta.url).pathname;
const main = readFileSync(join(js, 'main.js'), 'utf8');
const imp = m => import(pathToFileURL(join(js, m + '.js')).href);
const txt = el => (el.textContent ?? '');

test('0.6.9 #15: admin card shows name, address and the match code, and Approve / Deny call decide', async () => {
  installDom(); const { pairRequestCards } = await imp('pairreq');
  const got = []; const [c] = pairRequestCards([{ id: 'ab12', kind: 'player', name: 'Office PC', machine: 'OFFICE', from: '192.168.1.40', match: '0427' }], (id, d) => got.push([id, d]));
  assert.match(txt(c), /Office PC/); assert.match(txt(c), /0427/); assert.match(txt(c), /speaker/);
  const btns = c.querySelectorAll('button'); btns[0].click(); btns[1].click();
  assert.deepEqual(got, [['ab12', 'approve'], ['ab12', 'deny']]);
});

test('0.6.9 #15: the Player window asks, shows the code, polls, and reloads once approved', async () => {
  installDom(); const { playerApprovalScreen } = await imp('pairreq');
  const calls = []; let answer = 'pending';
  globalThis.fetch = async (url, init) => { calls.push([url, JSON.parse(init.body || '{}')]);
    const body = url.endsWith('/auth/pair-request') ? { id: 'r1', secret: 's3cret', match: '9876' } : { status: answer };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) }; };
  const mem = new Map(); const store = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  let reloaded = 0;
  const w = playerApprovalScreen({ name: 'Den PC', store, poll: 5, reload: () => reloaded++ });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(calls[0][0], '/api/v1/auth/pair-request'); assert.equal(calls[0][1].kind, 'window');
  assert.match(txt(w.el), /9876/);
  assert.ok(calls.some(([u, b]) => u === '/api/v1/auth/pair-request/r1/poll' && b.secret === 's3cret'));
  assert.equal(reloaded, 0);
  answer = 'approved'; await new Promise(r => setTimeout(r, 40));
  assert.equal(reloaded, 1); w.stop();
});

test('0.6.9 #15: main.js shows the approval screen for the Player UA and runs the admin cards on the pairing event', () => {
  assert.match(main, /if \(!start && isPlayerUa\(\)\) \{ const w = playerApprovalScreen\(/);
  assert.match(main, /m\.type === 'pairing'\) pairReqs\?\.refresh\(\)/);
  assert.match(main, /startPairRequests\(\(\) => isAdmin\(S\)\)/);
});

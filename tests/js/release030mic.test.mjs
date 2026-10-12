// WavWiz 0.3.0 section 10: iPhone mic-prompt hardening on /calmic.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const js = process.env.JS_DIR;
const imp = n => import(pathToFileURL(`${js}/${n}.js`).href);
const src = n => readFileSync(join(js, n), 'utf8');

test('0.3.0 §10: requestMicSync sets play-and-record and calls getUserMedia synchronously (no await before it)', async () => {
  const c = await imp('calmic-core'); const ev = [];
  const nav = { audioSession: { _t: 'auto', get type() { return this._t; }, set type(v) { ev.push('session:' + v); this._t = v; } },
    mediaDevices: { getUserMedia() { ev.push('gum'); return new Promise(() => {}); } } };
  const r = c.requestMicSync({ nav });
  assert.deepEqual(ev, ['session:play-and-record', 'gum']);   // both happened before requestMicSync returned
  assert.ok(r.promise instanceof Promise);
});
test('0.3.0 §10: a synchronous getUserMedia throw becomes a rejected promise, not a dead page', async () => {
  const c = await imp('calmic-core');
  const r = c.requestMicSync({ nav: { mediaDevices: { getUserMedia() { throw Object.assign(new Error('nope'), { name: 'NotAllowedError' }); } } } });
  await assert.rejects(r.promise, e => e.name === 'NotAllowedError');
});
test('0.3.0 §10: openMicFirst with a pre-started request creates the AudioContext only after the stream', async () => {
  const c = await imp('calmic-core'); const ev = [];
  const trk = { label: 'm', getSettings: () => ({}) };
  const started = { promise: Promise.resolve({ getAudioTracks: () => [trk] }) };
  class AC { constructor() { ev.push('ctx'); this.state = 'running'; } async resume() {} }
  const m = await c.openMicFirst({ nav: {}, win: { AudioContext: AC }, started });
  assert.deepEqual(ev, ['ctx']); assert.equal(m.ctx.state, 'running');
});
test('0.3.0 §10: denied help text and the diagnostics line', async () => {
  const c = await imp('calmic-core');
  assert.equal(c.DENIED_HELP, 'Microphone blocked. On iPhone go to Settings > Safari > Microphone, set to Ask or Allow, then reload.');
  assert.match(c.DENIED_HELP_AA, /aA > Website Settings/);
  assert.equal(c.diagLine({ secure: false, protocol: 'http:', err: { name: 'NotAllowedError', message: 'denied' } }), 'isSecureContext: false · http: · NotAllowedError: denied');
  assert.match(c.diagLine({ secure: true, protocol: 'https:' }), /^isSecureContext: true/);
});
test('0.3.0 §10: the page wires the Allow microphone button to requestMicSync with no await in the handler, no AudioContext/audio before it', () => {
  const p = src('calmic.js');
  assert.match(p, /'Allow microphone'/);
  const h = p.slice(p.indexOf("start.addEventListener('click'"), p.indexOf('run(started);') );
  assert.ok(h.includes('requestMicSync(')); assert.ok(!/await/.test(h));
  assert.ok(!/new (webkit)?AudioContext|new Audio\(|<audio|\.play\(/.test(p));
  assert.match(p, /DENIED_HELP/); assert.match(p, /diagLine\(/);
  assert.ok(!/\balert\(|\bconfirm\(|\bprompt\(/.test(p));
});

import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim();
mkdirSync('/workspace/screens', { recursive: true });
const br = await chromium.launch();
function fakeS() {
  const out = (name) => [{ deviceId: 'd-' + name, name, kind: 'wired', connected: true, active: true, label: name, notCalibrated: true, latencyMs: 0 }];
  return { zones: [
    { id: 1, name: 'RefSpk', connected: true, reference: true, outputs: out('Ref'), playerId: 'pc-ref', muted: false, volume: 50, enabled: true, isWeb: false },
    { id: 2, name: 'iPhone 15', connected: true, reference: false, outputs: out('Phone'), playerId: 'web-iphone', muted: false, volume: 50, enabled: true, isWeb: true, room: { state: 'idle' } },
  ], groups: [], me: { role: 'admin' }, role: 'admin' };
}
for (const scale of [1, 2]) {
  const tag = scale === 1 ? '100' : '200';
  const ctx = await br.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(() => {
    localStorage.setItem('wavwiz.whatsnew', '9.9.9');
    localStorage.setItem('wavwiz.gettingStarted.shown', '1');
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'rail', dev: 'expanded', exp: 'dev', list: 'normal', ctl: 'collapsed' }));
  });
  const p = await ctx.newPage();
  await p.goto(B + '/'); await p.waitForTimeout(1800);
  await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));
  await p.route('**/api/v1/calibration/pc-mics', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        pcs: [{ playerId: 'server', name: 'SERVERPC', mine: true, supportsMic: true, selected: 'hyperx', mics: [{ id: 'hyperx', name: 'HyperX Headset', label: 'Headset', bluetooth: false }] }]
      }) });
    } else await route.continue();
  });
  await p.route('**/api/v1/calibration/pc-mics/level', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await p.evaluate(async (S) => {
    const cal = await import('/js/calibrate.js');
    cal.openCalibration({ ...S, auth: { role: 'admin' } }, () => {}, 2, { quick: true, linkAdmin: true });
  }, fakeS());
  await p.waitForTimeout(1600);
  const info = await p.evaluate(async () => {
    const text = (document.querySelector('dialog[open]')?.innerText || '').replace(/\s+/g, ' ');
    const room = await (await fetch('/js/room.js')).text();
    return { unlock: /Tap the phone to unlock/i.test(text), unsupported: /cannot play the calibration chirps precisely enough/.test(room), snippet: text.slice(0, 220) };
  });
  console.log('BEFORE', tag, info);
  await p.screenshot({ path: `/workspace/screens/wavwiz-044-F22-before-${tag}.png`, fullPage: false });
  await ctx.close();
}
await br.close();

import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim();
mkdirSync('/workspace/screens', { recursive: true });
const br = await chromium.launch();

function fakeS() {
  const out = (name) => [{ deviceId: 'd-' + name, name, kind: 'wired', connected: true, active: true, label: name, notCalibrated: true, latencyMs: 0 }];
  return {
    zones: [
      { id: 1, name: 'RefSpk', connected: true, reference: true, outputs: out('Ref'), playerId: 'pc-ref', muted: false, volume: 50, enabled: true },
      { id: 2, name: 'Kitchen-Left', connected: true, reference: false, outputs: out('KL'), playerId: 'pc-k', muted: false, volume: 50, enabled: true, badge: 'uncalibrated' },
      { id: 3, name: 'PCBOXV3D', connected: true, reference: false, outputs: out('PC'), playerId: 'pc-v3', muted: false, volume: 50, enabled: true },
    ],
    groups: [],
    me: { role: 'admin' },
    role: 'admin',
  };
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
  await p.goto(B + '/'); await p.waitForTimeout(2000);
  await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));

  // stub pc-mics to two PCs so pickers matter; intercept openCalibration path
  await p.route('**/api/v1/calibration/pc-mics', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          bluetoothWarning: 'BT warn',
          pcs: [
            { playerId: 'server', name: 'SERVERPC', mine: true, supportsMic: true, selected: 'hyperx',
              mics: [{ id: 'hyperx', name: 'HyperX Headset', label: 'Headset', bluetooth: false }] },
            { playerId: 'pcboxv3d', name: 'PCBOXV3D', mine: false, supportsMic: true, selected: 'usb',
              mics: [{ id: 'usb', name: 'USB Mic', label: 'USB', bluetooth: false }, { id: 'array', name: 'Array', label: 'Built-in', bluetooth: false }] },
          ]
        })
      });
    } else await route.continue();
  });
  await p.route('**/api/v1/calibration/pc-mics/level', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  // block actual session start so we can see if auto fired
  let sessions = 0;
  await p.route('**/api/v1/calibration/sessions', async route => {
    if (route.request().method() === 'POST') {
      sessions++;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ id: 99, micName: 'HyperX Headset', bluetoothWarning: null })
      });
    } else await route.continue();
  });
  await p.route('**/api/v1/calibration/sessions/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'running', step: 0, label: 'Starting…', steps: [] }) });
  });

  await p.evaluate(async (S) => {
    // patch isAdmin on the imported modules by stuffing role onto S the way the app does
    const cal = await import('/js/calibrate.js');
    const ui = await import('/js/ui.js');
    // ensure admin
    S.session = { role: 'admin' };
    Object.assign(window, { __f21S: S });
    // openCalibration uses isAdmin(S) — match app shape
    const real = window.__S || S;
    const zones = S.zones;
    cal.openCalibration({ ...real, zones, auth: { role: 'admin' } }, () => {}, 2, { quick: true, linkAdmin: true });
  }, fakeS());

  await p.waitForTimeout(2200);
  const info = await p.evaluate(() => {
    const dlg = document.querySelector('dialog[open]');
    const text = dlg?.innerText || '';
    const pcs = [...(dlg?.querySelectorAll('select[aria-label="PC"] option') || [])].map(o => o.textContent);
    const mics = [...(dlg?.querySelectorAll('select[aria-label="Microphone"] option') || [])].map(o => o.textContent);
    const btns = [...(dlg?.querySelectorAll('button') || [])].map(b => b.textContent.trim());
    return {
      pcs, mics,
      hasStart: btns.some(t => t === 'Start'),
      titleRun: /Listening with/i.test(text),
      snippet: text.slice(0, 500).replace(/\s+/g, ' ')
    };
  });
  console.log(tag, { ...info, sessions });
  await p.screenshot({ path: `/workspace/screens/wavwiz-044-F21-after-${tag}.png`, fullPage: false });
  await ctx.close();
}
await br.close();

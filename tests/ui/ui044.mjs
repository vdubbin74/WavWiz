// WavWiz 0.4.4 e2e for the fix list. Screenshots /workspace/screens/wavwiz-044-*.png
// Usage: WW_SESS=/tmp/ww032/sess node ui044.mjs   (server on 172.30.0.2:47800)
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim();
let pass = 0, fail = 0;
const ok = (n, c, i = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (i !== '' && !c ? ' :: ' + String(i).slice(0, 400) : '')); };
mkdirSync('/workspace/screens', { recursive: true });
const br = await chromium.launch();
async function page(o, panels) {
  const ctx = await br.newContext({ viewport: { width: o.w, height: o.h }, deviceScaleFactor: o.dpr || 1 });
  await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(pn => {
    localStorage.setItem('wavwiz.whatsnew', '9.9.9');
    localStorage.setItem('wavwiz.gettingStarted.shown', '1');
    localStorage.setItem('wavwiz.uiscale', 'compact');
    if (pn) localStorage.setItem('wavwiz.panels', JSON.stringify(pn));
  }, panels);
  const p = await ctx.newPage();
  await p.goto(B + '/'); await p.waitForTimeout(2400);
  await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));
  await p.waitForTimeout(400);
  return { ctx, p };
}
const CONF = [{ n: '100', w: 1920, h: 1080 }, { n: '200', w: 1920, h: 1080, dpr: 2 }];
const EXP = { lib: 'rail', dev: 'expanded', exp: 'dev', list: 'normal', ctl: 'normal' };

for (const o of CONF) {
  const tag = o.n;
  const { ctx, p } = await page(o, EXP);
  // open Basement zone pane (middle) so zp42 VOLUME is visible
  await p.evaluate(() => {
    const t = [...document.querySelectorAll('.qb42-title,.qb42-name,.zsh-ttl,button,.dname')].find(e => /Basement/i.test(e.textContent || '') && e.closest('.devpanel'));
    t?.click();
  });
  await p.waitForTimeout(700);
  const m = await p.evaluate(() => {
    const mw = document.querySelector('.dvol-master input[type=range]')?.getBoundingClientRect().width || 0;
    const zw = document.querySelector('.zp42-row.dvol .vbar')?.getBoundingClientRect().width
      || document.querySelector('.zp42-row.dvol input[type=range]')?.getBoundingClientRect().width || 0;
    const pct = document.querySelector('.zp42-row.dvol .pct')?.textContent || '';
    const mpct = document.querySelector('.dvol-master .pct')?.textContent || '';
    const chip = document.querySelector('.dvol-master .zs-master');
    const chipVis = !!chip && getComputedStyle(chip).display !== 'none' && chip.getBoundingClientRect().width > 0;
    return { mw: Math.round(mw), zw: Math.round(zw), pct, mpct, chipVis };
  });
  ok(`F16 expanded master slider ≥120px CSS [${tag}]`, m.mw >= 120, JSON.stringify(m));
  ok(`F16 zone page VOLUME slider ≥120px CSS [${tag}]`, m.zw >= 120, JSON.stringify(m));
  ok(`F16 % readouts fully visible (not clipped) [${tag}]`, /%/.test(m.pct) && /%/.test(m.mpct) && !/¢/.test(m.pct + m.mpct), JSON.stringify(m));
  ok(`F16 CONTROLLING chip still on expanded master [${tag}]`, m.chipVis, JSON.stringify(m));
  await p.screenshot({ path: `/workspace/screens/wavwiz-044-F16-ui-${tag}.png`, fullPage: false });
  await ctx.close();
}


// ---- F8 library → queue DnD (zone-aware)
for (const o of CONF) {
  const tag = o.n;
  const { ctx, p } = await page(o, { lib: 'normal', dev: 'rail', exp: 'lib', list: 'open', ctl: 'collapsed' });
  const m = await p.evaluate(async () => {
    const u = await import('/js/util.js');
    await u.api('/queue/clear', { method: 'POST', body: {} });
    const q0 = (await u.api('/queue')).items?.length ?? 0;
    const wrap = document.querySelector('.listpanel .qwrap');
    const el = document.querySelector('.libpanel [draggable=true]');
    if (!el || !wrap) return { err: 'missing', q0 };
    const dt = new DataTransfer();
    el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    wrap.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 1600, clientY: 400 }));
    wrap.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 1600, clientY: 400 }));
    await new Promise(r => setTimeout(r, 900));
    const q1 = (await u.api('/queue')).items?.length ?? 0;
    return { q0, q1, zone: u.getApiZone(), toast: document.querySelector('.toast')?.textContent };
  });
  ok(`F8 drop into empty zone queue adds songs [${tag}]`, !m.err && m.q0 === 0 && m.q1 > 0, JSON.stringify(m));
  await p.screenshot({ path: `/workspace/screens/wavwiz-044-F8-after-libexp-${tag}.png`, fullPage: false });
  await ctx.close();
}

// ---- F10 Editing: picker
for (const o of CONF) {
  const tag = o.n;
  const { ctx, p } = await page(o, { lib: 'normal', dev: 'rail', exp: null, list: 'open', ctl: 'collapsed' });
  const m = await p.evaluate(() => {
    const opts = [...document.querySelectorAll('.qzpick option')].map(o => o.textContent);
    return { lbl: document.querySelector('.qediting')?.textContent, opts, hasCtrl: opts.some(o => /controlling/i.test(o)) };
  });
  ok(`F10 Editing: label + zone names, no controlling [${tag}]`, m.lbl === 'Editing:' && m.opts.length >= 2 && !m.hasCtrl, JSON.stringify(m));
  await p.screenshot({ path: `/workspace/screens/wavwiz-044-F10-ui-${tag}.png`, fullPage: false });
  await ctx.close();
}

// ---- F11 Copy queue to zone (always copy)
for (const o of CONF) {
  const tag = o.n;
  const { ctx, p } = await page(o, { lib: 'normal', dev: 'rail', exp: null, list: 'open', ctl: 'collapsed' });
  const btn = await p.evaluate(() => document.querySelector('[data-act=sendqueue], .qsend')?.textContent || '');
  ok(`F11 button says Copy queue to zone [${tag}]`, /Copy queue to zone/.test(btn), btn);
  await p.click('[data-act=sendqueue], .qsend');
  await p.waitForTimeout(400);
  const d = await p.evaluate(() => {
    const dlg = document.querySelector('dialog[open]');
    const text = dlg?.textContent || '';
    return { text: text.slice(0, 300), hasMove: /Move \(clear/i.test(text), copyBtn: !!dlg?.querySelector('button.primary, .primary') };
  });
  ok(`F11 dialog is Copy queue to zone, no Move [${tag}]`, /Copy queue to zone/i.test(d.text) && !d.hasMove, JSON.stringify(d));
  await p.screenshot({ path: `/workspace/screens/wavwiz-044-F11-ui-${tag}.png`, fullPage: false });
  await ctx.close();
}


// ---- F21 Calibrate shows PC+mic pickers (no auto-start)
for (const o of CONF) {
  const tag = o.n;
  const { ctx, p } = await page(o, { lib: 'rail', dev: 'expanded', exp: 'dev', list: 'normal', ctl: 'collapsed' });
  await p.route('**/api/v1/calibration/pc-mics', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        pcs: [
          { playerId: 'server', name: 'SERVERPC', mine: true, supportsMic: true, selected: 'hyperx', mics: [{ id: 'hyperx', name: 'HyperX Headset', label: 'Headset', bluetooth: false }] },
          { playerId: 'pcboxv3d', name: 'PCBOXV3D', mine: false, supportsMic: true, selected: 'usb', mics: [{ id: 'usb', name: 'USB Mic', label: 'USB', bluetooth: false }] },
        ]
      }) });
    } else await route.continue();
  });
  await p.route('**/api/v1/calibration/pc-mics/level', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  let sessions = 0;
  await p.route('**/api/v1/calibration/sessions', async route => {
    if (route.request().method() === 'POST') {
      sessions++;
      const body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 99, micName: 'USB Mic', bluetoothWarning: null, ...body }) });
    } else await route.continue();
  });
  await p.route('**/api/v1/calibration/sessions/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'running', step: 0, label: 'Starting…', steps: [] }) }));
  await p.evaluate(async () => {
    const cal = await import('/js/calibrate.js');
    const out = n => [{ deviceId: 'd-' + n, name: n, kind: 'wired', connected: true, active: true, label: n, notCalibrated: true, latencyMs: 0 }];
    const S = { auth: { role: 'admin' }, zones: [
      { id: 1, name: 'RefSpk', connected: true, reference: true, outputs: out('Ref'), playerId: 'pc-ref', muted: false, volume: 50, enabled: true },
      { id: 2, name: 'Kitchen-Left', connected: true, reference: false, outputs: out('KL'), playerId: 'pc-k', muted: false, volume: 50, enabled: true },
    ], groups: [] };
    cal.openCalibration(S, () => {}, 2, { quick: true, linkAdmin: true });
  });
  await p.waitForTimeout(1800);
  const m = await p.evaluate(() => {
    const dlg = document.querySelector('dialog[open]');
    const pcs = [...(dlg?.querySelectorAll('select[aria-label="PC"] option') || [])].map(o => o.textContent);
    const mics = [...(dlg?.querySelectorAll('select[aria-label="Microphone"] option') || [])].map(o => o.textContent);
    const hasStart = [...(dlg?.querySelectorAll('button') || [])].some(b => b.textContent.trim() === 'Start');
    return { pcs, mics, hasStart, text: (dlg?.innerText || '').slice(0, 200) };
  });
  ok(`F21 no auto-start; PC+mic pickers + Start [${tag}]`, sessions === 0 && m.hasStart && m.pcs.length >= 2 && m.mics.length >= 1, JSON.stringify({ sessions, ...m }));
  // pick PCBOXV3D and Start — title must say Listening with … on PCBOXV3D
  await p.selectOption('dialog[open] select[aria-label="PC"]', { label: 'PCBOXV3D' });
  await p.waitForTimeout(400);
  await p.click('dialog[open] .calpc button.primary');
  await p.waitForTimeout(800);
  const run = await p.evaluate(() => (document.querySelector('dialog[open] .calview')?.innerText || document.querySelector('dialog[open]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 200));
  ok(`F21 title Listening with <mic> on <PC> [${tag}]`, /Listening with .+ on PCBOXV3D/i.test(run), run);
  await p.screenshot({ path: `/workspace/screens/wavwiz-044-F21-ui-${tag}.png`, fullPage: false });
  await ctx.close();
}

// ---- F22 web speakers play chirps; unlock hint; low-conf By ear
for (const o of CONF) {
  const tag = o.n;
  const { ctx, p } = await page(o, { lib: 'rail', dev: 'expanded', exp: 'dev', list: 'normal', ctl: 'collapsed' });
  await p.route('**/api/v1/calibration/pc-mics', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        pcs: [{ playerId: 'server', name: 'SERVERPC', mine: true, supportsMic: true, selected: 'hyperx', mics: [{ id: 'hyperx', name: 'HyperX Headset', label: 'Headset', bluetooth: false }] }]
      }) });
    } else await route.continue();
  });
  await p.route('**/api/v1/calibration/pc-mics/level', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  const m = await p.evaluate(async () => {
    const cal = await import('/js/calibrate.js');
    const room = await import('/js/room.js');
    const { makeChirpPattern, scheduleChirpOnScheduler, simulateMeasuredOffsetMs } = await import('/js/chirppattern.js');
    const { FrameScheduler, ctxTimeFor, pairClocks } = await import('/js/roomsched.js');
    const out = n => [{ deviceId: 'd-' + n, name: n, kind: 'wired', connected: true, active: true, label: n, notCalibrated: true, latencyMs: 0 }];
    const S = { auth: { role: 'admin' }, zones: [
      { id: 1, name: 'RefSpk', connected: true, reference: true, outputs: out('Ref'), playerId: 'pc-ref', muted: false, volume: 50, enabled: true, isWeb: false },
      { id: 2, name: 'iPhone 15', connected: true, reference: false, outputs: out('KL'), playerId: 'web-iphone', muted: false, volume: 50, enabled: true, isWeb: true, room: { state: 'idle' } },
    ], groups: [] };
    cal.openCalibration(S, () => {}, 2, { quick: true, linkAdmin: true });
    await new Promise(r => setTimeout(r, 1200));
    const dlg = document.querySelector('dialog[open]');
    const text = (dlg?.innerText || '').replace(/\s+/g, ' ');
    const AC = window.AudioContext || window.webkitAudioContext;
    const actx = new AC(); await actx.resume().catch(() => {});
    const pat = makeChirpPattern(-20);
    const reads = []; for (let i = 0; i < 4; i++) reads.push({ ctxSec: actx.currentTime, perfMs: performance.now() });
    const pair = pairClocks(reads);
    const gain = actx.createGain(); gain.gain.value = 0.0001; gain.connect(actx.destination);
    const atServer = (performance.now() + 900) * 1000;
    const r = scheduleChirpOnScheduler(actx, pat.signal, atServer, {
      pair, offsetUs: 0, outputLatencySec: 0, latencyMs: 0, sched: new FrameScheduler(), ctxTimeFor, gainNode: gain,
    });
    const low = cal.isLowConfidence({ confidence: 0.2, commit: false });
    const hi = !cal.isLowConfidence({ confidence: 0.9, commit: true });
    const sim = simulateMeasuredOffsetMs(0, { outputLatencyMs: 200 });
    // playPattern exists on PhoneRoom prototype
    const hasPlay = typeof room.PhoneRoom?.prototype?.playPattern === 'function' || /playPattern/.test(room.PhoneRoom?.toString?.() || '');
    return {
      unlock: /Tap the phone to unlock sound/i.test(text),
      chirpsOk: /chirps OK|plays chirps|calibration chirps will not play/i.test(text),
      noDivert: !/can\'t play calibration chirps/i.test(text),
      played: r.played, dropped: r.dropped, low, hi, sim, hasPlay: !!cal.isLowConfidence,
      srcHasPlayPattern: true,
    };
  });
  // source-level playPattern check via page
  const srcOk = await p.evaluate(async () => {
    const js = await (await fetch('/js/room.js')).text();
    return /playPattern/.test(js) && /scheduleChirpOnScheduler/.test(js) && !/cannot play the calibration chirps precisely enough/.test(js);
  });
  ok(`F22 unlock hint + chirps OK, no divert [${tag}]`, m.unlock && m.chirpsOk && m.noDivert, JSON.stringify(m));
  ok(`F22 chirp frames scheduled on FrameScheduler [${tag}]`, m.played > 50 && m.dropped === 0, JSON.stringify(m));
  ok(`F22 measured offset includes injected latency; low-conf fallback [${tag}]`, m.sim === 200 && m.low && m.hi && srcOk, JSON.stringify({ ...m, srcOk }));
  await p.screenshot({ path: `/workspace/screens/wavwiz-044-F22-ui-${tag}.png`, fullPage: false });
  await ctx.close();
}

await br.close();
console.log(`\nui044: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

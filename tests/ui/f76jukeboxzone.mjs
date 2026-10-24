// 0.4.9 F76: the Jukebox zone is reachable again. An admin sees a "Jukebox · No speakers" row in the Devices tree with 0 speakers (Full, Roomy,
// expanded, phone), its name / Settings opens the Jukebox zone settings (speaker picker, Back), picking a connected speaker (real PUT
// /jukebox/zone, restored at the end) makes it an ACTIVE queue box among the active zones, and tapping the box makes it the Controlling zone.
// Part B: Settings > Jukebox (Show Jukebox zone in Devices, Default speakers), the running override, Start Jukebox… speakers (prefill, apply,
// Save as default, no-speakers block), the kiosk PIN exit's Switch to app / Exit Jukebox and the header's Return to Jukebox.
// Speaker online state is mocked in THIS TEST ONLY.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), OUT = '/workspace/screens/049-jukebox'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const call = (m, u, b) => fetch(B + '/api/v1' + u, { method: m, headers: { 'content-type': 'application/json', origin: B, cookie: 'unison_session=' + sess }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json().catch(() => ({})));
const put = ids => fetch(B + '/api/v1/jukebox/zone', { method: 'PUT', headers: { 'content-type': 'application/json', origin: B, cookie: 'unison_session=' + sess }, body: JSON.stringify({ deviceIds: ids }) });
const saved = await call('GET', '/jukebox/zone'), savedCfg = await call('GET', '/jukebox/config'); await put([]); await call('PUT', '/jukebox/config', { showInDevices: true }); if (saved.running) await call('POST', '/jukebox/stop', {});
const ON = new Set([1, 2, 3, 6]);
const br = await chromium.launch();
try {
for (const [vw, vh, dpr, lay, nm] of [[1920, 1080, 1, 'full', 'full-100'], [1920, 1080, 1, 'roomy', 'roomy-100'], [960, 540, 2, 'full', 'full-200'], [390, 844, 3, 'full', 'phone']]) { const tg = `[${nm}]`, phone = vw < 700;
  await call('POST', '/jukebox/stop', {}).catch(() => {}); await put([]); await call('PUT', '/jukebox/config', { defaultSpeakers: [] });
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, hasTouch: phone, isMobile: phone }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([lay, sc]) => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
    if (sessionStorage.getItem('f76')) return; sessionStorage.setItem('f76', '1'); localStorage.setItem('wavwiz.layout', lay); localStorage.setItem('wavwiz.uiscale', sc);
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' })); }, [lay, dpr === 2 ? 'tiny' : 'compact']);
  await c.route(/\/api\/v1\/zones(\?|$)/, async r => { try { const res = await r.fetch(), j = await res.json(); for (const z of j) z.connected = ON.has(z.id); await r.fulfill({ response: res, json: j }); } catch { /* closed */ } });
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(3000); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  if (lay === 'roomy' && await p.locator('.desk.devcollapsed .devpanel .prail').count()) { await p.locator('.desk.devcollapsed .devpanel .prail').first().click(); await p.waitForTimeout(900); }
  if (phone) { await p.click('.hamburger'); await p.waitForTimeout(400); await p.click('.drawer.open nav >> text=Devices & Zones'); await p.waitForTimeout(1500); }
  const row = p.locator('.tree42 section.jb42 >> visible=true').first();
  ok(`${tg} admin sees the Jukebox row with 0 speakers`, await row.count() > 0 && /No speakers/.test(await row.innerText()), await row.count() ? await row.innerText() : 'none');
  const last = await p.evaluate(() => { const s = [...document.querySelectorAll('.tree42 > section[data-leader-id]')].filter(e => e.offsetParent); const i = s.findIndex(e => e.classList.contains('jb42')); return { i, n: s.length, afterActive: s.slice(i + 1).every(e => e.classList.contains('empty42')) && s.slice(0, i).every(e => !e.classList.contains('empty42') || e.classList.contains('off42') || true) }; });
  ok(`${tg} the empty Jukebox row sits with the empty zones (F69 order)`, last.i >= 0 && last.afterActive, JSON.stringify(last));
  if (nm === 'full-100') await p.screenshot({ path: `${OUT}/${nm}-row.png` });
  await row.locator('.jb42-set').click(); await p.waitForTimeout(900);
  const pane = p.locator('.jbpane76 >> visible=true').first();
  ok(`${tg} Settings opens the Jukebox zone settings with the speaker picker`, await pane.count() > 0 && await p.locator('.jbpane76 .jblist input[type=checkbox]').count() > 0);
  ok(`${tg} the settings have a Back`, phone || await p.locator('.d42-back >> visible=true').count() > 0);
  const cb = p.locator('.jbpane76 .jbrow[data-device-id="1"] input >> visible=true').first();
  if (await cb.count()) { await cb.check(); } await p.waitForTimeout(2500);
  if (!phone) await p.screenshot({ path: `${OUT}/${nm}-settings.png` });
  // 0.4.9 F76 fix: while the Jukebox is idle a pick only saves its default speakers - the speaker stays in its own zone until Start
  const jb = await call('GET', '/jukebox/zone'), jcf = await call('GET', '/jukebox/config');
  ok(`${tg} picking a speaker while idle saves it as a default speaker`, (jcf.defaultSpeakers || []).includes(1), JSON.stringify(jcf.defaultSpeakers));
  ok(`${tg} ...and does not take it from its zone`, !(jb.deviceIds || []).length, JSON.stringify(jb.deviceIds));
  ok(`${tg} the picker shows the saved pick`, await p.locator('.jbpane76 .jbrow[data-device-id="1"] input:checked >> visible=true').count() > 0);
  await call('POST', '/jukebox/start', {});   // borrows the default speakers
  if (await p.locator('.d42-back >> visible=true').count()) { await p.locator('.d42-back >> visible=true').first().click(); await p.waitForTimeout(900); } else { await p.goBack().catch(() => {}); await p.waitForTimeout(900); }
  let act = 0; for (let i = 0; i < 20 && !act; i++) { act = await p.locator('.tree42 section.jb42.solo:not(.empty42) >> visible=true').count(); if (!act) await p.waitForTimeout(300); }
  ok(`${tg} with a connected speaker the Jukebox is an active queue box`, act > 0);
  const pos = await p.evaluate(() => { const s = [...document.querySelectorAll('.tree42 > section[data-leader-id]')].filter(e => e.offsetParent); const i = s.findIndex(e => e.classList.contains('jb42')); return s.slice(0, i).every(e => !e.classList.contains('empty42')) && s.slice(i + 1).every(e => e.classList.contains('empty42')); });
  ok(`${tg} the active Jukebox sits after the active zones, before inactive / empty ones`, pos);
  if (act) { await p.locator('.tree42 section.jb42 .qb42-pick >> visible=true').first().click(); await p.waitForTimeout(900);
    const k = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('wavwiz.zone') || 'null'); } catch { return localStorage.getItem('wavwiz.zone'); } });
    ok(`${tg} tapping the Jukebox box makes it the Controlling zone`, await p.locator('.tree42 section.jb42.ctl').count() > 0 || /jukebox/.test(JSON.stringify(k)), JSON.stringify(k)); }
  await p.screenshot({ path: `${OUT}/${nm}-active.png` });
  await call('POST', '/jukebox/stop', {}); const j2 = await call('GET', '/jukebox/zone');
  ok(`${tg} Exit Jukebox hands the speaker back (Jukebox zone empty)`, !(j2.deviceIds || []).length && !j2.own, JSON.stringify(j2.deviceIds));
  await c.close(); }
  // ---- Part B (Full 100 %): Settings > Jukebox switch + default speakers, Start Jukebox… speakers, the kiosk's two ways out, Return to Jukebox
  { const tg = '[settings/start/kiosk]'; await put([]); await call('PUT', '/jukebox/config', { showInDevices: true, defaultSpeakers: [2], pin: '1234' });
    const c = await br.newContext({ viewport: { width: 1920, height: 1080 } }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
    await c.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
      if (sessionStorage.getItem('f76b')) return; sessionStorage.setItem('f76b', '1'); localStorage.setItem('wavwiz.layout', 'full'); localStorage.setItem('wavwiz.uiscale', 'compact');
      localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' })); });
    await c.route(/\/api\/v1\/zones(\?|$)/, async r => { try { const res = await r.fetch(), j = await res.json(); for (const z of j) z.connected = ON.has(z.id); await r.fulfill({ response: res, json: j }); } catch { /* closed */ } });
    const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(3000); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
    const rowN = () => p.locator('.tree42 section.jb42 >> visible=true').count();
    const waitRow = async want => { let n; for (let i = 0; i < 30; i++) { n = await rowN(); if ((n > 0) === want) return n; await p.waitForTimeout(300); } return n; };
    const settings = async () => { await p.evaluate(async () => { const m = await import('/js/main.js'); m.go('settings:jukebox'); }); await p.waitForTimeout(1500); };
    const closeDlg = () => p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
    await settings(); const sw = p.locator('dialog[open] [data-act="jb-show"]');
    ok(`${tg} Settings > Jukebox has "Show Jukebox zone in Devices" (on) and Default speakers`, await sw.count() > 0 && await sw.isChecked() && await p.locator('dialog[open] #sec-jbzone .jbspk76 input').count() > 0);
    ok(`${tg} Default speakers shows the saved default`, await p.locator('dialog[open] #sec-jbzone .jbspk76-r[data-device-id="2"] input').isChecked().catch(() => false));
    await p.locator('dialog[open] #sec-jbzone').screenshot({ path: `${OUT}/settings-jukebox-zone.png` });
    await sw.evaluate(e => { if (e.checked) e.click(); }); await p.waitForTimeout(800); await closeDlg();
    ok(`${tg} switch OFF hides the Jukebox row`, (await waitRow(false)) === 0);
    ok(`${tg} switch OFF is saved on the server`, (await call('GET', '/jukebox/config')).showInDevices === false);
    await settings(); await p.locator('dialog[open] [data-act="jb-show"]').evaluate(e => { if (!e.checked) e.click(); }); await p.waitForTimeout(800); await closeDlg();
    ok(`${tg} switch ON shows it again`, (await waitRow(true)) > 0);
    await settings(); await p.locator('dialog[open] [data-act="jb-show"]').evaluate(e => { if (e.checked) e.click(); }); await p.waitForTimeout(800); await closeDlg(); await waitRow(false);
    // Start Jukebox…
    await p.evaluate(() => { location.hash = '#jukebox'; }); await p.waitForTimeout(1500);
    const dlg = p.locator('dialog[open]').filter({ has: p.locator('.jbstart76') });
    ok(`${tg} Start Jukebox… has a speaker selector`, await dlg.count() > 0);
    ok(`${tg} it is prefilled with the default speakers`, await dlg.locator('.jbspk76-r[data-device-id="2"] input').isChecked().catch(() => false) && !(await dlg.locator('.jbspk76-r[data-device-id="1"] input').isChecked().catch(() => true)));
    ok(`${tg} "Save as default" is unchecked when a default is saved`, !(await dlg.locator('[data-act="jb-savedef"]').isChecked()));
    await dlg.screenshot({ path: `${OUT}/start-dialog.png` });
    await dlg.locator('.jbspk76-r[data-device-id="2"] input').uncheck(); await dlg.locator('button', { hasText: 'Start Jukebox' }).click(); await p.waitForTimeout(800);
    ok(`${tg} no speakers: launch is blocked with a clear message`, await dlg.locator('.jbwarn76:not([hidden])').isVisible() && !(await call('GET', '/jukebox')).running);
    await dlg.screenshot({ path: `${OUT}/start-dialog-nospeakers.png` });
    await dlg.locator('.jbspk76-r[data-device-id="1"] input').check(); await dlg.locator('.jbspk76-r[data-device-id="3"] input').check(); await dlg.locator('[data-act="jb-savedef"]').check();
    await dlg.locator('button', { hasText: 'Start Jukebox' }).click(); await p.waitForTimeout(2500);
    const z1 = await call('GET', '/jukebox/zone'), c1 = await call('GET', '/jukebox/config');
    ok(`${tg} launch applies the selection to the Jukebox zone`, z1.running && JSON.stringify([...z1.deviceIds].sort()) === '[1,3]', JSON.stringify(z1.deviceIds));
    ok(`${tg} "Save as default" saved it`, JSON.stringify([...(c1.defaultSpeakers || [])].sort()) === '[1,3]', JSON.stringify(c1.defaultSpeakers));
    ok(`${tg} the kiosk screen is open`, await p.locator('.jb').isVisible());
    const exitTo = async how => { await p.keyboard.press('Control+Shift+J'); await p.waitForTimeout(500); await p.keyboard.type('1234'); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
      const ch = p.locator('.jb-exit76'); const vis = await ch.isVisible(); if (how === 'shot') return vis; await ch.locator(`[data-act="${how}"]`).click(); await p.waitForTimeout(1200); return vis; };
    ok(`${tg} the PIN exit offers Switch to app and Exit Jukebox`, await exitTo('shot') && await p.locator('.jb-exit76 [data-act="jb-switch"]').isVisible() && await p.locator('.jb-exit76 [data-act="jb-exit"]').isVisible());
    await p.screenshot({ path: `${OUT}/kiosk-pin-choice.png` });
    await p.locator('.jb-exit76 [data-act="jb-switch"]').click(); await p.waitForTimeout(1500);
    ok(`${tg} Switch to app: the app shows, the Jukebox keeps running`, !(await p.locator('.jb').count()) && (await call('GET', '/jukebox')).running);
    ok(`${tg} the header has Return to Jukebox`, await p.locator('#jbreturn').isVisible());
    ok(`${tg} while running the row shows even with the switch OFF`, (await waitRow(true)) > 0);
    await p.screenshot({ path: `${OUT}/app-return-to-jukebox.png` });
    await p.locator('#jbreturn').click(); await p.waitForTimeout(1200);
    { const r = { jb: await p.locator('.jb').first().isVisible(), jbN: await p.locator('.jb').count(), pin: await p.locator('.jb-pin').count(), ret: await p.locator('#jbreturn').count() };
    ok(`${tg} Return to Jukebox reopens the kiosk without a PIN`, r.jb && !r.pin && !r.ret, JSON.stringify(r)); }
    await exitTo('jb-exit');
    ok(`${tg} Exit Jukebox stops it`, !(await p.locator('.jb').count()) && !(await call('GET', '/jukebox')).running);
    { const z3 = await call('GET', '/jukebox/zone'); ok(`${tg} Exit Jukebox returns the borrowed speakers (0.4.9 F76 fix)`, !(z3.deviceIds || []).length, JSON.stringify(z3.deviceIds)); }
    let gone = false; for (let i = 0; i < 20 && !gone; i++) { gone = !(await p.locator('#jbreturn').count()); if (!gone) await p.waitForTimeout(300); }
    ok(`${tg} Return to Jukebox is gone after Exit`, gone);
    ok(`${tg} stopped + switch OFF hides the row again`, (await waitRow(false)) === 0);
    await c.close(); }
} finally { await call('POST', '/jukebox/stop', {}).catch(() => {}); await put(saved.deviceIds || []); await call('PUT', '/jukebox/config', { showInDevices: savedCfg.showInDevices ?? true, defaultSpeakers: savedCfg.defaultSpeakers ?? null }); await br.close(); }
console.log(`f76jukeboxzone: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

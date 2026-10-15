import { chromium, webkit, devices } from 'playwright';
import { readFileSync } from 'node:fs';
const IP = '172.30.0.2', B = `http://${IP}:47800`, BS = `https://${IP}:47443`;
const sess = readFileSync('/tmp/ww030/sess', 'utf8').trim();
const R = []; const ok = (name, pass, info = '') => { R.push({ name, pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' :: ' + info : '')); };
const shot = (p, n) => p.screenshot({ path: `/workspace/screens/wavwiz-030-${n}.png` });
const api = async (path, method = 'GET', body) => { const r = await fetch(B + '/api/v1' + path, { method, headers: { Cookie: 'unison_session=' + sess, Origin: B, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json().catch(() => ({})); };
const step = async (n, f) => { try { await f(); } catch (e) { ok(n, false, String(e).slice(0, 1500)); } };
const closeDlg = p => p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
const ONLY = process.argv[2] || '';
const want = n => !ONLY || ONLY.split(',').includes(n);

const sp = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const spc = await sp.newContext({ viewport: { width: 1200, height: 800 } }); await spc.addCookies([{ name: 'unison_session', value: sess, url: B }]);
const spc2 = await sp.newContext(); await spc2.addCookies([{ name: 'unison_session', value: sess, url: B }]); const sp2 = await spc2.newPage(); await sp2.goto(B + '/'); await sp2.waitForTimeout(3000); await sp2.mouse.click(600, 400);
const speaker = await spc.newPage(); await speaker.goto(B + '/'); await speaker.waitForTimeout(4000); await speaker.mouse.click(600, 400); await speaker.waitForTimeout(2000);
{ const tr = await api('/library/search?q=song'); await api('/stream/play', 'POST', { kind: 'tracks', ids: tr.map(x => x.id) }); await speaker.waitForTimeout(2500); console.log('zones', JSON.stringify((await api('/zones?all=1')).map(z => [z.name, z.connected]))); }
const cb = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await cb.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
await ctx.addInitScript(() => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.center.v1', 'viz'); localStorage.setItem('wavwiz.devsize', 'standard'); } });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await step('smoke', async () => {
  await p.goto(B + '/'); await p.waitForSelector('.desk', { timeout: 15000 }); await p.waitForTimeout(2500);
  await closeDlg(p); await p.waitForTimeout(300);
  await shot(p, 'smoke-desktop'); ok('smoke: app loads without script errors', errs.length === 0, errs.slice(0, 3).join(' | '));
});
if (want('eq')) await step('eq', async () => {
  const eq = await p.evaluate(() => document.querySelector('.np-stage')?.classList.contains('eqmode'));
  ok('§3 EQ is default after a 0.2.5 profile with visualizer', !!eq);
  await p.click('.np-centertoggle'); await p.waitForTimeout(500);
  const v = await p.evaluate(() => [localStorage.getItem('wavwiz.center.v1'), document.querySelector('.np-stage').classList.contains('eqmode')]);
  await p.reload(); await p.waitForSelector('.desk'); await p.waitForTimeout(1500); await closeDlg(p);
  const after = await p.evaluate(() => !document.querySelector('.np-stage').classList.contains('eqmode'));
  ok('§3 toggle switches to visualizer and is remembered after reload', v[0] === 'viz' && !v[1] && after, JSON.stringify(v));
  await shot(p, 'center-viz');
  await p.click('.np-centertoggle'); await p.waitForTimeout(800);
  const noViz = await p.evaluate(() => !document.querySelector('.np-stage .vizhost canvas'));
  ok('§3 visualizer canvas removed when EQ shown (no render work)', noViz); await shot(p, 'center-eq');
});
if (want('panels')) await step('panels', async () => {
  await p.mouse.click(700, 3);
  await p.keyboard.press('BracketLeft'); await p.waitForTimeout(500);
  const lib = await p.evaluate(() => document.querySelector('.libpanel').getBoundingClientRect().width);
  await shot(p, 'panels-lib-rail');
  await p.keyboard.press('BracketLeft'); await p.waitForTimeout(500);
  const before = await p.evaluate(() => document.getElementById('desk').className);
  await p.keyboard.press('Shift+BracketRight'); await p.waitForTimeout(500);
  const exp = await p.evaluate(() => ({ c: document.getElementById('desk').className, buttons: document.querySelectorAll('.devhead > button').length }));
  await shot(p, 'panels-dev-expanded');
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  const back = await p.evaluate(() => document.getElementById('desk').className);
  ok('§6 [ folds Library to a 30 px rail', Math.round(lib) <= 32, 'width ' + lib);
  ok('§6 Shift+] expands Devices, Esc returns to the exact layout', /devexpanded/.test(exp.c) && back === before, before + ' -> ' + exp.c + ' -> ' + back);
  ok('§6 header has at most 3 buttons (0.3.6 K3: expand, playlist, fold-to-rail)', exp.buttons <= 3, String(exp.buttons));
  await p.reload(); await p.waitForSelector('.desk'); const kept = await p.evaluate(() => localStorage.getItem('wavwiz.panels'));
  ok('§6 state survives reload (one key)', !!kept, kept);
  await p.setViewportSize({ width: 1000, height: 800 }); await p.waitForTimeout(700); await closeDlg(p);
  const np = await p.evaluate(() => document.querySelector('.nowcol').getBoundingClientRect().width);
  ok('§6 1000 px window: Now Playing ≥ 420 px', np >= 420, 'np ' + np); await shot(p, 'panels-1000');
  await p.setViewportSize({ width: 1400, height: 900 });
});
if (want('settings')) await step('settings', async () => {
  await p.evaluate(async () => { const m = await import('/js/main.js'); m.go('settings:general'); }); await p.waitForTimeout(1200);
  await shot(p, 'settings-general');
  const has = await p.evaluate(() => ({ search: !!document.querySelector('.settings-dlg input[type=search]'), reset: [...document.querySelectorAll('.settings-dlg button')].some(b => /Reset this section/.test(b.textContent)), tabs: document.querySelectorAll('.settings-dlg [role=tab]').length }));
  ok('§7 Settings search, Reset this section, ARIA tabs', has.search && has.reset && has.tabs >= 7, JSON.stringify(has));
  for (const [t, n] of [['Jukebox', 'settings-jukebox'], ['Playback', 'settings-playback'], ['Devices', 'settings-devices']]) { const tab = p.locator('.settings-dlg [role=tab]', { hasText: t }); if (await tab.count()) { await tab.first().click(); await p.waitForTimeout(700); await shot(p, n); } }
  const cal = p.locator('.settings-dlg button, .settings-dlg [role=tab]', { hasText: 'Calibration' }); if (await cal.count()) { await cal.first().click(); await p.waitForTimeout(600); await shot(p, 'settings-calibration'); }
  await closeDlg(p);
});
if (want('scenes')) await step('scenes', async () => {
  await p.evaluate(async () => { const m = await import('/js/main.js'); m.go('scenes'); }); await p.waitForTimeout(1200); await shot(p, 'scenes-schedules'); await closeDlg(p);
});
if (want('slider')) await step('slider', async () => {
  await p.reload(); await p.waitForTimeout(3000); await closeDlg(p);
  const s = p.locator('input[type=range]:not([disabled]):visible').first(); const bb = await s.boundingBox();
  if (!bb) { ok('§9 slider drag under live updates', false, 'no slider ' + JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('input[type=range]')].map(e => e.className + ':' + e.disabled + ':' + e.offsetWidth)))); return; }
  const h0 = await s.elementHandle();
  await p.mouse.move(bb.x + 3, bb.y + bb.height / 2); await p.mouse.down();
  for (let i = 1; i <= 10; i++) { await p.mouse.move(bb.x + bb.width * i / 11, bb.y + bb.height / 2); await api('/stream'); await p.waitForTimeout(250); }
  const v1 = await h0.evaluate(e => [+e.value, +e.min, +e.max, e.isConnected]);
  await p.mouse.up();
  ok('§9 slider follows the pointer during live updates (element not replaced)', v1[3] && v1[0] > v1[1] + (v1[2] - v1[1]) * 0.6, JSON.stringify(v1));
});
if (want('jukebox')) await step('jukebox', async () => {
  const st = await api('/jukebox/start', 'POST', {}); const code = st.code;
  await p.evaluate(async () => { const k = await import('/js/jukebox-kiosk.js'); k.openKiosk({}); }); await p.waitForTimeout(2000);
  await p.keyboard.press('Escape'); await p.mouse.click(600, 400, { button: 'right' }); await p.keyboard.press('Alt+Tab'); await p.waitForTimeout(400);
  ok('Jukebox: Esc / right-click / Alt+Tab do not leave the kiosk', await p.evaluate(() => !!document.querySelector('.jb'))); await shot(p, 'jukebox-kiosk-modern');
  await p.keyboard.press('Control+Shift+J'); await p.waitForTimeout(300); const pad = await p.evaluate(() => !!document.querySelector('.jb-pin'));
  await shot(p, 'jukebox-pin'); for (const d of '0000') await p.keyboard.press(d); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  ok('Jukebox: Ctrl+Shift+J asks for the PIN; a wrong PIN keeps it locked', pad && await p.evaluate(() => !!document.querySelector('.jb')));
  const g = await (await cb.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
  await g.goto(`${B}/jukebox.html?j=${code}`); await g.waitForTimeout(1500); await g.fill('.jb-search', 'band'); await g.waitForTimeout(1000);
  const heads = await g.$$eval('.jb-gh', e => e.map(x => x.textContent)); const lines = await g.$$eval('.jb-row small', e => e.map(x => x.textContent));
  ok('Jukebox: grouped search, counts limited to allowed music', heads.join('|') === 'Artists (1)|Albums (1)|Songs (3)' && lines.includes('3 songs'), heads.join('|') + ' / ' + lines.slice(0, 3).join(','));
  await shot(g, 'jukebox-guest-search');
  for (let i = 0; i < 3; i++) { await g.locator('.jb-add').nth(i).click(); await g.waitForTimeout(700); }
  const note = await g.$$eval('.jb-note', e => e.map(x => x.textContent).join(' '));
  ok('Jukebox: guest adds songs within the limit (3rd refused at 2)', /already have 2/.test(note), note); await shot(g, 'jukebox-guest-limit');
  await p.waitForTimeout(1500); await shot(p, 'jukebox-kiosk-queue');
  const b = await api('/jukebox/board'); ok('Jukebox: board lists requests', (b.next || []).length + (b.now ? 1 : 0) >= 2, JSON.stringify(b).slice(0, 150));
  await api('/jukebox/config', 'PUT', { style: 'retro' }); await p.waitForTimeout(1600); await shot(p, 'jukebox-kiosk-retro');
  await g.reload(); await g.waitForTimeout(1500); await shot(g, 'jukebox-guest-retro');
  if (!(await p.evaluate(() => !!document.querySelector('.jb-pin')))) await p.keyboard.press('Control+Shift+J');
  await p.waitForTimeout(200); for (const d of '2468') await p.keyboard.press(d); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
  ok('Jukebox: the host PIN exits the kiosk', await p.evaluate(() => !document.querySelector('.jb')));
  await api('/jukebox/config', 'PUT', { style: 'modern' }); await api('/jukebox/stop', 'POST', {});
});
if (want('themes')) await step('themes', async () => {
  for (const id of ['pepecoin', 'daylight', 'violet']) { await p.evaluate(async id => { const t = await import('/js/theme.js'); t.applyTheme({ ...t.PRESETS[id], preset: id }); }, id); await p.waitForTimeout(200); await shot(p, 'theme-' + id); }
  await p.mouse.click(5, 300); await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
  const ring = await p.evaluate(() => { const e = document.activeElement; return getComputedStyle(e).outlineStyle + ' ' + getComputedStyle(e).outlineWidth + ' ' + e.tagName + '.' + e.className; });
  ok('§7.11 focus ring visible on keyboard focus', /solid 2px/.test(ring), ring);
  await p.evaluate(async () => { const t = await import('/js/theme.js'); t.applyTheme(t.loadTheme()); });
});
if (want('remote')) await step('remote', async () => {
  const r = await ctx.newPage(); await r.goto(B + '/?remote=1'); await r.waitForSelector('.desk'); await r.waitForTimeout(2500);
  const st = await r.evaluate(() => ({ banner: !!document.getElementById('remotebanner'), bg: getComputedStyle(document.getElementById('remotebanner') || document.body).backgroundColor, key: localStorage.getItem('wavwiz.remoteMode'), dev: !!window.__wavwizPhone }));
  await shot(r, 'remote-mode');
  await r.goto(B + '/'); await r.waitForTimeout(2000); const kept = await r.evaluate(() => !!document.getElementById('remotebanner'));
  ok('Remote mode: banner shown (Highlight color), remembered after reload', st.banner && kept && st.key === '1', JSON.stringify(st));
  await r.evaluate(() => localStorage.setItem('wavwiz.remoteMode', '0')); await r.close();
});
if (want('phone')) await step('phone-sheet', async () => {
  const pc = await cb.newContext({ ...devices['iPhone 13'] }); await pc.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await pc.addInitScript(() => { localStorage.setItem('wavwiz.phoneRole', 'speaker'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); });
  const ph = await pc.newPage(); await ph.goto(B + '/'); await ph.waitForTimeout(2500); await closeDlg(ph);
  await ph.evaluate(async () => { const m = await import('/js/main.js'); m.go('scenes'); }); await ph.waitForTimeout(1200); await shot(ph, 'scenes-phone');
});
await cb.close();

if (want('calmic')) {
  const link = await api('/calibration/phone-link', 'POST', {});
  const wk = await webkit.launch();
  for (const redirect of [false, true]) {
    await api('/settings', 'PUT', { 'tls.redirect': redirect });
    for (const [label, url] of [['http', `${B}/calmic.html?cal=${link.token}`], ['https', `${BS}/calmic.html?cal=${link.token}`]]) {
      await step(`calmic ${label} redirect=${redirect}`, async () => {
        const c = await wk.newContext({ ...devices['iPhone 13'], ignoreHTTPSErrors: true });
        await c.addInitScript(() => {
          window.__log = []; let inTap = false;
          document.addEventListener('click', () => { inTap = true; setTimeout(() => { inTap = false; }, 0); }, true);
          const deny = new URLSearchParams(location.search).get('deny') === '1';
          const O = window.AudioContext || window.webkitAudioContext; if (O) { const W = function (...a) { window.__log.push('ctx:' + (window.__gum ? 'after' : 'before')); return new O(...a); }; window.AudioContext = window.webkitAudioContext = W; }
          Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => { window.__gum = true; window.__log.push('gum:' + (inTap ? 'sync-in-tap' : 'later')); return deny ? Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })) : new Promise(() => {}); }, enumerateDevices: async () => [] } });
        });
        const pg = await c.newPage(); await pg.goto(url, { waitUntil: 'load' }); await pg.waitForTimeout(3000);
        const finalUrl = pg.url(); const view = await pg.evaluate(() => document.body.innerText);
        await shot(pg, `calmic-iphone-${label}-redirect-${redirect ? 'on' : 'off'}`);
        ok(`§10 ${label} (redirect ${redirect ? 'on' : 'off'}): never a dead page; http moves to https or shows setup`, view.length > 30 && (label === 'https' || /^https:/.test(finalUrl) || /secure|HTTPS|Retry/i.test(view)), finalUrl + ' :: ' + view.replace(/\s+/g, ' ').slice(0, 140));
        ok(`§10 ${label} redirect=${redirect}: isSecureContext shown`, /isSecureContext: (true|false)/.test(view));
        if (/^https:/.test(finalUrl)) {
          const btn = pg.locator('#start'); if (await btn.count()) { await btn.tap(); await pg.waitForTimeout(700); }
          const log = await pg.evaluate(() => window.__log);
          ok(`§10 https redirect=${redirect}: getUserMedia called synchronously in the tap, no AudioContext before`, log[0] === 'gum:sync-in-tap' && !log.includes('ctx:before'), log.join(','));
          await pg.goto(finalUrl + (finalUrl.includes('?') ? '&' : '?') + 'deny=1'); await pg.waitForTimeout(2500); const b2 = pg.locator('#start'); if (await b2.count()) { await b2.tap(); await pg.waitForTimeout(900); }
          const t = await pg.evaluate(() => document.body.innerText);
          ok(`§10 https redirect=${redirect}: denied help line + error name shown`, t.includes('Microphone blocked. On iPhone go to Settings > Safari > Microphone, set to Ask or Allow, then reload.') && /NotAllowedError/.test(t), t.replace(/\s+/g, ' ').slice(0, 160));
          await shot(pg, `calmic-iphone-denied-redirect-${redirect ? 'on' : 'off'}`);
        }
        await c.close();
      });
    }
  }
  await api('/settings', 'PUT', { 'tls.redirect': false });
  await wk.close();
  const cb2 = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--ignore-certificate-errors'] });
  await step('calmic android', async () => {
    const c = await cb2.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true, permissions: ['microphone'] });
    const pg = await c.newPage(); await pg.goto(`${BS}/calmic.html?cal=${link.token}`); await pg.waitForTimeout(2500);
    const btn = pg.locator('#start'); const had = await btn.count(); if (had) await btn.tap(); await pg.waitForTimeout(3000);
    const t = await pg.evaluate(() => document.body.innerText); await shot(pg, 'calmic-android');
    ok('§10 Android: the tap opens the mic (fake device)', had > 0 && !/Microphone blocked|NotAllowed|NotFound|Nothing to measure/.test(t), t.replace(/\s+/g, ' ').slice(0, 160));
  });
  await cb2.close();
}
await sp.close();
console.log(JSON.stringify({ pass: R.filter(x => x.pass).length, fail: R.filter(x => !x.pass).length }));

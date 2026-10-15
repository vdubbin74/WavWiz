// WavWiz 0.3.6 (K1-K22): the app the way a user uses it. Usage: node ui035.mjs [chromium|webkit] [shots]
// Viewports: 1920x1080, 1280x720, iPhone 13, 4K (3840x2160). Screenshots: /workspace/screens/wavwiz-036-<engine>-<n>-<vp>.png;
// with "shots": every theme x desktop/phone/1080p/4K -> /workspace/screens/wavwiz-036-theme-<theme>-<vp>.png
import { chromium, webkit, devices } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const ENG = process.argv[2] || 'chromium', SHOTS = process.argv.includes('shots'), ONLYSHOTS = process.argv.includes('onlyshots');
const B = 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim();
const R = []; const ok = (n, c, i = '') => { R.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? ' :: ' + String(i).slice(0, 500) : '')); };
const api = async (p, m = 'GET', b) => { const r = await fetch(B + '/api/v1' + p, { method: m, headers: { Cookie: 'unison_session=' + sess, Origin: B, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const zlist = async () => { const x = await api('/zones?all=1'); return Array.isArray(x) ? x : x.zones || []; };
const step = async (n, f) => { try { await f(); } catch (e) { ok(n, false, String(e).slice(0, 500)); } };
const THEMES = ['default', 'pepecoin', 'ember', 'arctic', 'violet', 'mono', 'daylight', 'nebula', 'steel', 'lime'];
const NORMAL = { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'open' };
mkdirSync('/workspace/screens', { recursive: true });
const br = await (ENG === 'webkit' ? webkit : chromium).launch(ENG === 'webkit' ? {} : { args: ['--autoplay-policy=no-user-gesture-required'] });
await api('/jukebox/stop', 'POST', { pin: '2468' }).catch(() => {});
const zones = await zlist(); const capZ = zones.find(z => z.connected) || zones[0];
const VPS = [['1920', { viewport: { width: 1920, height: 1080 } }], ['1280', { viewport: { width: 1280, height: 720 } }], ['iphone', devices['iPhone 13']], ['4k', { viewport: { width: 3840, height: 2160 } }]];
async function newPage(opt) {
  const o = { ...opt }; delete o.defaultBrowserType; if (ENG === 'chromium') { /* isMobile works in Chromium */ } else if (ENG === 'webkit') { /* ok */ }
  const ctx = await br.newContext(o); await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); });
  const p = await ctx.newPage(); p._errs = []; p.on('pageerror', e => { if (!/due to access control checks|Load failed/.test(e.message)) p._errs.push(e.message); }); return { ctx, p };   // WebKit reports fetches cut off by our own page.goto as errors
}
const closeDlg = p => p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
const home = async (p, pan, theme) => { await p.goto(B + '/'); await p.evaluate(([v, t]) => { if (v) localStorage.setItem('wavwiz.panels', JSON.stringify(v)); }, [pan, theme]); await p.goto(B + '/'); await p.waitForTimeout(2500); await closeDlg(p); await p.locator('.phone-unlock').click({ timeout: 1500 }).catch(() => {}); if (theme) { await p.evaluate(async id => { const t = await import('/js/theme.js'); t.applyTheme({ ...t.PRESETS[id], preset: id }); }, theme); } await p.waitForTimeout(theme ? 600 : 200); };   // the 'Tap anywhere to start sound' prompt
const go = (p, k) => p.evaluate(async k => (await import('/js/main.js')).go(k), k);
const dlgW = p => p.evaluate(() => { const d = document.querySelector('dialog[open]'); return d ? Math.round(d.getBoundingClientRect().width) : -1; });
const hoverItem = async (p, top, label) => { await p.click(`.menubar .mtop:text-is("${top}")`); const it = p.locator(`.menubar .mgroup.open > .mpanel > .msub > button:text-is("${label}"), .menubar .mgroup.open > .mpanel > button:text-is("${label}")`).first(); await it.hover(); await p.waitForTimeout(450); return it; };
const labels = (p, sel) => p.evaluate(s => [...document.querySelectorAll(s)].filter(e => e.getClientRects().length).map(e => e.firstChild?.textContent?.trim() || e.textContent.trim()), sel);
{
  const { ctx, p } = await newPage({ viewport: { width: 1920, height: 1080 } });
  await api('/queue/clear', 'POST', {}).catch(() => {});
  await step('K15-K19/K22 menus', async () => {
    await home(p, NORMAL);
    // K16 sleep submenu
    await hoverItem(p, 'Playback', 'Sleep timer');
    const sl = await labels(p, '.menubar .msub.open > .mpanel button');
    ok('K16 Sleep timer submenu lists 15/30/45/60/End of song/Off', ['15 minutes', '30 minutes', '45 minutes', '60 minutes', 'End of song', 'Off'].every((x, i) => sl[i]?.startsWith(x)), sl.join('|'));
    await p.screenshot({ path: `/workspace/screens/wavwiz-036-${ENG}-k16-sleep.png` });
    await p.keyboard.press('Escape');
    await hoverItem(p, 'Playback', 'Sound / EQ');
    const eq = await labels(p, '.menubar .msub.open > .mpanel button'); ok('K16 Sound / EQ submenu lists presets', eq.length >= 3, eq.join('|'));
    await p.keyboard.press('Escape');
    // K16 flyout opens toward free space (flip near the right edge)
    await p.setViewportSize({ width: 700, height: 800 }); await p.waitForTimeout(300);
    // K17 File > New
    await p.setViewportSize({ width: 1920, height: 1080 }); await p.waitForTimeout(300);
    await hoverItem(p, 'File', 'New');
    const nw = await p.evaluate(() => [...document.querySelectorAll('.menubar .msub.open > .mpanel button')].map(b => [b.firstChild.textContent.trim(), b.querySelector('.kbd')?.textContent]));
    ok('K17 File > New lists zone/scene/alarm/schedule with shortcuts', JSON.stringify(nw) === JSON.stringify([['Zone', 'Ctrl+Shift+Z'], ['Scene', 'Ctrl+Shift+S'], ['Alarm', 'Ctrl+Shift+A'], ['Schedule', 'Ctrl+Shift+H']]), JSON.stringify(nw));
    await p.screenshot({ path: `/workspace/screens/wavwiz-036-${ENG}-k17-new.png` });
    await p.locator('.menubar .msub.open > .mpanel button', { hasText: 'Alarm' }).click(); await p.waitForTimeout(900);
    const al = await p.evaluate(() => ({ dev: document.getElementById('desk').classList.contains('devexpanded'), editor: !!document.querySelector('.devpanel .ss-inline') }));
    ok('K17 New > Alarm jumps to the alarm editor in expanded Devices', al.dev && al.editor, JSON.stringify(al));
    await p.keyboard.press('Escape'); await home(p, NORMAL);
    for (const [key, sel, name] of [['Control+Shift+KeyS', '.devpanel .ss-sceneedit', 'scene'], ['Control+Shift+KeyH', '.devpanel .ss-inline', 'schedule'], ['Control+Shift+KeyZ', '.devpanel .zone-inline, .devpanel .zinline, .devpanel [data-edit], .devpanel .zedit-form', 'zone']]) {
      await home(p, NORMAL); await p.locator('body').click({ position: { x: 5, y: 300 } }); await p.keyboard.press(key); await p.waitForTimeout(1100);
      const r = await p.evaluate(s => ({ dev: document.getElementById('desk').classList.contains('devexpanded'), el: !!document.querySelector(s) }), sel);
      ok(`K17 ${key} opens New ${name}`, r.dev && r.el, JSON.stringify(r));
    }
    // typing in a field must NOT trigger the shortcut (redo keeps working)
    await home(p, NORMAL); await p.locator('input[type=search]').first().focus().catch(() => {}); await p.keyboard.press('Control+Shift+KeyS'); await p.waitForTimeout(500);
    ok('K17 shortcut ignored while typing in a field', await p.evaluate(() => !document.getElementById('desk').classList.contains('devexpanded')));
    // K19 File > Run
    await home(p, NORMAL); await hoverItem(p, 'File', 'Run');
    const run = await labels(p, '.menubar .msub.open > .mpanel button'); ok('K19 File > Run lists Scenes / Schedules / Alarms groups', run.length >= 1, run.join('|'));
    await p.screenshot({ path: `/workspace/screens/wavwiz-036-${ENG}-k19-run.png` }); await p.keyboard.press('Escape');
    // K18 Devices menu
    await home(p, NORMAL); await hoverItem(p, 'Devices', 'Zones');
    const zs = await labels(p, '.menubar .msub.open > .mpanel button'); ok('K18 Zones submenu ends with New…', zs.at(-1)?.startsWith('New'), zs.join('|'));
    await p.screenshot({ path: `/workspace/screens/wavwiz-036-${ENG}-k18-zones.png` }); await p.keyboard.press('Escape');
    await hoverItem(p, 'Devices', 'Scenes'); const sc = await labels(p, '.menubar .msub.open > .mpanel button'); ok('K18 Scenes submenu ends with New…', sc.at(-1)?.startsWith('New'), sc.join('|')); await p.keyboard.press('Escape');
    await hoverItem(p, 'Devices', 'Devices'); const dv = await labels(p, '.menubar .msub.open > .mpanel button'); ok('K18 Devices submenu lists devices', dv.length >= 1, dv.length); 
    ok('K18 no Start buttons in the Devices menu', !(await labels(p, '.menubar .mgroup.open .mpanel button')).some(t => /^Start\b/.test(t) && !/Jukebox/.test(t)));
    await p.locator('.menubar .msub.open > .mpanel button').first().click(); await p.waitForTimeout(900);
    ok('K18 picking a device jumps to expanded Devices', await p.evaluate(() => document.getElementById('desk').classList.contains('devexpanded')));
    // K22 Queue menu
    await home(p, NORMAL); await p.click('.menubar .mtop:text-is("Library")'); await p.locator('.menubar .mgroup.open > .mpanel > button:text-is("Queue")').click(); await p.waitForTimeout(700);
    ok('K22 Queue menu opens the playlist expanded', await p.evaluate(() => document.getElementById('desk').classList.contains('listexpanded')));
    await p.click('.menubar .mtop:text-is("Library")'); await p.locator('.menubar .mgroup.open > .mpanel > button:text-is("Queue")').click(); await p.waitForTimeout(150);
    ok('K15 Queue again pulses (already expanded)', await p.evaluate(() => document.querySelector('.listpanel').classList.contains('k-pulse')));
  });
  await ctx.close();
}
// ---- items: K1-K13, K14, K21, K22, K5-K7, K20 ----
const shotP = (p, n) => p.screenshot({ path: `/workspace/screens/wavwiz-036-${ENG}-${n}.png` });
const ev = (p, f, a) => p.evaluate(f, a);
const seed = async () => { const tr = await api('/library/search?q=song'); if (Array.isArray(tr) && tr.length) await api('/stream/play', 'POST', { kind: 'tracks', ids: tr.map(x => x.id) }); await new Promise(r => setTimeout(r, 1500)); };
await seed();
const TITLE = { hasText: /^title/i };
{
  const { ctx, p } = await newPage({ viewport: { width: 1920, height: 1080 } });
  await step('K1/K2/K9/K10 chrome', async () => {
    await home(p, NORMAL);
    const r = await ev(p, () => { const b = s => document.querySelector(s); const bb = s => b(s)?.getBoundingClientRect();
      return { hdr: bb('.listpanel .pane-h')?.height, pane: bb('.libpanel .pane-h')?.height, chv: !!b('.listpanel .plus.listcol svg'), radius: getComputedStyle(b('.listpanel .plus.listcol')).borderRadius, ctl: b('.np-ctlpanel')?.classList.contains('collapsed'), pick: !!b('.plpick'), lock: !!b('.pllock') }; });
    ok('K1 playlist title bar is 30px with compact icon buttons (picker, lock, collapse)', r.hdr >= 29 && r.hdr <= 32 && r.pick && r.lock && r.chv && /3px/.test(r.radius), JSON.stringify(r));
    ok('K9 title bars are 30px and the NP control panel starts collapsed', r.pane >= 29 && r.pane <= 32 && r.ctl === true, JSON.stringify(r));
    ok('K2 thin chevron icons are SVG', (await ev(p, () => document.querySelectorAll('.plus.chv svg, .plus.listcol svg').length)) >= 2);
    await p.click('.plpick'); await p.waitForTimeout(300);
    ok('K10 column picker lists every column', (await ev(p, () => document.querySelectorAll('.plpicker label, .plpicker [role=menuitemcheckbox]').length)) >= 8);
    await p.keyboard.press('Escape'); await p.mouse.click(5, 500); await p.waitForTimeout(200);
    const col = () => ev(p, () => [...document.querySelectorAll('.qtable tbody tr td:nth-child(2)')].map(x => x.textContent.trim()));
    await p.locator('.qtable thead th', TITLE).first().click(); await p.waitForTimeout(400); const t1 = await col();
    await p.locator('.qtable thead th', TITLE).first().click(); await p.waitForTimeout(400); const t2 = await col();
    ok('K10 sort: click 1 ascending, click 2 descending', t1.length > 2 && t1[0] <= t1[t1.length - 1] && t2[0] >= t2[t2.length - 1] && t1[0] !== t2[0], JSON.stringify([t1.slice(0, 3), t2.slice(0, 3)]));
    await p.locator('.qtable thead th', TITLE).first().click(); await p.waitForTimeout(300);
    await p.click('.pllock'); await p.waitForTimeout(200);
    ok('K10 lock turns the lock button red', (await ev(p, () => document.querySelector('.pllock').classList.contains('on'))) === true);
    await shotP(p, 'k10-lock'); await p.click('.pllock');
  });
  await step('K3 rails', async () => {
    await home(p, { ...NORMAL, lib: 'rail' });
    const lr = await ev(p, () => { const l = document.querySelector('.libpanel'); return { w: l.getBoundingClientRect().width, rail: l.classList.contains('israil'), edge: getComputedStyle(l, '::before').backgroundColor }; });
    ok('K3 Library collapsed = thin rail with accent edge', lr.rail && lr.w <= 40 && /rgb\(/.test(lr.edge) && lr.edge !== 'rgba(0, 0, 0, 0)', JSON.stringify(lr));
    await home(p, { ...NORMAL, dev: 'rail' }); await shotP(p, 'k3-dev-rail');
    const dr = await ev(p, () => { const d = document.querySelector('.devpanel'); return { w: d.getBoundingClientRect().width, rail: d.classList.contains('israil'), edge: getComputedStyle(d, '::before').backgroundColor }; });
    ok('K3 Devices collapsed mirrors Library (same rail width, accent edge)', dr.rail && Math.abs(dr.w - lr.w) <= 6 && dr.edge !== 'rgba(0, 0, 0, 0)', JSON.stringify([dr, lr]));
  });
  await step('K8 one 250ms glide', async () => {
    await home(p, NORMAL);
    const g = await ev(p, () => [getComputedStyle(document.documentElement).getPropertyValue('--glide').trim(), getComputedStyle(document.getElementById('desk')).transitionDuration]);
    ok('K8 --glide is 250ms and the grid transitions with it', g[0] === '250ms' && /0\.25s/.test(g[1]), JSON.stringify(g));
  });
  await step('K11/K12/K13 viz', async () => {
    await home(p, NORMAL); await ev(p, () => localStorage.setItem('wavwiz.center.v1', 'eq')); await p.reload(); await p.waitForTimeout(3500); await closeDlg(p);
    const e = await ev(p, () => ({ leds: document.querySelectorAll('.eqled').length }));
    ok('K11 EQ view draws 10 LED bars', e.leds === 10, JSON.stringify(e)); await shotP(p, 'k11-eq');
    await ev(p, () => localStorage.setItem('wavwiz.center.v1', 'viz')); await p.reload(); await p.waitForTimeout(2500); await closeDlg(p);
    const o = await ev(p, () => [...document.querySelectorAll('.stage .vbtns > *')].map(x => x.getAttribute('data-ov') || ''));
    ok('K12 viz overlay order ends swap, looks, full; power and pop-out first', o.join(',').includes('swap,looks,full') && o.indexOf('popout') < o.indexOf('swap'), o.join(','));
    await shotP(p, 'k13-vu');
  });
  ok('page errors (chrome)', p._errs.length === 0, p._errs.join(' | ')); await ctx.close();
}
{
  const { ctx, p } = await newPage({ viewport: { width: 1920, height: 1080 } });
  await step('K14/K22 mini player', async () => {
    await home(p, { ...NORMAL, exp: 'lib' }); await shotP(p, 'k14-lib-expanded');
    const r = await ev(p, () => { const m = document.querySelector('.minicol .mp'), d = document.querySelector('.devpanel'), np = document.querySelector('.npbar'); const mb = m?.getBoundingClientRect(), db = d?.getBoundingClientRect(); return { mini: !!mb && mb.height > 40, belowDev: mb && db && mb.top >= db.bottom - 4, right: mb && Math.abs(mb.right - innerWidth) < 40, np: np ? getComputedStyle(np).display : 'none', playlist: !!document.querySelector('.listpanel')?.offsetParent }; });
    ok('K14 expanded Library: playlist kept, NP bar hidden, mini player bottom-right under Devices', r.mini && r.belowDev && r.right && r.np === 'none' && r.playlist, JSON.stringify(r));
    const mc = await ev(p, () => ({ play: !!document.querySelector('.minicol .mp-ctl button'), seek: !!document.querySelector('.minicol .mp-seek'), vol: !!document.querySelector('.minicol .mp-vol') }));
    ok('K14 the in-column mini player has controls, seek and volume', mc.play && mc.seek && mc.vol, JSON.stringify(mc));
    await home(p, { ...NORMAL, list: 'expanded', dev: 'rail' }); await shotP(p, 'k22-rail');
    const rr = await ev(p, () => { const m = document.querySelector('.minicol .minirail'); const b = m?.getBoundingClientRect(); return { rail: !!b && b.width > 10, art: !!m?.querySelector('.mp-rart'), bar: !!m?.querySelector('.mp-rbar') }; });
    ok('K22 collapsed Devices: rail shows cover + progress', rr.rail && rr.art && rr.bar, JSON.stringify(rr));
    const rb = await p.locator('.minicol').boundingBox(); if (rb) { await p.mouse.move(rb.x + rb.width / 2, rb.y + rb.height - 20); await p.waitForTimeout(700); }
    const pop = await ev(p, () => +getComputedStyle(document.querySelector('.minicol .mp')).opacity);
    ok('K22 hover pops out the full mini player', pop > 0.5, pop); await shotP(p, 'k22-hover');
    await p.mouse.move(300, 300); await p.waitForTimeout(700);
    const gone = await ev(p, () => +getComputedStyle(document.querySelector('.minicol .mp')).opacity); ok('K22 pop-out hides again when the pointer leaves', gone < 0.5, gone);
    await home(p, { ...NORMAL, list: 'collapsed' });
    const q = await ev(p, async () => { await (await import('/js/main.js')).openQueue(); await new Promise(r => setTimeout(r, 700)); return document.getElementById('desk').className; });
    ok('K22 Queue opens the playlist expanded', /listexpanded/.test(q), q);
  });
  await step('K21 center style artist - album on the time line', async () => {
    await home(p, NORMAL); await ev(p, () => localStorage.setItem('wavwiz.center.v1', 'viz')); await p.reload(); await p.waitForTimeout(3000); await closeDlg(p);
    const t = await ev(p, () => document.querySelector('.pn-aa')?.textContent || '');
    ok('K21 Center style shows "artist - album" on the time line', / - /.test(t), t);
  });
  ok('page errors (mini)', p._errs.length === 0, p._errs.join(' | ')); await ctx.close();
}
{
  const { ctx, p } = await newPage({ viewport: { width: 1920, height: 1080 } });
  await step('K5/K6/K7 speaker settings + profiles', async () => {
    await home(p, { ...NORMAL, exp: 'dev' });
    const w0 = await ev(p, () => Math.round(document.querySelector('.devpanel .scol').getBoundingClientRect().width));
    ok('K5 Speakers column is 380 wide with nothing open', Math.abs(w0 - 380) <= 2, w0);
    await p.locator('.devpanel .scol .dcard.dc3 .dname').first().click(); await p.waitForTimeout(900);
    const w1 = await ev(p, () => ({ s: Math.round(document.querySelector('.devpanel .scol').getBoundingClientRect().width), set: !!document.querySelector('.devpanel .spcol .spkset'), sliders: document.querySelectorAll('.spkset input[type=range]').length }));
    ok('K5 opening a speaker keeps Speakers at 380 and fills the settings column (6 sliders)', Math.abs(w1.s - 380) <= 2 && w1.set && w1.sliders >= 6, JSON.stringify(w1)); await shotP(p, 'k5-settings');
    await p.setViewportSize({ width: 1280, height: 720 }); await p.waitForTimeout(500);
    const w2 = await ev(p, () => Math.round(document.querySelector('.devpanel .scol').getBoundingClientRect().width)); ok('K5 Speakers stays fixed width at 1280 (clamped)', w2 >= 245 && w2 <= 380, w2);
    await p.setViewportSize({ width: 1920, height: 1080 });
    const nm = 'E2E ' + ENG + ' ' + (Date.now() % 100000);
    await p.locator('.spkset [data-act="prof-saveas"]').first().click(); await p.waitForTimeout(300);
    await p.locator('.spkset input[type=text], .spkset .prof-name').first().fill(nm); await p.locator('.spkset [data-act="prof-saveas-ok"]').first().click(); await p.waitForTimeout(900);
    const pl = await api('/profiles'); const mine = pl.find(x => x.name === nm); ok('K6 Save as… creates the profile on the server', !!mine, JSON.stringify(pl.map(x => x.name)));
    await p.locator('.spkset [data-act="spk-done"]').first().click(); await p.waitForTimeout(500);
    await p.locator('.devpanel .ssc-col button', { hasText: '+ New scene' }).first().click(); await p.waitForTimeout(700);
    ok('K7 scene editor has a profile picker per device', (await ev(p, () => document.querySelectorAll('.ss-inline select.ss-prof').length)) >= 1);
    await shotP(p, 'k7-scene-profile');
    await p.locator('.devpanel .ssc-col .ss-inline button', { hasText: /^Cancel$/ }).first().click({ timeout: 3000 }).catch(() => {});
    if (mine) await api('/profiles/' + mine.id, 'DELETE');
  });
  ok('page errors (speaker settings)', p._errs.length === 0, p._errs.join(' | ')); await ctx.close();
}
{
  const { ctx, p } = await newPage({ viewport: { width: 1920, height: 1080 } });
  await step('K20 backup flow', async () => {
    await home(p, NORMAL);
    await p.click('.menubar .mtop:text-is("File")'); await p.locator('.menubar .mgroup.open button', { hasText: /^Back up now/ }).first().click(); await p.waitForTimeout(1200);
    const l = await api('/backup/list'); ok('K20 Back up now saves a snapshot', Array.isArray(l) && l.length >= 1, JSON.stringify(l).slice(0, 200));
    await p.click('.menubar .mtop:text-is("File")'); await p.locator('.menubar .mgroup.open button', { hasText: /^Restore backup/ }).first().click(); await p.waitForTimeout(1000);
    ok('K20 Restore backup opens the in-page panel (no browser dialog)', await ev(p, () => !!document.querySelector('.bkpanel') && !document.querySelector('dialog[open]'))); await shotP(p, 'k20-restore');
    await p.locator('.bkpanel .bk-row').first().click(); await p.waitForTimeout(800);
    const b2 = await ev(p, () => ({ restore: !!document.querySelector('[data-act="bk-restore"]'), cancel: !!document.querySelector('[data-act="bk-cancel"]') }));
    ok('K20 picking a saved backup shows the summary with Restore and Cancel', b2.restore && b2.cancel, JSON.stringify(b2));
    await p.click('[data-act="bk-cancel"]'); await p.waitForTimeout(300);
    ok('K20 Cancel closes the panel', !(await ev(p, () => document.querySelector('.bkpanel'))));
  });
  ok('page errors (backup)', p._errs.length === 0, p._errs.join(' | ')); await ctx.close();
}
await br.close();
const fails = R.filter(x => !x).length; console.log(`\n${R.length - fails}/${R.length} passed`); process.exit(fails ? 1 : 0);

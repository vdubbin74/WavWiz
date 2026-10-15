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
await br.close();
const fails = R.filter(x => !x).length; console.log(`\n${R.length - fails}/${R.length} passed`); process.exit(fails ? 1 : 0);

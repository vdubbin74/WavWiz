// WavWiz 0.3.5 (J1-J12, J16 web menus, J17 web part): the app the way a user uses it. Usage: node ui035.mjs [chromium|webkit] [shots]
// Viewports: 1920x1080, 1280x720, iPhone 13, 4K (3840x2160). Screenshots: /workspace/screens/wavwiz-035-<engine>-<n>-<vp>.png;
// with "shots": every theme x desktop/phone/1080p/4K -> /workspace/screens/wavwiz-035-theme-<theme>-<vp>.png
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
for (const [tag, opt] of (ONLYSHOTS ? [] : VPS)) {
  const { ctx, p } = await newPage(opt); const phone = tag === 'iphone';
  const shot = n => p.screenshot({ path: `/workspace/screens/wavwiz-035-${ENG}-${n}-${tag}.png` });
  await step(`[${tag}] J1/J2 settings`, async () => {
    await home(p, NORMAL); await go(p, 'settings:theme'); await p.waitForTimeout(1200); await shot('settings-theme');
    const r = await p.evaluate(() => { const d = document.querySelector('dialog[open].settings-dlg'); const nav = [...d.querySelectorAll('.settings-nav button')].map(b => b.textContent.trim());
      const pw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--popw')); return { w: Math.round(d.getBoundingClientRect().width), pw, nav, size: /Display size/.test(d.querySelector('.settings-sec.on')?.textContent || ''), mini: !!d.querySelector('.minicard input[type=range]') }; });
    ok(`[${tag}] J2 no Display size category; size picker on the Theme page`, !r.nav.some(n => /Display size/i.test(n)) && r.size, r.nav.join('|'));
    ok(`[${tag}] J17 Settings > Appearance has the mini player Transparency slider`, r.mini);
    const ws = [r.w];
    for (const s of ['general', 'diag', 'about']) { await closeDlg(p); await go(p, 'settings:' + s); await p.waitForTimeout(800); ws.push(await dlgW(p)); }
    await closeDlg(p); p.evaluate(async () => (await import('/js/util.js')).ask?.('Test?', 'A short one')).catch(() => {}); await p.waitForTimeout(500);
    const aw = await dlgW(p); if (aw > 0) ws.push(aw); await closeDlg(p);
    ok(`[${tag}] J1 every popup the same fixed width`, new Set(ws).size === 1 && (phone || Math.abs(ws[0] - r.pw) <= 2), `${ws.join(',')} popw ${r.pw}`);
    if (!phone) { await p.setViewportSize({ width: opt.viewport.width - 120, height: opt.viewport.height }); await p.waitForTimeout(300); await go(p, 'settings:general'); await p.waitForTimeout(800); const w2 = await dlgW(p);
      ok(`[${tag}] J1 width does not stretch with the window`, Math.abs(w2 - ws[0]) <= 2 || w2 <= opt.viewport.width - 120 - 32 + 1, `${ws[0]} -> ${w2}`); await closeDlg(p); await p.setViewportSize(opt.viewport); }
  });
  if (!phone) {
    await step(`[${tag}] J3/J4 cards`, async () => {
      await api(`/zones/${capZ.id}/volcap`, 'PUT', { cap: 40, locked: true }); await api(`/zones/${capZ.id}`, 'PATCH', { volume: 30 });
      await home(p, NORMAL); await shot('devices-standard');
      const r = await p.evaluate(() => { const cards = [...document.querySelectorAll('.devpanel .dcard.dc3')].filter(c => c.offsetParent);
        const hs = cards.map(c => Math.round(c.getBoundingClientRect().height)); const pills = cards.map(c => c.querySelector('.onpill')).filter(Boolean);
        const capped = [...document.querySelectorAll('.devpanel .vbar.capped')].filter(c => c.offsetParent);
        return { n: cards.length, hs: [...new Set(hs)], pills: pills.length, pillTxt: pills[0]?.textContent, capped: capped.length, tags: cards.slice(0, 3).map(c => c.querySelector('.dc3l2')?.textContent.trim()), mutes: cards.filter(c => c.querySelector('.dc3l3 button')).length,
          r: cards[0] ? getComputedStyle(cards[0]).borderTopLeftRadius : '' }; });
      ok(`[${tag}] J4 three-line cards (~56px), labeled OFF|ON pills, bar + mute`, r.n > 0 && r.hs.every(x => x >= 54 && x <= 60) && r.pills === r.n && /OFF/.test(r.pillTxt) && /ON/.test(r.pillTxt) && r.mutes === r.n, JSON.stringify(r));
      ok(`[${tag}] J12 cards 3px corners`, r.r === '3px', r.r);
      ok(`[${tag}] J3 capped bar visibly different`, r.capped >= 1, JSON.stringify(r.tags));
      const v = await p.evaluate(() => { const i = document.querySelector('.devpanel .vbar.capped input[type=range]'); if (!i) return null; i.value = '95'; i.dispatchEvent(new Event('input', { bubbles: true })); const m = i.closest('.vbar'); return { v: +i.value, cap: +i.dataset.cap, marker: getComputedStyle(m).getPropertyValue('--cap').trim() }; });
      ok(`[${tag}] J3 dragging stops at the cap`, v && v.v <= v.cap && v.cap === 40, JSON.stringify(v));
      await p.waitForTimeout(600); let z = (await zlist()).find(x => x.id === capZ.id); ok(`[${tag}] J3 server keeps the speaker at or below the cap`, z.volume <= 40, z.volume);
      await api('/zones/master', 'POST', { set: 100 }); z = (await zlist()).find(x => x.id === capZ.id); ok(`[${tag}] J3 master volume respects the cap`, z.volume <= 40, z.volume);
      await api('/zones/master', 'POST', { set: 40 });
    });
    await step(`[${tag}] J5-J7 expanded devices`, async () => {
      await home(p, { ...NORMAL, exp: 'dev' }); await shot('devices-expanded');
      const r = await p.evaluate(() => { const g = s => document.querySelector('.devpanel ' + s)?.getBoundingClientRect(); const a = g('.sscol'), b = g('.zcol'), c = g('.scol'), d = document.querySelector('.devpanel').getBoundingClientRect();
        return { a: a && [a.left, a.right], b: b && [b.left, b.right], c: c && [c.left, c.right], d: [d.left, d.right], page: document.documentElement.scrollWidth <= innerWidth + 1, np: document.querySelector('.npbar')?.getBoundingClientRect().height > 0 }; });
      ok(`[${tag}] J5 Scenes & Schedules | Zones | Speakers (Speakers on the right)`, r.a && r.b && r.c && r.a[0] < r.b[0] && r.b[0] < r.c[0] && Math.abs(r.c[1] - r.d[1]) < 40 && r.page && r.np, JSON.stringify(r));
      await p.locator('.devpanel .scol .dcard.dc3 .dname').first().click(); await p.waitForTimeout(800);
      const s6 = await p.evaluate(() => ({ dlg: !!document.querySelector('dialog[open]'), col: !!document.querySelector('.devpanel .spcol .spkset'), w: Math.round(document.querySelector('.devpanel .spcol')?.getBoundingClientRect().width || 0) }));
      ok(`[${tag}] J6 speaker settings open in place (0.3.6 K5: the settings column, no window)`, !s6.dlg && s6.col && s6.w > 200, JSON.stringify(s6));
      await shot('devices-expanded-settings');
      await p.locator('.spkset [data-act="spk-done"]').first().click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(600);
      const t7 = await p.evaluate(() => document.querySelector('.devpanel .ssc-col')?.textContent || '');
      ok(`[${tag}] J7 scenes & schedules column has the create buttons`, ['+ From current setup', '+ New scene', '+ Alarm', '+ New schedule'].every(x => t7.includes(x)), t7.slice(0, 200));
      await p.locator('.spkset [data-act="spk-done"]').first().click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(600);   // 0.3.6 K5: Done closes the settings column and brings the Scenes column back
      await p.locator('.devpanel .ssc-col button', { hasText: '+ New scene' }).first().click(); await p.waitForTimeout(600);
      const e7 = await p.evaluate(() => ({ dlg: !!document.querySelector('dialog[open]'), inl: !!document.querySelector('.devpanel .ssc-col .ss-inline') }));
      ok(`[${tag}] J7 new scene edits inline`, !e7.dlg && e7.inl, JSON.stringify(e7)); await shot('scene-inline');
      await p.locator('.devpanel .ssc-col .ss-inline button', { hasText: /^Cancel$/ }).first().click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(300);
      await p.locator('.devpanel .ssc-col button', { hasText: '+ New schedule' }).first().click(); await p.waitForTimeout(600);
      const e7b = await p.evaluate(() => ({ dlg: !!document.querySelector('dialog[open]'), pill: !!document.querySelector('.devpanel .ssc-col .ss-inline :is(.onpill,.sw,.switch)') }));
      ok(`[${tag}] J7 new schedule edits inline with an Enabled pill`, !e7b.dlg && e7b.pill, JSON.stringify(e7b)); await shot('schedule-inline');
    });
    await step(`[${tag}] J8/J9/J16 menu routes`, async () => {
      await home(p, NORMAL); await go(p, 'scenes'); await p.waitForTimeout(900);
      const r = await p.evaluate(() => ({ exp: document.querySelector('.desk')?.classList.contains('devexpanded'), dlg: !!document.querySelector('dialog[open]') }));
      ok(`[${tag}] J8 Scenes & Schedules opens expanded Devices, no window`, r.exp && !r.dlg, JSON.stringify(r));
      await home(p, NORMAL); await go(p, 'diag'); await p.waitForTimeout(900);
      ok(`[${tag}] J9 Diagnostics is a Settings section`, await p.evaluate(() => !!document.querySelector('dialog[open].settings-dlg')));
      await closeDlg(p);
      const m = await p.evaluate(() => [...document.querySelectorAll('.menubar button')].map(b => b.textContent.trim()).filter(Boolean));
      ok(`[${tag}] J16 menu bar File / Library / Playback / Devices / Help`, ['File', 'Library', 'Playback', 'Devices', 'Help'].every(x => m.some(y => y.startsWith(x))), m.slice(0, 8).join('|'));
    });
    await step(`[${tag}] J10/J11 library`, async () => {
      await home(p, { ...NORMAL, exp: 'lib' });
      await p.locator('.libpanel button', { hasText: /^Genres$/ }).first().click(); await p.waitForTimeout(1500); await shot('library-genres');
      const r = await p.evaluate(() => { const t = [...document.querySelectorAll('.libpanel .tile')].filter(x => x.offsetParent); const lp = document.querySelector('.listpanel'); const c = t[0]?.querySelector('.gcount b, .tcount');
        return { n: t.length, w: t[0] ? Math.round(t[0].getBoundingClientRect().width) : 0, svg: !!t[0]?.querySelector('svg'), cnt: c?.textContent, fs: c ? parseFloat(getComputedStyle(c).fontSize) : 0, fw: c ? getComputedStyle(c).fontWeight : '', list: !!(lp && lp.offsetParent && lp.getBoundingClientRect().width > 200), dev: !!document.querySelector('.devpanel')?.offsetParent && document.querySelector('.devpanel').getBoundingClientRect().width > 40 }; });   // 0.3.8 L33: the 30px sleeve is always visible
      ok(`[${tag}] J10 genre tiles: theme pattern art + legible count`, r.n > 0 && r.svg && /song/.test(r.cnt || '') && r.fs >= 11 && +r.fw >= 600, JSON.stringify(r));
      ok(`[${tag}] J11 expanded Library keeps the playlist column, ~132px tiles`, r.list && !r.dev && Math.abs(r.w - 132) <= 12, JSON.stringify(r));
      await p.locator('.libpanel button', { hasText: /^Years$/ }).first().click(); await p.waitForTimeout(1500); await shot('library-years');
      const y = await p.evaluate(() => [...document.querySelectorAll('.libpanel .dtile')].filter(x => x.offsetParent).length); const yrs = (await api('/library/years')).filter?.(r => +r.name > 0).length || 0; ok(`[${tag}] J10 Years open as decade tiles` + (yrs ? '' : ' (fixture has no years: no tiles expected)'), yrs ? y >= 1 : y === 0, `${y} tiles, ${yrs} years`);
      ok(`[${tag}] J11 (0.3.6 K14: the Devices swap is replaced by the in-column mini player)`, await p.evaluate(() => document.querySelector('.desk').classList.contains('libexpanded') && !!document.querySelector('.minicol .mp')?.offsetParent));
    });
    await step(`[${tag}] J12 consistent controls`, async () => {
      await home(p, NORMAL); await go(p, 'settings:general'); await p.waitForTimeout(900); await shot('settings-general');
      const r = await p.evaluate(() => { const d = document.querySelector('dialog[open]'); const sw = [...d.querySelectorAll('.switch,.sw')].filter(x => x.offsetParent); const btn = [...d.querySelectorAll('button.btn')].filter(x => x.offsetParent);
        return { sw: sw.length, swTxt: sw.slice(0, 2).map(x => (x.textContent.trim() + getComputedStyle(x, '::before').content + getComputedStyle(x, '::after').content + getComputedStyle(x.querySelector('span,i') || x, '::before').content)), r: [...new Set([...sw, ...btn, d].map(x => getComputedStyle(x).borderTopLeftRadius))] }; });
      ok(`[${tag}] J12 toggles/buttons/dialog all 3px corners`, r.r.length === 1 && r.r[0] === '3px', JSON.stringify(r));
      ok(`[${tag}] J12 toggles are labeled ON/OFF`, r.sw === 0 || r.swTxt.every(t => /ON|OFF/.test(t)), JSON.stringify(r.swTxt));
      await closeDlg(p);
      const q = await p.evaluate(() => { const th = document.querySelector('.qtable thead th'); return { th: th && getComputedStyle(th).color, r: th && getComputedStyle(document.querySelector('.qtable')).borderTopLeftRadius }; });
      ok(`[${tag}] J12 playlist table themed header`, !!q.th, JSON.stringify(q));
    });
  } else {
    await step(`[${tag}] phone`, async () => {
      await home(p, NORMAL); await go(p, 'devices'); await p.waitForTimeout(1500); await shot('phone-devices');
      const r = await p.evaluate(() => ({ cards: [...document.querySelectorAll('.dcard.dc3')].filter(c => c.offsetParent).length, page: document.documentElement.scrollWidth <= innerWidth + 1 }));
      ok(`[${tag}] J4 phone devices page uses the 3-line cards, no side scroll`, r.cards > 0 && r.page, JSON.stringify(r));
    });
  }
  ok(`[${tag}] no page errors`, p._errs.length === 0, p._errs.join(' | '));
  await ctx.close();
}
if (!ONLYSHOTS) await step('J17 mini player', async () => {
  const { ctx, p } = await newPage({ viewport: { width: 380, height: 150 } }); await p.goto(B + '/mini.html'); await p.waitForTimeout(2000);
  await p.locator('.mp-op').click(); await p.waitForTimeout(300);
  const r = await p.evaluate(() => { const row = document.querySelector('.mp-oprow'); return { vis: !!row && !row.hidden && row.getBoundingClientRect().width > 0, lab: row?.textContent }; });
  ok('J17 mini player shows a labeled Transparency control', r.vis && /Transparency/.test(r.lab) && /%/.test(r.lab), JSON.stringify(r));
  await p.locator('.mp-oprow input').fill('40'); await p.mouse.move(100, 60); await p.waitForTimeout(300);
  const o = await p.evaluate(() => { const els = [document.documentElement, document.body, ...document.body.children]; return Math.min(...els.map(e => Math.round(parseFloat(getComputedStyle(e).opacity) * 100))); });
  ok('J17 live preview while adjusting (does not go solid on hover)', o === 40, o);
  await p.screenshot({ path: `/workspace/screens/wavwiz-035-${ENG}-mini-transparency.png` });
  await p.evaluate(() => localStorage.setItem('wavwiz.mini.opacity', '100')); await ctx.close();
});
if (SHOTS || ONLYSHOTS) {
  const SV = [['1080p', VPS[0][1]], ['4k', VPS[3][1]], ['phone', VPS[2][1]]];
  for (const th of THEMES) for (const [tag, opt] of SV) await step(`shots ${th} ${tag}`, async () => {
    const { ctx, p } = await newPage(opt); await home(p, NORMAL, th); await p.screenshot({ path: `/workspace/screens/wavwiz-035-theme-${th}-${tag}.png` });
    if (tag === '1080p') { for (const [n, pan] of [['desktop-devices', { ...NORMAL, exp: 'dev' }], ['desktop-library', { ...NORMAL, exp: 'lib' }]]) { await home(p, pan, th); await p.screenshot({ path: `/workspace/screens/wavwiz-035-theme-${th}-${n}.png` }); }
      await home(p, NORMAL, th); await go(p, 'settings:theme'); await p.waitForTimeout(1000); await p.screenshot({ path: `/workspace/screens/wavwiz-035-theme-${th}-desktop-settings.png` }); }
    await ctx.close(); });
  await (async () => { const { ctx, p } = await newPage(VPS[0][1]); await home(p, NORMAL, 'default'); await ctx.close(); })();
}
await api(`/zones/${capZ.id}/volcap`, 'PUT', { cap: capZ.volCap ?? 100, locked: !!capZ.volLocked });   // put the fixture back
await br.close();
console.log(`\n${ENG}: ${R.filter(Boolean).length}/${R.length} passed`); process.exit(R.every(Boolean) ? 0 : 1);

// WavWiz 0.3.7 (L1-L26): the app the way a user uses it. Usage: node ui035.mjs [chromium|webkit] [shots]
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
const ZSTUB = async p => p.route('**/api/v1/zones*', async route => { try { const r = await route.fetch(); let z = await r.json(); if (Array.isArray(z) && z.length) { z = z.slice(0, 5); z[0] = { ...z[0], outputs: [{ deviceId: 'e2e-dev', name: 'E2E Speaker', connected: true, active: true, kind: 'wired' }] }; } await route.fulfill({ response: r, json: z });  } catch { /* page closed */ } });
const hoverItem = async (p, top, label) => { await p.click(`.menubar .mtop:text-is("${top}")`); const it = p.locator(`.menubar .mgroup.open > .mpanel > .msub > button:text-is("${label}"), .menubar .mgroup.open > .mpanel > button:text-is("${label}")`).first(); await it.hover(); await p.waitForTimeout(450); return it; };
// ---- 0.3.7 items (L1-L30) the way a user uses them ----
const unlockQ = p => p.evaluate(() => { const k = ['wavwiz.plcols.v1', 'wavwiz.plcols.narrow.v1']; for (const x of Object.keys(localStorage)) if (/plcol|queuecols|pl\.layout/i.test(x)) { try { const v = JSON.parse(localStorage.getItem(x)); v.locked = false; localStorage.setItem(x, JSON.stringify(v)); } catch { /* ignore */ } } });
await api('/queue/clear', 'POST', {}).catch(() => {});
for (let i = 0; i < 1; i++) { /* the library has songs; queue some */ }
await step('queue seed', async () => { const lib = await api('/library/tracks?limit=50'); await api('/queue/add', 'POST', { kind: 'tracks', ids: lib.slice(0, 8).map(t => t.id) }); ok('L27 queue seeded', (await api('/stream')).queue.items.length >= 3); });
await step('L27/L29/L30 queue lock, sort, chip, drag (desktop)', async () => {
  const { ctx, p } = await newPage({ viewport: { width: 1920, height: 1080 } }); await home(p, NORMAL); await unlockQ(p); await p.reload(); await p.waitForTimeout(2500); await closeDlg(p);
  const n = await p.locator('.qtable tbody tr[data-i]').count(); ok('queue has rows', n >= 3, n);
  // L30: sort by Title -> accent header, arrow, chip
  await p.click('.qtable th[data-col=title]'); await p.waitForTimeout(300);
  const st = await p.evaluate(() => { const th = document.querySelector('.qtable th[data-col=title]'), chip = document.querySelector('.sortchip'); const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); return { cls: th.className, arrow: th.querySelector('.sortar')?.textContent, chip: chip && !chip.hidden ? chip.textContent : null, col: getComputedStyle(th).color, acc, chipBorder: chip ? getComputedStyle(chip).borderTopColor : '' }; });
  ok('L30 sorted column highlighted with arrow', /sorted/.test(st.cls) && st.arrow === '▲', JSON.stringify(st)); ok('L30 Sorted by chip', /^Sorted by Title ▲/.test(st.chip || ''), st.chip);
  await p.screenshot({ path: `/workspace/screens/wavwiz-037-${ENG}-l30-sorted.png` });
  // L29: while a sort is showing a drag asks to apply it
  await p.dragAndDrop('.qtable tbody tr[data-i]:nth-child(1)', '.qtable tbody tr[data-i]:nth-child(3)').catch(() => {}); await p.waitForTimeout(500);
  const dlg = await p.evaluate(() => document.querySelector('dialog[open]')?.textContent || '');
  ok('L29 a drag under a sort asks "Apply this sort as the queue order?"', /Apply this sort as the queue order\?/.test(dlg), dlg.slice(0, 120));
  await closeDlg(p);
  // chip x clears the sort
  await p.click('.sortclear, .sortchip-x'); await p.waitForTimeout(200); ok('L30 chip clear removes the sort', await p.evaluate(() => document.querySelector('.sortchip')?.hidden === true));
  // L27: lock -> sorting, chip clear, Clear queue and dragging are disabled
  await p.click('.qtable th[data-col=artist]'); await p.waitForTimeout(150);
  await p.click('.pllock'); await p.waitForTimeout(300);
  const lk = await p.evaluate(() => ({ thDis: document.querySelector('.qtable th[data-col=title]').getAttribute('aria-disabled'), chipX: document.querySelector('.sortchip-x')?.disabled, clear: document.querySelector('[data-act=clearqueue]')?.disabled, drag: document.querySelector('.qtable tbody tr[data-i]')?.draggable, grip: !!document.querySelector('.qgrip') }));
  ok('L27 locked: sort headers disabled', lk.thDis === 'true', JSON.stringify(lk)); ok('L30 locked: chip clear + Clear queue disabled', lk.chipX === true && lk.clear === true, JSON.stringify(lk)); ok('L29 locked: rows not draggable, no grip', lk.drag === false && !lk.grip, JSON.stringify(lk));
  await p.evaluate(() => document.querySelector('.qtable th[data-col=title]').click()); await p.waitForTimeout(150); ok('L27 locked: a header click changes nothing', /Sorted by Artist/.test(await p.evaluate(() => document.querySelector('.sortchip')?.textContent || '')));
  await p.evaluate(() => document.querySelector('.plpick').click()); await p.waitForTimeout(250); ok('L27 locked: sort options in the picker disabled', await p.evaluate(() => [...document.querySelectorAll('.plpicker .plp-sort')].length > 2 && [...document.querySelectorAll('.plpicker .plp-sort')].every(b => b.disabled)));
  await p.screenshot({ path: `/workspace/screens/wavwiz-037-${ENG}-l27-locked.png` }); await p.keyboard.press('Escape');
  await p.evaluate(() => document.querySelector('.pllock').click()); await p.waitForTimeout(300);
  const ul = await p.evaluate(() => ({ thDis: document.querySelector('.qtable th[data-col=title]').getAttribute('aria-disabled'), clear: document.querySelector('[data-act=clearqueue]')?.disabled, drag: document.querySelector('.qtable tbody tr[data-i]')?.draggable }));
  ok('L27 unlocked: everything is back', !ul.thDis && !ul.clear, JSON.stringify(ul));
  // plain reorder without a sort (drag first row after the third)
  await p.click('.sortchip-x').catch(() => {}); await p.waitForTimeout(200);
  const before = (await api('/stream')).queue.items.map(x => x.title);
  await p.dragAndDrop('.qtable tbody tr[data-i]:nth-child(1)', '.qtable tbody tr[data-i]:nth-child(4)', { targetPosition: { x: 40, y: 18 } }).catch(() => {}); await p.waitForTimeout(900);
  const after = (await api('/stream')).queue.items.map(x => x.title); ok('L29 desktop drag reorders', before.join() !== after.join(), before.slice(0, 4).join('|') + ' -> ' + after.slice(0, 4).join('|'));
  await ctx.close();
});
await step('L29 phone Queue grip drag + lock', async () => {
  const { ctx, p } = await newPage(VPS[2][1]); await home(p, null); await go(p, 'queue'); await p.waitForTimeout(1200);
  const g = await p.locator('.qlist .qgrip').count(); ok('L29 phone Queue has a grip per row', g >= 3, g);
  const before = (await api('/stream')).queue.items.map(x => x.title);
  const a = await p.locator('.qlist .item').nth(0).boundingBox(), b = await p.locator('.qlist .item').nth(3).boundingBox(), gr = await p.locator('.qlist .qgrip').nth(0).boundingBox();
  await p.mouse.move(gr.x + 5, gr.y + 5); await p.mouse.down(); await p.mouse.move(gr.x + 5, b.y + b.height - 4, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(1200);
  const after = (await api('/stream')).queue.items.map(x => x.title); ok('L29 phone drag reorders the queue', before.join() !== after.join(), before.slice(0, 4).join('|') + ' -> ' + after.slice(0, 4).join('|'));
  await p.screenshot({ path: `/workspace/screens/wavwiz-037-${ENG}-l29-phone-queue.png` });
  await p.click('[data-act=phonelock]'); await p.waitForTimeout(500);
  ok('L29 phone locked: no grips, no arrows', await p.evaluate(() => !document.querySelector('.qlist .qgrip') && !document.querySelector('.qlist [aria-label="Move up"]')));
  await p.click('[data-act=phonelock]'); await p.waitForTimeout(400); ok('L29 phone unlocked again', await p.evaluate(() => !!document.querySelector('.qlist .qgrip')));
  ok('phone no page errors', !p._errs.length, p._errs.join('|')); await ctx.close();
});
await step('L1/L4/L5/L8/L11/L17 Home + pins + front', async () => {
  const { ctx, p } = await newPage({ viewport: { width: 1920, height: 1080 } }); await p.addInitScript(() => localStorage.removeItem('wavwiz.pins.v1')); await home(p, NORMAL);
  ok('Home button in the far right of the Now Playing panel', await p.evaluate(() => { const h = document.querySelector('.np-ctlpanel .schome'); if (!h) return false; const r = h.getBoundingClientRect(), pr = h.closest('.np-ctlpanel').getBoundingClientRect(); return r.right > pr.right - 90; }));
  // pin Sound / EQ from the menu
  await hoverItem(p, 'Playback', 'Sound / EQ').catch(() => {}); await p.evaluate(() => document.querySelector('.menubar .mpin[data-pin=eq]')?.click()); await p.waitForTimeout(300); await p.keyboard.press('Escape');
  ok('pin from the menu row adds a shortcut', await p.evaluate(() => !!document.querySelector('.np-ctlpanel .scpin[data-sc=eq]')));
  // max 3
  await p.evaluate(async () => { const m = await import('/js/shortcuts.js'); m.pinToggle('queue'); m.pinToggle('library'); const r = m.pinToggle('devices'); window.__full = r.full; });
  ok('a 4th pin is refused', await p.evaluate(() => window.__full === true) && (await p.locator('.np-ctlpanel .scpin').count()) === 3);
  const order = await p.evaluate(() => [...document.querySelectorAll('.np-ctlpanel .scrow > *')].map(x => x.dataset.sc || 'sep')); ok('pins stack leftward of Home, first pin nearest', order.join() === 'library,queue,eq,sep,home'.replace('library,queue,eq', 'library,queue,eq') , order.join());
  // L4/L17: from expanded Devices, pin Queue brings the queue forward; Home restores the default screen
  await p.evaluate(() => localStorage.setItem('wavwiz.pins.v1', JSON.stringify(['queue']))); await p.evaluate(v => localStorage.setItem('wavwiz.panels', JSON.stringify(v)), { ...NORMAL, exp: 'dev' }); await p.evaluate(() => { window.onbeforeunload = null; }); await p.context().addInitScript(() => { localStorage.setItem('wavwiz.pins.v1', JSON.stringify(['queue'])); }); await p.goto(B + '/'); await p.waitForTimeout(2800); await p.evaluate(() => document.querySelector('.np-ctlpanel .scpin[data-sc=queue], .npbar .scpin[data-sc=queue]')?.click()); await p.waitForTimeout(900);
  ok('L17 Queue from expanded Devices: devices folded, queue shown', await p.evaluate(() => { const d = document.querySelector('.desk'); const q = document.querySelector('.listpanel').getBoundingClientRect(); window.__dbg = d.className; return !d.classList.contains('devexpanded') && q.width > 100 && q.height > 100; }), await p.evaluate(() => JSON.stringify({c: document.querySelector('.desk').className, n: document.querySelectorAll('.scpin[data-sc=queue]').length, q: document.querySelector('.listpanel').getBoundingClientRect().toJSON()})));
  await home(p, { ...NORMAL, exp: 'lib' }); await p.evaluate(() => [...document.querySelectorAll('.scpin[data-sc=eq],.schome')].find(x => x.dataset.sc === 'home' && x.getClientRects().length)?.click()); await p.waitForTimeout(900);
  ok('Home returns to the default screen', await p.evaluate(() => !/libexpanded|devexpanded|listexpanded/.test(document.querySelector('.desk').className)));
  await p.screenshot({ path: `/workspace/screens/wavwiz-037-${ENG}-l11-pins.png` });
  ok('shortcuts no page errors', !p._errs.length, p._errs.join('|')); await ctx.close();
});
await step('L7 All sound settings in place + one padlock', async () => {
  const { ctx, p } = await newPage({ viewport: { width: 1920, height: 1080 } }); await ZSTUB(p); await p.addInitScript(() => { localStorage.setItem('wavwiz.center.v1', 'eq'); localStorage.setItem('wavwiz.eqlock', '0'); }); await home(p, NORMAL);
  await p.click('.eqallbtn:not([disabled])'); await p.waitForTimeout(600);
  const r = await p.evaluate(() => ({ dlg: !!document.querySelector('dialog[open]'), panel: !!document.querySelector('.np-eqview .eqall'), groups: [...document.querySelectorAll('.eqall-preset optgroup')].map(o => o.label), labels: [...document.querySelectorAll('.eqall .eqknob span.grow, .eqall .eqsw b')].map(x => x.textContent) }));
  ok('L7 All sound settings opens in place (no popup)', r.panel && !r.dlg, JSON.stringify(r)); ok('L7 purpose-based preset groups', r.groups.join() === 'Situation,Speaker type,Music', r.groups.join());
  ok('L7 Bass, Treble, Trim, Balance, Auto pre-gain, Loudness, Limiter, Bypass', ['Bass', 'Treble', 'Trim', 'Balance', 'Auto pre-gain', 'Loudness', 'Limiter', 'Bypass'].every(x => r.labels.includes(x)), r.labels.join());
  await p.screenshot({ path: `/workspace/screens/wavwiz-037-${ENG}-l7-open.png` });
  await p.click('.eqpadlock'); await p.waitForTimeout(400);
  ok('L7 the ONE padlock locks the settings', await p.evaluate(() => document.querySelector('.eqall').classList.contains('locked') && [...document.querySelectorAll('.eqall input,.eqall select')].every(x => x.disabled)));
  await p.screenshot({ path: `/workspace/screens/wavwiz-037-${ENG}-l7-locked.png` });
  await p.click('.eqpadlock'); await p.waitForTimeout(300); ok('L7 unlock restores the controls', await p.evaluate(() => !document.querySelector('.eqall').classList.contains('locked') && !document.querySelector('.eqall input').disabled));
  ok('L7 no page errors', !p._errs.length, p._errs.join('|')); await ctx.close();
});
await step('L3/L9/L10/L18 layouts', async () => {
  const { ctx, p } = await newPage({ viewport: { width: 1920, height: 1080 } }); await home(p, { ...NORMAL, exp: 'dev' });
  const w = await p.evaluate(() => [...document.querySelectorAll('.dexp-main.e1 > .ecol')].filter(c => c.getBoundingClientRect().width > 5).map(c => Math.round(c.getBoundingClientRect().width)));
  ok('L3 three equal columns', w.length === 3 && Math.max(...w) - Math.min(...w) <= 2 && w[0] > 560, w.join());
  const hh = await p.evaluate(() => [...document.querySelectorAll('.dexp-main.e1 > .ecol > .dsec-h, .dexp-main.e1 .ssc-h')].map(c => Math.round(c.getBoundingClientRect().height))); ok('L3 identical 34px title bars', hh.length >= 2 && hh.every(x => x === 34), hh.join());
  const rows = await p.evaluate(() => [...document.querySelectorAll('.dexp-main.e1 :is(.zcard,.dcard)')].slice(0, 6).map(c => Math.round(c.getBoundingClientRect().height))); ok('L3 64px rows', rows.length && rows.every(x => x >= 64 && x <= 66), rows.join());
  await home(p, { ...NORMAL, exp: 'lib' });
  const l9 = await p.evaluate(() => { const q = document.querySelector('.listpanel').getBoundingClientRect(), m = document.querySelector('.minicol').getBoundingClientRect(), c0 = document.querySelector('.listpanel .qtable colgroup col')?.getBoundingClientRect().width, arrow = document.querySelector('.listpanel .listcolwrap'); return { gap: Math.round(m.top - q.bottom), c0, arrow: arrow ? getComputedStyle(arrow).display : 'none', sep: getComputedStyle(document.querySelector('.minicol')).borderTopWidth }; });
  ok('L9/L10 library open: mini player is its own panel with a 10px gap', l9.gap >= 8 && l9.gap <= 12 && l9.sep === '1px', JSON.stringify(l9)); ok('L9 # column shrinks', l9.c0 <= 40, l9.c0); ok('L12 no collapse arrow', l9.arrow === 'none');
  await p.screenshot({ path: `/workspace/screens/wavwiz-037-${ENG}-l9-library-open.png` });
  await ctx.close();
  const { ctx: c2, p: p2 } = await newPage({ viewport: { width: 1366, height: 768 } }); await home(p2, { ...NORMAL, ctl: 'collapsed' });
  const t = await p2.evaluate(() => { const s = document.querySelector('.np-strip .ns-titles'); const el = document.querySelector('.np-strip .ns-elv'), dur = document.querySelector('.np-strip .ns-dur'), seek = document.querySelector('.np-strip .ns-seek'); return { title: Math.round(s?.getBoundingClientRect().width || 0), elv: el?.getBoundingClientRect(), dur: dur?.getBoundingClientRect(), seek: seek?.getBoundingClientRect() }; });
  ok('L18 1366: song title keeps >= 150px and times stay inside the seek row', t.title >= 150 && t.elv.left >= t.seek.left - 1 && t.dur.right <= t.seek.right + 1, JSON.stringify(t));
  await p2.screenshot({ path: `/workspace/screens/wavwiz-037-${ENG}-l18-1366.png` }); await c2.close();
  const { ctx: c3, p: p3 } = await newPage({ viewport: { width: 1920, height: 1080 } }); await home(p3, { ...NORMAL, list: 'expanded', dev: 'rail' });
  const hv = await p3.evaluate(() => { const m = document.querySelector('.minicol').getBoundingClientRect(); return { w: Math.round(m.width), h: Math.round(m.height), right: Math.round(innerWidth - m.right) }; });
  ok('L10 Devices collapsed: one small button', hv.w <= 40 && hv.h <= 40, JSON.stringify(hv));
  await p3.hover('.minicol'); await p3.waitForTimeout(500);
  const pop = await p3.evaluate(() => { const mp = document.querySelector('.minicol .mp'), m = document.querySelector('.minicol').getBoundingClientRect(); const r = mp.getBoundingClientRect(); return { op: getComputedStyle(mp).opacity, leftOfButton: r.right <= m.left + 2, sc: !!mp.querySelector('.schome') }; });
  ok('L10 hover floats the full mini player to the left, with Home far right', pop.op === '1' && pop.leftOfButton && pop.sc, JSON.stringify(pop));
  await p3.screenshot({ path: `/workspace/screens/wavwiz-037-${ENG}-l10-hover.png` }); await c3.close();
});
await step('L28 pairing QR + address + add to home screen', async () => {
  const { ctx, p } = await newPage({ viewport: { width: 1920, height: 1080 } }); await home(p, NORMAL); await p.evaluate(async () => (await import('/js/main.js')).go('settings:players')).catch(() => {}); await p.waitForTimeout(1200);
  await p.click('text=Show a pairing code'); await p.waitForTimeout(1500);
  const r = await p.evaluate(() => ({ code: document.querySelector('#sec-players .mono.accent')?.textContent, qr: document.querySelector('.pairqr')?.getAttribute('src'), vis: document.querySelector('.pairqr') && !document.querySelector('.pairqr').hidden, addr: document.querySelector('.pairqr-addr')?.textContent }));
  ok('L28 QR next to the 6-digit code', /^\d{6}$/.test(r.code || '') && r.vis && r.qr.includes('to=pair&code=' + r.code), JSON.stringify(r)); ok('L28 server address shown as text under the QR', /^Server address: http:\/\/.+:\d+$/.test(r.addr || ''), r.addr);
  await p.screenshot({ path: `/workspace/screens/wavwiz-037-${ENG}-l28-pair-qr.png` }); await ctx.close();
  const { ctx: c2, p: p2 } = await newPage(VPS[2][1]); await p2.goto(B + '/tls/setup?pair=123456'); await p2.waitForTimeout(1500);
  ok('L28 phone page: manifest linked + Add to Home Screen steps', await p2.evaluate(() => !!document.querySelector('link[rel=manifest]') && /Add to Home Screen/.test(document.body.innerText)));
  await p2.screenshot({ path: `/workspace/screens/wavwiz-037-${ENG}-l28-phone-setup.png`, fullPage: true }); await c2.close();
});
  // 0.3.7: every EQ entry point -> the ONE center EQ (never the old Sound popup), on the shared glide + pulse
  await step('EQ entry points', async () => {
    for (const [vpn, vopt] of VPS) {
      const { ctx, p } = await newPage(vopt); const phone = vpn === 'iphone';
      const fresh = async (pan) => { await p.goto(B + '/'); await p.evaluate(([v]) => { localStorage.setItem('wavwiz.center.v1', 'viz'); localStorage.setItem('wavwiz.center.migrated030', '1'); if (v) localStorage.setItem('wavwiz.panels', JSON.stringify(v)); }, [pan]); await p.goto(B + '/'); await p.waitForTimeout(2200); await closeDlg(p); };
      const check = async (name) => {
        await p.waitForTimeout(700);
        const r = await p.evaluate(() => ({ dlg: !!document.querySelector('dialog[open]'), title: document.querySelector('dialog[open] h2,dialog[open] header')?.textContent || '',
          eq: !!document.querySelector('.np-stage.eqmode'), eqv: !!document.querySelector('.np-stage .eqv, .np-stage .ceq, .np-stage canvas.eqcanvas, .np-stage [class*=eq]'), pulsed: !!document.querySelector('.np-stage.k-pulse, .np-stage[data-eqfront]'),
          vis: (() => { const s = document.querySelector('.np-stage'); if (!s) return false; const b = s.getBoundingClientRect(); return b.width > 20 && b.height > 20 && b.bottom > 0 && b.top < innerHeight; })() }));
        ok(`EQ[${vpn}] ${name}: center EQ, no Sound popup, visible, pulsed`, !r.dlg && r.eq && r.vis && r.pulsed, JSON.stringify(r));
        await p.screenshot({ path: `/workspace/screens/wavwiz-037-${ENG}-eq-${vpn}-${name.replace(/\W+/g, '')}.png` });
      };
      // every EQ button in the Now Playing panel (bar, full panel, control strip)
      await fresh(NORMAL);
      const n = await p.evaluate(() => document.querySelectorAll('.eqbtn').length); ok(`EQ[${vpn}] Now Playing has EQ buttons`, n >= 1, n);
      for (let i = 0; i < n; i++) {
        await fresh(NORMAL);
        const vis = await p.evaluate(i => { const b = [...document.querySelectorAll('.eqbtn')][i]; return !!(b && b.getClientRects().length); }, i);
        if (!vis) continue;
        await p.evaluate(i => [...document.querySelectorAll('.eqbtn')][i].click(), i); await check('button' + i);
      }
      if (!phone) {   // from an expanded Library / Devices / Queue the EQ button (and the menu) must collapse it and bring the center EQ forward
        for (const [nm, pan] of [['lib', { lib: 'normal', dev: 'normal', exp: 'lib', list: 'open', ctl: 'open' }], ['dev', { lib: 'normal', dev: 'normal', exp: 'dev', list: 'open', ctl: 'open' }]]) {
          await fresh(pan); const ok1 = await p.evaluate(() => { const b = [...document.querySelectorAll('.eqbtn')].find(b => b.getClientRects().length); if (b) b.click(); return !!b; });
          if (ok1) { await check(`from-${nm}-expanded`); ok(`EQ[${vpn}] expanded ${nm} collapsed`, !(await p.evaluate(() => document.querySelector('.desk')?.className || '')).includes(nm + 'expanded')); }
        }
        await fresh(NORMAL); await go(p, 'eq'); await check('go-eq');
        await fresh(NORMAL); await p.evaluate(() => window.dispatchEvent(new Event('resize')));
        try { await hoverItem(p, 'Playback', 'Sound / EQ'); await p.evaluate(() => { const o = [...document.querySelectorAll('.menubar .msub.open > .mpanel button')].find(b => /Open the EQ/.test(b.textContent)); o?.click(); }); await check('menu-open-the-eq'); } catch (e) { ok(`EQ[${vpn}] menu`, false, e); }
      } else { await fresh(null); await go(p, 'eq'); await check('go-eq'); }
      ok(`EQ[${vpn}] no page errors`, !p._errs.length, p._errs.join('|')); await ctx.close();
    }
  });
await br.close();
const fails = R.filter(x => !x).length; console.log(`\n${R.length - fails}/${R.length} passed`); process.exit(fails ? 1 : 0);

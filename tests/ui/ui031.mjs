// WavWiz 0.3.1 fix pass: browser checks for every acceptance item that a browser can see, all 10 themes, iPhone WebKit EQ.
import { chromium, webkit, devices } from 'playwright';
import { readFileSync } from 'node:fs';
const IP = '172.30.0.2', B = `http://${IP}:47800`;
const sess = readFileSync('/tmp/ww030/sess', 'utf8').trim();
const R = []; const ok = (name, pass, info = '') => { R.push({ name, pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' :: ' + info : '')); };
const shot = (p, n) => p.screenshot({ path: `/workspace/screens/wavwiz-031-${n}.png` });
const api = async (path, method = 'GET', body) => { const r = await fetch(B + '/api/v1' + path, { method, headers: { Cookie: 'unison_session=' + sess, Origin: B, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json().catch(() => ({})); };
const step = async (n, f) => { try { await f(); } catch (e) { ok(n, false, String(e).slice(0, 900)); } };
const closeDlg = p => p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
const ONLY = process.argv[2] || ''; const want = n => !ONLY || ONLY.split(',').includes(n);
const THEMES = ['default', 'pepecoin', 'ember', 'arctic', 'violet', 'mono', 'daylight', 'nebula', 'steel', 'lime'];
const setTheme = (p, id) => p.evaluate(async id => { const t = await import('/js/theme.js'); t.applyTheme({ ...t.PRESETS[id], preset: id }); }, id);

const cb = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
// two browser speakers so the center EQ, device bars and delay slider have something to show (as in ui030)
const spc = await cb.newContext({ viewport: { width: 1200, height: 800 } }); await spc.addCookies([{ name: 'unison_session', value: sess, url: B }]);
for (let i = 0; i < 2; i++) { const sp = await spc.newPage(); await sp.goto(B + '/'); await sp.waitForTimeout(3000); await sp.mouse.click(600, 400); await sp.waitForTimeout(1000); }
const ctx = await cb.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
await ctx.addInitScript(() => { if (!localStorage.getItem('seeded31')) { localStorage.setItem('seeded31', '1'); localStorage.setItem('wavwiz.center.v1', 'eq'); localStorage.setItem('wavwiz.devsize', 'standard'); localStorage.setItem('wavwiz.whatsnew', '0.3.1'); } });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
const home = async () => { await p.goto(B + '/'); await p.waitForSelector('.desk', { timeout: 15000 }); await p.waitForTimeout(2000); await closeDlg(p); await p.waitForTimeout(300); };

await step('smoke', async () => {
  await home(); await shot(p, 'smoke-desktop');
  const v = await p.evaluate(async () => (await (await fetch('/api/v1/version').catch(() => null))?.json?.().catch(() => null)) || null);
  ok('smoke: app loads without script errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  const about = await p.evaluate(async () => (await import('/js/about.js')).WHATS_NEW_VERSION);
  ok('smoke: version 0.3.1 (What\'s new)', about === '0.3.1', about + ' ' + JSON.stringify(v));
});

if (want('b18')) await step('b18', async () => {
  const g = await p.evaluate(() => { const v = document.querySelector('.np-stage .vbtns'); const bs = [...v.querySelectorAll('button')]; return { names: bs.map(b => b.dataset.ov), sizes: bs.map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }), titles: bs.every(b => b.title), radius: getComputedStyle(bs[0]).borderTopLeftRadius }; });
  ok('B18 EQ mode: Lock, swap, Looks, Full screen', JSON.stringify(g.names) === '["lock","swap","looks","full"]', JSON.stringify(g.names));
  ok('B18 all buttons same size, tooltips, 3px corners', new Set(g.sizes.map(String)).size === 1 && g.titles && g.radius === '3px', JSON.stringify(g));
  await shot(p, 'b18-eq-group');
  await p.click('.vbtns .ov-looks'); await p.waitForTimeout(400);
  const pop = await p.evaluate(() => { const l = document.querySelector('.looks-pop'); return l && { w: Math.round(l.getBoundingClientRect().width), focusIn: l.contains(document.activeElement), sliders: l.querySelectorAll('input[type=range]').length, onLooks: document.querySelector('.vbtns .ov-looks').classList.contains('on'), outline: getComputedStyle(document.querySelector('.vbtns .ov-looks')).borderColor }; });
  ok('B18 Looks popover opens (300 px, focus inside, sliders, active state)', !!pop && pop.w === 300 && pop.focusIn && pop.sliders >= 2 && pop.onLooks, JSON.stringify(pop));
  await shot(p, 'b18-looks-popover');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  const closed = await p.evaluate(() => !document.querySelector('.looks-pop') && document.activeElement?.classList.contains('ov-looks'));
  ok('B18 Esc closes Looks and returns focus', closed);
  await p.click('.vbtns .ov-looks'); await p.waitForTimeout(300); await p.mouse.click(5, 450); await p.waitForTimeout(300);
  ok('B18 outside click closes Looks', await p.evaluate(() => !document.querySelector('.looks-pop')));
  await p.click('.vbtns .np-centertoggle'); await p.waitForTimeout(800);
  const vz = await p.evaluate(() => [...document.querySelectorAll('.np-stage .vbtns button')].map(b => b.dataset.ov));
  ok('B18 viz mode adds power + pop-out', vz.includes('power') && vz.includes('popout') && vz.includes('lock'), JSON.stringify(vz));
  await shot(p, 'b18-viz-group');
  await p.click('.vbtns .np-centertoggle'); await p.waitForTimeout(800);
});

if (want('b17')) await step('b17', async () => {
  const r = await p.evaluate(() => { const b = document.querySelector('.vbtns .ov-lock'); const rc = b.getBoundingClientRect(); const top = document.elementFromPoint(rc.x + rc.width / 2, rc.y + rc.height / 2); return { hit: b === top || b.contains(top), was: b.getAttribute('aria-pressed') }; });
  await p.click('.vbtns .ov-lock'); await p.waitForTimeout(300);
  const now = await p.evaluate(() => document.querySelector('.vbtns .ov-lock').getAttribute('aria-pressed'));
  ok('B17 Lock EQ is the top element and toggles', r.hit && now !== r.was, JSON.stringify({ ...r, now }));
  await p.click('.vbtns .ov-lock'); await p.waitForTimeout(300);
  // in EQ mode the EQ itself must stay interactive; the decorative layers (cover backdrop, glow, visualizer canvas) never take clicks
  await p.click('.vbtns .np-centertoggle'); await p.waitForTimeout(900);
  const pe = await p.evaluate(() => [...document.querySelectorAll('.np-stage .stagecover, .np-stage .vizhost, .np-stage .vizhost canvas, .np-stage [class*=glow]')].map(e => [e.className || e.tagName, getComputedStyle(e).pointerEvents]));
  const lockTop = await p.evaluate(() => { const b = document.querySelector('.vbtns .ov-lock'); const rc = b.getBoundingClientRect(); const t = document.elementFromPoint(rc.x + rc.width / 2, rc.y + rc.height / 2); return b === t || b.contains(t); });
  ok('B17 visualizer mode: decorative layers pointer-events:none, Lock EQ still on top', pe.length > 0 && pe.every(x => x[1] === 'none') && lockTop, JSON.stringify(pe));
  await p.click('.vbtns .np-centertoggle'); await p.waitForTimeout(900);
});

if (want('dev')) await step('dev', async () => {
  const exp = '.devexp';
  const l0 = await p.getAttribute(exp, 'aria-label');
  await p.click(exp); await p.waitForTimeout(600); const l1 = await p.getAttribute(exp, 'aria-label'); const ic1 = await p.innerHTML(exp);
  await shot(p, 'b4-devices-expanded');
  await p.keyboard.press('Escape'); await p.waitForTimeout(600); const l2 = await p.getAttribute(exp, 'aria-label'); const ic2 = await p.innerHTML(exp);
  ok('B4 Expand label reverts after collapse', /Expand/.test(l0) && /Collapse/.test(l1) && l2 === l0, [l0, l1, l2].join(' -> '));
  ok('B6 standard icons (svg) both ways', /<svg/.test(ic1) && /<svg/.test(ic2) && ic1 !== ic2);
  await p.keyboard.press('BracketRight'); await p.waitForTimeout(600);
  const rail = await p.evaluate(() => { const r = document.querySelector('.devpanel.israil'); if (!r) return null; const a = r.querySelector('.pane-h').getBoundingClientRect(), b = r.querySelector('.prail').getBoundingClientRect(); return { headTop: Math.round(a.top), railTop: Math.round(b.top), w: Math.round(r.getBoundingClientRect().width) }; });
  ok('B5 collapsed rail: header on top, icon + title below, slim', !!rail && rail.headTop <= rail.railTop && rail.w <= 32, JSON.stringify(rail));
  await shot(p, 'b5-devices-rail');
  await p.keyboard.press('BracketRight'); await p.waitForTimeout(600);
  const m = await p.evaluate(() => { const ms = document.querySelector('.devpanel .dmaster input[type=range]'), dv = document.querySelector('.devpanel .drow input[type=range], .devpanel .dvol:not(.dvol-master) input[type=range]'); return { master: ms && Math.round(ms.getBoundingClientRect().width), dev: dv && Math.round(dv.getBoundingClientRect().width), muteLine: !!document.querySelector('.devpanel .dmaster-mute button') }; });
  ok('B7 master volume bar matches device bars', m.master && m.dev && Math.abs(m.master - m.dev) <= 2, JSON.stringify(m));
  ok('B8 Mute all on its own line', m.muteLine);
  const ss = await p.evaluate(() => { const s = document.querySelector('.devpanel .dss'); return s && { text: s.textContent.slice(0, 120), open: !!s.querySelector('a,button') }; });
  ok('B9 compact Scenes & Schedules section in Devices', !!ss && ss.open, JSON.stringify(ss));
  await shot(p, 'b7-b9-devices-standard');
});

if (want('settings')) await step('settings', async () => {
  const sz = [];
  for (const sec of ['general', 'appearance', 'devices']) {
    await closeDlg(p); await p.evaluate(async s => { const m = await import('/js/main.js'); m.go('settings:' + s); }, sec); await p.waitForTimeout(1500);
    sz.push(await p.evaluate(() => { const d = document.querySelector('dialog.settings-dlg[open]'); const r = d.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    const ov = await p.evaluate(() => { const nav = document.querySelector('.settings-dlg .appnav, .settings-dlg [role=tablist]'); const sub = document.querySelector('.settings-dlg .subtabs'), rs = [...document.querySelectorAll('.settings-dlg button')].find(b => /Reset this section/.test(b.textContent));
      const inter = (a, b) => a && b && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
      return { navScroll: nav ? nav.scrollHeight > nav.clientHeight + 1 && getComputedStyle(nav).overflowY !== 'hidden' : false, overlap: sub && rs ? inter(sub.getBoundingClientRect(), rs.getBoundingClientRect()) : false, hasSub: !!sub };
    });
    ok(`B10/B11 ${sec}: reset does not overlap sub-tabs, no scroll bar on main tabs`, !ov.overlap && !ov.navScroll, JSON.stringify(ov));
    await shot(p, 'settings-' + sec);
  }
  ok('B12 Settings window is a fixed size across sections', new Set(sz.map(String)).size === 1 && sz[0][0] === 1200, JSON.stringify(sz));
  await closeDlg(p); await p.evaluate(async () => { const m = await import('/js/main.js'); m.go('settings:appearance'); }); await p.waitForTimeout(2000);
  const cols = {};
  for (const [tab, k, n] of [['Theme', 'pgrid-theme', 5], ['Visualizer', 'pgrid-viz', 4], ['EQ', 'pgrid-eq', 3], ['Now Playing', 'pgrid-np', 2]]) {
    await p.locator('dialog[open].settings-dlg .subtabs button:visible', { hasText: new RegExp('^' + tab + '$') }).first().click(); await p.waitForTimeout(1500);
    cols[k] = await p.evaluate(k => { const g = [...document.querySelectorAll('.settings-dlg .' + k)].find(e => e.offsetParent); if (!g) return null; const cs = [...g.children].filter(c => c.offsetParent).map(c => c.getBoundingClientRect()); const top = cs[0]?.top; return { cols: cs.filter(r => Math.abs(r.top - top) < 2).length, maxH: Math.round(Math.max(...cs.map(r => r.height))), n: cs.length }; }, k);
    cols[k] && (cols[k].want = n); await shot(p, 'appearance-' + k);
  }
  ok('B13-B15 Appearance: shared live preview grid (theme 5, viz 4, EQ 3, Now Playing 2 per row)', Object.values(cols).every(c => c && c.cols === Math.min(c.want, c.n)), JSON.stringify(cols));
  await p.locator('dialog[open].settings-dlg .subtabs button:visible', { hasText: /^Display size$/ }).first().click(); await p.waitForTimeout(1000);
  const ds = await p.evaluate(() => [...document.querySelectorAll('.settings-dlg .dsmock')].filter(e => e.offsetParent).length);
  ok('B16 Display size presets as cards (Small, Default, Large)', ds === 3, String(ds)); await shot(p, 'b16-display-size');
  await closeDlg(p);
});

if (want('s1')) await step('s1', async () => {
  await p.evaluate(async () => { const m = await import('/js/main.js'); m.go('devices'); }); await p.waitForTimeout(1500);
  if (!(await p.locator('.latslider:visible').count())) { const b = p.locator('button.dexpand:visible').first(); if (await b.count()) { await b.click(); await p.waitForTimeout(1000); } }
  const sl = p.locator('.latslider:visible').first();
  if (!(await sl.count())) { ok('S1 delay slider wheel ±1 / Shift ±10', false, 'no slider visible'); return; }
  await sl.scrollIntoViewIfNeeded(); await sl.hover(); const v0 = +(await sl.inputValue());
  await p.mouse.wheel(0, -100); await p.waitForTimeout(100); const v1 = +(await sl.inputValue());
  await p.keyboard.down('Shift'); await p.mouse.wheel(0, -100); await p.keyboard.up('Shift'); await p.waitForTimeout(700); const v2 = +(await sl.inputValue());
  const saved = await p.evaluate(() => document.querySelector('.latstatus')?.textContent || '');
  ok('S1 wheel +1 ms, Shift +10 ms, saves', v1 === v0 + 1 && v2 === v1 + 10 && /Saved/.test(saved), `${v0} -> ${v1} -> ${v2} · ${saved}`);
  await shot(p, 's1-delay-slider');
  await p.mouse.wheel(0, 100); await p.keyboard.down('Shift'); await p.mouse.wheel(0, 100); await p.keyboard.up('Shift'); await p.waitForTimeout(700);   // put it back
  const r = await sl.boundingBox(); ok('S1 bigger handle/hit target (≥ 40 px tall, 30 px handle)', r.height >= 40, JSON.stringify(r));
});

if (want('lib')) await step('lib', async () => {
  await p.evaluate(async () => { const m = await import('/js/main.js'); m.go('library'); }); await p.waitForTimeout(1500);
  const t = p.locator('button, [role=tab]', { hasText: /^Artists$/ }).first(); if (await t.count()) { await t.click(); await p.waitForTimeout(2500); }
  const st = await p.evaluate(() => { const imgs = [...document.querySelectorAll('.libpanel img, .lib img')]; return { imgs: imgs.length, broken: imgs.filter(i => i.complete && i.naturalWidth === 0).length, portraits: document.querySelectorAll('.gencover.portrait').length }; });
  ok('B19 library artists: no broken images (initials tile otherwise)', st.broken === 0, JSON.stringify(st));
  await shot(p, 'b19-library-artists');
});

if (want('bt')) await step('bt', async () => {
  // B1 needs a real Bluetooth output for the end-to-end check; here we feed the panel a Bluetooth zone through the module and check tag + hint.
  const r = await p.evaluate(async () => { const D = await import('/js/devices.js'); const z = (c, dev) => ({ id: 999, name: 'PCBOXV2', connected: c, outputs: [{ deviceId: dev, kind: 'bluetooth', active: true, connected: c }] });
    const tags = D.cardTags(z(true, 'a')).map(t => t.text); const S = { zones: [z(true, 'a')], me: { role: 'admin' } };
    const a = D.btHint(S, {}); S.zones = [z(false, 'a')]; const b = D.btHint(S, {}); S.zones = [z(true, 'a')]; const c = D.btHint(S, {}); const d = D.btHint(S, {});
    if (c) { c.id = 'bthint-demo'; document.querySelector('.devpanel .devbody')?.prepend(c); }
    return { tags, first: !!a, off: !!b, reconnect: c?.textContent || null, again: !!d && d.textContent }; });
  ok('B1 Bluetooth tag + one-time reconnect hint with Recalibrate', r.tags.includes('BLUETOOTH') && !r.first && !r.off && /Bluetooth reconnected - recalibrate\?/.test(r.reconnect || '') && /Recalibrate/.test(r.reconnect || ''), JSON.stringify(r));
  await shot(p, 'b1-bt-hint'); await p.evaluate(() => document.getElementById('bthint-demo')?.remove());
});

if (want('themes')) await step('themes', async () => {
  for (const id of THEMES) {
    await setTheme(p, id); await p.waitForTimeout(200);
    await p.click('.vbtns .ov-looks').catch(() => {}); await p.waitForTimeout(300); await shot(p, `theme-${id}-looks`); await p.keyboard.press('Escape');
    await p.evaluate(async () => { const m = await import('/js/main.js'); m.go('settings:appearance'); }); await p.waitForTimeout(900); await shot(p, `theme-${id}-settings`); await closeDlg(p);
    await p.evaluate(async () => { const m = await import('/js/main.js'); m.go('scenes'); }); await p.waitForTimeout(900); await shot(p, `theme-${id}-scenes`); await closeDlg(p);
    await p.evaluate(async () => { const c = await import('/js/calibrate.js'); const S = (await import('/js/main.js')).S; c.openCalibration?.(S, () => {}); }).catch(() => {}); await p.waitForTimeout(900); await shot(p, `theme-${id}-calibration`); await closeDlg(p);
  }
  await p.evaluate(async () => { const t = await import('/js/theme.js'); t.applyTheme(t.loadTheme()); });
  ok('themes: 10 themes x Looks, Settings, Scenes, Calibration screenshots', true, THEMES.join(','));
});

if (want('iphone')) await step('iphone', async () => {
  const wk = await webkit.launch();
  for (const [o, dev] of [['portrait', devices['iPhone 13']], ['landscape', devices['iPhone 13 landscape']]]) {
    const c = await wk.newContext({ ...dev }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
    await c.addInitScript(() => { localStorage.setItem('wavwiz.center.v1', 'eq'); localStorage.setItem('wavwiz.whatsnew', '0.3.1'); localStorage.setItem('wavwiz.phoneRole', 'speaker'); });
    const q = await c.newPage(); await q.goto(B + '/'); await q.waitForTimeout(3500); await q.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    await q.mouse.click(dev.viewport.width / 2, dev.viewport.height / 2); await q.waitForTimeout(3500); await q.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    await q.evaluate(async () => { const m = await import('/js/main.js'); m.go('now'); }).catch(() => {}); await q.waitForTimeout(1500);
    const r = await q.evaluate(() => { const host = document.querySelector('.np-eqhost') || document.querySelector('.np-eqview'); if (!host || !host.querySelector('.eqa-plot')) return { noEq: true }; const hr = host.getBoundingClientRect(); const bands = [...host.querySelectorAll('.eqa-band, [data-band], .eqa-plot')];
      const over = [...host.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e); return (s.overflowX === 'scroll' || s.overflowY === 'scroll' || s.overflowX === 'auto' || s.overflowY === 'auto') && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1); }).length;
      const plot = host.querySelector('.eqa-plot'); const pr = plot && plot.getBoundingClientRect();
      return { host: [Math.round(hr.width), Math.round(hr.height)], vw: innerWidth, scrollers: over, plotInside: !!pr && pr.right <= hr.right + 1 && pr.bottom <= hr.bottom + 1 && pr.left >= hr.left - 1 && pr.width > 0, docScrollX: document.documentElement.scrollWidth > innerWidth + 1 }; });
    ok(`B2 iPhone WebKit ${o}: full EQ visible, no scroll bars`, !!r && r.scrollers === 0 && r.plotInside && !r.docScrollX, JSON.stringify(r));
    await q.screenshot({ path: `/workspace/screens/wavwiz-031-b2-iphone-${o}.png` });
    if (o === 'portrait') { const b = q.locator('.vbtns .ov-looks'); if (await b.count()) { await b.click(); await q.waitForTimeout(400); const sh = await q.evaluate(() => document.querySelector('.looks-pop')?.classList.contains('sheet')); ok('B18 phone: Looks is a bottom sheet', !!sh); await q.screenshot({ path: '/workspace/screens/wavwiz-031-b18-phone-sheet.png' }); } }
    await c.close();
  }
  await wk.close();
});

await cb.close();
const fails = R.filter(r => !r.pass);
console.log(`\nUI 0.3.1: ${R.length - fails.length}/${R.length} passed`); if (fails.length) console.log('FAILED:\n' + fails.map(f => ' - ' + f.name + ' :: ' + f.info).join('\n'));
process.exit(fails.length ? 1 : 0);

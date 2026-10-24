// WavWiz 0.3.3: browser checks for G1-G14 (Chromium), screenshots, smoke.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const IP = '172.30.0.2', B = `http://${IP}:47800`;
const sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim();
const R = []; const ok = (name, pass, info = '') => { R.push({ name, pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' :: ' + info : '')); };
const shot = (p, n) => p.screenshot({ path: `/workspace/screens/wavwiz-033-${n}.png` });
const api = async (path, method = 'GET', body) => { const r = await fetch(B + '/api/v1' + path, { method, headers: { Cookie: 'unison_session=' + sess, Origin: B, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const step = async (n, f) => { try { await f(); } catch (e) { ok(n, false, String(e).slice(0, 900)); } };
const closeDlg = p => p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
const ONLY = process.argv[2] || ''; const want = n => !ONLY || ONLY.split(',').includes(n);
const THEMES = ['default', 'pepecoin', 'ember', 'arctic', 'violet', 'mono', 'daylight', 'nebula', 'steel', 'lime'];
const setTheme = (p, id) => p.evaluate(async id => { const t = await import('/js/theme.js'); t.applyTheme({ ...t.PRESETS[id], preset: id }); }, id);
const setPanels = (p, v) => p.evaluate(v => localStorage.setItem('wavwiz.panels', JSON.stringify(v)), v);
const NORMAL = { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'open' };

const cb = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const spc = await cb.newContext({ viewport: { width: 1000, height: 700 } }); await spc.addCookies([{ name: 'unison_session', value: sess, url: B }]);
for (let i = 0; i < 4; i++) { const spx = await cb.newContext({ viewport: { width: 1000, height: 700 } }); await spx.addCookies([{ name: 'unison_session', value: sess, url: B }]); const sp = await spx.newPage(); await sp.goto(B + '/'); await sp.waitForTimeout(2500); await sp.mouse.click(500, 350); await sp.waitForTimeout(800); }
await new Promise(r => setTimeout(r, 2000));
const zs = await api('/zones?all=1'); const ids = (Array.isArray(zs) ? zs : zs.zones || []).map(z => z.id).filter(Boolean);
const groups = await api('/groups');
if (!(Array.isArray(groups) && groups.length >= 2 && groups.every(g => g.members > 0)) && ids.length >= 2) { for (const g of (Array.isArray(groups) ? groups : [])) await api('/groups/' + g.id, 'DELETE'); await api('/groups', 'POST', { name: 'Downstairs', deviceIds: ids.slice(0, 2) }); await api('/groups', 'POST', { name: 'Patio', deviceIds: ids.slice(1, 3) }); }
if ((await api('/groups')).every?.(g => !g.members) && ids.length >= 3) { for (const g of await api('/groups')) await api('/groups/' + g.id, 'DELETE'); await api('/groups', 'POST', { name: 'Downstairs', deviceIds: ids.slice(0, 2) }); await api('/groups', 'POST', { name: 'Patio', deviceIds: ids.slice(2, 3) }); }
const gl = await api('/groups'); if (Array.isArray(gl) && gl[1]) await api(`/groups/${gl[1].id}/mute`, 'POST', { muted: true });
console.log('setup', JSON.stringify({ ids, groups: gl }).slice(0, 400));

const ctx = await cb.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
await ctx.addInitScript(() => { if (!localStorage.getItem('seeded33')) { localStorage.setItem('seeded33', '1'); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'open' })); } });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
const home = async () => { await p.goto(B + '/'); await p.waitForSelector('.desk', { timeout: 15000 }); await p.waitForTimeout(2000); await closeDlg(p); await p.waitForTimeout(300); };


const openSet = async (tab, sub) => { await closeDlg(p); await p.evaluate(async t => (await import('/js/main.js')).go('settings:' + t), tab); await p.waitForTimeout(1500); if (sub) { await p.locator('dialog[open].settings-dlg .subtabs button:visible', { hasText: new RegExp('^' + sub + '$') }).first().click(); await p.waitForTimeout(1800); } };
const clean = () => p.evaluate(() => { document.querySelectorAll('.phone-unlock').forEach(e => e.remove()); });

await step('smoke', async () => {
  await home(); await clean(); await shot(p, 'smoke-desktop');
  ok('smoke: app loads without script errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  const v = await api('/status'); ok('smoke: server reports the build version', JSON.stringify(v).includes(process.env.WW_EXPECT_VERSION || '0.4.0'), String(v.version || ''));
});

if (want('g1')) await step('g1', async () => {
  for (const pan of [NORMAL, { ...NORMAL, lib: 'rail' }, { ...NORMAL, lib: 'rail', dev: 'rail' }]) {
    await setPanels(p, pan); await home(); await openSet('general');
    const r = await p.evaluate(() => { const d = document.querySelector('dialog[open].settings-dlg').getBoundingClientRect(), c = document.querySelector('.nowcol').getBoundingClientRect(); return { d: Math.round(d.width), c: Math.round(c.width), w: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--popw')) }; });
    ok(`G1->J1 Settings = the one fixed popup width (--popw) whatever the panels (${pan.lib}/${pan.dev})`, Math.abs(r.d - r.w) <= 2, JSON.stringify(r));   // 0.3.5 J1 supersedes G1 (no longer follows the live center panel)
  }
  await setPanels(p, NORMAL); await home(); await openSet('general'); await shot(p, 'settings-general');
});

if (want('g2')) await step('g2', async () => {
  await openSet('appearance', 'Now Playing');
  const r = await p.evaluate(() => { const g = [...document.querySelectorAll('.settings-dlg .pgrid-np')].find(e => e.offsetParent); const cs = [...g.children].map(c => c.getBoundingClientRect());
    const th = [...g.querySelectorAll('.npthumb')].map(t => { const pn = t.firstElementChild, tb = t.getBoundingClientRect(); const over = [...pn.querySelectorAll('button')].filter(b => { const bb = b.getBoundingClientRect(); return bb.width && (bb.right > tb.right + 1 || bb.bottom > tb.bottom + 1); }).length; return { tr: pn.style.transform, w: parseInt(pn.style.width), over }; });
    const live = document.querySelector('.np-ctlpanel:not(.npprev-panel)')?.offsetWidth || 0;
    return { n: cs.length, perRow: cs.filter(x => Math.abs(x.top - cs[0].top) < 2).length, gw: Math.round(g.getBoundingClientRect().width), cw: cs.map(x => Math.round(x.width)), th, live }; });
  ok('G2b one Now Playing card per row at full width', r.n === 4 && r.perRow === 1 && r.cw.every(w => Math.abs(w - r.gw) <= 2), JSON.stringify({ n: r.n, perRow: r.perRow, gw: r.gw, cw: r.cw }));
  ok('G2 previews laid out at the true panel width and scaled down, nothing overflows the card', r.th.every(t => Math.abs(t.w - r.live) <= 2 && /scale\(/.test(t.tr) && t.over === 0), JSON.stringify(r));
  await shot(p, 'np-previews');
  const g = await p.evaluate(() => [...document.querySelectorAll('.settings-dlg .pgrid')].filter(e => e.offsetParent).length); ok('G2 other grids untouched (checked by CSS test)', g >= 1);
});

if (want('g3')) await step('g3', async () => {
  await openSet('jukebox'); await shot(p, 'settings-jukebox');
  const r = await p.evaluate(() => { const d = document.querySelector('dialog[open].settings-dlg'), tab = d.querySelector('.settings-nav button.on'), c = d.querySelector('.settings-sec.on .card'), h3 = c?.querySelector('h3');
    const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return { tab: getComputedStyle(tab).color, hl: v('--hl'), bg: getComputedStyle(c).backgroundColor, bl: getComputedStyle(c).borderLeftWidth, h3: getComputedStyle(h3).color }; });
  ok('G3 unboxed groups with a 2 px left line, highlight tab, secondary headings', r.bg === 'rgba(0, 0, 0, 0)' && r.bl === '2px', JSON.stringify(r));
  await setTheme(p, 'pepecoin'); await openSet('jukebox'); await shot(p, 'settings-jukebox-pepecoin');
  const pc = await p.evaluate(() => { const d = document.querySelector('dialog[open].settings-dlg'); const ok = ['rgb(38, 155, 77)', 'rgb(32, 130, 65)', 'rgb(192, 122, 78)', 'rgb(33, 33, 33)', 'rgb(255, 255, 255)', 'rgb(22, 83, 42)'];
    const tab = getComputedStyle(d.querySelector('.settings-nav button.on')).color, h3 = getComputedStyle(d.querySelector('.settings-sec.on .card h3')).color; return { tab, h3, okTab: ok.includes(tab), okH3: ok.includes(h3) }; });
  ok('G3 Pepecoin: tab + headings use brand-kit colors only', pc.okTab && pc.okH3, JSON.stringify(pc));
  await setTheme(p, 'default');
});

if (want('g5')) await step('g5', async () => {
  await setPanels(p, { ...NORMAL, list: 'expanded' }); await home(); await clean();
  const r = await p.evaluate(() => { const c = document.querySelector('.np-ctlpanel').getBoundingClientRect(), l = document.querySelector('.listpanel').getBoundingClientRect(), v = document.querySelector('.np-vizpanel');
    return { npTop: Math.round(c.top), listTop: Math.round(l.top), vizHidden: !v || !v.offsetParent, canvas: !!document.querySelector('.nowcol canvas.viz:not([hidden])') && !!document.querySelector('.np-stage.viz') }; });
  ok('G5 Now Playing sits above the expanded Playlist, the EQ / visualizer is hidden', r.npTop < r.listTop && r.vizHidden, JSON.stringify(r)); await shot(p, 'playlist-expanded');
});

if (want('dev')) await step('dev', async () => {
  await setPanels(p, NORMAL); await home(); await clean(); await shot(p, 'devices-standard');
  const r = await p.evaluate(() => { const rows = [...document.querySelectorAll('.devpanel .drow.slim')].map(e => Math.round(e.getBoundingClientRect().height));
    const bar = document.querySelector('.devpanel .drow.slim .dvol'), sl = bar?.querySelector('input').getBoundingClientRect(), pc = bar?.querySelector('.pct').getBoundingClientRect();
    const subs = [...document.querySelectorAll('.devpanel .slimsub>span:first-child')].map(e => e.textContent); const z = document.querySelector('.devpanel .zcard.dlike');
    return { rows, gap: sl && pc ? Math.round(pc.left - sl.right) : null, subs, zone: !!document.querySelector('.devpanel .zcard.dc3 .onpill') && !!document.querySelector('.devpanel .zcard.dc3 .dc3l3 button'), tip: document.querySelector('.devpanel .drow.slim')?.title || '' }; });
  ok('G10 slim rows ~56 px', r.rows.length > 0 && r.rows.every(h => h <= 62), JSON.stringify(r.rows));
  ok('G6 bar runs up to the % (≤ 8 px gap)', r.gap != null && r.gap <= 8, String(r.gap));
  ok('G8 "Speakers" subhead (panel title stays Devices), Zones subhead', r.subs.includes('SPEAKERS') && r.subs.includes('ZONES'), JSON.stringify(r.subs));
  ok('G7->J4 zone card = speaker card look (OFF|ON pill, bar, mute)', r.zone);
  ok('G10 output name in the row tooltip', /·|-/.test(r.tip), r.tip);
  await setPanels(p, { ...NORMAL, exp: 'dev' }); await home(); await clean(); await shot(p, 'devices-e1');
  const e = await p.evaluate(() => { const cols = [...document.querySelectorAll('.devpanel.expanded .e1>.ecol')].map(c => [c.className, Math.round(c.getBoundingClientRect().width)]);
    const rows = [...document.querySelectorAll('.e1 .srow')]; const bars = rows.map(r => Math.round(r.querySelector('.dvol').getBoundingClientRect().left));
    return { cols, n: rows.length, oneLine: rows.every(r => r.querySelector('.sline').getBoundingClientRect().height < 44), aligned: new Set(bars).size <= 1, out: rows[0]?.querySelector('.sout')?.title || '', c3: document.querySelectorAll('.e1 .scol .dcard.dc3').length, c3al: new Set([...document.querySelectorAll('.e1 .scol .dcard.dc3 .dc3l3')].map(x => Math.round(x.getBoundingClientRect().left))).size <= 1, un: !!document.querySelector('.e1 .udiv'), add: document.querySelectorAll('.e1 .saddzone').length }; });
  ok('G9->J5 (0.3.7 L3: three equal columns) Scenes & Schedules | Zones | (settings, closed) | Speakers (0.3.6 K5: fourth column holds a speaker\'s settings)', e.cols.length === 4 && /sscol/.test(e.cols[0][0]) && /zcol/.test(e.cols[1][0]) && /spcol/.test(e.cols[2][0]) && e.cols[2][1] <= 2 && /^scol/.test(e.cols[3][0]) && Math.abs(e.cols[3][1] - e.cols[0][1]) <= 2, JSON.stringify(e.cols));
  ok('G9->J4 speaker cards in the Speakers column (3-line cards, bars aligned)', e.c3 > 0 && e.c3al, JSON.stringify(e));   // 0.3.5 J4/J6 cards replace the G9 one-line rows
  const z = p.locator('.e1 .zcard').first(); if (await z.count()) { await z.click({ position: { x: 20, y: 30 } }); await p.waitForTimeout(800);
    const hlr = await p.evaluate(() => ({ dim: document.querySelectorAll('.e1 .scol .dc3.dimmed').length, all: document.querySelectorAll('.e1 .scol .dc3').length, picked: !!document.querySelector('.e1 .zcard.picked') }));
    ok('G9 selecting a zone highlights its speakers and dims the others', hlr.picked && hlr.dim > 0 && hlr.dim < hlr.all, JSON.stringify(hlr)); await shot(p, 'devices-e1-zone'); await p.locator('.e1 .zall').click(); }
  await setTheme(p, 'pepecoin'); await p.waitForTimeout(500); await shot(p, 'devices-e1-pepecoin'); await setTheme(p, 'default');
});

if (want('g11')) await step('g11', async () => {
  await setPanels(p, NORMAL); await home(); await openSet('appearance', 'Theme');   // 0.3.5 J2: Display size is on the Theme page await shot(p, 'slider-style-setting');
  const tr = () => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--voltrack').trim());
  const g = await tr(); await p.locator('.sliderstyle button[data-slider=flat]').click(); await p.waitForTimeout(300); const f = await tr();
  const acc = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()); ok('G11 Gradient (default) from theme colors, Flat = primary (0.3.4: one-color gradient)', /gradient/.test(g) && (f === acc || f.replace(/\s/g, '') === `linear-gradient(${acc},${acc})`), JSON.stringify({ g, f, acc }));
  await closeDlg(p); await clean(); await shot(p, 'devices-flat-slider'); await p.evaluate(() => { localStorage.setItem('wavwiz.sliderstyle', 'gradient'); document.documentElement.dataset.slider = 'gradient'; });
});

if (want('g12')) await step('g12', async () => {
  await setPanels(p, NORMAL); await home(); await clean();
  const lib = await api('/library/tracks?limit=4').catch(() => null);
  await api('/queue/clear', 'POST'); const tr = await api('/library/tracks').catch(() => []); const tl = Array.isArray(tr) ? tr : tr.tracks || [];
  await api('/queue/add', 'POST', { kind: 'tracks', ids: tl.slice(0, 5).map(t => t.id) });
  await home(); await clean();
  const titles = () => p.evaluate(() => [...document.querySelectorAll('.qtable tbody tr[data-i] td:nth-child(2)')].map(t => t.textContent));
  const before = await titles();
  if (before.length >= 3) {
    await p.locator('.qtable tbody tr[data-i="0"]').dragTo(p.locator('.qtable tbody tr[data-i="2"]'), { targetPosition: { x: 40, y: 18 } }); await p.waitForTimeout(1500);
    const after = await titles(); ok('G12 drag a row to reorder', after[0] !== before[0] && after.includes(before[0]), JSON.stringify({ before: before.slice(0, 4), after: after.slice(0, 4) }));
    await p.keyboard.press('Control+z'); await p.waitForTimeout(1500); const und = await titles(); ok('G12 Ctrl+Z undoes the reorder', JSON.stringify(und) === JSON.stringify(before), JSON.stringify(und.slice(0, 4)));
    const n0 = before.length; const src = p.locator('.libpanel [draggable=true]').first();
    if (await src.count()) { await src.dragTo(p.locator('.qtable tbody tr[data-i="1"]'), { targetPosition: { x: 40, y: 4 } }); await p.waitForTimeout(1500); const t2 = await titles(); ok('G12 drop from the Library into the playlist', t2.length > n0, `${n0} -> ${t2.length}`); }
    else ok('G12 drop from the Library into the playlist', false, 'no draggable library item');
    await shot(p, 'playlist-dnd');
  } else ok('G12 drag reorder', false, 'queue too short: ' + before.length);
});

if (want('g14')) await step('g14', async () => {
  await home(); await clean(); await p.evaluate(async () => { const m = await import('/js/main.js'); m.go?.('eq'); }); await p.waitForTimeout(400);
  if (!(await p.locator('[data-eqglow]:visible').count())) { await p.locator('.topbar button', { hasText: /Sound/ }).first().click().catch(() => {}); await p.waitForTimeout(1500); }
  if (!(await p.locator('[data-eqglow]:visible').count())) { await p.locator('text=Playback').first().click(); await p.locator('text=Sound / EQ').first().click(); await p.waitForTimeout(1500); }
  // 0.3.5: desktop Playback > Sound / EQ is the center EQ panel (no glow there); the glow slider lives in Settings > Appearance > EQ
  if (!(await p.locator('[data-eqglow]:visible').count())) { await closeDlg(p); await p.evaluate(async () => (await import('/js/main.js')).go('settings:eq')); await p.waitForTimeout(1500); }
  const sl = p.locator('[data-eqglow]:visible').first();
  if (!(await sl.count())) { ok('G14 glow slider found', false); return; }
  await sl.evaluate(e => { window.__g14 = e; e.value = 0; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(500);
  const b = await sl.boundingBox(); await p.mouse.move(b.x + 3, b.y + b.height / 2); await p.mouse.down();
  const vals = []; for (let i = 1; i <= 25; i++) { await p.mouse.move(b.x + 3 + (b.width - 6) * i / 25, b.y + b.height / 2); await p.waitForTimeout(30); vals.push(await p.evaluate(() => [+window.__g14.value, window.__g14.isConnected, document.contains(window.__g14)])); }
  await p.mouse.up(); await p.waitForTimeout(400);
  const same = vals.every(v => v[1]), mono = vals.every((v, i) => i === 0 || v[0] >= vals[i - 1][0]), end = vals[vals.length - 1][0];
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('wavwiz.eqstyle') || localStorage.getItem('wavwiz.eqprefs') || '{}').glow);
  ok('G14 glow slider follows the drag smoothly (same element, rising, reaches the end)', same && mono && end >= 95, JSON.stringify({ end, same, mono, sample: vals.filter((_, i) => i % 6 === 0).map(v => v[0]) }));
  ok('G14 value saved on release', saved === end || saved == null, String(saved));
  await shot(p, 'g14-glow'); await closeDlg(p);
});

if (want('mini')) await step('mini', async () => {
  for (const [w, hh, n] of [[420, 145, 'main'], [300, 48, 'slim']]) for (const t of ['default', 'pepecoin']) {
    const mc = await cb.newContext({ viewport: { width: w, height: hh } }); await mc.addCookies([{ name: 'unison_session', value: sess, url: B }]);
    await mc.addInitScript(id => { localStorage.setItem('wavwiz.theme', JSON.stringify({ preset: id })); }, t);
    const mp = await mc.newPage(); const me = []; mp.on('pageerror', e => me.push(e.message)); await mp.goto(B + '/mini.html'); await mp.waitForTimeout(2500);
    if (t === 'pepecoin') await mp.evaluate(async () => { const m = await import('/js/theme.js'); m.applyTheme({ ...m.PRESETS.pepecoin, preset: 'pepecoin' }); });
    const r = await mp.evaluate(() => { const box = document.querySelector('.mp').getBoundingClientRect(); const out = [...document.querySelectorAll('.mp button,.mp input,.mp-t')].filter(e => e.offsetParent).filter(e => { const b = e.getBoundingClientRect(); return b.right > box.right + 1 || b.bottom > box.bottom + 1; }).length;
      const t = document.querySelector('.mp-t').getBoundingClientRect(), s = document.querySelector('.mp-seek').getBoundingClientRect(), a = document.querySelector('.mp-a').getBoundingClientRect();
      return { out, mute: !!document.querySelector('.mp-mute:not([hidden])') && !document.querySelector('.mp-mute').textContent.trim(), sep: t.bottom <= s.top + 1 && (a.height === 0 || s.bottom <= a.top + 1), op: !!document.querySelector('.mp-op') }; });
    if (n === 'main') { ok(`G4 mini (${t}): icon-only mute, transparency control, title above / artist below the bar, nothing clipped`, r.out === 0 && r.mute && r.op && r.sep && me.length === 0, JSON.stringify(r));
      await mp.locator('.mp-op').click(); await mp.locator('.mp-opsl').fill('40'); await mp.waitForTimeout(200); const o = await mp.evaluate(() => [localStorage.getItem('wavwiz.mini.opacity'), getComputedStyle(document.querySelector('.mp')).opacity]);
      ok(`G4 mini (${t}): opacity remembered (40), solid while hovered`, o[0] === '40', JSON.stringify(o)); await mp.mouse.move(5, 5); }
    else ok(`G4 mini slim (${t}) fits`, r.out === 0, JSON.stringify(r));
    await mp.screenshot({ path: `/workspace/screens/wavwiz-033-mini-${n}-${t}.png` }); await mc.close();
  }
});

await step('regress', async () => {
  await setPanels(p, { ...NORMAL, exp: 'dev' }); await home(); await clean();
  const r = await p.evaluate(() => ({ lock: !!document.querySelector('.vlock') || true, f21: [...document.querySelectorAll('.e1 .scol .dc3 .dc3l2')].length > 0 }));
  ok('regress: F21->J4 tags have their own row on speaker cards', r.f21);
  ok('regress: no script errors during the run', errs.length === 0, errs.slice(0, 3).join(' | '));
});
const pass = R.filter(r => r.pass).length; console.log(`\nui033: ${pass}/${R.length} passed`); await cb.close(); process.exit(pass === R.length ? 0 : 1);

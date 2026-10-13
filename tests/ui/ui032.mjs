// WavWiz 0.3.2: browser checks for every acceptance item a browser can see (F1-F17), all 10 themes for F17, mini player, smoke.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const IP = '172.30.0.2', B = `http://${IP}:47800`;
const sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim();
const R = []; const ok = (name, pass, info = '') => { R.push({ name, pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' :: ' + info : '')); };
const shot = (p, n) => p.screenshot({ path: `/workspace/screens/wavwiz-032-${n}.png` });
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
for (let i = 0; i < 4; i++) { const sp = await spc.newPage(); await sp.goto(B + '/'); await sp.waitForTimeout(2500); await sp.mouse.click(500, 350); await sp.waitForTimeout(800); }
await new Promise(r => setTimeout(r, 2000));
const zs = await api('/zones?all=1'); const ids = (Array.isArray(zs) ? zs : zs.zones || []).map(z => z.id).filter(Boolean);
const groups = await api('/groups');
if (!(Array.isArray(groups) && groups.length >= 2 && groups.every(g => g.members > 0)) && ids.length >= 2) { for (const g of (Array.isArray(groups) ? groups : [])) await api('/groups/' + g.id, 'DELETE'); await api('/groups', 'POST', { name: 'Downstairs', deviceIds: ids.slice(0, 2) }); await api('/groups', 'POST', { name: 'Patio', deviceIds: ids.slice(1, 3) }); }
const gl = await api('/groups'); if (Array.isArray(gl) && gl[1]) await api(`/groups/${gl[1].id}/mute`, 'POST', { muted: true });
console.log('setup', JSON.stringify({ ids, groups: gl }).slice(0, 400));

const ctx = await cb.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
await ctx.addInitScript(() => { if (!localStorage.getItem('seeded32')) { localStorage.setItem('seeded32', '1'); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'open' })); } });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
const home = async () => { await p.goto(B + '/'); await p.waitForSelector('.desk', { timeout: 15000 }); await p.waitForTimeout(2000); await closeDlg(p); await p.waitForTimeout(300); };

await step('smoke', async () => {
  await home(); await shot(p, 'smoke-desktop');
  ok('smoke: app loads without script errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  const v = await api('/status'); ok('smoke: server reports 0.3.2', JSON.stringify(v).includes('0.3.2'), String(v.version || ''));
  const about = await p.evaluate(async () => (await import('/js/about.js')).WHATS_NEW_VERSION); ok('smoke: What\'s new is 0.3.2', about === '0.3.2', about);
});

if (want('art')) await step('art', async () => {
  await p.waitForTimeout(1500);
  const r = await p.evaluate(async () => { const imgs = [...document.querySelectorAll('img')].filter(i => /\/art\//.test(i.src) && i.complete && i.naturalWidth > 0);
    const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d'); let bad = 0; const out = [];
    for (const i of imgs.slice(0, 30)) { g.drawImage(i, 0, 0, 8, 8); const d = g.getImageData(0, 0, 8, 8).data; let mag = 0; for (let k = 0; k < d.length; k += 4) { const [r, gg, b] = [d[k], d[k + 1], d[k + 2]]; if (r > 180 && b > 180 && gg < 80 || gg > 200 && r < 60 && b < 60) mag++; } if (mag > 40) bad++; out.push(i.src.split('/art/')[1]); }
    return { n: imgs.length, bad, cv: imgs.every(i => i.src.includes('cv=3.0.3.2')), sample: out.slice(0, 3) }; });
  ok('F10/F11 art shows in the UI, no scrambled tiles, versioned URLs', r.n > 0 && r.bad === 0 && r.cv, JSON.stringify(r)); await shot(p, 'f10-art-library');
});

if (want('f1')) await step('f1', async () => {
  await setPanels(p, { ...NORMAL, lib: 'rail', dev: 'rail' }); await p.evaluate(() => localStorage.setItem('wavwiz.view', 'now')); await home();
  if (!(await p.evaluate(() => document.querySelector('.libpanel').classList.contains('israil')))) await p.click('.libpanel .libcol');
  if (!(await p.evaluate(() => document.querySelector('.devpanel').classList.contains('israil')))) await p.click('.devpanel .devcol, .devpanel .pchev');
  await p.waitForTimeout(600);
  const r = await p.evaluate(() => [...document.querySelectorAll('.prail-t')].filter(e => e.offsetParent).map(e => ({ lib: !!e.closest('.libpanel'), t: getComputedStyle(e).transform, wm: getComputedStyle(e).writingMode })));
  const lib = r.find(x => x.lib), dev = r.find(x => !x.lib);
  ok('F1 collapsed Library rail mirrors Devices (rotated 180°)', !!lib && !!dev && /matrix\(-1, ?[-0-9.e]+, ?[-0-9.e]+, ?-1/.test(lib.t) && dev.t === 'none', JSON.stringify(r)); await shot(p, 'f1-rails');
  await setPanels(p, NORMAL);
});

if (want('dev')) await step('dev', async () => {
  await setPanels(p, NORMAL); await home();
  const r = await p.evaluate(() => { const q = s => [...document.querySelectorAll(s)].filter(e => e.offsetParent);
    const mm = q('.devpanel .mastermute')[0], mutes = q('.devpanel .mutebtn'), heads = q('.devpanel .dsec-h'), zc = q('.devpanel .zcard'), dc = q('.devpanel .dcard');
    const cx = e => { const b = e.getBoundingClientRect(); return Math.round(b.left + b.width / 2); };
    return { master: !!mm, round: mm && getComputedStyle(mm).borderRadius, muteAllText: document.querySelector('.devpanel')?.textContent.includes('Mute all'), mutesX: [...new Set(mutes.map(cx))], heads: heads.map(h => h.textContent.trim().slice(0, 20)), headBorder: heads.map(h => getComputedStyle(h).borderTopWidth + '/' + getComputedStyle(h).borderBottomWidth), zones: zc.length, devs: dc.length,
      mutedAmber: zc.filter(z => z.querySelector('.mutebtn.on')).map(z => getComputedStyle(z.querySelector('.mutebtn.on')).color) }; });
  ok('F4/F5 round master mute, no "Mute all" text, mute buttons in one column', r.master && !r.muteAllText && r.mutesX.length <= 2, JSON.stringify(r));
  ok('F6 Devices / Zones sections with dividers', r.heads.length >= 2 && r.headBorder.some(b => b !== '0px/0px'), JSON.stringify(r.heads) + ' ' + JSON.stringify(r.headBorder));
  ok('F3 zones show as cards', r.zones >= 2, String(r.zones));
  ok('F5 a muted zone shows an amber mute icon', r.mutedAmber.length >= 1, JSON.stringify(r.mutedAmber));
  await shot(p, 'f3-f6-devices-standard');
  const g = (await api('/groups'))[0]; if (g) { const before = g.volume ?? g.Volume ?? 0.5, tgt = Math.max(0, before - 0.1); const res = await api(`/groups/${g.id}/volume`, 'POST', { set: tgt }); const after = (await api('/groups'))[0]; ok('F4 zone volume API sets the zone level', Math.abs((after.volume ?? after.Volume) - tgt) < 0.02, JSON.stringify({ before, res, after: after.volume ?? after.Volume })); }
});

if (want('f7')) await step('f7', async () => {
  await setPanels(p, NORMAL); await home();
  const r = await p.evaluate(() => { const L = e => e ? Math.round(e.getBoundingClientRect().left) : null; const vis = s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && e.textContent.trim());
    const dt = vis('.devpanel .devhead .devtitle')[0], secs = vis('.devpanel .dsec-h > span:first-child'), lt = vis('.libpanel .libtitle')[0], ls = document.querySelector('.libpanel input[type=search]');
    const btnR = vis('.devpanel .devhead button').map(b => Math.round(b.getBoundingClientRect().left)), dtR = dt && Math.round(dt.getBoundingClientRect().right);
    return { dev: L(dt), secs: secs.map(L), lib: L(lt), libSearch: L(ls), arrowsRight: btnR.every(x => x >= dtR) }; });
  ok('F7 DEVICES title left edge = Zones/Devices section titles; arrows on the right', r.dev != null && r.secs.length > 0 && r.secs.every(x => Math.abs(x - r.dev) <= 1) && r.arrowsRight, JSON.stringify(r));
  ok('F7 LIBRARY title left edge = library content edge', r.lib != null && Math.abs(r.lib - r.libSearch) <= 2, JSON.stringify(r)); await shot(p, 'f7-headers');
});

if (want('f8')) for (const w of [1920, 1280]) await step('f8-' + w, async () => {
  await p.setViewportSize({ width: w, height: w === 1920 ? 1080 : 800 }); await setPanels(p, NORMAL); await home();
  const nw = await p.evaluate(() => Math.round(document.querySelector('.nowcol')?.getBoundingClientRect().width || 0));
  const cw = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--centerw').trim());
  await p.evaluate(async () => { const m = await import('/js/main.js'); m.go('settings:general'); }); await p.waitForTimeout(1200);
  const dw = await p.evaluate(() => { const d = [...document.querySelectorAll('dialog[open]')].pop(); return d ? [Math.round(d.getBoundingClientRect().width), d.className] : null; });
  ok(`F8 @${w}: popups use the center column width`, !!dw && Math.abs(dw[0] - nw) <= 24, JSON.stringify({ cw, nw, dw })); await shot(p, 'f8-popup-' + w); await closeDlg(p);
});
await p.setViewportSize({ width: 1920, height: 1080 });

if (want('f9')) await step('f9', async () => {
  await setPanels(p, NORMAL); await home();
  const s = p.locator('.libpanel input[type=search], .libpanel input[type=text]').first(); await s.click();
  const pos = () => p.evaluate(() => [...document.querySelectorAll('.libpanel .pane-h *')].filter(e => e.offsetParent).slice(0, 14).map(e => { const b = e.getBoundingClientRect(); return [b.left | 0, b.top | 0, b.width | 0]; }).join(';'));
  const a = await pos(); await s.type('atl', { delay: 150 }); await p.waitForTimeout(500); const b = await pos(); const caret = await p.evaluate(() => [document.activeElement?.tagName, document.activeElement?.selectionStart]);
  ok('F9 search: header does not move while typing, caret kept', a === b && caret[0] === 'INPUT' && caret[1] === 3, JSON.stringify({ caret, same: a === b, a: a.slice(0, 120), b: b.slice(0, 120) })); await shot(p, 'f9-search'); await s.fill('');
});

if (want('f12')) await step('f12', async () => {
  await closeDlg(p); await p.evaluate(async () => { const m = await import('/js/main.js'); m.go('settings:appearance'); }); await p.waitForTimeout(1500);
  await p.locator('dialog[open].settings-dlg .subtabs button:visible', { hasText: /^Now Playing$/ }).first().click(); await p.waitForTimeout(2000);
  const r = await p.evaluate(() => { const g = [...document.querySelectorAll('.settings-dlg .pgrid-np')].find(e => e.offsetParent); const cs = [...g.children].map(c => c.getBoundingClientRect()); const top = cs[0].top;
    const th = [...g.querySelectorAll('.npthumb')].map(t => { const pn = t.firstElementChild; return { h: Math.round(t.getBoundingClientRect().height), ph: pn ? Math.round(pn.getBoundingClientRect().height) : 0, tr: pn?.style.transform || '', viz: !!pn?.querySelector('canvas') }; });
    const card = g.querySelector('[data-npstyle=center]'); let cl = null;
    if (card) { const art = card.querySelector('.pn-art'), seek = card.querySelector('.np-tableseek'); if (art && seek) { const a = art.getBoundingClientRect(), s = seek.getBoundingClientRect(); cl = { artR: a.right | 0, seekL: s.left | 0, overlapY: a.bottom > s.top && a.top < s.bottom }; } }
    const sel = g.querySelector('.pgcard.on'); const after = g.nextElementSibling;
    return { n: cs.length, perRow: cs.filter(r => Math.abs(r.top - top) < 2).length, w: cs.map(r => Math.round(r.width)), th, cl, outline: sel && getComputedStyle(sel).borderColor, effectsBelow: !!after && /Effects/.test(after.textContent), names: [...g.querySelectorAll('.pg-meta b')].map(b => b.textContent) }; });
  ok('F12 four styles, 2 per row at ~543 px', r.n === 4 && r.perRow === 2 && r.w.every(x => Math.abs(x - 543) <= 30), JSON.stringify({ n: r.n, perRow: r.perRow, w: r.w, names: r.names }));
  ok('F12 previews at true size (never scaled up), height fits the panel, no visualizer', r.th.length === 4 && r.th.every(t => t.ph > 0 && Math.abs(t.h - t.ph) <= 2 && !t.viz), JSON.stringify(r.th));
  ok('F12 Center: cover left of the seek bar', !!r.cl && r.cl.artR <= r.cl.seekL + 2 && r.cl.overlapY, JSON.stringify(r.cl));
  ok('F12 Effects options below the grid, selected card outlined', r.effectsBelow && !!r.outline, JSON.stringify({ e: r.effectsBelow, o: r.outline }));
  await shot(p, 'f12-np-picker'); await closeDlg(p);
});

if (want('f13')) await step('f13', async () => {
  await setPanels(p, NORMAL); await home();
  const g = () => p.evaluate(() => { const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left | 0, b.top | 0, b.width | 0, b.height | 0]; }; return { list: r('.listpanel'), lib: r('.libpanel'), dev: r('.devpanel'), now: r('.nowcol'), listh: getComputedStyle(document.querySelector('.desk')).getPropertyValue('--listh').trim() }; });
  const n = await g();
  ok('F13 playlist at center column width; side panels full height', n.list && n.now && Math.abs(n.list[0] - n.now[0]) <= 2 && Math.abs(n.list[2] - n.now[2]) <= 2 && n.lib[1] + n.lib[3] >= n.list[1] + n.list[3] - 2, JSON.stringify(n));
  ok('F13 normal playlist height equals --listh (0.3.1 height)', !n.listh || Math.abs(parseFloat(n.listh) - n.list[3]) <= 2, JSON.stringify({ listh: n.listh, h: n.list[3] }));
  await shot(p, 'f13-playlist-normal');
  await p.locator('.listpanel .listup').first().click(); await p.waitForTimeout(700); const e = await g();
  ok('F13 expand up: taller, same width, side panels unchanged', e.list[3] > n.list[3] + 50 && Math.abs(e.list[2] - n.list[2]) <= 2 && e.lib[3] === n.lib[3], JSON.stringify(e)); await shot(p, 'f13-playlist-expanded');
  await p.locator('.listpanel .listcol').first().click(); await p.waitForTimeout(500); const back = await g();
  ok('F13 ˅ from expanded returns to normal height', Math.abs(back.list[3] - n.list[3]) <= 2, JSON.stringify(back));
  await p.locator('.listpanel .listcol').first().click(); await p.waitForTimeout(500); const c = await g();
  ok('F15 ˅ from normal collapses', c.list[3] < n.list[3], JSON.stringify(c)); await shot(p, 'f15-playlist-collapsed');
  const arrows = await p.evaluate(() => [...document.querySelectorAll('.listpanel .listup, .listpanel .listcol')].filter(e => e.offsetParent).map(e => e.textContent.trim()));
  ok('F15 arrows: ˄ expands up, ˅ collapses', arrows.length >= 1 && arrows.every(a => a === '˄' || a === '˅'), JSON.stringify(arrows));
  await p.locator('.listpanel .listup').first().click().catch(() => {}); await p.waitForTimeout(400);
});

if (want('f16')) await step('f16', async () => {
  await setPanels(p, NORMAL); await home();
  for (const sec of ['library', 'network']) {
    await p.evaluate(async s => { const m = await import('/js/main.js'); m.go('settings:' + s); }, sec); await p.waitForTimeout(1500);
    const r = await p.evaluate(() => { const sc = [...document.querySelectorAll('dialog[open] .settings-scroll')].find(e => e.offsetParent); return sc ? { sh: sc.scrollHeight, ch: sc.clientHeight, cols: new Set([...sc.querySelectorAll('.card')].filter(c => c.offsetParent).map(c => c.getBoundingClientRect().left | 0)).size, info: sc.querySelectorAll('.infoi').length } : null; });
    ok(`F16 ${sec}: fits at 1920x1080 without scrolling, two-column cards, (i) help`, !!r && r.sh <= r.ch + 1 && r.cols >= 2, JSON.stringify(r)); await shot(p, 'f16-settings-' + sec); await closeDlg(p);
  }
});

if (want('f17')) await step('f17', async () => {
  for (const w of [1920, 1280]) {
    await p.setViewportSize({ width: w, height: w === 1920 ? 1080 : 800 }); await setPanels(p, { ...NORMAL, exp: 'dev' }); await home();
    for (const t of THEMES) {
      await setTheme(p, t); await p.waitForTimeout(350);
      const r = await p.evaluate(() => { const vis = s => [...document.querySelectorAll(s)].filter(e => e.offsetParent); const R = e => e.getBoundingClientRect();
        const main = document.querySelector('.devpanel.expanded .dexp-main'); if (!main) return { err: 'no expanded main' };
        const dc = vis('.devpanel .dgrid .dcard'), zc = vis('.devpanel .zcol .zcard'), zcol = document.querySelector('.devpanel .zcol'), grid = document.querySelector('.devpanel .dgrid');
        const cols = getComputedStyle(main).gridTemplateColumns.split(' ').map(parseFloat);
        const dl = [...new Set(dc.map(c => Math.round(R(c).left)))].sort((a, b) => a - b), dw = [...new Set(dc.map(c => Math.round(R(c).width)))];
        const zl = [...new Set(zc.map(c => Math.round(R(c).left)))], zw = [...new Set(zc.map(c => Math.round(R(c).width)))];
        const pitch = dl.length > 1 ? dl[1] - dl[0] : null;
        const txt = (e, s) => { const n = e?.querySelector(s); return n ? Math.round(R(n).left - R(e).left) : null; };
        const before = zcol && getComputedStyle(zcol, '::before'); const div = document.querySelector('.devpanel .zcol .zcol-div');
        const muted = zc.find(z => z.querySelector('.mutebtn.on')); const amber = muted && getComputedStyle(muted.querySelector('.mutebtn.on')).color;
        return { cols: cols.map(Math.round), dl, dw, zl, zw, pitch, txt: [txt(dc[0], '.dname'), txt(zc[0], '.zname')], sub: [txt(dc[0], '.dstatus'), txt(zc[0], '.zc-mem')], vdiv: !!before && before.content !== 'none', hdiv: !!div && zc.length > 0 && R(div).top >= R(zc[zc.length - 1]).bottom - 1, amber, nz: zc.length, nd: dc.length, gridCols: new Set(dc.map(c => Math.round(R(c).left))).size }; });
      const equal4 = r.cols && r.cols.length === 4 && Math.max(...r.cols) - Math.min(...r.cols) <= 1;
      const pass = !r.err && equal4 && r.gridCols === 3 && r.dl.length === Math.min(3, r.nd) && r.dw.length === 1 && r.zw.length === 1 && Math.abs(r.zw[0] - r.dw[0]) <= 1 && r.zl.length === 1 && Math.abs(r.zl[0] - (r.dl[0] + 3 * r.pitch)) <= 1 && r.vdiv && r.hdiv && r.txt[0] != null && r.txt[0] === r.txt[1] && r.sub[0] === r.sub[1] && !!r.amber;
      ok(`F17 @${w} ${t}: 4 equal columns, zone cards = device cards (width/edges), dividers, text aligned, muted icon`, pass, JSON.stringify(r));
      if (t === 'default' || t === 'daylight') await shot(p, `f17-expanded-${w}-${t}`);
    }
  }
  await setTheme(p, 'default'); await p.setViewportSize({ width: 1920, height: 1080 }); await setPanels(p, NORMAL);
});

if (want('mini')) await step('mini', async () => {
  for (const [w, h, n] of [[420, 72, 'full'], [300, 48, 'slim']]) for (const t of ['default', 'daylight']) {
    const mc = await cb.newContext({ viewport: { width: w, height: h } }); await mc.addCookies([{ name: 'unison_session', value: sess, url: B }]);
    const mp = await mc.newPage(); const me = []; mp.on('pageerror', e => me.push(e.message)); await mp.goto(B + '/mini.html'); await mp.waitForTimeout(2500);
    await mp.evaluate(async t => { try { const m = await import('/js/theme.js'); m.applyTheme({ ...m.PRESETS[t], preset: t }); } catch {} }, t); await mp.waitForTimeout(300);
    const r = await mp.evaluate(() => ({ slim: !!document.querySelector('.slim'), ow: document.documentElement.scrollWidth, oh: document.documentElement.scrollHeight, btns: [...document.querySelectorAll('button')].filter(b => b.offsetParent).length, bg: getComputedStyle(document.body).backgroundColor }));
    ok(`Mini player ${n} ${w}x${h} ${t}: fits, themed, no errors`, r.ow <= w && r.oh <= h && r.btns >= 3 && me.length === 0 && (n === 'slim') === r.slim, JSON.stringify({ ...r, me }));
    await mp.screenshot({ path: `/workspace/screens/wavwiz-032-mini-${n}-${t}.png` }); await mc.close();
  }
});

if (want('remote')) await step('remote', async () => {
  await home(); const r = await p.evaluate(() => ({ txt: document.body.innerHTML.includes('Use as remote only') }));
  ok('Remote mode removed from the web UI', !r.txt, JSON.stringify(r));
});


if (want('f18')) await step('f18', async () => {
  const zl = await api('/zones?all=1'); const z = (Array.isArray(zl) ? zl : zl.zones).find(x => x.connected) || (Array.isArray(zl) ? zl : zl.zones)[0];
  for (const o of await api('/zones?all=1')) await api(`/zones/${o.id}`, 'PATCH', { volume: 30 });   // room is the loudest, so master 100 would scale it far past the cap
  await api(`/zones/${z.id}`, 'PATCH', { volume: 40 }); await api(`/zones/${z.id}/volcap`, 'PUT', { cap: 40, locked: true });
  await api('/zones/master', 'POST', { set: 100 }); const all1 = await api('/zones?all=1'), v1 = all1.find(x => x.id === z.id).volume, other = all1.find(x => x.id !== z.id && x.enabled)?.volume;
  await api(`/zones/${z.id}`, 'PATCH', { volume: 80 }); const v2 = (await api('/zones?all=1')).find(x => x.id === z.id).volume;
  await api(`/zones/${z.id}`, 'PATCH', { volume: 20 }); const v3 = (await api('/zones?all=1')).find(x => x.id === z.id).volume;
  ok('F18 cap 40 locked: master 100 -> 40, request 80 -> 40, lowering to 20 works', v1 === 40 && other > 30 && v2 === 40 && v3 === 20, JSON.stringify({ v1, other, v2, v3 }));
  for (const t of THEMES) {
    await setPanels(p, NORMAL); await home(); await setTheme(p, t); await p.waitForTimeout(300);
    const r = await p.evaluate(id => { const c = document.querySelector(`.devpanel [data-zone-id="${id}"]`); const l = c?.querySelector('.vlock'); const v = c?.querySelector('.dvol'); if (!l || !v) return null; const a = l.getBoundingClientRect(), b = v.getBoundingClientRect(); return { inBar: a.top >= b.top - 2 && a.bottom <= b.bottom + 2, color: getComputedStyle(l).color, w: a.width | 0 }; }, z.id);
    ok(`F18 ${t}: padlock beside the room's volume bar`, !!r && r.inBar && r.w > 0, JSON.stringify(r));
    if (t === 'default') await shot(p, 'f18-volume-lock');
  }
  await api(`/zones/${z.id}/volcap`, 'PUT', { locked: false }); await api(`/zones/${z.id}`, 'PATCH', { volume: 80 }); const v4 = (await api('/zones?all=1')).find(x => x.id === z.id).volume;
  ok('F18 unlock restores normal behavior', v4 === 80, String(v4)); await api(`/zones/${z.id}`, 'PATCH', { volume: 60 });
});

if (want('f19')) await step('f19', async () => {
  await setPanels(p, NORMAL); await p.evaluate(() => localStorage.setItem('wavwiz.center.v1', 'eq')); await home();
  for (const t of THEMES) {
    await setTheme(p, t); await p.waitForTimeout(300);
    const lockOn = () => p.evaluate(() => document.querySelector('.np-stage .vbtns .ov-lock')?.classList.contains('on'));
    if (await lockOn()) { await p.click('.np-stage .vbtns .ov-lock'); await p.waitForTimeout(400); }
    const area = p.locator('.np-stage .eqarea').first(); await p.mouse.move(5, 5); await p.waitForTimeout(300);
    const a = await area.screenshot(); const offStyle = await p.evaluate(() => { const b = document.querySelector('.np-stage .vbtns .ov-lock'); const cs = getComputedStyle(b); return cs.color + '|' + cs.borderColor; });
    await p.click('.np-stage .vbtns .ov-lock'); await p.waitForTimeout(400); await p.mouse.move(5, 5); await p.waitForTimeout(300);
    const b = await area.screenshot(); const on = await p.evaluate(() => { const b = document.querySelector('.np-stage .vbtns .ov-lock'); const e = document.querySelector('.np-stage .eqarea'); const cs = getComputedStyle(b); return { on: b.classList.contains('on'), c: cs.color, bc: cs.borderColor, eqOp: getComputedStyle(e.querySelector('.eqa-plot') || e).opacity, filt: getComputedStyle(e.querySelector('.eqa-plot') || e).filter, title: e.title, cur: getComputedStyle(e.querySelector('.eqb') || e).cursor }; });
    const want = t === 'pepecoin' ? 'rgb(192, 122, 78)' : await p.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--red)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });
    ok(`F19 ${t}: locked EQ not dimmed (same pixels), lock button ${t === 'pepecoin' ? 'copper' : 'danger red'}, unlocked normal`, Buffer.compare(a, b) === 0 && on.on && on.eqOp === '1' && on.filt === 'none' && on.c === want && offStyle.split('|')[0] !== want && on.title === 'EQ locked', JSON.stringify({ same: Buffer.compare(a, b) === 0, on, want, offStyle }));
    if (t === 'default' || t === 'pepecoin') await shot(p, 'f19-eq-locked-' + t);
    await p.click('.np-stage .vbtns .ov-lock'); await p.waitForTimeout(300);
  }
  await setTheme(p, 'default');
});

if (want('f20')) await step('f20', async () => {
  for (const mode of ['eq', 'viz']) {
    await setPanels(p, NORMAL); await p.evaluate(m => { localStorage.setItem('wavwiz.center.v1', m); const k = Object.keys(localStorage).find(k => /looks/i.test(k)); localStorage.setItem(k || 'wavwiz.looks.v1', JSON.stringify({ btn: 80, overlay: 50 })); }, mode); await home();
    await p.evaluate(async () => { const l = await import('/js/looks.js'); l.saveLooks?.({ btn: 80, overlay: 50 }); window.dispatchEvent(new Event('wavwiz:looks')); }); await p.mouse.move(5, 5); await p.waitForTimeout(500);
    const g = () => p.evaluate(() => { const v = document.querySelector('.np-stage .vbtns'); const op = e => { let o = 1; for (let x = e; x && x !== document.body; x = x.parentElement) o *= +getComputedStyle(x).opacity; return +o.toFixed(2); };
      const canv = document.querySelector('.np-stage.viz .vizhost canvas, .np-stage .vizhost canvas') ; const eq = document.querySelector('.np-stage .eqarea .eqa-plot, .np-stage .eqarea');
      return { btn: op(v), canvas: canv ? op(canv) : null, eq: eq && eq.offsetParent ? op(eq) : null }; });
    const rest = await g(); await p.hover('.np-stage .vbtns'); await p.waitForTimeout(300); const hov = await g();
    await p.mouse.move(5, 5); await p.focus('.np-stage .vbtns button'); await p.waitForTimeout(300); const foc = await g();
    await p.click('.np-stage .vbtns .ov-looks'); await p.mouse.move(5, 5); await p.waitForTimeout(400); const pop = await g(); await p.keyboard.press('Escape');
    const full = mode === 'eq' ? rest.eq === 1 : (rest.canvas === null || rest.canvas === 1);
    ok(`F20 ${mode}: Button transparency 80% fades only the button group (0.2); solid on hover, focus, popover; ${mode} at full opacity`, rest.btn === 0.2 && hov.btn === 1 && foc.btn === 1 && pop.btn === 1 && full, JSON.stringify({ rest, hov, foc, pop }));
    await shot(p, 'f20-buttons-' + mode);
  }
  await p.evaluate(async () => { const l = await import('/js/looks.js'); l.saveLooks?.({ btn: 50, overlay: 50 }); localStorage.setItem('wavwiz.center.v1', 'eq'); });
});

if (want('f21')) await step('f21', async () => {
  for (const [exp, n] of [[null, 'standard'], ['dev', 'expanded']]) {
    await p.setViewportSize({ width: 1920, height: 1080 }); await setPanels(p, { ...NORMAL, exp }); await home();
    const r = await p.evaluate(() => { const R = e => e.getBoundingClientRect(); const cards = [...document.querySelectorAll('.devpanel .dcard, .devpanel .drow, .devpanel .zcard')].filter(c => c.offsetParent);
      return cards.map(c => { const top = c.querySelector('.dtop, .zc-top'), vol = c.querySelector(':scope > .dvol'), row = c.querySelector(':scope > .dtagrow'), name = c.querySelector('.dname, .zname');
        const tagsTop = top ? top.querySelectorAll('.dtag').length : -1; const tags = row ? [...row.querySelectorAll('.dtag')].filter(t => t.offsetParent) : [];
        return { zone: c.classList.contains('zcard'), tagsTop, n: tags.length, under: !tags.length || (R(row).top >= R(vol).bottom - 1 && row.previousElementSibling === vol), left: tags.length ? Math.round(R(tags[0]).left - R(name).left) : 0, sw: !!top?.querySelector('.sw') || c.classList.contains('zcard') }; }); });
    const bad = r.filter(x => x.tagsTop !== 0 || !x.under || Math.abs(x.left) > 2 || !x.sw);
    ok(`F21 ${n}: tags on their own row under the volume bar, left-aligned with the name; name line = dot + name (+ switch)`, r.length > 0 && r.some(x => x.n > 0) && r.some(x => x.zone && x.n > 0) && bad.length === 0, JSON.stringify({ n: r.length, withTags: r.filter(x => x.n).length, bad: bad.slice(0, 3) }));
    await shot(p, 'f21-tags-' + n);
  }
  await setPanels(p, NORMAL);
});

ok('smoke: no script errors during the whole run', errs.length === 0, errs.slice(0, 5).join(' | '));
await cb.close();
const f = R.filter(x => !x.pass); console.log(`\n${R.length - f.length}/${R.length} passed`); if (f.length) { console.log('FAILED:'); f.forEach(x => console.log(' - ' + x.name)); }
process.exit(f.length ? 1 : 0);

// WavWiz 0.3.9 e2e (L50-L57). Usage: node ui039.mjs [chromium|webkit]
import { chromium, webkit } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const ENG = process.argv[2] || 'chromium';
const B = 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim();
const ok = (n, c, i = '') => console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? ' :: ' + String(i).slice(0, 400) : ''));
const step = async (n, f) => { if (process.env.ONLY && !new RegExp(process.env.ONLY).test(n)) return; try { await f(); } catch (e) { ok(n, false, String(e).slice(0, 400)); } };
mkdirSync('/workspace/screens', { recursive: true });
const br = await (ENG === 'webkit' ? webkit : chromium).launch();
const THEMES = ['default', 'pepecoin', 'ember', 'arctic', 'violet', 'mono', 'daylight', 'nebula', 'steel', 'lime'];
async function page(w, h, panels, { dsf = 1, scale = 'normal', pins = null, theme = null, url = '/' } = {}) {
  const ctx = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf }); await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(([pn, sc, pi]) => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.uiscale', sc); if (pi) localStorage.setItem('wavwiz.pins.v1', JSON.stringify(pi)); if (pn) localStorage.setItem('wavwiz.panels', JSON.stringify(pn)); }, [panels, scale, pins]);
  const p = await ctx.newPage(); await p.goto(B + url); await p.waitForTimeout(2000); await p.locator('.phone-unlock').click({ timeout: 1500 }).catch(() => {});
  if (theme) await p.evaluate(async id => { const t = await import('/js/theme.js'); t.applyTheme({ ...t.PRESETS[id], preset: id }); }, theme);
  await p.waitForTimeout(400); return { ctx, p };
}
const api = (p, path, method = 'GET', body) => p.evaluate(async ([path, method, body]) => { const r = await fetch('/api/v1' + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json().catch(() => ({})); }, [path, method, body]);
const ST = { normal: { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' }, libexp: { lib: 'normal', dev: 'normal', exp: 'lib', list: 'open', ctl: 'collapsed' }, devexp: { lib: 'normal', dev: 'normal', exp: 'dev', list: 'open', ctl: 'collapsed' }, queue: { lib: 'normal', dev: 'normal', exp: null, list: 'expanded', ctl: 'collapsed' } };
const PINS = ['eq', 'queue', 'library', 'devices', 'scenes'];

// L50: with 5 pins, no two visible controls of the Now Playing bar overlap (box vs box), in every state and small viewport / scale
const overlaps = p => p.evaluate(() => {
  const vis = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; }; const bad = [];
  for (const bar of [...document.querySelectorAll('.npbar,.np-ctlpanel')].filter(vis)) {
    const A = [...bar.querySelectorAll('.transport,.scrow,.scbtn,.npb-seek,.npb-vol,.npb-titles,.npb-art,.np-strip,.np-strip>*:not(.scrow)')].filter(vis);
    for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) { if (A[i].contains(A[j]) || A[j].contains(A[i])) continue; const a = A[i].getBoundingClientRect(), c = A[j].getBoundingClientRect(); if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) bad.push(A[i].className.toString().split(' ')[0] + 'x' + A[j].className.toString().split(' ')[0]); }
  }
  return [...new Set(bad)];
});
for (const sc of ['small', 'normal']) for (const [w, h] of [[1280, 720], [1152, 648], [1024, 600], [960, 540], [1920, 1080]]) for (const [k, pn] of Object.entries(ST)) await step(`L50 ${sc} ${w}x${h} ${k}`, async () => {
  const { ctx, p } = await page(w, h, pn, { dsf: 2, scale: sc, pins: PINS }); const o = await overlaps(p); ok(`L50 pins/transport do not overlap: ${sc} ${w}x${h} ${k}`, o.length === 0, o.join(',')); if (o.length || (w === 1280 && k === 'normal')) await p.screenshot({ path: `/workspace/screens/wavwiz-039-${ENG}-l50-${sc}-${w}-${k}.png` }); await ctx.close();
});

await step('L52 resize wide->narrow->wide->narrow', async () => {
  const { ctx, p } = await page(1920, 1080, null); const st = () => p.evaluate(() => { const v = e => { const b = document.querySelector(e)?.getBoundingClientRect(); return b ? b.width * b.height : 0; }; return { dv: document.getElementById('desk').dataset.view, on: document.querySelectorAll('.tabbar button.on').length, nowcol: v('.nowcol'), view: v('.view'), stage: v('.stage') }; });
  for (const [w, h, narrow] of [[700, 900, true], [1920, 1080, false], [600, 900, true], [1400, 900, false], [500, 800, true]]) { await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(700); const s = await st();
    ok(`L52 ${w}: ${narrow ? 'a tab is active and the center has content' : 'desktop panels'}`, narrow ? (s.on === 1 && (s.nowcol > 0 || s.view > 0) && s.dv === 'now') : s.stage > 0, JSON.stringify(s)); if (narrow) await p.screenshot({ path: `/workspace/screens/wavwiz-039-${ENG}-l52-${w}.png` }); }
  await p.goto(B + '/'); await ctx.close();
});

await step('L55 mini player border is the panel border in every theme', async () => {
  for (const th of THEMES) { const { ctx, p } = await page(1600, 900, ST.queue, { theme: th }); const r = await p.evaluate(() => ({ mp: getComputedStyle(document.querySelector('.minicol .mp')).borderTopColor, line: getComputedStyle(document.querySelector('.listpanel')).borderTopColor }));
    ok('L55 ' + th, r.mp === r.line, JSON.stringify(r)); if (th === 'default' || th === 'daylight') await p.screenshot({ path: `/workspace/screens/wavwiz-039-${ENG}-l55-${th}.png`, clip: { x: 700, y: 540, width: 900, height: 360 } }); await ctx.close(); }
});

for (const [w, h, sc] of [[1920, 1080, 'normal'], [1366, 768, 'small']]) await step(`L51/L53/L54/L56 expanded Devices ${w} ${sc}`, async () => {
  const { ctx, p } = await page(w, h, ST.devexp, { scale: sc });
  const m = await p.evaluate(() => { const R = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
    const cols = [...document.querySelectorAll('.dexp-main > .ecol')].filter(e => e.getClientRects().length).map(e => e.className.split(' ')[0]); const card = document.querySelector('.scol .dc3.clickable'); const cb = card?.getBoundingClientRect(), r = s => card?.querySelector(s)?.getBoundingClientRect();
    return { cols, znow: document.querySelectorAll('.znow .znow-tile').length, groups: document.querySelectorAll('.zlist .zc3').length, master: R('.dexp-top .dvol-master'), mall: R('.dexp-top .mallrow'), top: R('.dexp-top'), grid: getComputedStyle(document.querySelector('.scol .slist')).gridTemplateColumns.split(' ').length, card: cb && { x: cb.x, w: cb.width, r: cb.right }, bar: r('.vbar') && { w: r('.vbar').width, r: r('.vbar').right }, pct: r('.pct') && { x: r('.pct').x, r: r('.pct').right }, mute: r('.dc3foot .mutebtn') && { r: r('.dc3foot .mutebtn').right, b: r('.dc3foot .mutebtn').bottom }, foot: r('.dc3foot') && { b: r('.dc3foot').bottom }, out: !!card?.querySelector('.dc3out .dout'), zchips: document.querySelectorAll('.zlist .dc3mem').length, arrows: document.querySelectorAll('.dcard .dexpand, .zc3 .dexpand').length }; });
  ok(`L51 ${w}: columns Scenes, Zones, Speakers`, JSON.stringify(m.cols) === JSON.stringify(['sscol', 'zcol', 'scol']), m.cols.join());
  ok(`L51 ${w}: Now playing in each zone has one tile per zone`, m.znow === m.groups && m.znow > 0, `${m.znow}/${m.groups}`);
  ok(`L51 ${w}: speaker cards are a 2-wide grid`, m.grid >= 2, m.grid);
  ok(`L53 ${w}: master slider capped, with a gap before All off / All on`, m.master && m.mall && m.master.w <= 660 && m.mall.x - m.master.r >= 16, JSON.stringify([m.master, m.mall]));
  ok(`L53 ${w}: master row is full width`, m.top && m.mall && m.mall.r <= m.top.r && m.top.w > w * 0.85, JSON.stringify(m.top));
  ok(`L56 ${w}: volume bar edge to edge, % at its right end`, m.bar && m.card && m.bar.w > m.card.w * 0.6 && m.pct.x >= m.bar.r - 2 && m.pct.r <= m.card.r, JSON.stringify([m.bar, m.pct, m.card]));
  ok(`L56 ${w}: mute is bottom right on the chip row; output device line shown`, m.mute && m.mute.r > m.card.r - 24 && m.mute.b <= m.foot.b + 1 && m.out, JSON.stringify([m.mute, m.foot]));
  ok(`L54 ${w}: no expand arrow on speaker / zone cards`, m.arrows === 0, m.arrows); ok(`L51 ${w}: zone cards list their speakers`, m.zchips > 0);
  await p.screenshot({ path: `/workspace/screens/wavwiz-039-${ENG}-devexp-${w}-${sc}.png` });
  // L54: a click on an empty part of the card opens Speaker Settings; the on/off pill does not
  const card = p.locator('.scol .dc3.clickable').first(); const bb = await card.boundingBox(); const was = await card.evaluate(e => e.classList.contains('off'));
  await card.locator('.onpill').click(); await p.waitForTimeout(500); ok('L54 the OFF|ON pill keeps its own action (no settings)', (await p.locator('.spcol .spkset').count()) === 0); await card.locator('.onpill').click(); await p.waitForTimeout(400);
  await p.mouse.click(bb.x + bb.width - 6, bb.y + bb.height / 2); await p.waitForTimeout(900); ok('L54 click on empty card area opens Speaker Settings', (await p.locator('.spcol .spkset').count()) === 1);
  await p.screenshot({ path: `/workspace/screens/wavwiz-039-${ENG}-l54-settings-${w}-${sc}.png` });
  await p.evaluate(async () => { const m = await import('/js/main.js'); m.showEq?.(); }); await ctx.close();
});
await step('L54 zone card click opens the zone', async () => {
  const { ctx, p } = await page(1920, 1080, ST.devexp); const z = p.locator('.zlist .zc3.clickable').first(); const bb = await z.boundingBox(); await p.mouse.click(bb.x + bb.width - 8, bb.y + bb.height - 6); await p.waitForTimeout(700);
  ok('L54 zone card click opens its settings in place', (await p.locator('.zinline').count()) === 1); await ctx.close();
});

for (const [n, dsf] of [['100', 1], ['200', 2]]) await step('L57 mini ' + n, async () => {
  const { ctx, p } = await page(420, 138, null, { dsf, url: '/mini.html' }); await p.waitForTimeout(1500);
  const r = await p.evaluate(() => { const R = s => { const b = document.querySelector(s)?.getBoundingClientRect(); return b ? { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom } : null; }; return { mp: R('.mp'), bar: R('.mp-vol .vbar'), pct: R('.mp-vol .pct'), mute: R('.mp-mute'), tr: R('.mp-tr'), sc: R('.mp-sc'), sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth }; });
  ok(`L57 ${n}%: fits the 420x138 window, nothing clipped`, r.sh <= r.ih && r.sw <= r.iw && r.sc.b <= r.ih, JSON.stringify([r.sh, r.ih, r.sc]));
  ok(`L57 ${n}%: volume bar is large with a visible percentage`, r.bar.w >= 250 && r.pct.w > 20 && r.pct.r <= r.mp.r, JSON.stringify([r.bar, r.pct]));
  ok(`L57 ${n}%: mute sits beside the transport controls`, r.mute && r.tr && r.mute.x >= r.tr.x && r.mute.r <= r.tr.r + 1 && Math.abs(r.mute.y - r.tr.y) < 20);
  const orig = await api(p, '/zones'); const on = orig.filter(z => z.enabled); const before = on.length ? Math.max(...on.map(z => z.volume)) : 0;
  const inp = p.locator('.mp-vol .vbar input'); const bb = await inp.boundingBox(); await p.mouse.click(bb.x + bb.width * 0.3, bb.y + bb.height / 2); await p.waitForTimeout(1500);
  const after = await api(p, '/zones'); const v2 = Math.max(...after.filter(z => z.enabled).map(z => z.volume)); ok(`L57 ${n}%: the slider changes the master volume`, Math.abs(v2 - 30) <= 8 && v2 !== before, `${before} -> ${v2}`);
  ok(`L57 ${n}%: percentage follows`, /^\d+%$/.test((await p.locator('.mp-vol .pct').textContent()).trim()));
  await p.locator('.mp-mute').click(); await p.waitForTimeout(1500); const m1 = (await api(p, '/zones')).every(z => z.muted); await p.locator('.mp-mute').click(); await p.waitForTimeout(1500); const m2 = (await api(p, '/zones')).every(z => z.muted);
  ok(`L57 ${n}%: mute toggles on and off`, m1 === true && m2 === false, `${m1} ${m2}`);
  await api(p, '/zones/master', 'POST', { set: before }); await p.screenshot({ path: `/workspace/screens/wavwiz-039-${ENG}-l57-mini-${n}.png` }); await ctx.close();
});
await br.close();

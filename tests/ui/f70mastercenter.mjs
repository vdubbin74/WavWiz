// 0.4.9 F70: expanded Devices (E1) - the master volume bar lines up with the middle column's setting bars: the master slider track's left AND
// right edges match Volume / Max volume / Delay / Balance / Bass / Treble within 1 px (so its center and width match too); All off / All on /
// Link all stay on the right. Full and Roomy expanded, 100 % and 200 % tiny.
import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SH, OUT = '/workspace/screens/049-master2'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
if (SH) mkdirSync(OUT, { recursive: true });
const br = await chromium.launch();
const geo = () => { const R = e => e.getBoundingClientRect(), m = document.querySelector('.dexp-top .dvol-master input[type=range]'), col = document.querySelector('.dexp-main .dcol42') || document.body, all = document.querySelector('.dexp-top .mallrow');
  const bars = [...col.querySelectorAll('input[type=range]')].filter(i => i.offsetParent).map(i => ({ n: i.getAttribute('aria-label'), l: R(i).left, r: R(i).right }));
  return { m: m && { l: R(m).left, r: R(m).right, top: R(m).top }, bars, col: { l: R(col).left, r: R(col).right }, all: all && { l: R(all).left, r: R(all).right, top: R(all).top }, vw: innerWidth,
    // F70b: what sits next to the tracks - the master %, its Mute / mixer buttons, the speaker Volume Mute - and the boxes they must stay inside
    mx: m ? [...m.parentElement.children].filter(e => e !== m && !e.classList.contains('zsel') && e.offsetParent && R(e).width > 0).map(e => { const r = R(e); return { n: e.className || e.tagName, l: r.left, r: r.right, t: r.top, b: r.bottom }; }) : [],
    mt: m && (r => ({ l: r.left, r: r.right, t: r.top, b: r.bottom }))(R(m)), mbox: (b => b && (r => ({ l: r.left, r: r.right }))(R(b)))(document.querySelector('.dexp-top .dmaster')),
    smute: (e => e && e.offsetParent && (r => ({ l: r.left, r: r.right, t: r.top, b: r.bottom }))(R(e)))(col.querySelector('.spk-mute')),
    svol: (e => e && e.offsetParent && (r => ({ l: r.left, r: r.right, t: r.top, b: r.bottom }))(R(e)))(col.querySelector('.spk-volline input[type=range]')),
    card: (e => e && (r => ({ l: r.left, r: r.right }))(R(e)))(col.querySelector('.spkset')) }; };
const hit = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
for (const [vw, vh, dpr, scale, z] of [[1920, 1080, 1, 'compact', '100'], [960, 540, 2, 'tiny', '200-tiny']]) for (const layout of ['full', 'roomy']) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([sc, lay]) => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
    if (sessionStorage.getItem('f70')) return; sessionStorage.setItem('f70', '1'); localStorage.setItem('wavwiz.uiscale', sc); localStorage.setItem('wavwiz.layout', lay);
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' })); }, [scale, layout]);
  const p = await c.newPage(), t = `[${layout} ${z}]`; await p.goto(B + '/'); await p.waitForTimeout(3000); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  if (layout === 'roomy') { await p.click('.desk.devcollapsed .devpanel .prail').catch(() => {}); await p.waitForTimeout(700); }
  await p.click('.devpanel .devexp'); await p.waitForTimeout(1000);
  await p.locator('.e42 .sp42 .dname >> visible=true').first().click(); await p.waitForTimeout(900);
  const g = await p.evaluate(geo);
  ok(`${t} the middle column shows the setting bars`, g.bars.length >= 6, JSON.stringify(g.bars.map(b => b.n)));
  for (const b of g.bars) ok(`${t} master track left/right = ${b.n} (±1 px)`, g.m && Math.abs(g.m.l - b.l) <= 1 && Math.abs(g.m.r - b.r) <= 1, JSON.stringify([g.m, b]));
  ok(`${t} master is inside the middle column`, g.m && g.m.l >= g.col.l && g.m.r <= g.col.r, JSON.stringify([g.m, g.col]));
  ok(`${t} All off / All on / Link all stay at the right, clear of the master`, g.all && g.all.l > g.m.r && g.all.r > g.vw * 0.7, JSON.stringify([g.all, g.m]));
  for (const x of g.mx) { ok(`${t} master ${x.n} does not overlap the master track`, !hit(x, g.mt), JSON.stringify([x, g.mt])); ok(`${t} master ${x.n} is right of the track and inside the master row`, x.l >= g.mt.r - 0.5 && x.r <= g.mbox.r + 0.5 && x.r < g.all.l, JSON.stringify([x, g.mt, g.mbox, g.all])); }
  ok(`${t} the master has its % and buttons`, g.mx.length >= 2, JSON.stringify(g.mx));
  ok(`${t} speaker Volume Mute: not on the track, inside the settings card`, g.smute && g.svol && !hit(g.smute, g.svol) && g.smute.l >= g.svol.r && g.smute.r <= g.card.r - 1, JSON.stringify([g.smute, g.svol, g.card]));
  if (SH) await p.screenshot({ path: `${OUT}/${layout}-${z}-expanded.png` });
  await p.setViewportSize({ width: Math.round(vw * 0.85), height: vh }); await p.waitForTimeout(700); const g2 = await p.evaluate(geo);
  ok(`${t} still lined up after a window resize`, g2.bars.every(b => Math.abs(g2.m.l - b.l) <= 1 && Math.abs(g2.m.r - b.r) <= 1), JSON.stringify([g2.m, g2.bars]));
  // 0.4.9 F70 fix: zone settings - the old code measured speaker rows only, so with a zone open the master kept a stale place (TV: 185-525 vs 213-785)
  for (const w of [vw, Math.round(vw * 0.7)]) {
    await p.setViewportSize({ width: w, height: vh }); if (!await p.locator('.e42 .qb42 .zname >> visible=true').first().click({ timeout: 3000 }).then(() => true, () => false)) { console.log(`skip ${t} at ${w}px: the zone tree is folded at this width`); continue; } await p.waitForTimeout(900);
    const zg = await p.evaluate(() => { const R = e => e && e.offsetParent ? (r => ({ l: r.left, r: r.right }))(e.getBoundingClientRect()) : null, col = document.querySelector('.dexp-main .dcol42'), m = document.querySelector('.dexp-top .dmaster'), row = col.querySelector('.zp42-row.dvol');
      return { m: R(m.querySelector('.dvol-master input[type=range]')), b: R(row?.querySelector('input[type=range]')), mp: R(m.querySelector('.dvol-master .pct')), bp: R(row?.querySelector('.pct')), mm: R(m.querySelector('.mastermute')), bm: R(row?.querySelector('.mutebtn')) }; });
    ok(`${t} zone settings at ${w}px: master track left/right = zone Volume (±1 px)`, zg.m && zg.b && Math.abs(zg.m.l - zg.b.l) <= 1 && Math.abs(zg.m.r - zg.b.r) <= 1, JSON.stringify(zg));
    ok(`${t} zone settings at ${w}px: master % and Mute in the bar's % / Mute column`, zg.mp && zg.bp && Math.abs(zg.mp.r - zg.bp.r) <= 1 && (!zg.bm || Math.abs(zg.mm.l - zg.bm.l) <= 1), JSON.stringify(zg));
    if (SH) await p.screenshot({ path: `${OUT}/${layout}-${z}-zone-${w}.png` });
    await p.locator('.e42 .sp42 .dname >> visible=true').first().click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(900);
    const sg = await p.evaluate(geo); ok(`${t} back to speaker settings at ${w}px: still lined up`, sg.bars.length > 0 && sg.bars.every(b => Math.abs(sg.m.l - b.l) <= 1 && Math.abs(sg.m.r - b.r) <= 1), JSON.stringify([sg.m, sg.bars]));
    if (SH) await p.screenshot({ path: `${OUT}/${layout}-${z}-speaker-${w}.png` });
  }
  await c.close();
}
// F70b: the regular Devices panel (Classic, Roomy, Full) - master track = the zone volume bars below (all zones reported online so the bars show)
const pgeo = () => { const R = e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }, dev = document.querySelector('.devpanel'), m = dev.querySelector(':scope .dmaster input[type=range]');
  const bars = [...dev.querySelectorAll('.tree42 .vbar input[type=range]')].filter(i => i.offsetParent && i.getBoundingClientRect().width > 0 && i.getBoundingClientRect().bottom < innerHeight).map(i => ({ n: i.getAttribute('aria-label') || 'bar', ...R(i) }));
  const mx = m ? [...m.parentElement.children].filter(e => e !== m && e.offsetParent && e.getBoundingClientRect().width > 0).map(e => ({ n: (e.className + '').split(' ')[0], ...R(e) })) : [];
  const lbl = dev.querySelector('.dmaster > .dlbl'); const dr = R(dev), bw = parseFloat(getComputedStyle(dev).borderRightWidth) || 0;
  return { m: m && R(m), bars, mx, lbl: lbl && R(lbl), box: { l: dr.l, r: dr.r - bw } }; };
for (const [vw, vh, dpr, scale, z] of [[1920, 1080, 1, 'compact', '100'], [960, 540, 2, 'tiny', '200-tiny']]) for (const layout of ['classic', 'roomy', 'full']) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([sc, lay]) => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
    if (sessionStorage.getItem('f70p')) return; sessionStorage.setItem('f70p', '1'); localStorage.setItem('wavwiz.uiscale', sc); localStorage.setItem('wavwiz.layout', lay);
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' })); }, [scale, layout]);
  await c.route(/\/api\/v1\/zones(\?|$)/, async r => { try { const res = await r.fetch(), j = await res.json(); for (const x of j) x.connected = true; await r.fulfill({ response: res, json: j }); } catch { /* closed */ } });
  const p = await c.newPage(), t = `[${layout} ${z} panel]`; await p.goto(B + '/'); await p.waitForTimeout(3000); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  if (layout === 'roomy') { await p.click('.desk.devcollapsed .devpanel .prail').catch(() => {}); await p.waitForTimeout(900); }
  await p.waitForTimeout(400); const g = await p.evaluate(pgeo);
  ok(`${t} zone volume bars on screen`, g.bars.length >= 2, JSON.stringify(g.bars));
  for (const b of g.bars) ok(`${t} master track left/right = ${b.n} at y${Math.round(b.t)} (±1 px)`, g.m && Math.abs(g.m.l - b.l) <= 1 && Math.abs(g.m.r - b.r) <= 1, JSON.stringify([g.m, b]));
  ok(`${t} master has %, Mute and mixer`, g.mx.length >= 3, JSON.stringify(g.mx));
  for (const x of g.mx) ok(`${t} master ${x.n}: right of the track, no overlap, inside the panel`, x.l >= g.m.r - 0.5 && !hit(x, g.m) && x.r <= g.box.r + 0.5, JSON.stringify([x, g.m, g.box]));
  ok(`${t} MASTER label does not overlap the track or its controls`, g.lbl && !hit(g.lbl, g.m) && g.mx.every(x => !hit(g.lbl, x)), JSON.stringify([g.lbl, g.m]));
  if (SH) await p.screenshot({ path: `${OUT}/${layout}-${z}-panel.png` });
  await c.close();
}
await br.close(); console.log(`f70mastercenter: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

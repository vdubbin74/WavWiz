// 0.4.4 layout regressions (F1 F2 F3 F7 F17 F18 ...) at 100% and 200%. Needs seeded schedules ("Wake up" 04:20 alarm) + a scene used by a schedule.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const B = process.env.WW_URL || 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim();
const SHOTS = process.env.SHOTS; const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m); } };
const want = k => !ONLY.length || ONLY.includes(k);
const api = (u, m = 'GET', body) => fetch(B + '/api/v1' + u, { method: m, headers: { cookie: 'unison_session=' + sess, 'content-type': 'application/json', origin: B }, body: body ? JSON.stringify(body) : undefined });
// fixtures: capped speakers (F18/F19) + an alarm and a scene used by a schedule (F1-F3), idempotent
for (const id of [3, 5]) await api(`/zones/${id}/volcap`, 'PUT', { cap: 64, locked: true });
{ const sc = await (await api('/schedules')).json().catch(() => []); const scenes = await (await api('/scenes')).json().catch(() => []);
  let sid = (Array.isArray(scenes) ? scenes : scenes.scenes || []).find(x => x.name === 'Evening')?.id; if (!sid) sid = (await (await api('/scenes/capture', 'POST', { name: 'Evening' })).json()).id;
  const rows = Array.isArray(sc) ? sc : sc.rows || [];
  if (!rows.some(r => r.name === 'Wake up')) await api('/schedules', 'POST', { name: 'Wake up', time: '04:20', days: '0123456', action: 'play', payload: {} });
  if (!rows.some(r => r.name === 'Evening lights')) await api('/schedules', 'POST', { name: 'Evening lights', time: '19:30', days: '12345', action: 'scene', payload: { sceneId: sid } }); }
const br = await chromium.launch();
export async function open(dpr, panels, w = 1920, h = 1080) {
  const ctx = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(pn => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); localStorage.setItem('wavwiz.panels', JSON.stringify(pn)); }, panels);
  const p = await ctx.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2600); 
  return { ctx, p };
}
const EXP = { lib: 'rail', dev: 'expanded', exp: 'dev', list: 'normal', ctl: 'collapsed' };
for (const [z, dpr] of [['100', 1], ['200', 2]]) {
  if (want('F1') || want('F2') || want('F3')) {
    const { ctx, p } = await open(dpr, EXP);
    const m = await p.evaluate(() => {
      const r = e => e?.getBoundingClientRect(), ov = (a, b) => !!(a && b && !(a.right <= b.left + .5 || b.right <= a.left + .5 || a.bottom <= b.top + .5 || b.bottom <= a.top + .5));
      const rows = [...document.querySelectorAll('.ssc-col .ssc-sched')].map(row => {
        const parts = [row.querySelector('.ss-tm'), row.querySelector('.ss-mid b'), row.querySelector('.ss-mid .dtag'), row.querySelector('.ss-days'), row.querySelector('.ss-when .small')];
        let o = 0; for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (ov(r(parts[i]), r(parts[j]))) o++;
        const nx = parts[4]; return { name: parts[1]?.textContent, overlaps: o, nextOneLine: nx ? r(nx).height < parseFloat(getComputedStyle(nx).fontSize) * 2 : false, nextIn: nx ? r(nx).right <= r(row).right + .5 : false };
      });
      const col = document.querySelector('.sscol'), sc = document.querySelector('.ssc-col');
      const sub = document.querySelector('.ssc-scene .ss-sub');
      return { rows, colH: col.scrollWidth - col.clientWidth, sccH: sc.scrollWidth - sc.clientWidth, sub: sub?.textContent, subClip: sub ? sub.scrollWidth > sub.clientWidth + 1 || sub.scrollHeight > sub.clientHeight + 1 : true };
    });
    if (want('F1')) { ok(m.rows.length >= 1, `F1 ${z}% schedule rows present`); for (const x of m.rows) { ok(x.overlaps === 0, `F1 ${z}% ${x.name}: no overlap`); ok(x.nextOneLine && x.nextIn, `F1 ${z}% ${x.name}: Next on one line, inside row`); } }
    if (want('F2')) ok(m.colH <= 0 && m.sccH <= 0, `F2 ${z}% Scenes & Schedules: no horizontal overflow (${m.colH}/${m.sccH})`);
    if (want('F3')) ok(/used by \S/.test(m.sub || '') && !/used by \d+ schedule/.test(m.sub) && !m.subClip, `F3 ${z}% scene subtitle shows full "used by <name>": ${m.sub}`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/wavwiz-044-F1F2F3-after-${z}.png` });
    await ctx.close();
  }
}

// F2 at narrow TV/laptop widths + F17 zone detail pane: no horizontal scrollbar anywhere
for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 720]]) for (const [z, dpr] of [['100', 1], ['200', 2]]) {
  if (!(want('F2') || want('F17'))) break;
  const { ctx, p } = await open(dpr, EXP, w, h);
  const o = await p.evaluate(() => [...document.querySelectorAll('*')].filter(e => /auto|scroll/.test(getComputedStyle(e).overflowX) && e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1).map(e => e.className.toString().slice(0, 40) + ':' + (e.scrollWidth - e.clientWidth)));
  const zp = await p.evaluate(() => !!document.querySelector('.dexp-main .zp42, .dexp-main [class*=zp42]'));
  if (want('F2')) ok(!o.some(x => /sscol|ssc-col/.test(x)), `F2 ${w}x${h} ${z}% S&S column no h-scroll ${o.join(' ')}`);
  if (want('F17')) { ok(zp, `F17 ${w}x${h} ${z}% zone detail pane open`); ok(o.length === 0, `F17 ${w}x${h} ${z}% no horizontal scrollbar anywhere ${o.join(' ')}`); }
  if (SHOTS && want('F17') && w === 1920) await p.screenshot({ path: `${SHOTS}/wavwiz-044-F17-notrepro-${z}.png` });
  await ctx.close();
}

// F18: every visible status tag the same height/font/padding/corners; lock glyph small (needs a CAPPED speaker: PUT /zones/3/volcap {cap:64,locked:true})
if (want('F18')) for (const [z, dpr] of [['100', 1], ['200', 2]]) for (const pn of [EXP, { lib: 'rail', dev: 'normal', exp: null, list: 'normal', ctl: 'collapsed' }]) {
  const { ctx, p } = await open(dpr, pn);
  const t = await p.evaluate(() => [...document.querySelectorAll('.devpanel .dtag')].filter(e => e.offsetParent).map(e => { const cs = getComputedStyle(e), sv = e.querySelector('svg'); return { k: e.textContent.trim().replace(/\d+/g, 'n'), h: Math.round(e.getBoundingClientRect().height), f: cs.fontSize, p: cs.paddingLeft + cs.paddingTop, r: cs.borderTopLeftRadius, s: sv ? sv.getBoundingClientRect().height : 0 }; }));
  const sig = new Set(t.map(x => [x.h, x.f, x.p, x.r].join('|')));
  ok(t.some(x => /CAPPED/.test(x.k)), `F18 ${z}% ${pn.dev}: a CAPPED tag is shown`);
  ok(sig.size === 1, `F18 ${z}% ${pn.dev}: one tag size for ${[...new Set(t.map(x => x.k))].join(',')} -> ${[...sig].join(' ; ')}`);
  ok(t.every(x => x.s <= 10) && t.every(x => x.r === '3px'), `F18 ${z}% ${pn.dev}: lock glyph <=10px, 3px corners`);
  await ctx.close();
}

// F7: collapsed Library rail count - vertical (same direction as LIBRARY), bottom-left, themed, separator + tooltip
if (want('F7')) for (const [z, dpr] of [['100', 1], ['200', 2]]) {
  const { ctx, p } = await open(dpr, { lib: 'rail', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' });
  const real = await p.evaluate(() => { const n = document.querySelector('.libpanel .prail-n'); return { text: n?.textContent, title: n?.title, vis: !!n?.offsetParent }; });
  ok(real.vis && /^\d{1,3}(,\d{3})*$/.test(real.text) && real.title === `${real.text} song${real.text === '1' ? '' : 's'}`, `F7 ${z}% count + tooltip: "${real.text}" / "${real.title}"`);
  // a large library: 5372 -> 5,372 (same formatter the status loop uses)
  const m = await p.evaluate(async () => { const { libCountLabel } = await import('/js/libcount.js'); const n = document.querySelector('.libpanel .prail-n'), l = libCountLabel(5372); n.textContent = l.text; n.title = l.title;
    const t = document.querySelector('.libpanel .prail-t'), rail = document.querySelector('.libpanel').getBoundingClientRect(), cs = getComputedStyle(n), ct = getComputedStyle(t), b = n.getBoundingClientRect();
    return { text: n.textContent, title: n.title, wm: cs.writingMode, same: cs.writingMode === ct.writingMode && cs.transform === ct.transform, border: cs.borderTopStyle === 'none' || parseFloat(cs.borderTopWidth) === 0, bg: cs.backgroundColor, left: b.left - rail.left, bottomGap: rail.bottom - b.bottom, railW: rail.width, tall: b.height > b.width }; });
  ok(m.text === '5,372' && m.title === '5,372 songs', `F7 ${z}% 5372 -> ${m.text} / ${m.title}`);
  ok(m.wm === 'vertical-rl' && m.same && m.tall, `F7 ${z}% vertical text, same rotation as LIBRARY`);
  ok(m.border && /rgba\(0, 0, 0, 0\)|transparent/.test(m.bg), `F7 ${z}% themed, no box (${m.bg})`);
  ok(m.left < m.railW / 2 && m.bottomGap < 40, `F7 ${z}% bottom-left of rail (left ${Math.round(m.left)}, gap ${Math.round(m.bottomGap)})`);
  if (SHOTS) { const r = await p.locator('.libpanel').boundingBox(); await p.screenshot({ path: `${SHOTS}/wavwiz-044-F7-after-${z}.png`, clip: { x: 0, y: 0, width: Math.max(200, r.x + r.width + 120), height: 1080 } }); }
  await ctx.close();
}

// F13: collapsed Now Playing bar has the compact CONTROLLING chip left of the art/title; it opens the zone list; zone name only when narrow
if (want('F13')) for (const [w, h] of [[1920, 1080], [1366, 768]]) for (const [z, dpr] of [['100', 1], ['200', 2]]) {
  const { ctx, p } = await open(dpr, { lib: 'normal', dev: 'normal', exp: null, list: 'normal', ctl: 'collapsed' }, w, h);
  const m = await p.evaluate(() => { const c = document.querySelector('.np-ctlpanel.collapsed .zl-strip'), s = document.querySelector('.np-ctlpanel.collapsed .ns-song'); const v = e => !!e && e.getBoundingClientRect().width > 0;
    return { vis: v(c), left: v(c) && v(s) && s.contains(c), /* 0.4.5 F27: the zone is on the song line now */ name: c?.querySelector('.zs-name')?.textContent, lbl: v(c?.querySelector('.zs-lbl')), barH: document.querySelector('.np-ctlpanel.collapsed')?.getBoundingClientRect().height }; });
  ok(m.vis && m.left && !!m.name, `F13 ${w} ${z}% "on <zone>" on the collapsed bar's song line (${m.name})`);   // 0.4.5 F27: the CONTROLLING chip is gone
  await p.locator('.np-ctlpanel.collapsed .zl-strip').click(); await p.waitForTimeout(300);
  ok(await p.locator('.zmenu40 .zm-item').count() > 0, `F13 ${w} ${z}% chip opens the zone list`);
  await ctx.close();
}

// F14: clicking a zone box title (mouse / Enter) makes that zone Controlling everywhere + shows it in the middle pane
if (want('F14')) for (const [z, dpr] of [['100', 1], ['200', 2]]) for (const how of ['click', 'Enter']) {
  const { ctx, p } = await open(dpr, EXP);
  const read = () => p.evaluate(() => ({ chips: [...document.querySelectorAll('.zsel')].filter(e => e.getBoundingClientRect().width).map(e => e.querySelector('.zs-name')?.textContent), ctl: [...document.querySelectorAll('.qb42.ctl .qb42-name, .zwrap42.ctl .zname')].map(e => e.textContent), edit: document.querySelector('.listpanel select')?.selectedOptions?.[0]?.textContent || document.querySelector('.listpanel')?.innerText.match(/Editing:?\s*([^\n]+)/)?.[1], crumb: document.querySelector('.dpath42')?.textContent, cursor: getComputedStyle(document.querySelector('.qb42-pick')).cursor }));
  const before = await read(); const target = before.chips[0] === 'Patio' ? 'Basement' : 'Patio';
  const t = p.locator('.qb42', { has: p.locator('.qb42-name', { hasText: 'Queue: ' + target }) }).locator('.qb42-pick').first();
  if (how === 'click') await t.click(); else { await t.focus(); await p.keyboard.press('Enter'); }
  await p.waitForTimeout(900); const a = await read();
  ok(a.cursor === 'grab', `F14 ${z}% ${how}: title has the grab cursor (0.4.6 F30: the title also drags the zone; a click still selects)`);
  ok(a.chips.length > 0 && a.chips.every(n => n === target), `F14 ${z}% ${how}: every Controlling chip -> ${target} (${a.chips.join(',')})`);
  ok(a.ctl.some(n => n.includes(target)), `F14 ${z}% ${how}: box highlighted as Controlling (${a.ctl.join(',')})`);
  ok((a.edit || '').includes(target), `F14 ${z}% ${how}: queue Editing picker -> ${a.edit}`);
  ok((a.crumb || '').includes(target), `F14 ${z}% ${how}: middle pane shows ${a.crumb}`);
  if (SHOTS && how === 'click') await p.screenshot({ path: `${SHOTS}/wavwiz-044-F14-after-${z}.png` });
  await p.evaluate(() => import('/js/zones40.js').then(m => m.select('g:' + 1))).catch(() => {});
  await ctx.close();
}

// F19: action tags jump to their setting (panel + expanded tree); read-only tags are not clickable
if (want('F19')) for (const [z, dpr] of [['100', 1], ['200', 2]]) for (const pn of [EXP, { lib: 'rail', dev: 'normal', exp: null, list: 'normal', ctl: 'collapsed' }]) {
  const { ctx, p } = await open(dpr, pn);
  const where = pn.dev;
  if (await p.evaluate(() => document.querySelector('.desk')?.classList.contains('tight'))) { await p.locator('.devtab').click(); await p.waitForTimeout(500); }   // 0.4.5 T1b: 1920 at dpr 2 is tight - Devices in the slide-over
  const info = await p.evaluate(() => { const t = document.querySelector('.sp42[data-device="Sub"] .dtag.capped'); const ro = document.querySelector('.dtag.count, .dtag.role'); return { cur: t && getComputedStyle(t).cursor, tip: t?.title, ro: ro && getComputedStyle(ro).cursor, roAct: ro?.classList.contains('tagact') }; });
  ok(info.cur === 'pointer' && info.tip === 'Change max volume', `F19 ${z}% ${where}: CAPPED pointer + tooltip "${info.tip}"`);
  ok(info.ro !== 'pointer' && !info.roAct, `F19 ${z}% ${where}: read-only tag not clickable`);
  await p.locator('.sp42[data-device="Sub"] .dtag.capped').first().click(); await p.waitForTimeout(1800);
  const a = await p.evaluate(() => { const ae = document.activeElement; const sp = ae?.closest('.spkset'); return { page: sp?.getAttribute('aria-label'), range: ae?.type, lbl: ae?.closest('.spk-row, label, div')?.textContent?.slice(0, 40) }; });
  ok(/Sub/.test(a.page || '') && a.range === 'range' && /Max volume/i.test(a.lbl || ''), `F19 ${z}% ${where}: CAPPED -> Sub page, Max volume focused (${JSON.stringify(a)})`);
  const off = p.locator('.sp42[data-device="PCBOXV1"] .dtag.offline').first();
  if (await off.count()) { await off.click(); await p.waitForTimeout(1500); const b = await p.evaluate(() => ({ page: document.activeElement?.closest('.spkset')?.getAttribute('aria-label'), tag: document.activeElement?.tagName, cls: document.activeElement?.className })); ok(/PCBOXV1/.test(b.page || '') && (/SELECT|BUTTON/.test(b.tag) || /dlbl/.test(b.cls)), `F19 ${z}% ${where}: OFFLINE -> output picker / calibrate focused (${JSON.stringify(b)})`); }
  if (SHOTS && where === 'expanded') await p.screenshot({ path: `${SHOTS}/wavwiz-044-F19-after-${z}.png` });
  await ctx.close();
}

// F9: Devices tree drag feedback (mouse + touch long-press), Esc cancels
if (want('F9')) for (const [z, dpr] of [['100', 1], ['200', 2]]) {
  const { ctx, p } = await open(dpr, EXP);
  if (await p.evaluate(() => document.querySelector('.desk')?.classList.contains('tight'))) { await p.locator('.devtab').click(); await p.waitForTimeout(500); }   /* 0.4.5 T1: Devices behind the right-edge tab */ 
  const grip = p.locator('.sp42[data-device="Sub"] .dgrip42').first(); await grip.scrollIntoViewIfNeeded(); const g = await grip.boundingBox();
  const pat = p.locator('.zwrap42[data-zone="Patio"]').first(); await pat.scrollIntoViewIfNeeded().catch(() => {}); const g2 = await grip.boundingBox(); const tb = await pat.boundingBox();
  if (process.env.DIAG) console.log(JSON.stringify({ g2, tb, at: await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className, [g2.x + g2.width / 2, g2.y + g2.height / 2]) }));
  await p.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2); await p.mouse.down(); await p.mouse.move(g2.x + 30, g2.y + 30, { steps: 4 }); await p.mouse.move(tb.x + tb.width / 2, tb.y + Math.min(30, tb.height / 2), { steps: 8 }); await p.waitForTimeout(150);
  const m = await p.evaluate(() => { const gh = document.querySelector('.dragghost'), src = document.querySelector('.sp42.drag42-src'), cs = gh && getComputedStyle(gh);
    const own = document.querySelector('.sp42[data-device="Sub"]')?.closest('[data-drop]'), all = [...document.querySelectorAll('.tree42 [data-drop]')];
    return { ghost: !!gh, ghostOp: cs && +cs.opacity, ghostShadow: cs?.boxShadow !== 'none', src: !!src && +getComputedStyle(src).opacity < 0.6, valid: all.filter(t => t.classList.contains('droppable')).length, total: all.length, ownLit: own?.classList.contains('droppable'), over: document.querySelector('.dropping')?.dataset.zone, overStyle: (() => { const o = document.querySelector('.dropping'); return o && getComputedStyle(o).outlineStyle; })(), dashed: (() => { const o = document.querySelector('.droppable:not(.dropping)'); return o && getComputedStyle(o).outlineStyle; })(), line: (() => { const o = document.querySelector('.dropping .zsp42'); return o && getComputedStyle(o, '::after').height; })() }; });
  ok(m.ghost && m.ghostOp < 1 && m.ghostShadow && m.src, `F9 ${z}% picked-up: ghost (translucent, shadow) + dimmed source`);
  ok(m.valid === m.total - 1 && !m.ownLit && m.dashed === 'dashed', `F9 ${z}% every valid target dashed (${m.valid}/${m.total}), own zone not`);
  ok(m.over === 'Patio' && m.overStyle === 'solid' && m.line === '3px', `F9 ${z}% target under cursor solid + insertion line (${m.over} ${m.overStyle} ${m.line})`);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/wavwiz-044-F9-after-${z}.png` });
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  const c = await p.evaluate(() => ({ ghost: !!document.querySelector('.dragghost'), lit: document.querySelectorAll('.droppable,.dropping,.drag42-src').length }));
  await p.mouse.up(); await p.waitForTimeout(800);
  const still = await p.evaluate(() => document.querySelector('.sp42[data-device="Sub"]')?.closest('.zwrap42')?.dataset.zone);
  ok(!c.ghost && c.lit === 0 && still === 'Basement', `F9 ${z}% Esc cancels (Sub stays in ${still})`);
  // touch: a quick swipe does not pick up; a 400 ms long-press does
  const t = await p.evaluate(async () => { const gr = document.querySelector('.sp42[data-device="Sub"] .dgrip42'), r = gr.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    const ev = (type, dx, dy, tg = gr) => tg.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, clientX: x + dx, clientY: y + dy, pointerId: 7 }));
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    ev('pointerdown', 0, 0); await sleep(50); ev('pointermove', 0, 40); await sleep(450); const swipe = !!document.querySelector('.dragghost'); ev('pointerup', 0, 40);
    ev('pointerdown', 0, 0); await sleep(480); ev('pointermove', 30, 30); await sleep(50); const lp = !!document.querySelector('.dragghost'), lit = document.querySelectorAll('.droppable').length;   // 0.4.5 F26: pdrag engine - hold, then the first move picks up const lit = document.querySelectorAll('.droppable').length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); ev('pointercancel', 30, 30);
    return { swipe, lp, lit }; });
  ok(!t.swipe && t.lp && t.lit > 0, `F9 ${z}% touch: swipe scrolls (no pick-up), long-press picks up + targets lit (${JSON.stringify(t)})`);
  await ctx.close();
}
await br.close();
console.log(`${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);

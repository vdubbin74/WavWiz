// 0.4.6 F40: every Library control (side panel + expanded) follows the active theme: no native <select>, no UA-default bg/border/color on inputs and
// buttons, themed dropdown open list + right-click menu. Spot-check 3 themes at 100 % and 200 %. SHOTS=1 writes /workspace/screens/wavwiz-046-F40-*.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SHOTS, TAG = process.env.TAG || 'after'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const br = await chromium.launch();
for (const [vw, vh, d, zt] of [[1920, 1080, 1, '100'], [960, 540, 2, '200']]) for (const view of ['side', 'expanded']) for (const th of ['default', 'daylight', 'ember']) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([view]) => { if (sessionStorage.getItem('f40')) return; sessionStorage.setItem('f40', '1'); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: view === 'expanded' ? 'expanded' : 'normal', dev: 'normal', exp: view === 'expanded' ? 'lib' : null, list: 'open', ctl: 'collapsed' })); }, [view]);
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2600); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  await p.evaluate(async t => { const m = await import('/js/theme.js'); m.applyTheme({ preset: t, ...(m.PRESETS[t] || {}) }); }, th); await p.waitForTimeout(300);
  const tg = `[${zt} ${view} ${th}]`;
  const r = await p.evaluate(() => { const lp = document.querySelector('.libpanel'); const UA_BG = ['rgb(239, 239, 239)', 'rgb(240, 240, 240)', 'rgb(233, 233, 237)', 'rgb(255, 255, 255)'], UA_BD = ['rgb(118, 118, 118)', 'rgb(133, 133, 133)', 'rgb(118, 118, 118) none'];
    const root = getComputedStyle(document.body), text = root.color, bad = [];
    for (const e of lp.querySelectorAll('button,input:not([type=checkbox]):not([type=range]):not([type=radio])')) { if (!e.offsetParent) continue; const s = getComputedStyle(e);
      const uaBg = UA_BG.includes(s.backgroundColor) && !document.body.className.includes('light') && s.backgroundColor !== getComputedStyle(lp).backgroundColor;
      const uaBd = s.borderStyle === 'outset' || s.borderStyle === 'inset' || (UA_BD.includes(s.borderTopColor) && s.borderTopWidth === '2px');
      const uaCol = s.color === 'rgb(0, 0, 0)' && text !== 'rgb(0, 0, 0)' && (UA_BG.includes(s.backgroundColor) || s.backgroundColor === 'rgba(0, 0, 0, 0)');
      if (uaBg || uaBd || uaCol) bad.push((e.className || e.tagName) + ':' + s.backgroundColor + '/' + s.borderTopColor + ' ' + s.borderStyle + '/' + s.color); }
    return { selects: lp.querySelectorAll('select').length, bad: bad.slice(0, 5), nbad: bad.length, sort: !!lp.querySelector('.libsort') }; });
  ok(`${tg} no native <select> left in the Library`, r.selects === 0, JSON.stringify(r));
  ok(`${tg} no Library button/input with UA-default bg/border/color`, r.nbad === 0, JSON.stringify(r.bad));
  const sort = p.locator('.libpanel .libsort:visible').first();
  if (await sort.count()) { await sort.click(); await p.waitForTimeout(200);
    const m = await p.evaluate(() => { const m = document.querySelector('.ctxmenu'); if (!m) return null; const s = getComputedStyle(m), pv = getComputedStyle(document.documentElement).getPropertyValue('--accent'); return { bg: s.backgroundColor, rad: s.borderTopLeftRadius, items: m.querySelectorAll('.ctx-item').length }; });
    ok(`${tg} the Sort dropdown opens the themed list (3px, items)`, m && m.rad === '3px' && m.items > 1, JSON.stringify(m));
    if (SH && th !== 'daylight') await p.screenshot({ path: `/workspace/screens/wavwiz-046-F40-${TAG}-${zt}-${view}-${th}-sort.png` });
    await p.keyboard.press('Escape'); }
  const row = p.locator('.libpanel .ldrag').first();
  if (await row.count()) { await row.click({ button: 'right' }).catch(() => {}); await p.waitForTimeout(200);
    const m = await p.evaluate(() => { const m = document.querySelector('.ctxmenu, .sheet .panel'); return m ? getComputedStyle(m).borderTopLeftRadius : null; });
    ok(`${tg} right-click menu is the themed menu`, m === '3px', String(m)); if (SH && th === 'ember') await p.screenshot({ path: `/workspace/screens/wavwiz-046-F40-${TAG}-${zt}-${view}-${th}-ctx.png` }); await p.keyboard.press('Escape'); }
  if (SH && th !== 'daylight') await p.screenshot({ path: `/workspace/screens/wavwiz-046-F40-${TAG}-${zt}-${view}-${th}.png` });
  await c.close(); }
await br.close(); console.log(`f40libtheme: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

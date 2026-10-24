// 0.4.6 F34: the side Library panel's tab row fits on ONE line inside the panel in every theme at 100 % / 200 % (and at a narrow window):
// no wrap, no horizontal scroll in the Library, the "⋯" overflow is a themed tab-style button that stays inside the panel and lists the tabs that
// did not fit. TAG=before|after, SHOTS=1 for screenshots.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SHOTS, TAG = process.env.TAG || 'after'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const THEMES = (process.env.THEMES || 'default,pepecoin,ember,arctic,violet,mono,daylight,nebula,steel,lime').split(',');
const br = await chromium.launch();
for (const [vw, vh, d, zt] of [[1920, 1080, 1, '100'], [960, 540, 2, '200'], [1280, 800, 1, '1280']]) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(() => { if (sessionStorage.getItem('f34')) return; sessionStorage.setItem('f34', '1'); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
    localStorage.setItem('wavwiz.uiscale', 'compact'); localStorage.setItem('wavwiz.layout', 'full'); localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' })); });
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2500); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  for (const th of (zt === '1280' ? ['default'] : THEMES)) {
    const t = `[${zt} ${th}]`;
    await p.evaluate(async t => { const m = await import('/js/theme.js'); const th = { preset: t, ...(m.PRESETS[t] || {}) }; try { m.saveTheme(th); } catch { } m.applyTheme(th); }, th); await p.waitForTimeout(250);
    const r = await p.evaluate(() => {
      const lp = document.querySelector('.libpanel'), R = lp.getBoundingClientRect(), tabs = [...lp.querySelectorAll('.ctabwrap [role=tab], .ctabwrap .moresel, .ctabwrap .tabmore')].filter(e => e.offsetParent);
      const tops = new Set(tabs.map(e => Math.round(e.getBoundingClientRect().top))), sc = [...lp.querySelectorAll('*')].filter(e => e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(e).overflowX)).map(e => e.className);
      const more = lp.querySelector('.ctabwrap .tabmore, .ctabwrap .moresel'), on = lp.querySelector('.ctabwrap [role=tab]:not(.tabmore):not(.on)'), cs = e => e ? getComputedStyle(e) : null;
      return { rows: tops.size, out: tabs.filter(e => e.getBoundingClientRect().right > R.right - 1).map(e => e.textContent.slice(0, 12)), hscroll: sc, n: tabs.length,
        moreBg: cs(more)?.backgroundColor, tabBg: cs(on)?.backgroundColor, moreTag: more?.tagName, moreRadius: cs(more)?.borderTopLeftRadius, moreFont: cs(more)?.fontSize, tabFont: cs(on)?.fontSize };
    });
    ok(`${t} tabs on one row`, r.rows === 1, JSON.stringify(r)); ok(`${t} every tab inside the panel`, !r.out.length, JSON.stringify(r.out)); ok(`${t} no horizontal scroll in the Library`, !r.hscroll.length, JSON.stringify(r.hscroll));
    ok(`${t} the ⋯ overflow is a themed tab-style button (same background / font / 3px corners as the tabs)`, r.moreTag === 'BUTTON' && r.moreBg === r.tabBg && r.moreFont === r.tabFont && r.moreRadius === '3px', JSON.stringify(r));
    if (SH && ['default', 'daylight', 'mono'].includes(th) || SH && zt === '1280') await p.locator('.libpanel').screenshot({ path: `/workspace/screens/wavwiz-046-F34-${TAG}-${th}-${zt}.png` });
  }
  // the overflow menu lists the hidden tabs and opens them
  { const t = `[${zt}]`; const m = p.locator('.libpanel .ctabwrap .tabmore'); if (await m.count()) { await m.click(); await p.waitForTimeout(250);
      const items = await p.evaluate(() => [...document.querySelectorAll('.ctxmenu [role=menuitem], .ctxmenu button')].map(e => e.textContent.trim()).filter(Boolean));
      const hidden = await p.evaluate(() => [...document.querySelectorAll('.libpanel .ctabwrap [role=tab]:not(.tabmore)')].filter(e => !e.offsetParent).map(e => e.textContent.trim().toLowerCase()));
      ok(`${t} ⋯ menu lists every tab that did not fit + Years / Recently added / Favorites`, hidden.every(h => items.some(i => i.toLowerCase().includes(h))) && items.some(i => /years/i.test(i)), JSON.stringify({ items, hidden }));
      if (SH) await p.screenshot({ path: `/workspace/screens/wavwiz-046-F34-${TAG}-menu-${zt}.png` });
      const pickName = items.find(i => /years/i.test(i)); await p.locator('.ctxmenu').getByText(pickName, { exact: false }).first().click(); await p.waitForTimeout(400);
      ok(`${t} picking from ⋯ opens that tab and marks ⋯ as the current tab`, await p.evaluate(() => document.querySelector('.libpanel .ctabwrap .tabmore')?.classList.contains('on')));
    } else ok(`${t} a ⋯ overflow button exists`, false); }
  await c.close();
}
await br.close(); console.log(`f34libtabs: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

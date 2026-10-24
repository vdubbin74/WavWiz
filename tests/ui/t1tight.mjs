// 0.4.5 T1: adaptive tight-space layout - on below 1600 CSS px of layout width (window / Display size zoom), off at 1920 (4K TV at 200 %).
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(); let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const br = await chromium.launch();
const CASES = [[1280, 820, 1, 'compact', true, 'Player window 1280'], [1280, 820, 2, 'compact', true, 'Player window 1280 @200%'], [1536, 864, 1, 'compact', true, '4K TV @250% (1536)'],
  [1920, 1080, 2, 'compact', true, '4K TV @200% (1920, dpr 2)'], [1920, 1080, 1, 'compact', false, '1080p monitor (dpr 1)'], [2560, 1440, 1, 'compact', false, '1440p monitor'],
  [1920, 1080, 1, 'large', true, '1920 + Display size 125% (1536)'], [1280, 820, 1, 'tiny', false, '1280 + Display size 67% (1910)'], [800, 900, 1, 'compact', false, 'phone layout (800)'],
  [2560, 1440, 1, 'compact', true, 'Roomy on 2560', 'roomy'], [1920, 1080, 2, 'compact', false, 'Full on the 4K TV @200%', 'full'], [1280, 820, 1, 'compact', false, 'Full on 1280', 'full'],
  [1920, 1080, 2, 'compact', false, 'no saved setting = Full (4K TV @200%)', null], [1280, 820, 1, 'compact', false, 'no saved setting = Full (1280)', null]];
for (const [w, hh, d, sc, want, n, lay = 'auto'] of CASES) {
  const c = await br.newContext({ viewport: { width: w, height: hh }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([sc, lay]) => { if (lay) localStorage.setItem('wavwiz.layout', lay); else localStorage.removeItem('wavwiz.layout'); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); localStorage.setItem('wavwiz.uiscale', sc);
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' })); }, [sc, lay]);
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2600); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  const st = () => p.evaluate(() => { const de = document.querySelector('.desk'), dp = document.querySelector('.devpanel'), r = dp.getBoundingClientRect(), tab = document.querySelector('.devtab');
    return { tight: de.classList.contains('tight'), open: de.classList.contains('devopen'), lib: de.classList.contains('libcollapsed'), tab: tab && getComputedStyle(tab).display !== 'none' ? tab.innerText.replace(/\s+/g, ' ').trim() : null,
      dpVis: getComputedStyle(dp).visibility, dpL: r.left, dpR: r.right, dpW: r.width, vw: innerWidth, scrim: getComputedStyle(document.querySelector('.devscrim')).display, edge: getComputedStyle(dp).borderLeftWidth, z: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1 }; });
  const s0 = await st(), t = `[${n}]`;
  ok(`${t} tight = ${want}`, s0.tight === want, JSON.stringify(s0));
  if (want) {
    ok(`${t} Library on its rail`, s0.lib); ok(`${t} Devices tab "DEVICES · N ZONES"`, /^DEVICES · \d+ ZONES?$/.test(s0.tab || ''), s0.tab); ok(`${t} slide-over hidden`, s0.dpVis === 'hidden' && !s0.open);
    await p.locator('.devtab').click(); await p.waitForTimeout(450); const s1 = await st();
    ok(`${t} tab opens a full-height slide-over at the right edge`, s1.open && s1.dpVis === 'visible' && Math.abs(s1.dpR - s1.vw) < 2 && s1.scrim === 'block' && parseFloat(s1.edge) >= 2, JSON.stringify(s1));
    ok(`${t} slide-over width respects zoom (${Math.round(s1.dpW)} px)`, s1.dpW >= 300 * s1.z - 2 && s1.dpW <= Math.min(400 * s1.z, 0.92 * s1.vw) + 2, JSON.stringify(s1));
    await p.keyboard.press('Escape'); await p.waitForTimeout(350); ok(`${t} Esc closes`, !(await st()).open);
    await p.locator('.devtab').click(); await p.waitForTimeout(350); await p.mouse.click(40, s1.vw > 0 ? 300 : 300); await p.waitForTimeout(350); ok(`${t} clicking outside closes`, !(await st()).open);
    const lw = await p.evaluate(() => { const n = document.querySelector('.nowcol, .np-vizpanel')?.getBoundingClientRect(), l = document.querySelector('.listpanel').getBoundingClientRect(); return { n: n?.right, l: l.right, vw: innerWidth }; });
    ok(`${t} Sound / Queue take the width`, lw.l > lw.vw - 70 * (s0.z || 1), JSON.stringify(lw));
  } else ok(`${t} no Devices tab, panel in the grid`, !s0.tab && s0.dpVis === 'visible', JSON.stringify(s0));
  await c.close();
}
// T1c: in the default Full layout the right Devices column runs full height (0.4.4): top = Library top, bottom = the player bar's bottom edge; in Roomy the tab does too
for (const [d, lay] of [[1, null], [2, null], [2, 'roomy'], [1, 'roomy']]) { const c = await br.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(l => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); localStorage.removeItem('wavwiz.panels'); if (l) localStorage.setItem('wavwiz.layout', l); else localStorage.removeItem('wavwiz.layout'); }, lay);
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2500);
  const m = await p.evaluate(() => { const b = s => document.querySelector(s)?.getBoundingClientRect(); const col = document.querySelector('.desk').classList.contains('tight') ? b('.devtab') : b('.devpanel'); return { top: col?.top, bot: col?.bottom, libTop: b('.libpanel')?.top, barBot: b('.np-ctlpanel')?.bottom, q: b('.listpanel')?.top }; });
  ok(`[T1c ${lay || 'default'} dpr${d}] right column full height: ${Math.round(m.top)}-${Math.round(m.bot)} vs library top ${Math.round(m.libTop)} / player bar bottom ${Math.round(m.barBot)} (queue top ${Math.round(m.q)})`, Math.abs(m.bot - m.barBot) <= 1 && Math.abs(m.top - m.libTop) <= 1);
  await c.close(); }
// the setting itself: picking Roomy / Full re-lays out at once, Auto returns to the rule
{ const c = await br.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); localStorage.removeItem('wavwiz.layout'); });
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2500); await p.evaluate(async () => (await import('/js/main.js')).go('settings:theme')); await p.waitForTimeout(900);
  const tight = () => p.evaluate(() => document.querySelector('.desk').classList.contains('tight'));
  ok('[setting] Layout control: Full (default) / Roomy / Auto, Full selected', (await p.locator('.laylayout .segbtn').allInnerTexts()).join('|') === 'Full (default)|Roomy|Auto' && await p.locator('.laylayout [data-layout=full]').getAttribute('aria-checked') === 'true');
  ok('[setting] 3px corners, accent on the selected choice', await p.evaluate(() => { const g = document.querySelector('.laylayout'), on = g.querySelector('.on'); const e = document.createElement('i'); e.style.color = getComputedStyle(document.documentElement).getPropertyValue('--accent'); document.body.append(e); const a = getComputedStyle(e).color; e.remove(); return getComputedStyle(g).borderRadius === '3px' && getComputedStyle(on).backgroundColor === a; }));
  await p.locator('.laylayout [data-layout=roomy]').click(); await p.waitForTimeout(300); ok('[setting] Roomy applies at once and is saved', await tight() && await p.evaluate(() => localStorage.getItem('wavwiz.layout')) === 'roomy');
  await p.locator('.laylayout [data-layout=full]').click(); await p.waitForTimeout(300); ok('[setting] Full applies at once', !(await tight()));
  await p.locator('.laylayout [data-layout=auto]').click(); await p.waitForTimeout(300); ok('[setting] Auto: 1920 at dpr 1 is normal', !(await tight()));
  await c.close(); }
await br.close(); console.log(`t1tight: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

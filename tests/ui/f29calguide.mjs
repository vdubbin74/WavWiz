// 0.4.5 F29: calibration step strip + '? How calibration works' guide, in every theme, at 100 %, 200 % and phone width. SHOTS=1 saves wavwiz-045-F29-*.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SHOTS; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const THEMES = ['default', 'pepecoin', 'ember', 'arctic', 'violet', 'mono', 'daylight', 'nebula', 'steel', 'lime'];
const br = await chromium.launch();
for (const [vp, d, tag] of [[[1920, 1080], 1, '100'], [[960, 540], 2, '200'], [[390, 844], 3, 'phone']]) for (const th of THEMES) {
  const first = th === 'default';
  const c = await br.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); });
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2200);
  await p.evaluate(async t => { const m = await import('/js/theme.js'); const th = { preset: t, ...(m.PRESETS[t] || {}) }; try { m.saveTheme(th); } catch { } m.applyTheme(th); document.querySelectorAll('dialog[open]').forEach(x => x.close()); }, th); await p.waitForTimeout(300);
  await p.evaluate(async () => (await import('/js/main.js')).go('calibrate')); await p.waitForTimeout(900);
  const t = `[${tag} ${th}]`, r = await p.evaluate(() => { const s = document.querySelector('dialog[open] .calsteps'), on = s?.querySelector('.calst.on .calst-n'); const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const rgb = x => { const e = document.createElement('i'); e.style.color = x; document.body.append(e); const v = getComputedStyle(e).color; e.remove(); return v; };
    const dl = document.querySelector('dialog[open]'), R = dl?.getBoundingClientRect();
    return { strip: !!s, lbl: s?.querySelector('.calst-lbl')?.textContent, n: s?.querySelectorAll('.calst').length, accentOk: on ? getComputedStyle(on).backgroundColor === rgb(acc) : false, radius: on ? getComputedStyle(on).borderRadius : '', help: !!dl?.querySelector('.calhelp'), fits: R ? R.right <= innerWidth + 1 && R.left >= -1 : false }; });
  ok(`${t} step strip "Step 1 of 4" with 4 steps`, r.strip && r.lbl === 'Step 1 of 4' && r.n === 4, JSON.stringify(r)); ok(`${t} active step uses the theme accent, 3px corners`, r.accentOk && r.radius === '3px', JSON.stringify(r));
  ok(`${t} '? How calibration works' in the window`, r.help); ok(`${t} window fits the screen`, r.fits);
  if (SH && (first || tag === '100')) await p.screenshot({ path: `/workspace/screens/wavwiz-045-F29-window-${th}-${tag}.png` });
  await p.locator('dialog[open] .calhelp').first().click(); await p.waitForTimeout(400);
  const g = await p.evaluate(() => { const s = document.querySelector('dialog.calguide-dlg[open]'); const b = s?.querySelector('.body'); return { open: !!s, txt: s?.innerText || '', scroll: b ? getComputedStyle(b).overflowY : '', fits: s ? s.getBoundingClientRect().bottom <= innerHeight + 1 : false }; });
  ok(`${t} guide opens, one scrollable screen`, g.open && g.scroll === 'auto' && g.fits, JSON.stringify({ ...g, txt: '' }));
  ok(`${t} guide covers steps, By ear, Bluetooth, phones`, /Pick a reference speaker/.test(g.txt) && /clicks land together/.test(g.txt) && /Bluetooth adds lag/.test(g.txt) && /screen awake/.test(g.txt));
  if (SH && (first || tag === '100')) await p.screenshot({ path: `/workspace/screens/wavwiz-045-F29-guide-${th}-${tag}.png` });
  await c.close();
}
await br.close(); console.log(`f29calguide: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

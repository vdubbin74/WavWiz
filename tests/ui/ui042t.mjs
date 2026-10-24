// 0.4.2 theme sweep: tree, linked box, Controlling highlight, expanded view and menu in every theme. Screenshots /workspace/screens/wavwiz-042-theme-<id>-*.png
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs'; import { execSync } from 'node:child_process';
const B = 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim();
let pass = 0, fail = 0; const ok = (n, c, i = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' :: ' + i)); };
execSync('WWDIR=/tmp/ww032 bash /workspace/seed042.sh', { stdio: 'ignore' });
const br = await chromium.launch();
const ctx0 = await br.newContext({ viewport: { width: 1400, height: 900 } }); await ctx0.addCookies([{ name: 'unison_session', value: sess, url: B }]);
const p0 = await ctx0.newPage(); await p0.goto(B + '/'); await p0.waitForTimeout(1500); const THEMES = await p0.evaluate(async () => Object.keys((await import('/js/theme.js')).PRESETS)); await ctx0.close();
console.log('themes', THEMES.join());
for (const th of THEMES) for (const mode of ['std', 'exp']) {
  const ctx = await br.newContext({ viewport: { width: 1400, height: 900 } }); await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(([m]) => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.uiscale', 'compact'); if (m === 'exp') { localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: 'dev', list: 'open', ctl: 'collapsed' })); sessionStorage.setItem('wavwiz.spk', '5'); } }, [mode]);
  const p = await ctx.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2200); await p.evaluate(() => document.querySelector('.phone-unlock')?.click());
  await p.evaluate(async id => { const t = await import('/js/theme.js'); t.applyTheme({ ...t.PRESETS[id], preset: id }); }, th); await p.waitForTimeout(700);
  const r = await p.evaluate(() => { const g = (s, k) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[k] : null; }; const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return { linked: g('.qb42.linked', 'borderTopColor'), solo: g('.qb42.solo:not(.ctl)', 'borderTopColor'), ctlW: g('.qb42.ctl', 'borderLeftWidth'), ctlC: g('.qb42.ctl', 'borderLeftColor'), un: g('.un42', 'borderTopStyle'), sel: g('.sp42.sel', 'backgroundColor'), acc,
      clip: [...document.querySelectorAll('.zname')].some(n => n.scrollWidth > n.clientWidth + 1), hs: document.querySelector('.tree42')?.scrollWidth <= document.querySelector('.tree42')?.clientWidth + 1 }; });
  ok(`[${th}/${mode}] linked box accent differs from neutral solo box`, r.linked && r.solo && r.linked !== r.solo, JSON.stringify(r));
  ok(`[${th}/${mode}] Controlling edge is thick and accent-colored`, parseFloat(r.ctlW) >= 3 && r.ctlC === r.linked, JSON.stringify(r));
  ok(`[${th}/${mode}] names not clipped, no horizontal overflow`, !r.clip && r.hs, JSON.stringify(r));
  if (mode === 'exp') ok(`[${th}/exp] selected speaker row highlighted`, !!r.sel && r.sel !== 'rgba(0, 0, 0, 0)', r.sel);
  if (mode === 'std') { await p.locator('.sp42').first().click({ button: 'right' }); await p.waitForTimeout(300); ok(`[${th}] context menu opens and is themed`, await p.evaluate(() => { const m = document.querySelector('.ctxmenu'); if (!m) return false; return getComputedStyle(m).borderTopColor !== 'rgba(0, 0, 0, 0)'; })); await p.screenshot({ path: `/workspace/screens/wavwiz-042-theme-${th}-menu.png` }); await p.keyboard.press('Escape'); }
  await p.screenshot({ path: `/workspace/screens/wavwiz-042-theme-${th}-${mode}.png` }); await ctx.close();
}
console.log(`\nui042t: ${pass} passed, ${fail} failed`); await br.close(); process.exit(fail ? 1 : 0);

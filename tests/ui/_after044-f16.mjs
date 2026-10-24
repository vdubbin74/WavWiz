import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim();
mkdirSync('/workspace/screens', { recursive: true });
const br = await chromium.launch();
async function pageFor(panels, scale = 1) {
  const ctx = await br.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(pn => {
    localStorage.setItem('wavwiz.whatsnew', '9.9.9');
    localStorage.setItem('wavwiz.gettingStarted.shown', '1');
    localStorage.setItem('wavwiz.panels', JSON.stringify(pn));
    localStorage.setItem('wavwiz.uiscale', 'compact');
  }, panels);
  const p = await ctx.newPage();
  await p.goto(B + '/'); await p.waitForTimeout(2600);
  await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));
  await p.waitForTimeout(400);
  return { ctx, p };
}
const pn = { lib: 'rail', dev: 'expanded', exp: 'dev', list: 'normal', ctl: 'normal' };
for (const scale of [1, 2]) {
  const tag = scale === 1 ? '100' : '200';
  const { ctx, p } = await pageFor(pn, scale);
  // open Basement zone pane
  await p.evaluate(() => {
    const t = [...document.querySelectorAll('.qb42-title,.zsh-ttl,.ztitle,button,.dname')].find(e => /Basement/i.test(e.textContent || '') && e.closest('.devpanel'));
    t?.click();
  });
  await p.waitForTimeout(600);
  const m = await p.evaluate(() => {
    const master = document.querySelector('.dvol-master input[type=range]');
    const zvol = document.querySelector('.zp42-row.dvol .vbar input, .zp42-row.dvol input[type=range]');
    const pct = document.querySelector('.zp42-row.dvol .pct')?.textContent;
    const mr = master?.getBoundingClientRect();
    const zr = zvol?.getBoundingClientRect();
    return { masterW: Math.round(mr?.width || 0), zoneW: Math.round(zr?.width || 0), pct, ok: (mr?.width || 0) >= 120 && (zr?.width || 0) >= 120 };
  });
  console.log(tag, m);
  await p.screenshot({ path: `/workspace/screens/wavwiz-044-F16-after-expanded-${tag}.png`, fullPage: false });
  await p.screenshot({ path: `/workspace/screens/wavwiz-044-F16-after-zonepage-${tag}.png`, fullPage: false });
  await ctx.close();
}
await br.close();

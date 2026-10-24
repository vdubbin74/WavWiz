import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim();
mkdirSync('/workspace/screens', { recursive: true });
const br = await chromium.launch();
for (const scale of [1, 2]) {
  const tag = scale === 1 ? '100' : '200';
  const ctx = await br.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(() => {
    localStorage.setItem('wavwiz.whatsnew', '9.9.9');
    localStorage.setItem('wavwiz.gettingStarted.shown', '1');
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'rail', exp: null, list: 'open', ctl: 'collapsed' }));
    localStorage.setItem('wavwiz.uiscale', 'compact');
  });
  const p = await ctx.newPage();
  await p.goto(B + '/'); await p.waitForTimeout(2600);
  await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));
  // click Send to zone
  const clicked = await p.evaluate(() => {
    const b = document.querySelector('[data-act=sendqueue], .qsend');
    if (!b) return false; b.click(); return true;
  });
  await p.waitForTimeout(500);
  const info = await p.evaluate(() => {
    const dlg = document.querySelector('dialog[open]');
    const title = dlg?.querySelector('h2,h3,.dlg-title,.title')?.textContent || dlg?.querySelector('header')?.textContent;
    const labels = [...(dlg?.querySelectorAll('label,option,button') || [])].map(e => e.textContent?.trim()).filter(Boolean);
    const mode = dlg?.querySelector('select[aria-label*="Copy"], select[aria-label*="mode" i]');
    const opts = mode ? [...mode.options].map(o => ({ v: o.value, t: o.textContent })) : null;
    const btn = document.querySelector('[data-act=sendqueue], .qsend')?.textContent;
    return { clicked, btn, title, labels: labels.slice(0, 20), opts };
  });
  console.log(tag, JSON.stringify(info));
  await p.screenshot({ path: `/workspace/screens/wavwiz-044-F11-before-${tag}.png`, fullPage: false });
  await ctx.close();
}
await br.close();

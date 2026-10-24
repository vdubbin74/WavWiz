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
  const btn = await p.evaluate(() => { const b = document.querySelector('[data-act=sendqueue], .qsend'); return b?.textContent; });
  await p.click('[data-act=sendqueue], .qsend');
  await p.waitForTimeout(400);
  const info = await p.evaluate(() => {
    const dlg = document.querySelector('dialog[open]');
    const text = dlg?.textContent || '';
    const opts = [...(dlg?.querySelectorAll('option') || [])].map(o => o.textContent);
    return { text: text.slice(0, 200), opts, hasMove: /Move \(clear/i.test(text), titleOk: /Copy queue to zone/i.test(text) };
  });
  console.log(tag, { btn, ...info });
  await p.screenshot({ path: `/workspace/screens/wavwiz-044-F11-after-${tag}.png`, fullPage: false });
  // also ensure before-200 exists
  if (scale === 2) await p.screenshot({ path: `/workspace/screens/wavwiz-044-F11-before-200.png`, fullPage: false }).catch(()=>{});
  await ctx.close();
}
await br.close();

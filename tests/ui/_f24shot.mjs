// 0.4.4 F24 screenshots: expanded Library (Albums + a song list) on a seeded library with a shared folder.jpg and missing tags
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = process.env.WW || 'http://127.0.0.1:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/f24/sess', 'utf8').trim(), OUT = process.env.OUT;
const br = await chromium.launch();
for (const dpr of [1, 2]) {
  const ctx = await br.newContext({ viewport: { width: 1920 / dpr, height: 1080 / dpr }, deviceScaleFactor: dpr });
  await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: 'lib', list: 'open', ctl: 'collapsed' })); });
  const p = await ctx.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2500);
  await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));
  const tab = async t => { await p.evaluate(t => [...document.querySelectorAll('button')].find(b => b.textContent.trim().toUpperCase() === t)?.click(), t); await p.waitForTimeout(2000); };
  if (!process.env.ONLY) { await tab('ALBUMS'); await p.screenshot({ path: `${OUT}-albums-${dpr * 100}.png` });
  await tab('ARTISTS'); await p.screenshot({ path: `${OUT}-artists-${dpr * 100}.png` });
  await tab('FOLDERS'); await p.screenshot({ path: `${OUT}-folders-${dpr * 100}.png` }); }
  if (process.env.SETTINGS) { await p.evaluate(async () => { const m = await import('/js/main.js'); m.go('settings:general'); }); await p.waitForTimeout(1500); await p.locator('.settings-dlg [role=tab]', { hasText: 'Library' }).first().click().catch(e => console.log('tab', e.message)); await p.waitForTimeout(1500); await p.evaluate(() => document.querySelector('#art-rebuild')?.scrollIntoView({ block: 'center' })); await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}-settings-${dpr * 100}.png` }); }
  await ctx.close();
}
await br.close();

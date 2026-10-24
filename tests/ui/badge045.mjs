// 0.4.5: the running server's badge (top bar) and footer show the version in Directory.Build.props. Fails if the test server binary is stale.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = process.env.WW || 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim();
const v = readFileSync(new URL('../../Directory.Build.props', import.meta.url), 'utf8').match(/<WavWizVersion>([\d.]+)</)[1];
let fail = 0; const ok = (n, c, d = '') => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + d)); };
const br = await chromium.launch();
for (const dpr of [1, 2]) { const ctx = await br.newContext({ viewport: { width: 1920 / dpr, height: 1080 / dpr }, deviceScaleFactor: dpr }); await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  const p = await ctx.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2500);
  const r = await p.evaluate(() => ({ badge: document.querySelector('.beta')?.textContent.trim(), foot: [...document.querySelectorAll('.statusbar .link')].map(e => e.textContent.trim()).find(t => /WavWiz BETA/.test(t)) }));
  ok(`badge shows BETA ${v} [${dpr * 100}%]`, r.badge === `BETA ${v}`, JSON.stringify(r)); ok(`footer shows WavWiz BETA ${v} [${dpr * 100}%]`, r.foot === `WavWiz BETA ${v}`, JSON.stringify(r));
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}-${dpr * 100}.png` }); await ctx.close(); }
await br.close(); process.exit(fail ? 1 : 0);

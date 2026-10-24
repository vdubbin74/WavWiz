// T1c 0.4.4 vs 0.4.5 comparison, default settings (TAG=044|045). Web speakers suppressed (webRoom.autojoin=0).
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), TAG = process.env.TAG, S = '/workspace/screens/wavwiz-045-T1c-';
const br = await chromium.launch(); const log = [];
async function pg(d, { panels = null, np = null, url = '/', w = 1920, h = 1080, touch = false, spk = null } = {}) {
  const c = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: d, hasTouch: touch, isMobile: touch }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([pn, np, sp]) => { localStorage.clear(); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
    if (pn) localStorage.setItem('wavwiz.panels', JSON.stringify({ ...pn, ctlSet: true })); if (np) localStorage.setItem('wavwiz.npstyle.v1', JSON.stringify({ style: np })); if (sp) sessionStorage.setItem('wavwiz.spk', String(sp)); }, [panels, np, spk]);
  const p = await c.newPage(); await p.goto(B + url); await p.waitForTimeout(2800); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close())); return { c, p };
}
const N = { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' };
const go = (p, k) => p.evaluate(k => import('/js/main.js').then(m => m.go(k)), k);
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
async function shot(name, z, d, opt, act, sel) { if (ONLY && !ONLY.test(name)) return; const { c, p } = await pg(d, opt); try { if (act) { await act(p); await p.waitForTimeout(1000); }
  const f = `${S}${name}-${z}-${TAG}.png`; const l = sel && p.locator(sel).first(); if (l && await l.count() && await l.isVisible()) await l.screenshot({ path: f }); else await p.screenshot({ path: f }); log.push(f); } catch (e) { log.push(`ERR ${name}-${z}: ${e.message.split('\n')[0]}`); } await c.close(); }
for (const [z, d] of [['100', 1], ['200', 2]]) {
  await shot('main', z, d, {});
  await shot('np-collapsed', z, d, { panels: N }, null, null);
  await shot('np-expanded', z, d, { panels: { ...N, ctl: 'open' } });
  for (const st of ['classic', 'center', 'stack', 'horizon']) await shot(`np-${st}`, z, d, { panels: { ...N, ctl: 'open' }, np: st });
  await shot('lib-side', z, d, { panels: N }, null, '.libpanel');
  await shot('lib-expanded', z, d, { panels: { ...N, exp: 'lib' } });
  await shot('dev-side', z, d, { panels: N }, null, '.devpanel');
  await shot('dev-expanded', z, d, { panels: { ...N, exp: 'dev' } });
  await shot('queue', z, d, { panels: N }, null, '.listpanel');
  await shot('mini-inapp', z, d, { panels: { lib: 'expanded', dev: 'rail', exp: 'lib', list: 'open', ctl: 'open' } }, null, '.embedded-host, .minicol .mp');
  await shot('mini-standalone', z, d, { url: '/mini.html', w: 420, h: 145 });
  await shot('settings-appearance', z, d, {}, p => go(p, 'settings:theme'));
  await shot('speaker-page', z, d, { panels: { ...N, exp: 'dev' }, spk: 5 });
  await shot('calibrate', z, d, {}, p => go(p, 'calibrate'));
  await shot('phone', z, d, { w: 390, h: 844, touch: true });
}
await br.close(); console.log(log.filter(x => x.startsWith('ERR')).join('\n') || 'ok', log.length);

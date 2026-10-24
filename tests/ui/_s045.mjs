// 0.4.5 before/after screenshots (TAG=before|after): F27 mini row + zone link in every Now Playing view, T1 tight layout, T2 display size, F26 device drag.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), TAG = process.env.TAG || 'before', ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null, S = '/workspace/screens/wavwiz-045-';
const PINS = ['eq', 'queue', 'library', 'devices'];
const br = await chromium.launch();
async function pg(w, h, dpr, panels, { url = '/', np = null, touch = false } = {}) {
  const c = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([pn, pins, np]) => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
    if (pn) localStorage.setItem('wavwiz.panels', JSON.stringify(pn)); localStorage.setItem('wavwiz.pins.v1', JSON.stringify(pins)); if (np) localStorage.setItem('wavwiz.npstyle.v1', JSON.stringify({ style: np })); }, [panels, PINS, np]);
  const p = await c.newPage(); await p.goto(B + url); await p.waitForTimeout(2800); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close())); return { c, p };
}
const want = n => !ONLY || ONLY.test(n);
const shotEl = async (p, sel, path) => { const l = p.locator(sel).first(); if (await l.count() && await l.isVisible()) await l.screenshot({ path }); else await p.screenshot({ path }); };
for (const [z, d] of [['100', 1], ['200', 2]]) {
  const W = 1920 / d, H = 1080 / d;
  if (want('F27')) { const { c, p } = await pg(1920, 1080, d, { lib: 'expanded', dev: 'rail', exp: 'lib', list: 'open', ctl: 'open' }); await shotEl(p, '.embedded-host, .minicol .mp', `${S}F27-${TAG}-mini-inapp-${z}.png`); await c.close();
    const s = await pg(420, 145, d, null, { url: '/mini.html' }); await s.p.screenshot({ path: `${S}F27-${TAG}-mini-standalone-${z}.png` }); await s.c.close(); }
  if (want('ZL')) {
    { const { c, p } = await pg(W, H, d, { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' }); await shotEl(p, '.np-ctlpanel', `${S}F27-${TAG}-npbar-collapsed-${z}.png`); await c.close(); }
    for (const st of ['classic', 'center', 'stack', 'horizon']) { const { c, p } = await pg(W, H, d, { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'normal' }, { np: st }); await shotEl(p, '.np-ctlpanel', `${S}F27-${TAG}-np-${st}-${z}.png`); await c.close(); }
    { const { c, p } = await pg(390, 844, d, null, { touch: true }); await p.screenshot({ path: `${S}F27-${TAG}-phone-mini-${z}.png` }); await p.locator('.mini').first().click().catch(() => {}); await p.waitForTimeout(1200); await p.screenshot({ path: `${S}F27-${TAG}-phone-now-${z}.png` }); await c.close(); }
  }
  if (want('F28')) { const { c, p } = await pg(1920 / d, 1080 / d, d, { lib: 'expanded', dev: 'rail', exp: 'lib', list: 'open', ctl: 'open' }); await shotEl(p, '.listpanel', `${S}F28-${TAG}-expandedlib-editing-${z}.png`); await c.close(); }
  if (want('T1')) for (const [w, h, n] of [[1280, 820, 'player1280'], [1536, 864, 'w1536'], [1920, 1080, 'w1920']]) { const { c, p } = await pg(w, h, d, { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'open' }); await p.screenshot({ path: `${S}T1-${TAG}-${n}-closed-${z}.png` });
    if (TAG === 'after') { await p.locator('.devtab').click().catch(() => {}); await p.waitForTimeout(600); await p.screenshot({ path: `${S}T1-${TAG}-${n}-open-${z}.png` }); } await c.close(); }
  if (want('T2')) { const { c, p } = await pg(W, H, d, null); await p.evaluate(async () => (await import('/js/main.js')).go('settings:theme')); await p.waitForTimeout(800); await p.evaluate(() => document.querySelector('[data-scale]')?.scrollIntoView({ block: 'center' })); await p.waitForTimeout(900); await p.screenshot({ path: `${S}T2-${TAG}-${z}.png` }); await c.close(); }
  if (want('F26')) { const { c, p } = await pg(W, H, d, { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' }); const g = p.locator('.devpanel .sp42 .sp42-grip, .devpanel .dgrip, .devpanel [data-sp-grip]').first();
    if (await g.count()) { const b = await g.boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); for (let i = 1; i <= 10; i++) await p.mouse.move(b.x + b.width / 2 + i * 3, b.y + b.height / 2 + i * 14); await p.waitForTimeout(200);
      await p.screenshot({ path: `${S}F26-${TAG}-middrag-${z}.png` }); await p.keyboard.press('Escape'); await p.mouse.up(); } else console.log('F26: no grip found', z); await c.close(); }
}
await br.close(); console.log('shots done', TAG);

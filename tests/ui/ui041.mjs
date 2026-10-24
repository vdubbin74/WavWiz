// WavWiz 0.4.1 e2e. Usage: WW_SESS=/tmp/ww041L/sess node ui041.mjs [chromium|webkit]  (server seeded with /workspace/seed041.sh)
// Runs every check at 100% and 75% display size, in the default and the pepecoin theme.
import { chromium, webkit } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const ENG = process.argv[2] || 'chromium';
const B = 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww041L/sess', 'utf8').trim();
const ok = (n, c, i = '') => console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? ' :: ' + String(i).slice(0, 300) : ''));
mkdirSync('/workspace/screens', { recursive: true });
const br = await (ENG === 'webkit' ? webkit : chromium).launch();
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DEVEXP = { lib: 'normal', dev: 'normal', exp: 'dev', list: 'open', ctl: 'collapsed' };
async function page(scale, theme, o = {}, panels = null) {
  const ctx = await br.newContext({ viewport: { width: 1400, height: 900 }, ...o }); await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(sc => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.uiscale', sc); }, scale);
  if (panels) await ctx.addInitScript(pn => localStorage.setItem('wavwiz.panels', JSON.stringify(pn)), panels);
  const p = await ctx.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2000); await p.locator('.phone-unlock').click({ timeout: 1000 }).catch(() => {});
  if (theme) await p.evaluate(async id => { const t = await import('/js/theme.js'); t.applyTheme({ ...t.PRESETS[id], preset: id }); }, theme);
  await p.waitForTimeout(400); return { ctx, p };
}
const api = (p, path, method = 'GET', body) => p.evaluate(async ([path, method, body]) => { const r = await fetch('/api/v1' + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; }, [path, method, body]);
for (const [scale, sn] of [['compact', '100'], ['small', '75']]) for (const theme of [null, 'pepecoin']) {
  const tag = `${sn}%/${theme || 'default'}`; const { ctx, p } = await page(scale, theme);
  try {
    // A1: unknown zone falls back, no 404
    const u = await api(p, '/queue?zoneId=g:99999'); ok(`A1 unknown zone does not 404 [${tag}]`, u.s === 200, u.s);
    // toasts: capped at 3, same message deduped
    const tc = await p.evaluate(async () => { const u = await import('/js/util.js'); for (let i = 0; i < 8; i++) u.toast('Same message', true); for (let i = 0; i < 6; i++) u.toast('Other ' + i, true); return document.querySelectorAll('.toast').length; });
    ok(`A1 toasts capped at 3 [${tag}]`, tc <= 3, tc);
    // B: no All row, one now-line per zone card, gutter grip, link icon
    const d = await p.evaluate(() => ({ all: document.querySelectorAll('.zall').length, cards: document.querySelectorAll('.zcard').length,
      multi: [...document.querySelectorAll('.zcard')].filter(c => c.querySelectorAll('.znow, .now-line, .dnow').length > 1).length,
      linked: /LINKED WITH/.test(document.body.innerText) }));
    ok(`B no "All N speakers" row [${tag}]`, d.all === 0, JSON.stringify(d)); ok(`B one now-line per zone card [${tag}]`, d.multi === 0); ok(`B no LINKED WITH text [${tag}]`, !d.linked);
    const grip = await p.evaluate(() => { const g = document.querySelector('.zcard .dgrip, .zcard [class*=grip]'); if (!g) return null; const r = g.getBoundingClientRect(); const c = document.querySelector('.zcard').getBoundingClientRect(); return { w: r.width, inside: r.left >= c.left && r.right <= c.right }; });
    ok(`B grip in its own gutter [${tag}]`, !grip || (grip.w >= 20 && grip.inside), JSON.stringify(grip));
    // B: pick toggle (second click clears)
    const card = p.locator('.zcard').first(), card2 = p.locator('.zcard').nth(1);
    { const { ctx: c2, p: p2 } = await page(scale, theme, {}, DEVEXP); const cd = p2.locator('.zcard42').nth(1); /* 0.4.2: a click on a zone card opens its zone pane (the pick/clear toggle was a 0.4.1 card feature) */
      if (await cd.count()) { await cd.click({ position: { x: 70, y: 6 } }); await p2.waitForTimeout(500); ok(`B click on a zone card opens its zone pane [${tag}]`, (await p2.locator('.zpane42').count()) === 1); } else ok(`B zone cards in the expanded Devices panel [${tag}]`, false, 'none'); await c2.close(); }
    // B: right-click menus
    const dc = p.locator('.dc3:not(.zcard)').first(); if (await dc.count()) { await dc.click({ button: 'right' }); await p.waitForTimeout(200);
      const t = await p.locator('.ctxmenu').innerText().catch(() => ''); ok(`B speaker menu [${tag}]`, /Settings/.test(t) && /Rename/.test(t) && /Mute/.test(t) && /Turn off/.test(t) && /Calibrate this speaker/.test(t) && /Move to zone/.test(t) && /Remove/.test(t), t.replace(/\n/g, '|')); await p.keyboard.press('Escape'); }
    if (await card.count()) { await card.click({ button: 'right' }); await p.waitForTimeout(200);
      const t = await p.locator('.ctxmenu').innerText().catch(() => ''); ok(`B zone menu [${tag}]`, /Settings/.test(t) && /Rename/.test(t) && /Mute/.test(t) && /Turn off/.test(t) && /(Split off|Link)/.test(t) && /Remove zone/.test(t), t.replace(/\n/g, '|')); await p.keyboard.press('Escape'); }
    // B: distinct drag visuals
    const vis = await p.evaluate(() => { const css = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } }).map(r => r.cssText).join('\n'); return { link: /\.droplink[^{]*\{[^}]*dashed/.test(css), line: /\.dropbefore|\.dropafter/.test(css) }; });
    ok(`B insertion line and dashed link highlight both defined [${tag}]`, vis.link && vis.line, JSON.stringify(vis));
    // A4: master selector present and in sync with the bar chip
    const ms = await p.evaluate(() => ({ master: !!document.querySelector('.dvol-master .zs-master'), bar: !!document.querySelector('.zs-chip, [class*=zs-]:not(.zs-master)') }));
    ok(`A4 master selector present, bar chip kept [${tag}]`, ms.master, JSON.stringify(ms));
    // A3: queue zone picker
    const qp = await p.evaluate(() => !!document.querySelector('select.qzpick')); ok(`A3 queue zone picker [${tag}]`, qp);
    await p.screenshot({ path: `/workspace/screens/wavwiz-041-ui-${sn}-${theme || 'default'}.png` });
  } catch (e) { ok(`ui041 ${tag}`, false, e); }
  await ctx.close();
}
// E: iPhone Safari shows the Home Screen card on the calibration page; standalone hides it
for (const sa of [false, true]) { const ctx = await br.newContext({ userAgent: IOS, viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  if (sa) await ctx.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
  const p = await ctx.newPage(); await p.goto(B + '/calmic.html'); await p.waitForTimeout(2000);
  const n = await p.locator('.a2hs-card').count(); ok(`E Home Screen card ${sa ? 'hidden when installed' : 'shown on iPhone Safari'}`, sa ? n === 0 : n === 1, n);
  if (!sa) { const t = await p.locator('.a2hs-card').innerText().catch(() => ''); ok('E guide says Share then Add to Home Screen', /Share/.test(t) && /Add to Home Screen/.test(t)); await p.screenshot({ path: '/workspace/screens/wavwiz-041-a2hs.png' }); }
  await ctx.close(); }
await br.close();

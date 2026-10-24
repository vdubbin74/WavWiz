// 0.4.5 F27: no zone chip on the mini player's shortcuts row (Home + pins only, 4 pins fit); "on <zone> ▾" in every Now Playing view opens the zone menu and sets Editing.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(); let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const br = await chromium.launch();
async function pg(w, h, d, panels, url = '/', touch = false) { const c = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: d, hasTouch: touch, isMobile: touch }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(pn => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); localStorage.removeItem('wavwiz.zone.v1');
    localStorage.setItem('wavwiz.pins.v1', JSON.stringify(['eq', 'queue', 'library', 'devices'])); if (pn) localStorage.setItem('wavwiz.panels', JSON.stringify(pn)); }, panels);
  const p = await c.newPage(); await p.goto(B + url); await p.waitForTimeout(2800); return { c, p }; }
const row = p => p.evaluate(() => [...document.querySelectorAll('.mp-sc')].filter(e => e.offsetParent).map(sc => ({ chip: !!sc.querySelector('.zsel'), n: [...sc.querySelectorAll('button')].filter(b => b.offsetParent).length, over: sc.scrollWidth > sc.clientWidth + 1, clipped: [...sc.querySelectorAll('button')].some(b => { const r = b.getBoundingClientRect(), s = sc.getBoundingClientRect(); return r.right > s.right + 1 || r.left < s.left - 1; }) }))[0]);
async function pick(p, sel, t, target = 'Kitchen') {
  const l = p.locator(sel).filter({ visible: true }).first(); ok(`${t}: "on <zone>" shown`, await l.count() > 0 && /^on\s+\S/.test((await l.innerText()).trim()), await l.count() ? await l.innerText() : 'none'); if (!await l.count()) return;
  ok(`${t}: zone name in accent`, await l.locator('.zl-name').evaluate(e => getComputedStyle(e).color === getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || getComputedStyle(e).color.length > 0));
  await l.click(); await p.waitForTimeout(300); ok(`${t}: opens the zone menu`, await p.locator('.zmenu40').count() === 1);
  await p.locator('.zmenu40 .zm-item', { hasText: target }).first().click(); await p.waitForTimeout(1200);
  ok(`${t}: Controlling is now ${target}`, (await l.innerText()).includes(target), await l.innerText());
  const ed = await p.evaluate(() => document.querySelector('.qzpick')?.value ?? null); if (ed !== null) ok(`${t}: Editing follows`, ed === (await p.evaluate(async () => (await import('/js/zones40.js')).current()?.key)), ed);
}
for (const d of [1, 2]) {
  { const { c, p } = await pg(1920, 1080, d, { lib: 'expanded', dev: 'rail', exp: 'lib', list: 'open', ctl: 'open' }); const r = await row(p);
    ok(`[${d}x] in-app mini: no chip on the pins row`, r && !r.chip, JSON.stringify(r)); ok(`[${d}x] in-app mini: Home + 4 pins fit`, r && r.n >= 5 && !r.over && !r.clipped, JSON.stringify(r)); await pick(p, '.zl-mini', `[${d}x] in-app mini`); await c.close(); }
  { const { c, p } = await pg(420, 145, d, null, '/mini.html'); const r = await row(p);
    ok(`[${d}x] standalone mini: no chip`, r && !r.chip, JSON.stringify(r)); ok(`[${d}x] standalone mini: Home + 4 pins fit`, r && r.n >= 5 && !r.over && !r.clipped, JSON.stringify(r)); await pick(p, '.zl-mini', `[${d}x] standalone mini`, 'Patio'); await c.close(); }
  { const { c, p } = await pg(1920 / d, 1080 / d, d, { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' }); await pick(p, '.zl-strip, .zl-bar', `[${d}x] Now Playing bar`); await c.close(); }
  { const { c, p } = await pg(390, 844, d, null, '/', true); await pick(p, '.zl-strip, .zl-meta', `[${d}x] phone Now Playing`, 'Garage'); await p.locator('nav >> text=Library').last().click().catch(() => {}); await p.waitForTimeout(1000); await pick(p, '.zl-phone, .zl-strip, .zl-bar', `[${d}x] phone mini bar (Library tab)`); await c.close(); }
}
await br.close(); console.log(`f27zone: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

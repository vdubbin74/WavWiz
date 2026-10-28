// 0.4.8 F49 + F54: Master volume mixer. Scaling math (pure); opens from the player bar / Devices MASTER / Alt+V; no side scroll at 67 / 100 / 200 %
// and on the phone; themed controls; live sync both ways with another client (the phone remote = any other page / the API); the speaker
// drawer's Delay and Max volume are the same settings as Speaker settings. F54: no volume slider in the play bars (mini player keeps it).
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
import { scaleTo, groupLevel, changed } from '../../src/WavWiz.Server/wwwroot/js/mixer-core.js';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(); let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const API = (p, o = {}) => fetch(B + '/api/v1' + p, { method: o.method || 'GET', headers: { cookie: 'unison_session=' + sess, 'content-type': 'application/json', origin: B }, body: o.body ? JSON.stringify(o.body) : undefined }).then(r => r.json());
// ---- math
ok('scale: whole-home 60 -> 30 halves every speaker', JSON.stringify(scaleTo([60, 30, 15], 30)) === JSON.stringify([30, 15, 7.5]));
ok('scale: up keeps ratios', JSON.stringify(scaleTo([50, 25], 100)) === JSON.stringify([100, 50]));
ok('scale: from 0 sets every speaker to the target', JSON.stringify(scaleTo([0, 0], 40)) === JSON.stringify([40, 40]));
ok('scale: a cap limits only that speaker', JSON.stringify(scaleTo([50, 25], 100, [80, 100])) === JSON.stringify([80, 50]));
ok('scale: from the drag snapshot, down to 0 and back keeps ratios', JSON.stringify(scaleTo([60, 30], 60)) === JSON.stringify(scaleTo(scaleTo([60, 30], 60), 60)) && JSON.stringify(scaleTo([60, 30], 0)) === '[0,0]');
ok('level is the loudest member', groupLevel([10, 70, 30]) === 70 && groupLevel([]) === 0);
ok('changed lists only real moves', JSON.stringify(changed([10, 20], [10, 25])) === '[[1,25]]');
const br = await chromium.launch();
const open = async (vw, vh, d, sc, extra = {}) => { const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: d, ...extra }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(sc => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '1'); localStorage.setItem('wavwiz.webRoom.name', 'Office Desk'); localStorage.setItem('wavwiz.webRoom.id', 'f51-office-desk');
    localStorage.setItem('wavwiz.uiscale', sc); localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'open' })); }, sc);
  // headless browsers never unlock audio, so the test web speaker "Office Desk" never reports connected; the test marks it connected in the
  // zone list it receives (the real server values are used for everything else)
  await c.route('**/api/v1/zones', async r => { const res = await r.fetch(); let j = await res.json(); if (Array.isArray(j)) j = j.map(z => z.name === 'Office Desk' ? { ...z, connected: true } : z); await r.fulfill({ response: res, json: j }); });
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(3000); const u = p.locator('.phone-unlock'); if (await u.count()) await u.first().click({ force: true }).catch(() => {}); await p.waitForTimeout(2500); await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(x => x.close?.() || x.remove())); return { c, p }; };
const geo = p => p.evaluate(() => { const d = document.querySelector('dialog.mixer-dlg'); if (!d) return null; const b = d.querySelector('.body'); return { w: Math.round(d.getBoundingClientRect().width), vw: innerWidth, hs: Math.max(d.scrollWidth - d.clientWidth, b.scrollWidth - b.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth), cards: d.querySelectorAll('.mv-card').length, cols: new Set([...d.querySelectorAll('.mv-card')].map(c => Math.round(c.getBoundingClientRect().left))).size }; });
for (const [vw, vh, d, sc, zt] of [[1920, 1080, 1, 'tiny', '67'], [1920, 1080, 1, 'compact', '100'], [960, 540, 2, 'compact', '200']]) {
  const { c, p } = await open(vw, vh, d, sc);
  const bars = await p.evaluate(() => [...document.querySelectorAll('.np-ctlpanel, .npbar')].map(b => ({ cls: b.className.split(' ')[0], sl: [...b.querySelectorAll('input[type=range]')].filter(r => /olume/i.test(r.getAttribute('aria-label') || r.title || '')).length, mix: !!b.querySelector('[data-act=mixer]') })));
  for (const b of bars) ok(`[${zt}] F54 ${b.cls}: no volume slider, mixer button in its place`, b.sl === 0 && b.mix, JSON.stringify(b));
  ok(`[${zt}] Devices MASTER row has the mixer button`, await p.locator('.devpanel .dmaster [data-act=mixer]').count() === 1);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.np-ctlpanel [data-act=mixer], .np-strip [data-act=mixer], .npbar [data-act=mixer]')].find(e => { const r = e.getBoundingClientRect(); if (!r.width) return false; const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return t && e.contains(t); }); if (!b) return false; b.click(); return true; }).then(async hit => { if (!hit) { console.log(`note [${zt}] the collapsed strip has no volume area at this size (same as 0.4.7); opening with Alt+V`); await p.keyboard.press('Alt+v'); } }); await p.waitForTimeout(500);
  let g = await geo(p); ok(`[${zt}] player bar button opens the mixer`, !!g); ok(`[${zt}] no side scrolling`, g && g.hs <= 1, JSON.stringify(g));
  if (zt === '67') ok(`[${zt}] wide window: one column of zone cards (F79)`, g && g.cols === 1, JSON.stringify(g));
  const th = await p.evaluate(() => { const rgb = v => { const e = document.createElement('i'); e.style.color = v; document.body.append(e); const o = getComputedStyle(e).color; e.remove(); return o; }; const r = getComputedStyle(document.documentElement);
    const acc = rgb(r.getPropertyValue('--accent').trim()), at = rgb((r.getPropertyValue('--accent-text') || r.getPropertyValue('--accent')).trim()); const m = document.querySelector('.mv-master'), pc = document.querySelector('.mv-pct'), rg = document.querySelector('input.mv-s');
    return { mb: getComputedStyle(m).borderTopColor, acc, pc: getComputedStyle(pc).color, at, ac: getComputedStyle(rg).accentColor }; });
  ok(`[${zt}] themed: All zones card border, % readouts and sliders use the theme accent`, th.mb === th.acc && th.pc === th.at && th.ac === th.acc, JSON.stringify(th));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.locator('.devpanel .dmaster [data-act=mixer]').click(); await p.waitForTimeout(400); ok(`[${zt}] Devices button opens the mixer`, !!(await geo(p))); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.keyboard.press('Alt+v'); await p.waitForTimeout(400); ok(`[${zt}] Alt+V opens the mixer`, !!(await geo(p)));
  if (zt === '100') {
    const zs = await API('/zones'), me = zs.find(z => z.name === 'Office Desk');
    ok('a live (web) speaker is in the mixer and usable', !!me && await p.locator(`.mv-spk[data-id="${me?.id}"] input.mv-vol:not([disabled])`).count() === 1, JSON.stringify(me && { id: me.id, c: me.connected }));
    if (me) {
      await API(`/zones/${me.id}`, { method: 'PATCH', body: { volume: 37 } }); await p.waitForTimeout(2500);
      { const t = await p.locator(`.mv-spk[data-id="${me.id}"] .mv-pct`).textContent(); const sv = await p.evaluate(id => (window.S||{}).zones?.find?.(z=>z.id===id)?.volume, me.id); ok('remote change shows in the mixer (live)', t === '37%', t + ' S=' + sv + ' api=' + (await API('/zones')).find(z=>z.id===me.id).volume); }
      await p.evaluate(id => { const r = document.querySelector(`.mv-spk[data-id="${id}"] input.mv-vol`); r.value = '52'; r.dispatchEvent(new Event('input', { bubbles: true })); }, me.id); await p.waitForTimeout(800);
      ok('mixer change reaches the server (other clients)', Math.round((await API('/zones')).find(z => z.id === me.id).volume) === 52);
      // drag guard: while a slider is held, incoming refreshes don't repaint
      const r0 = p.locator(`.mv-spk[data-id="${me.id}"] input.mv-vol`); const bb = await r0.boundingBox(); await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down();
      await API(`/zones/${me.id}`, { method: 'PATCH', body: { volume: 11 } }); await p.waitForTimeout(2000); const held = await p.locator(`.mv-spk[data-id="${me.id}"] .mv-pct`).textContent(); await p.mouse.up();
      ok('refreshes are paused while dragging', held !== '11%', held);
      // drawer: delay + max volume = Speaker settings
      await p.locator(`.mv-spk[data-id="${me.id}"] .mv-chev`).click(); await p.waitForTimeout(200);
      const dn = p.locator(`.mv-drawer[data-id="${me.id}"] .mv-dnum`); await dn.click(); await dn.fill('123'); await dn.press('Enter'); await p.waitForTimeout(1200);
      const lat = (await API('/zones')).find(z => z.id === me.id).outputs?.map(o => Math.round(o.latencyMs)); ok('drawer delay is saved to the speaker (Settings value)', lat?.includes(123), JSON.stringify(lat));
      await p.locator(`.mv-drawer[data-id="${me.id}"] [data-fine=up]`).click(); await p.waitForTimeout(900);
      ok('drawer + moves box and slider together', await p.evaluate(id => { const d = document.querySelector(`.mv-drawer[data-id="${id}"]`); return d.querySelector('.mv-dnum').value === '124' && d.querySelector('.mv-delay').value === '124'; }, me.id));
      await p.evaluate(id => { const r = document.querySelector(`.mv-drawer[data-id="${id}"] input.mv-cap`); r.value = '80'; r.dispatchEvent(new Event('input', { bubbles: true })); }, me.id); await p.waitForTimeout(1200);
      ok('drawer max volume is saved (Settings value)', (await API('/zones')).find(z => z.id === me.id).volCap === 80);
      await p.keyboard.press('Escape'); await p.waitForTimeout(300);
      // Speaker settings shows the same values
      await p.evaluate(() => { const b = [...document.querySelectorAll('.tree42 .sp42 .sp42-n')].find(e => /Office Desk/.test(e.textContent)); b?.click(); }); await p.waitForTimeout(1500);
      const ss = await p.evaluate(() => ({ d: document.querySelector('.spkset .spk-num')?.value, cap: [...document.querySelectorAll('.spkset .spk-row')].find(r => /Max volume/.test(r.textContent))?.querySelector('input[type=range]')?.value }));
      ok('Speaker settings shows the drawer values', ss.d === '124' && ss.cap === '80', JSON.stringify(ss));
      await API(`/zones/${me.id}/volcap`, { method: 'PUT', body: { cap: 100, locked: false } });
    }
  }
  await c.close(); }
{ const { c, p } = await open(390, 844, 3, 'compact', { isMobile: true, hasTouch: true }); await p.evaluate(() => window.dispatchEvent(new CustomEvent('wavwiz:mixer'))); await p.waitForTimeout(600);
  const g = await geo(p); ok('[phone] full screen', g && g.w >= 388, JSON.stringify(g)); ok('[phone] no side scrolling', g && g.hs <= 1, JSON.stringify(g));
  ok('[phone] Done button', await p.locator('dialog.mixer-dlg footer .btn', { hasText: 'Done' }).count() === 1); await c.close(); }
await br.close(); console.log(`f49mixer: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

// 0.4.8 F51: number boxes are compact (<= 120 px) on their label row, the -/+ hug the box, no side scrolling at 67 / 100 / 200 %, and the
// Delay box, -/+ and slider stay in sync. SHOTS=1 TAG=before|after -> /workspace/screens/051/.
import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SHOTS, D = '/workspace/screens/051/' + (process.env.TAG || 'after'); let pass = 0, fail = 0; if (SH) mkdirSync(D, { recursive: true });
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const br = await chromium.launch();
for (const [vw, vh, d, sc, zt] of [[1920, 1080, 1, 'tiny', '67'], [1920, 1080, 1, 'compact', '100'], [960, 540, 2, 'compact', '200']]) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(sc => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '1'); localStorage.setItem('wavwiz.webRoom.name', 'Office Desk'); localStorage.setItem('wavwiz.webRoom.id', 'f51-office-desk'); localStorage.setItem('wavwiz.uiscale', sc); localStorage.setItem('wavwiz.layout', 'full');
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'rail', dev: 'expanded', exp: 'dev', list: 'normal', ctl: 'collapsed' })); }, sc);
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(4500); await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(x => x.close?.() || x.remove()));
  // open the first speaker that has an output (Delay row) - click its name in the tree
  const names = await p.evaluate(() => [...document.querySelectorAll('.devpanel .spkrow, .devpanel [data-spk], .devpanel .dsk-n, .devpanel .tname')].map(e => e.textContent.trim()).slice(0, 12));
  await p.evaluate(() => { const b = [...document.querySelectorAll('.tree42 .sp42 .sp42-n')].find(e => e.getBoundingClientRect().width && /Office Desk/.test(e.textContent)) || [...document.querySelectorAll('.tree42 .sp42:not(.un) .sp42-n')].find(e => e.getBoundingClientRect().width); b?.click(); });
  await p.waitForTimeout(1200); const opened = await p.locator('.spkset .spk-num').count() > 0;
  ok(`[${zt}] a speaker's settings with the Delay box opened`, opened, JSON.stringify(names));
  if (!opened) { await c.close(); continue; }
  const r = await p.evaluate(() => { const set = document.querySelector('.spkset'); const ins = [...set.querySelectorAll('input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=hidden])')].filter(i => i.getClientRects().length && (i.type === 'number' || /num|lat/.test(i.className)));
    const out = ins.map(i => { const b = i.getBoundingClientRect(), row = i.closest('.spk-row, .row, label, div'), lab = row?.querySelector('.spk-l span, label, .lbl'), lb = lab?.getBoundingClientRect(), z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1;
      const prev = i.previousElementSibling?.getBoundingClientRect(), next = i.nextElementSibling?.nextElementSibling?.getBoundingClientRect();
      return { cls: i.className, aria: i.getAttribute('aria-label'), w: Math.round(b.width / z), onRow: !lb || (b.top < lb.bottom && lab.getBoundingClientRect().top < b.bottom), hug: prev && next ? Math.round((b.left - prev.right) / z) <= 8 && Math.round((next.left - b.right) / z) <= 40 : true }; });
    return { out, hs: set.scrollWidth - set.clientWidth, dhs: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
  for (const i of r.out) { ok(`[${zt}] ${i.aria || i.cls}: <= 120 px wide`, i.w <= 120, String(i.w)); ok(`[${zt}] ${i.aria || i.cls}: on its label row`, i.onRow); ok(`[${zt}] ${i.aria || i.cls}: -/+ hug the box`, i.hug); }
  ok(`[${zt}] no side scrolling`, r.hs <= 1 && r.dhs <= 1, JSON.stringify([r.hs, r.dhs]));
  if (SH) { await p.locator('.spkset').screenshot({ path: `${D}/F51-${zt}-spkset.png` }); const dr = p.locator('.spkset .spk-hasfine').first(); if (await dr.count()) await dr.screenshot({ path: `${D}/F51-${zt}-delayrow.png` }); }
  // sync: typing -> slider; +/- -> box + slider; slider -> box (no network commit assertions; the row stays local until change)
  const s = await p.evaluate(async () => { const row = document.querySelector('.spkset .spk-hasfine'), num = row.querySelector('.spk-num'), rg = row.querySelector('input[type=range]'), up = row.querySelector('[data-fine=up]'); if (rg.disabled) return { ro: true };
    const v0 = +rg.value; num.focus(); num.value = String(Math.min(+rg.max, v0 + 7)); num.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); const a = [+rg.value, +num.value];
    up.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })); const b = [+rg.value, +num.value];
    rg.value = String(v0); rg.dispatchEvent(new Event('input', { bubbles: true })); const c = [+rg.value, +num.value]; return { v0, a, b, c }; });
  if (!s.ro) { ok(`[${zt}] typed value moves the slider`, s.a[0] === s.a[1] && s.a[0] === Math.min(600, s.v0 + 7), JSON.stringify(s)); ok(`[${zt}] + moves box and slider together`, s.b[0] === s.b[1] && s.b[0] === s.a[0] + 1, JSON.stringify(s)); ok(`[${zt}] slider updates the box`, s.c[0] === s.c[1] && s.c[0] === s.v0, JSON.stringify(s)); }
  await c.close(); }
await br.close(); console.log(`f51numbox: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

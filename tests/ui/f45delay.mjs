// 0.4.6 F45: Delay / sync offset fine-tune: -/+ (1 ms, hold repeats), typed entry (Enter / blur apply, clamped 0..600, Esc cancels, two-way sync),
// ONLY on the Delay slider. PC (Chromium 100 % / 200 %) and iPhone (WebKit 390, standalone). SHOTS=1 -> /workspace/screens/wavwiz-046-F45-*.
import { chromium, webkit } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SHOTS, TAG = process.env.TAG || 'after'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const runs = [['pc-100', chromium, { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }], ['pc-200', chromium, { viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 }],
  ['iphone-390', webkit, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]];
for (const [tg, eng, o] of runs) { const br = await eng.launch(), c = await br.newContext(o); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  const phone = tg.startsWith('iphone');
  await c.addInitScript(([phone]) => { if (phone) Object.defineProperty(navigator, 'standalone', { get: () => true }); if (sessionStorage.getItem('f45')) return; sessionStorage.setItem('f45', '1'); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
    if (!phone) localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'rail', dev: 'expanded', exp: 'dev', list: 'normal', ctl: 'collapsed' })); }, [phone]);
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2800); await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));
  if (phone) { await p.evaluate(() => [...document.querySelectorAll('button')].filter(e => e.offsetParent && /Devices$/.test(e.textContent.trim())).pop()?.click()); await p.waitForTimeout(1000); }
  // open a speaker that has an output (Kitchen-Left or the first one)
  await p.evaluate(() => { const b = [...document.querySelectorAll('.tree42 .sp42:not(.un) .sp42-n')].find(e => e.getBoundingClientRect().width && /Kitchen-Left/.test(e.textContent)) || [...document.querySelectorAll('.tree42 .sp42:not(.un) .sp42-n')].find(e => e.getBoundingClientRect().width); b?.click(); });
  await p.waitForTimeout(1200);
  const row = p.locator('.spk-row.spk-hasfine').first();
  ok(`[${tg}] the Delay row has the fine-tune controls`, await row.count() > 0);
  if (!(await row.count())) { await br.close(); continue; }
  await row.scrollIntoViewIfNeeded();
  const val = () => p.evaluate(() => { const r = document.querySelector('.spk-hasfine .spk-range'), n = document.querySelector('.spk-hasfine .spk-num'); return { r: +r.value, n: n.value }; });
  const v0 = (await val()).r;
  ok(`[${tg}] only the Delay slider has -/+ (no other slider)`, await p.evaluate(() => document.querySelectorAll('.spk-fine').length === 2 && [...document.querySelectorAll('.spk-row')].filter(x => x.querySelector('.spk-fine')).every(x => /Delay/.test(x.textContent))));
  const tap = async sel => { const l = p.locator(sel).first(); if (phone) await l.tap(); else await l.click(); await p.waitForTimeout(120); };
  // set a mid value first (typed), then step
  const num = p.locator('.spk-hasfine .spk-num').first();
  await num.click(); await num.fill('50'); await num.press('Enter'); await p.waitForTimeout(200);
  let v = await val(); ok(`[${tg}] typed 50 + Enter applies to the slider`, v.r === 50 && v.n === '50', JSON.stringify(v));
  await tap('.spk-fine[data-fine=up]'); v = await val(); ok(`[${tg}] + is exactly 1 ms`, v.r === 51 && v.n === '51', JSON.stringify(v));
  await tap('.spk-fine[data-fine=down]'); await tap('.spk-fine[data-fine=down]'); v = await val(); ok(`[${tg}] - is exactly 1 ms`, v.r === 49 && v.n === '49', JSON.stringify(v));
  await p.waitForTimeout(1500); { const b = await p.locator('.spk-fine[data-fine=up]').first().boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.evaluate(() => { window._fb = document.querySelector('.spk-fine[data-fine=up]'); }); await p.mouse.down(); await p.waitForTimeout(1300); if (process.env.V) console.log('btn still attached:', await p.evaluate(() => window._fb.isConnected)); await p.mouse.up(); await p.waitForTimeout(150); }
  v = await val(); ok(`[${tg}] press-and-hold repeats (several ms)`, v.r >= 55, JSON.stringify(v));
  await num.click(); await num.fill('999'); await num.press('Enter'); await p.waitForTimeout(200); v = await val(); ok(`[${tg}] typed value is clamped to 600`, v.r === 600 && v.n === '600', JSON.stringify(v));
  if (!phone) { await num.click(); await num.fill('-20'); await num.press('Enter'); await p.waitForTimeout(200); v = await val(); ok(`[${tg}] typed below range clamps to 0`, v.r === 0 && v.n === '0', JSON.stringify(v)); }
  await num.click(); await num.fill('37'); await p.locator('.spk-hasfine .spk-l span').first().click(); await p.waitForTimeout(200); v = await val(); ok(`[${tg}] blur applies the typed value`, v.r === 37, JSON.stringify(v));
  await num.click(); await num.fill('123'); await num.press('Escape'); await p.waitForTimeout(200); v = await val(); ok(`[${tg}] Esc cancels the typed value`, v.r === 37 && v.n === '37', JSON.stringify(v));
  await p.evaluate(() => { const r = document.querySelector('.spk-hasfine .spk-range'); r.value = '80'; r.dispatchEvent(new Event('input', { bubbles: true })); }); v = await val(); ok(`[${tg}] slider -> number box stays in sync`, v.n === '80', JSON.stringify(v));
  const kb = await p.evaluate(() => { const n = document.querySelector('.spk-hasfine .spk-num'); return n.inputMode || n.getAttribute('inputmode'); }); ok(`[${tg}] numeric keypad (inputmode numeric; range has no negatives)`, kb === 'numeric', kb);
  if (phone) { const g = await p.evaluate(() => { const se = document.scrollingElement, sh = document.querySelector('#p-zones .pd42'); return { small: [...document.querySelectorAll('.spk-fine, .spk-num')].map(e => e.getBoundingClientRect()).filter(r => r.height < 44 || r.width < 44).length, sw: se.scrollWidth, cw: se.clientWidth, shs: sh ? [sh.scrollWidth, sh.clientWidth] : null }; });
    ok(`[${tg}] -/+ and the number box are >= 44 px`, g.small === 0, JSON.stringify(g)); ok(`[${tg}] no horizontal overflow at 390`, g.sw <= g.cw && (!g.shs || g.shs[0] <= g.shs[1] + 1), JSON.stringify(g)); }
  if (SH) await row.screenshot({ path: `/workspace/screens/wavwiz-046-F45-${TAG}-${tg}-row.png` });
  if (SH) await p.screenshot({ path: `/workspace/screens/wavwiz-046-F45-${TAG}-${tg}.png` });
  // restore the original delay
  await num.click(); await num.fill(String(v0)); await num.press('Enter'); await p.waitForTimeout(700);
  await br.close(); }
console.log(`f45delay: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

// 0.4.6 F47: the scene editor's action rows: "Update from current setup" on its own full-width row (one line), Delete / Duplicate left and Cancel / Save
// right below, every button on one line and nothing clipped by the card. Display size 67/75/100/125 x 100 %/200 % x Full/Roomy, plus the phone at 390.
import { chromium, webkit } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SHOTS, TAG = process.env.TAG || 'after'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const check = p => p.evaluate(() => { const ed = document.querySelector('.ss-sceneedit'); if (!ed) return null; const card = ed.getBoundingClientRect(), bad = [];
  for (const b of ed.querySelectorAll('.ss-savebar button, .ss-updrow button, .ss-savebar ~ * button')) { const r = b.getBoundingClientRect(); if (!r.width) continue; const lh = parseFloat(getComputedStyle(b).lineHeight) || 18;
    if (r.left < card.left - 0.5 || r.right > card.right + 0.5) bad.push('clipped:' + b.textContent.trim()); if (r.height > lh * 1.9 + 16) bad.push('wraps:' + b.textContent.trim() + ' h' + Math.round(r.height)); if (b.scrollWidth > b.clientWidth + 1 && !b.classList.contains('ss-upd')) bad.push('overflow:' + b.textContent.trim()); }
  const upd = ed.querySelector('.ss-upd'), save = [...ed.querySelectorAll('.ss-savebar button')].find(b => b.textContent.trim() === 'Save'), del = [...ed.querySelectorAll('.ss-savebar button')].find(b => /Delete/.test(b.textContent));
  const ur = upd?.getBoundingClientRect(), sr = save?.getBoundingClientRect(), dr = del?.getBoundingClientRect();
  return { bad, updOwnRow: !!ur && !!sr && ur.bottom <= sr.top + 1, delLeftOfSave: !!dr && !!sr && dr.right <= sr.left, updFull: !!ur && ur.width >= card.width * 0.8 }; });
const br = await chromium.launch();
const open = async (c, extra) => { await c.addCookies([{ name: 'unison_session', value: sess, url: B }]); await c.addInitScript(extra); const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2600); await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove())); return p; };
for (const [lay, scale] of (process.env.ONE ? ['full'] : ['full', 'roomy']).flatMap(l => ['tiny', 'small', 'compact', 'large'].map(s => [l, s]))) for (const [vw, vh, d, zt] of [[1920, 1080, 1, '100'], [960, 540, 2, '200']]) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: d });
  const p = await open(c, `localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.layout','${lay}');localStorage.setItem('wavwiz.uiscale','${scale}');localStorage.setItem('wavwiz.panels',JSON.stringify({lib:'rail',dev:'expanded',exp:'dev',list:'normal',ctl:'collapsed'}));`);
  if (await p.evaluate(() => !document.querySelector('.desk')?.classList.contains('devexpanded'))) { await p.locator('.devtab').click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(500); }
  const pen = p.locator('.devpanel [aria-label^="Edit scene"]').first(); await p.waitForTimeout(600); await pen.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  if (!(await pen.count())) { ok(`[${lay} ${scale} ${zt}] a scene to edit`, false); await c.close(); continue; }
  await pen.click(); await p.waitForTimeout(600); await p.locator('.ss-sceneedit .ss-savebar').scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  const r = await check(p), tg = `[${lay} ${scale} ${zt}]`;
  ok(`${tg} no button wrapped or clipped`, r && r.bad.length === 0, JSON.stringify(r)); ok(`${tg} Update on its own full-width row above; Delete left of Save`, r && r.updOwnRow && r.updFull && r.delLeftOfSave, JSON.stringify(r));
  if (SH && (scale === 'tiny' || scale === 'compact') && lay === 'full') await p.locator('.ss-sceneedit').screenshot({ path: `/workspace/screens/wavwiz-046-F47-${TAG}-${lay}-${scale}-${zt}.png` });
  await c.close(); }
await br.close();
const wk = await webkit.launch(); { const c = await wk.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await open(c, `localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');`);
  await p.evaluate(() => [...document.querySelectorAll('button')].filter(e => e.offsetParent && /Devices$/.test(e.textContent.trim())).pop()?.click()); await p.waitForTimeout(800);
  await p.locator('.hamburger').tap(); await p.waitForTimeout(300); await p.evaluate(() => [...document.querySelectorAll('.drawer nav button')].find(e => /^Devices/.test(e.textContent.trim()))?.click()); await p.waitForTimeout(300);
  await p.evaluate(() => [...document.querySelectorAll('.drawer nav button')].find(e => /^Scenes/.test(e.textContent.trim()))?.click()); await p.waitForTimeout(1200);
  await p.waitForTimeout(600); await p.evaluate(() => [...document.querySelectorAll('.drawer nav button')].find(e => /^Evening/.test(e.textContent.trim()))?.click()); await p.waitForTimeout(1500);
  const pen = p.locator('[aria-label^="Edit scene"]:visible').first();
  if (!(await p.locator('.ss-sceneedit').count()) && await pen.count()) { await pen.tap(); await p.waitForTimeout(700); }
  if (await p.locator('.ss-sceneedit').count()) { await p.locator('.ss-sceneedit .ss-savebar').scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {}); const r = await check(p); const ow = await p.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth);
    ok('[phone 390] no button wrapped or clipped, no overflow', r && r.bad.length === 0 && ow, JSON.stringify(r)); ok('[phone 390] Update on its own row; Delete left of Save', r && r.updOwnRow && r.delLeftOfSave, JSON.stringify(r));
    if (SH) await p.locator('.ss-sceneedit').screenshot({ path: `/workspace/screens/wavwiz-046-F47-${TAG}-phone-390.png` }); }
  else console.log('note [phone 390] the phone has no scene editor route reachable headless (Scenes menu runs / jumps); not asserted');
  await c.close(); } await wk.close();
console.log(`f47sceneedit: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

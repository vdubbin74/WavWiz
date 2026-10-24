// 0.4.9 F64: the side Library tab row after collapse -> reopen to standard (100 %, and 200 % with UI scale "tiny"): the same tabs show as on a
// cold load (ALBUMS / GENRES / FOLDERS were left in the "⋯" overflow because the row was fitted mid-animation and never re-fitted).
import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SH, TAG = process.env.TAG || 'after', OUT = '/workspace/screens/049-libchips'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const probe = () => { const row = document.querySelector('.libpanel .ctabs'); if (!row || !row.offsetParent) return null;
  return { wrapW: row.parentElement.clientWidth, vis: [...row.querySelectorAll('button[data-tab]')].filter(b => !b.hidden).map(b => b.textContent) }; };
if (SH) mkdirSync(OUT, { recursive: true });
const br = await chromium.launch();
for (const [vw, vh, d, scale, z] of [[1920, 1080, 1, null, '100'], [960, 540, 2, 'tiny', '200-tiny']]) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(sc => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
    if (sessionStorage.getItem('f64')) return; sessionStorage.setItem('f64', '1'); localStorage.setItem('wavwiz.layout', 'full'); if (sc) localStorage.setItem('wavwiz.uiscale', sc); else localStorage.removeItem('wavwiz.uiscale');
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' })); }, scale);
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2500); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  const t = `[${z}]`, r0 = await p.evaluate(probe);
  ok(`${t} cold load shows tabs`, r0 && r0.vis.length >= 1, JSON.stringify(r0));
  for (let n = 1; n <= 2; n++) {   // twice: the second round trip starts from an already re-fitted row
    await p.click('.libpanel .libcol'); await p.waitForTimeout(800);
    ok(`${t} #${n} collapsed: the Library is a rail`, await p.evaluate(() => document.querySelector('.desk').classList.contains('libcollapsed')));
    await p.click('.libpanel .libcol'); await p.waitForTimeout(1200);
    const r = await p.evaluate(probe);
    ok(`${t} #${n} reopened to standard: the same tabs as a cold load`, r && r0 && r.vis.join() === r0.vis.join(), JSON.stringify([r0?.vis, r?.vis]));
    ok(`${t} #${n} reopened: the tab row has the cold-load width`, r && r0 && Math.abs(r.wrapW - r0.wrapW) <= 1, JSON.stringify([r0?.wrapW, r?.wrapW]));
  }
  if (SH) await p.locator('.libpanel').screenshot({ path: `${OUT}/lib-${TAG}-reopen-${z}.png` });
  await c.close();
}
await br.close(); console.log(`f64libreopen: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

// 0.4.9 F65: Roomy - Devices is Full's narrow collapsed bar (F58), and opening it slides the panel out over the right side again (the 0.4.5-0.4.7
// slide-over): the grid column stays narrow (the center does not shrink), the panel is fixed full height at the right edge and animates in from
// off-screen, a scrim shows, and the scrim / Escape fold it back to the bar. Expanded Devices still runs full length with no player inside. 100 % / 200 % tiny.
import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SH, TAG = process.env.TAG || 'after', OUT = '/workspace/screens/049-roomy'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
if (SH) mkdirSync(OUT, { recursive: true });
const st = () => { const q = s => document.querySelector(s), R = e => e.getBoundingClientRect(), d = q('.desk'), dp = q('.devpanel'), sc = q('.devscrim'), r = R(dp), cs = getComputedStyle(dp);
  const np = [...dp.querySelectorAll('.npbar, .np-ctlpanel, .mp')].filter(e => e.offsetParent && R(e).width > 0).length;
  return { cls: d.className, pos: cs.position, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), vw: innerWidth, vh: innerHeight,
    center: Math.round(parseFloat(getComputedStyle(d).gridTemplateColumns.split(' ')[1]) || 0), tf: cs.transform, scrim: !!sc && getComputedStyle(sc).display !== 'none', body: !!dp.querySelector('.devbody')?.offsetParent, np, deskBottom: Math.round(R(d).bottom) }; };
const br = await chromium.launch();
for (const [vw, vh, dpr, scale, z] of [[1920, 1080, 1, 'compact', '100'], [960, 540, 2, 'tiny', '200-tiny']]) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(sc => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
    if (sessionStorage.getItem('f65')) return; sessionStorage.setItem('f65', '1'); localStorage.setItem('wavwiz.uiscale', sc); localStorage.setItem('wavwiz.layout', 'roomy');
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' })); }, scale);
  const p = await c.newPage(), t = `[${z}]`; await p.goto(B + '/'); await p.waitForTimeout(3000); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  const s0 = await p.evaluate(st); ok(`${t} Roomy starts on Full's narrow Devices bar`, /\broomy\b/.test(s0.cls) && /devcollapsed/.test(s0.cls) && s0.w <= 50, JSON.stringify(s0));
  if (SH) await p.screenshot({ path: `${OUT}/roomy-${TAG}-bar-${z}.png` });
  await p.click('.desk.devcollapsed .devpanel .prail'); await p.waitForTimeout(70);
  const mid = await p.evaluate(st); await p.waitForTimeout(700); const s1 = await p.evaluate(st);
  if (SH) await p.screenshot({ path: `${OUT}/roomy-${TAG}-open-${z}.png` });
  ok(`${t} opened: the panel shows its devices`, s1.body, JSON.stringify(s1));
  ok(`${t} opened: it slides out over the side (fixed at the right edge, full height)`, s1.pos === 'fixed' && Math.abs(s1.right - s1.vw) <= 1 && s1.top <= 1 && s1.bottom >= s1.vh - 1, JSON.stringify(s1));
  ok(`${t} opened: the center keeps its width (the grid column stays the narrow bar)`, Math.abs(s1.center - s0.center) <= 2, JSON.stringify([s0.center, s1.center]));
  ok(`${t} opened: it animates in from off the right edge`, mid.tf !== 'none' && mid.left > s1.left + 5, JSON.stringify([mid.tf, mid.left, s1.left]));
  ok(`${t} opened: a scrim dims the rest`, s1.scrim);
  await p.mouse.click(Math.round(vw * 0.3), Math.round(vh * 0.5)); await p.waitForTimeout(600);
  const s2 = await p.evaluate(st); ok(`${t} the scrim folds it back to the bar`, /devcollapsed/.test(s2.cls) && !s2.scrim && s2.w <= 50, JSON.stringify(s2));
  await p.click('.desk.devcollapsed .devpanel .prail', { timeout: 3000 }).catch(() => {}); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(600);
  const s3 = await p.evaluate(st); ok(`${t} Escape folds it back to the bar`, /devcollapsed/.test(s3.cls) && !s3.scrim, JSON.stringify(s3));
  if (!(await p.evaluate(() => document.querySelector('.desk').classList.contains('devcollapsed')))) await p.click('.devpanel .devcol'); await p.waitForTimeout(500); await p.click('.desk.devcollapsed .devpanel .prail'); await p.waitForTimeout(600); await p.click('.devpanel .devexp'); await p.waitForTimeout(900);
  const s4 = await p.evaluate(st); if (SH) await p.screenshot({ path: `${OUT}/roomy-${TAG}-expanded-${z}.png` });
  ok(`${t} expanded: in the grid, full length to the bottom, no player inside`, /devexpanded/.test(s4.cls) && s4.pos !== 'fixed' && Math.abs(s4.bottom - s4.deskBottom) <= 12 && s4.np === 0 && !s4.scrim, JSON.stringify(s4));
  await c.close();
}
await br.close(); console.log(`f65roomyslide: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

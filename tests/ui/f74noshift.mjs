// 0.4.9 F74 (generalizes F72): no expand / collapse / slide animation may make the page grow a scrollbar for a few frames (Devices
// jumped ~10 px left and back = right-edge flash). Real scrollbars on, 100 % and 200 % tiny; per rAF: viewport width (html clientWidth)
// and, where Devices itself is not the thing moving, Devices left / width - all within 0.5 px.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(); let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
// [layout, ctl start, steps: [name, selector, devStill]]
const RUNS = [
  ['full', 'collapsed', [['Now Playing expand', '.np-ctlcol', 1], ['Now Playing collapse', '.np-ctlcol', 1],
    ['queue expand', '.listpanel .listup', 1], ['queue collapse back', '.listpanel .listcol', 1], ['queue collapse', '.listpanel .listcol', 1], ['queue open again', '.listpanel .listup', 1],
    ['Library fold', '.libpanel .libcol', 0], ['Library reopen', '.libpanel .libcol', 0], ['Library expand (mini player)', '.libpanel .libexp', 0], ['Library back', '.libpanel .libexp', 0],
    ['Devices expand', '.devpanel .devexp', 0], ['Devices back', '.devpanel .devexp', 0]]],
  ['full', 'open', [['Now Playing collapse', '.np-ctlcol', 1], ['Now Playing expand', '.np-ctlcol', 1]]],
  ['roomy', 'open', [['Now Playing collapse', '.np-ctlcol', 1], ['Now Playing expand', '.np-ctlcol', 1], ['Roomy Devices slide', '.desk.devcollapsed .devpanel .prail', 0], ['Roomy Devices slide back', 'key:Escape', 0]]]];
const br = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
for (const [vw, vh, dpr, sc, z] of [[1920, 1080, 1, 'compact', '100'], [960, 540, 2, 'tiny', '200-tiny']]) for (const [lay, ctl, steps] of RUNS) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([sc, lay, ctl]) => { if (sessionStorage.getItem('f74')) return; sessionStorage.setItem('f74', '1'); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1');
    localStorage.setItem('wavwiz.webRoom.autojoin', '0'); localStorage.setItem('wavwiz.layout', lay); localStorage.setItem('wavwiz.uiscale', sc);
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl, ctlSet: true })); }, [sc, lay, ctl]);
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2800); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  for (const [what, sel, still] of steps) { const tg = `[${lay} ${z}] ${what}`;
    const key = sel.startsWith('key:') ? sel.slice(4) : null; let b = null;
    if (!key) { b = await p.locator(sel + ':visible').first().boundingBox().catch(() => null); ok(`${tg}: button visible`, !!b); if (!b) continue; }
    const before = await p.evaluate(() => document.querySelector('.desk')?.className + '|' + document.querySelector('#p-now')?.className);
    await p.evaluate(() => { const dev = document.querySelector('.devpanel'), H = document.documentElement; const g = () => { const r = dev.getBoundingClientRect(); return [Math.min(H.clientWidth, document.body.clientWidth), r.left, r.width]; };
      window.__r0 = g(); window.__s = []; let n = 0; const f = () => { window.__s.push(g()); if (++n < 60) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    if (key) { await p.mouse.move(vw / 2, 5); await p.keyboard.press(key); } else await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await p.waitForTimeout(1300);
    const { r0, s, after } = await p.evaluate(() => ({ r0: window.__r0, s: window.__s, after: document.querySelector('.desk')?.className + '|' + document.querySelector('#p-now')?.className }));
    ok(`${tg}: state changed`, before !== after, after);
    const d = i => Math.max(...s.map(x => Math.abs(x[i] - r0[i])));
    ok(`${tg}: no page scrollbar on any of ${s.length} frames (viewport/body ±${d(0).toFixed(2)} px)`, s.length > 20 && d(0) <= 0.5, JSON.stringify(s.filter(x => Math.abs(x[0] - r0[0]) > 0.5).slice(0, 3)));
    if (still) { ok(`${tg}: Devices left steady (max ${d(1).toFixed(2)} px)`, d(1) <= 0.5); ok(`${tg}: Devices width steady (max ${d(2).toFixed(2)} px)`, d(2) <= 0.5); }
  }
  await c.close(); }
await br.close(); console.log(`f74noshift: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

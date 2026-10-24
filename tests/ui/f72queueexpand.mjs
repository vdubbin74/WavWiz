// 0.4.9 F72: desktop Full mode, "Expand the queue" / "Collapse the queue" must not move Devices. The Queue slide used to push the panel past the
// bottom of the desk for a few frames, the page grew a scrollbar and Devices jumped left (right-edge flash). Samples Devices with
// getBoundingClientRect on every animation frame (real scrollbars on), at 100 % and 200 % tiny: left and width within 0.5 px, no drop-target outline.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(); let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const br = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
for (const [vw, vh, dpr, sc, z] of [[1920, 1080, 1, 'compact', '100'], [960, 540, 2, 'tiny', '200-tiny']]) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(sc => { if (sessionStorage.getItem('f72')) return; sessionStorage.setItem('f72', '1'); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1');
    localStorage.setItem('wavwiz.webRoom.autojoin', '0'); localStorage.setItem('wavwiz.layout', 'full'); localStorage.setItem('wavwiz.uiscale', sc);
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'open', ctlSet: true })); }, sc);
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2800); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  const tg = `[full ${z}]`;
  for (const [sel, want, what] of [['.listup', 'listexpanded', 'expand'], ['.listcol', '', 'collapse back'], ['.listcol', 'listcollapsed', 'collapse'], ['.listup', '', 'open again']]) {
    await p.evaluate(() => { const dev = document.querySelector('.devpanel'); const r0 = dev.getBoundingClientRect(); window.__r0 = [r0.left, r0.width]; window.__s = []; let n = 0;
      const f = () => { const r = dev.getBoundingClientRect();
        const hl = [...dev.querySelectorAll('.drop42, .dragover, .over42, .dropok, [class*="drop"]')].filter(e => e.offsetParent && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().height > 0).map(e => e.className);
        const o = getComputedStyle(dev); window.__s.push([r.left, r.width, hl.join(';') + (o.outlineStyle !== 'none' && parseFloat(o.outlineWidth) > 0 ? ' outline' : '')]); if (++n < 50) requestAnimationFrame(f); };
      requestAnimationFrame(f); });
    const b = await p.locator('.listpanel ' + sel + ':visible').first().boundingBox(); ok(`${tg} ${what}: button visible`, !!b); if (!b) continue;
    await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await p.waitForTimeout(1200);
    const { r0, s, cls } = await p.evaluate(() => ({ r0: window.__r0, s: window.__s, cls: document.querySelector('.desk').className }));
    if (want) ok(`${tg} ${what}: the queue changed state`, cls.includes(want), cls); else ok(`${tg} ${what}: the queue is back to open`, !/listexpanded|listcollapsed/.test(cls), cls);
    const dl = Math.max(...s.map(x => Math.abs(x[0] - r0[0]))), dw = Math.max(...s.map(x => Math.abs(x[1] - r0[1])));
    ok(`${tg} ${what}: Devices left steady on all ${s.length} frames (max ${dl.toFixed(2)} px)`, s.length > 20 && dl <= 0.5, JSON.stringify(s.filter(x => Math.abs(x[0] - r0[0]) > 0.5).slice(0, 3)));
    ok(`${tg} ${what}: Devices width steady (max ${dw.toFixed(2)} px)`, dw <= 0.5);
    const hl = s.filter(x => x[2]); ok(`${tg} ${what}: no drop-target outline on any frame`, !hl.length, JSON.stringify(hl.slice(0, 2)));
  }
  await c.close(); }
await br.close(); console.log(`f72queueexpand: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

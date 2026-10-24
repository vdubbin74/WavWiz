// 0.4.6 F36 / F37: Full and Roomy. The full-screen Queue keeps the classic full-width player bar under the Queue; only the expanded Library (Full)
// shrinks Now Playing to the column mini player, and never inside the collapsed strip. F37: the small corner 'Now playing' box (hover pop-up) is gone -
// nothing at the strip's bottom corner, no gap / stray border, hovering there opens nothing. 100 % / 200 %. TAG=before|after, SHOTS=1.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SHOTS, TAG = process.env.TAG || 'after'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const base = { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' };
const br = await chromium.launch();
for (const [vw, vh, d, zt] of [[1920, 1080, 1, '100'], [960, 540, 2, '200']]) for (const lay of ['full', 'roomy']) for (const [sn, pn] of [['queuefull', { ...base, list: 'expanded' }], ['queuefull-devrail', { ...base, list: 'expanded', dev: 'rail' }], ['libexpanded', { ...base, exp: 'lib' }]]) {
  if (lay === 'roomy' && sn === 'queuefull-devrail') continue;
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([pn, lay]) => { if (sessionStorage.getItem('f36')) return; sessionStorage.setItem('f36', '1'); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
    localStorage.setItem('wavwiz.uiscale', 'compact'); localStorage.setItem('wavwiz.layout', lay); localStorage.setItem('wavwiz.panels', JSON.stringify(pn)); }, [pn, lay]);
  const p = await c.newPage(), t = `[${zt} ${lay} ${sn}]`; await p.goto(B + '/'); await p.waitForTimeout(3000); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  const r = await p.evaluate(() => { const q = s => document.querySelector(s), R = e => e?.getBoundingClientRect(), vis = e => !!e && !!e.offsetParent && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' && R(e).width > 0;
    const bar = [q('.npbar'), q('.np-ctlpanel')].find(vis) || q('.npbar'), lst = q('.listpanel'), mini = q('.minicol'), tab = q('.desk.tight .devtab') || q('.desk .devpanel'), desk = q('.desk');
    return { cls: desk.className, bar: vis(bar) ? [R(bar).left, R(bar).right, R(bar).top, R(bar).bottom].map(Math.round) : null, list: vis(lst) ? [R(lst).left, R(lst).right, R(lst).top, R(lst).bottom].map(Math.round) : null,
      mini: vis(mini) ? [R(mini).left, R(mini).right, R(mini).top, R(mini).bottom, R(mini).width, R(mini).height].map(Math.round) : null, tab: vis(tab) ? [R(tab).left, R(tab).right, R(tab).top, R(tab).bottom].map(Math.round) : null,
      deskB: Math.round(R(desk).bottom), vw: innerWidth, z: R(document.documentElement).width / document.documentElement.offsetWidth }; });
  console.log(`     ${t} ${JSON.stringify(r)}`);
  if (sn.startsWith('queuefull')) {
    ok(`${t} F36 the classic player bar sits under the full-screen Queue`, r.bar && r.list && r.bar[2] >= r.list[3] - 1 && r.bar[0] <= r.list[0] + 1 && r.bar[1] >= r.list[1] - 1, JSON.stringify(r));
    ok(`${t} F36/F37 no mini player / corner box in the full-screen Queue`, !r.mini, JSON.stringify(r.mini));
  } else if (lay === 'full') ok(`${t} F36 the expanded Library may shrink Now Playing to the column mini player (not a 36 px corner box)`, r.mini && r.mini[4] > 200, JSON.stringify(r));
  if (sn === 'libexpanded' && r.tab) ok(`${t} F36 the mini is never inside the collapsed strip`, !r.mini || r.mini[1] <= r.tab[0] + 1, JSON.stringify(r));
  if (sn === 'libexpanded') {   // the condensed player's cover: the real art when it loads, else the themed placeholder - never a broken image
    await p.waitForTimeout(1500);
    const a = await p.evaluate(() => { const i = document.querySelector('.minicol .mp-art'); if (!i) return null; const cs = getComputedStyle(i);
      return { src: i.getAttribute('src'), nw: i.naturalWidth, complete: i.complete, noart: i.classList.contains('noart'), bg: cs.backgroundImage.slice(0, 30), title: document.querySelector('.minicol .mp-t, .minicol .mp-title')?.textContent }; });
    ok(`${t} cover: loaded art or the themed placeholder, never a broken image`, a && ((a.src && a.nw > 0 && !a.noart) || (a.noart && !a.src && /url/.test(a.bg))), JSON.stringify(a));
    if (SH) await p.locator('.minicol').screenshot({ path: `/workspace/screens/wavwiz-046-F37art-${TAG}-${lay}-${zt}.png` }).catch(() => {});
  }
  // F37: no gap / stray border at the strip's bottom corner; hovering there opens nothing
  if (r.tab) { const x = r.tab[0] + (r.tab[1] - r.tab[0]) / 2, y = Math.min(r.tab[3], r.deskB) - 12; await p.mouse.move(x, y); await p.waitForTimeout(500);
    const pop = await p.evaluate(() => [...document.querySelectorAll('.minicol .mp')].some(e => getComputedStyle(e).visibility === 'visible' && +getComputedStyle(e).opacity > 0.1 && e.getBoundingClientRect().width > 0 && !!e.offsetParent));
    ok(`${t} F37 hovering the strip's bottom corner opens no pop-up`, !pop || sn === 'libexpanded');
    const gap = await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.closest('.minicol') ? 'minicol' : 'ok') : 'none'; }, [x, y]);
    ok(`${t} F37 no corner box left (no stray border / empty box)`, gap !== 'minicol', gap); }
  if (SH) await p.screenshot({ path: `/workspace/screens/wavwiz-046-F36-${TAG}-${lay}-${sn}-${zt}.png` });
  await c.close();
}
await br.close(); console.log(`f36player: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

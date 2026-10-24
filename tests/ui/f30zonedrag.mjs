// 0.4.6 F30: zones drag like speakers (F26) - pdrag pointer engine: grab cursor, ghost pinned at the grab point, other zone boxes lit in the accent,
// drop reorders the zone boxes (saved on this device in wavwiz.devorder.v1 .g, like the 0.3.8 card order), Esc cancels, a plain click / tap still
// opens / controls the zone. 100 % + 200 %, standard + expanded Devices. TAG=before|after, SHOTS=1 for screenshots.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SHOTS, TAG = process.env.TAG || 'after'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const shot = (p, n) => SH && p.screenshot({ path: `/workspace/screens/wavwiz-046-F30-${TAG}-${n}.png` });
const views = { standard: { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' }, expanded: { lib: 'rail', dev: 'expanded', exp: 'dev', list: 'normal', ctl: 'normal' } };
const br = await chromium.launch();
for (const [vw, vh, d, zt] of [[1920, 1080, 1, '100'], [960, 540, 2, '200']]) for (const [vn, pn] of Object.entries(views)) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(pn => { if (sessionStorage.getItem('f30init')) return; sessionStorage.setItem('f30init', '1');
    localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
    localStorage.setItem('wavwiz.uiscale', 'compact'); localStorage.removeItem('wavwiz.devorder.v1'); localStorage.setItem('wavwiz.panels', JSON.stringify(pn)); }, pn);
  const p = await c.newPage(), t = `[${zt} ${vn}]`, tag = `${vn}-${zt}`;
  const load = async () => { await p.goto(B + '/'); await p.waitForTimeout(3000); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
    if (await p.evaluate(() => document.querySelector('.desk')?.classList.contains('tight'))) { await p.locator('.devtab').click(); await p.waitForTimeout(500); } };
  await load();
  const order = () => p.evaluate(() => [...document.querySelectorAll('.devpanel .tree42 .qb42')].map(b => b.dataset.leaderId).join(','));
  const names = () => p.evaluate(() => [...document.querySelectorAll('.devpanel .tree42 .qb42 .zcard42 .zname')].map(b => b.textContent).join(','));
  const o0 = await order(); ok(`${t} the tree shows 2+ zone boxes (${await names()})`, o0.split(',').length >= 2, o0);
  // hover: what the zone name / card / box title look like (the reported "link" cursor)
  const nm = p.locator('.devpanel .tree42 .qb42 .zcard42 .zname').first(); await nm.scrollIntoViewIfNeeded(); const nb = await nm.boundingBox();
  await p.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2); await p.waitForTimeout(250);
  const cur = await p.evaluate(() => { const q = s => document.querySelector('.devpanel .tree42 ' + s), cs = s => q(s) ? getComputedStyle(q(s)).cursor : '-';
    return { name: cs('.zcard42 .zname'), card: cs('.zcard42 .zc42-body'), title: cs('.qb42-pick'), underline: getComputedStyle(q('.qb42-pick .qb42-name')).textDecorationLine }; });
  console.log(`     ${t} cursors ${JSON.stringify(cur)}`);
  ok(`${t} zone name / card show the grab cursor`, cur.name === 'grab' && cur.card === 'grab', JSON.stringify(cur));
  await shot(p, `hover-${tag}`);
  const tb = p.locator('.devpanel .tree42 .qb42-pick').first(), tbb = await tb.boundingBox(); await p.mouse.move(tbb.x + 30, tbb.y + tbb.height / 2); await p.waitForTimeout(250);
  const t2 = await p.evaluate(() => { const e = document.querySelector('.devpanel .tree42 .qb42-pick'); return { cursor: getComputedStyle(e).cursor, deco: getComputedStyle(e.querySelector('.qb42-name')).textDecorationLine }; });
  ok(`${t} box title: grab cursor, no link underline`, t2.cursor === 'grab' && t2.deco === 'none', JSON.stringify(t2));
  await shot(p, `hover-title-${tag}`);
  // mouse drag the first zone card below the last box
  const gx = nb.x + Math.min(20, nb.width / 2), gy = nb.y + nb.height / 2;
  const off = await p.evaluate(([x, y]) => { const r = document.elementFromPoint(x, y).closest('.zcard42,.qb42-head')?.getBoundingClientRect(); return r ? { ox: x - r.left, oy: y - r.top } : null; }, [gx, gy]);
  await p.mouse.move(gx, gy); await p.mouse.down(); await p.mouse.move(gx + 3, gy + 2); await p.waitForTimeout(80);
  ok(`${t} under 5 px is not a drag`, await p.evaluate(() => !document.querySelector('.dragghost')));
  let err = 0; for (const [dx, dy] of [[10, 12], [30, 40], [40, 80]]) { await p.mouse.move(gx + dx, gy + dy, { steps: 3 }); await p.waitForTimeout(60);
    const e = await p.evaluate(([x, y, o]) => { const g = document.querySelector('.dragghost'); if (!g || !o) return 999; const r = g.getBoundingClientRect(); return Math.hypot(x - r.left - o.ox, y - r.top - o.oy); }, [gx + dx, gy + dy, off]); err = Math.max(err, e); }
  ok(`${t} a zone drag starts with a ghost pinned at the grab point (err ${err.toFixed(1)} px)`, err <= 1.5, String(err));
  const last = await p.evaluate(() => { const bs = [...document.querySelectorAll('.devpanel .tree42 .qb42')], b = bs[bs.length - 1]; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.8 }; });
  await p.waitForTimeout(120); await p.mouse.move(last.x, last.y, { steps: 6 }); await p.waitForTimeout(150);
  const hl = await p.evaluate(() => { const d = document.querySelector('.devpanel .tree42 .qb42.dropping'), any = document.querySelector('.devpanel .tree42 .qb42.droppable'); const a = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return { dropping: !!d, droppable: !!any, outline: d ? getComputedStyle(d).outlineStyle + ' ' + getComputedStyle(d).outlineColor : '', grabbing: getComputedStyle(document.body).cursor, accent: a }; });
  ok(`${t} the box under the pointer is lit (accent outline) and others outlined`, hl.dropping && hl.droppable && /solid/.test(hl.outline), JSON.stringify(hl));
  ok(`${t} grabbing cursor while dragging`, hl.grabbing === 'grabbing', hl.grabbing);
  await shot(p, `middrag-${tag}`);
  await p.mouse.up(); await p.waitForTimeout(900);
  const o1 = await order(), saved = await p.evaluate(() => JSON.parse(localStorage.getItem('wavwiz.devorder.v1') || '{}').g || []);
  ok(`${t} the drop reorders the zones (first box is now last)`, o1.split(',').at(-1) === o0.split(',')[0] && o1 !== o0, `${o0} -> ${o1}`);
  ok(`${t} the order is saved (wavwiz.devorder.v1)`, saved.length >= 2, JSON.stringify(saved));
  await load(); ok(`${t} the order survives a reload`, await order() === o1, `${o1} vs ${await order()}`);
  await shot(p, `dropped-${tag}`);
  // drag by the box title onto the top half of the box above it: reorders, and the drop is not also a click (a title click makes that zone Controlling)
  { const ctl = () => p.evaluate(() => document.querySelector('.devpanel .tree42 .qb42-pick[aria-pressed="true"]')?.closest('.qb42')?.dataset.leaderId || '');
    const b4 = await order(), c4 = await ctl();
    await p.evaluate(() => { const bs = document.querySelectorAll('.devpanel .tree42 .qb42'); bs[bs.length - 1].querySelector('.qb42-pick').scrollIntoView({ block: 'end' }); });
    const tl = await p.locator('.devpanel .tree42 .qb42-pick').last().boundingBox(), prev = await p.locator('.devpanel .tree42 .qb42').nth(-2).boundingBox();
    const x = tl.x + 30, y = tl.y + tl.height / 2, ty = Math.max(prev.y + 10, 70);
    await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + 8, y - 10, { steps: 2 }); await p.mouse.move(x, ty, { steps: 8 }); await p.waitForTimeout(150); await p.mouse.up(); await p.waitForTimeout(800);
    const a = b4.split(','), want = [...a.slice(0, -2), a.at(-1), a.at(-2)].join(), o2 = await order();
    ok(`${t} title drag: the last box moved above the one before it`, o2 === want, `${b4} -> ${o2} (want ${want})`);
    ok(`${t} title drag: the drop did not also change the Controlling zone`, await ctl() === c4, `${c4} -> ${await ctl()}`); }
  // Esc cancels
  { const n2 = await p.locator('.devpanel .tree42 .qb42 .zcard42 .zname').first().boundingBox(), x = n2.x + 10, y = n2.y + n2.height / 2, b4 = await order();
    await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + 20, y + 60, { steps: 4 }); await p.waitForTimeout(80); await p.keyboard.press('Escape'); await p.waitForTimeout(120);
    ok(`${t} Esc cancels: ghost + highlights gone`, await p.evaluate(() => !document.querySelector('.dragghost,.tree42 .droppable,.tree42 .dropping')));
    await p.mouse.up(); await p.waitForTimeout(500); ok(`${t} Esc cancels: order unchanged`, await order() === b4); }
  // touch: a quick swipe scrolls (no drag), a 180 ms hold drags (synthetic pointer events; the engine listens on document)
  { const r = await p.evaluate(async () => { const n = document.querySelector('.devpanel .tree42 .qb42 .zcard42 .zc42-body'), b = n.getBoundingClientRect(), x = b.left + 40, y = b.top + 8;
      const ev = (tp, el, dx, dy) => el.dispatchEvent(new PointerEvent(tp, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x + dx, clientY: y + dy }));
      const w = ms => new Promise(r => setTimeout(r, ms)); ev('pointerdown', n, 0, 0); await w(30); ev('pointermove', document, 0, 30); await w(30); const swipe = !!document.querySelector('.dragghost'); ev('pointerup', document, 0, 30); await w(50);
      ev('pointerdown', n, 0, 0); await w(260); ev('pointermove', document, 2, 30); await w(30); const hold = !!document.querySelector('.dragghost'); ev('pointercancel', document, 2, 30); await w(50);
      return { swipe, hold, left: !!document.querySelector('.dragghost') }; });
    ok(`${t} touch: swipe is not a drag, a 180 ms hold is, cancel cleans up`, !r.swipe && r.hold && !r.left, JSON.stringify(r)); }
  // a plain click still does what it did: zone name opens the zone (picked), box title makes it the Controlling zone
  { await p.locator('.devpanel .tree42 .qb42 .zcard42 .zname').nth(1).click(); await p.waitForTimeout(500);
    const r = await p.evaluate(() => ({ picked: !!document.querySelector('.devpanel .tree42 .zwrap42.picked'), pane: !!document.querySelector('.zp42, [data-act="zone-rename"]'), order: [...document.querySelectorAll('.devpanel .tree42 .qb42')].length }));
    console.log(`     ${t} after name click ${JSON.stringify(r)}`); ok(`${t} click on a zone name still opens it`, r.picked || r.pane, JSON.stringify(r));
    await p.locator('.devpanel .tree42 .qb42-pick').nth(1).click(); await p.waitForTimeout(500);
    ok(`${t} click on a box title still makes it Controlling`, await p.evaluate(() => document.querySelectorAll('.devpanel .tree42 .qb42-pick')[1]?.getAttribute('aria-pressed') === 'true')); }
  await c.close();
}
await br.close(); console.log(`f30zonedrag: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

// 0.4.5 F26: Devices speaker drags on the pointer engine - the ghost stays pinned at the exact grab point (100 %, 200 %, Display size 125 %),
// valid zones outlined + the one under the pointer solid, invalid (own zone) dimmed, Esc cancels. TAG=before|after + SHOTS=1 for screenshots.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SHOTS, TAG = process.env.TAG || 'after', DEV = process.env.DEVSEL || '.devpanel'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const br = await chromium.launch();
for (const [vw, vh, d, scale, tag] of (process.env.OPENDEV ? [[1280, 820, 1, 'compact', '100'], [1280, 820, 2, 'compact', '200']] : [[1920, 1080, 1, 'compact', '100'], [960, 540, 2, 'compact', '200'], [1920, 1080, 1, 'large', 'size125']])) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(sc => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); localStorage.setItem('wavwiz.uiscale', sc);
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' })); }, scale);
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(3000); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  if (process.env.OPENDEV || await p.evaluate(() => document.querySelector('.desk').classList.contains('tight'))) { await p.locator('.devtab').click(); await p.waitForTimeout(500); }   // T1: Devices is behind the tab
  const t = `[${tag}${process.env.OPENDEV ? ' slide-over' : ''}]`, g = p.locator(`${DEV} .sp42 .dgrip42:not(.ro)`).first();
  if (!await g.count()) { ok(`${t} a speaker grip exists`, false); await c.close(); continue; }
  await g.scrollIntoViewIfNeeded(); const b = await g.boundingBox(), gx = b.x + b.width / 2, gy = b.y + b.height / 2;
  const row = await p.evaluate(([x, y]) => { const r = document.elementFromPoint(x, y).closest('.sp42').getBoundingClientRect(); return { ox: x - r.left, oy: y - r.top }; }, [gx, gy]);
  const grp = () => p.evaluate(async () => JSON.stringify((await (await fetch('/api/v1/groups')).json()).map?.(g => [g.id, g.deviceIds]) ?? null)); const before = await grp();
  await p.mouse.move(gx, gy); await p.mouse.down(); const path = [[30, 20], [60, 60], [90, 140], [120, 200]];
  let maxErr = 0; for (const [dx, dy] of path) { await p.mouse.move(gx + dx, gy + dy, { steps: 3 }); await p.waitForTimeout(60);
    const e = await p.evaluate(([x, y, ox, oy]) => { const gh = document.querySelector('.dragghost'); if (!gh) return null; const r = gh.getBoundingClientRect(); return Math.hypot(x - r.left - ox, y - r.top - oy); }, [gx + dx, gy + dy, row.ox, row.oy]);
    maxErr = Math.max(maxErr, e == null ? 999 : e); }
  ok(`${t} ghost pinned at the grab point (max error ${maxErr.toFixed(1)} px)`, maxErr <= 1.5, String(maxErr));
  const st = await p.evaluate(() => ({ ok: document.querySelectorAll('.tree42 .droppable').length, no: [...document.querySelectorAll('.tree42 .dropno')].map(e => getComputedStyle(e).opacity), outline: (() => { const e = document.querySelector('.tree42 .droppable'); return e ? getComputedStyle(e).outlineStyle : ''; })() }));
  ok(`${t} valid zones outlined in the accent`, st.ok > 0 && /dashed|solid/.test(st.outline), JSON.stringify(st)); ok(`${t} the speaker's own zone is dimmed`, st.no.length > 0 && st.no.every(o => +o < 0.6), JSON.stringify(st));
  const tb = await p.evaluate(() => { for (const e of document.querySelectorAll('.tree42 .droppable')) { const r = e.getBoundingClientRect(), y = r.top + Math.min(r.height / 2, 30); if (y > 4 && y < innerHeight - 4 && r.width) return { x: r.left + r.width / 2, y }; } return null; });
  if (tb) await p.mouse.move(tb.x, tb.y, { steps: 5 }); await p.waitForTimeout(150);
  ok(`${t} the zone under the pointer is the drop target`, !tb || await p.evaluate(() => !!document.querySelector('.tree42 .dropping')), 'no visible target');
  if (SH) await p.screenshot({ path: `/workspace/screens/wavwiz-045-F26-${TAG}-middrag-${tag}${process.env.OPENDEV ? '-slideover' : ''}.png` });
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  ok(`${t} Esc cancels: ghost gone, nothing highlighted`, await p.evaluate(() => !document.querySelector('.dragghost') && !document.querySelector('.tree42 .dropping,.tree42 .droppable,.tree42 .dropno')));
  await p.mouse.up(); await p.waitForTimeout(800);
  ok(`${t} Esc cancels: no move happened`, before === await grp());
  await c.close();
}
await br.close(); console.log(`f26devdrag: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

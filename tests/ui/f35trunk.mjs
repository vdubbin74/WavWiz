// 0.4.6 F35: the Devices tree trunk ends exactly at the last speaker's elbow (±1 px) in every zone, after repeated drags of speakers in and out of a
// zone, a refresh and at 100 % / 200 % (incl. a speaker row that wraps to two lines); no orphan drag nodes / classes left. TAG=before|after, SHOTS=1.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs'; import { execSync } from 'node:child_process';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SHOTS, TAG = process.env.TAG || 'after'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const geo = p => p.evaluate(() => [...document.querySelectorAll('.devpanel .tree42 .zsp42')].filter(z => z.querySelector(':scope>.sp42')).map(z => {
  z.scrollIntoView({ block: 'center' });   // rows use content-visibility: measure them on screen
  const rows = [...z.querySelectorAll(':scope>.sp42')], last = rows.at(-1), lr = last.getBoundingClientRect(), zr = z.getBoundingClientRect(), px = v => parseFloat(v) || 0;
  const elbow = lr.top + px(getComputedStyle(last).borderTopWidth) + (lr.height - px(getComputedStyle(last).borderTopWidth) - px(getComputedStyle(last).borderBottomWidth)) / 2;
  let bottom = -1; const zb = getComputedStyle(z, '::before'); if (zb.content !== 'none' && zb.borderLeftStyle !== 'none') bottom = Math.max(bottom, zr.bottom - px(zb.bottom));
  for (const r of rows) { const a = getComputedStyle(r, '::after'), rr = r.getBoundingClientRect(); if (a.content !== 'none' && a.borderLeftStyle !== 'none') bottom = Math.max(bottom, rr.bottom - px(getComputedStyle(r).borderBottomWidth) - px(a.bottom)); }
  return { zone: z.closest('.zwrap42')?.dataset.zone, n: rows.length, elbow: Math.round(elbow * 10) / 10, trunk: Math.round(bottom * 10) / 10, lastH: Math.round(lr.height) };
}));
const orphans = p => p.evaluate(() => ({ ghost: document.querySelectorAll('.dragghost').length, cls: document.querySelectorAll('.tree42 .dropping,.tree42 .droppable,.tree42 .dropno,.tree42 .drag42-src,.tree42.dragging').length,
  extra: [...document.querySelectorAll('.devpanel .tree42 .zsp42>*')].filter(e => !e.matches('.sp42,.drop42')).map(e => e.className) }));
const api = (p, path, body) => p.evaluate(async ([path, body]) => { const r = await fetch('/api/v1' + path, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return r.status; }, [path, body]);
const br = await chromium.launch();
for (const [vw, vh, d, zt] of [[1920, 1080, 1, '100'], [960, 540, 2, '200']]) {
  try { execSync('bash /workspace/seed042.sh', { env: { ...process.env, WWDIR: '/tmp/ww032' }, stdio: 'ignore' }); } catch { /* seeded by the runner */ }
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); localStorage.setItem('wavwiz.uiscale', 'compact'); localStorage.setItem('wavwiz.layout', 'full');
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' })); localStorage.removeItem('wavwiz.devorder.v1'); });
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(3000); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  await api(p, '/zones/5', { name: 'PCBOXV3D whole-home living room speaker' }); await p.waitForTimeout(1500);   // a row that wraps
  const check = async (label) => { const g = await geo(p), o = await orphans(p), bad = g.filter(z => Math.abs(z.trunk - z.elbow) > 1);
    ok(`[${zt}] ${label}: trunk ends at the last elbow in every zone`, g.length && !bad.length, JSON.stringify(bad.length ? bad : g)); ok(`[${zt}] ${label}: no orphan drag nodes / classes`, !o.ghost && !o.cls && !o.extra.length, JSON.stringify(o)); };
  await check('initial'); if (SH) await p.locator('.devpanel').screenshot({ path: `/workspace/screens/wavwiz-046-F35-${TAG}-${zt}.png` });
  const srcName = await p.evaluate(() => document.querySelector('.devpanel .tree42 .zsp42 .sp42')?.closest('.zwrap42')?.dataset.zone);
  ok(`[${zt}] the source zone starts with 2 speakers`, (await geo(p)).find(z => z.zone === srcName)?.n === 2);
  for (let i = 0; i < 4; i++) {   // drag a speaker from the first zone into the next one and back (pointer drag, like a user)
    const grip = p.locator('.devpanel .tree42 .zsp42 .sp42 .dgrip42:not(.ro)').first();
    await p.evaluate(() => document.querySelector('.devpanel .tree42 .zsp42 .sp42 .dgrip42:not(.ro)').scrollIntoView({ block: 'start' })); await p.waitForTimeout(100); const b2 = await grip.boundingBox();
    const tgt = await p.evaluate(() => { const ws = [...document.querySelectorAll('.devpanel .tree42 .zwrap42')], from = document.querySelector('.devpanel .tree42 .zsp42 .sp42').closest('.zwrap42'), w = ws[ws.indexOf(from) + 1] || ws.find(x => x !== from);
      const r = w.getBoundingClientRect(); return { x: r.left + r.width / 2, y: Math.min(r.top + 20, innerHeight - 10) }; });
    await p.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2); await p.mouse.down(); await p.mouse.move(b2.x + 20, b2.y + 20, { steps: 3 }); await p.mouse.move(tgt.x, tgt.y, { steps: 8 }); await p.waitForTimeout(100); await p.mouse.up(); await p.waitForTimeout(1500);
    await check(`after drag ${i + 1}`);
    if (i === 0) { const g = await geo(p), src = g.find(z => z.zone === srcName); ok(`[${zt}] exact: 2 speakers in ${srcName}, 1 dragged out -> the source trunk ends at the remaining speaker's elbow`, src && src.n === 1 && Math.abs(src.trunk - src.elbow) <= 1, JSON.stringify(src)); }
  }
  await p.reload(); await p.waitForTimeout(3000); await check('after a refresh');
  if (SH) await p.locator('.devpanel').screenshot({ path: `/workspace/screens/wavwiz-046-F35-${TAG}-afterdrags-${zt}.png` });
  await api(p, '/zones/5', { name: 'PCBOXV1' }); await c.close();
}
await br.close(); console.log(`f35trunk: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

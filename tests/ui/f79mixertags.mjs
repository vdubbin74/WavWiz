// 0.4.9 F79: Volume Mixer - one column of zone cards; status tags (REF / OFFLINE / BT / MUTED) on their own row under the speaker name, never over
// the slider; every track in a card still shares left edge, width and center (F66). Long names + 3 tags, 100 %, 200 % + tiny, phone. Mocked zones.
import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), OUT = '/workspace/screens/049-mixertags'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
mkdirSync(OUT, { recursive: true });
const NAMES = { 5: 'PCBOXV2', 1: 'PCBOXV3D', 2: "Vince's iPhone 15 Pro Max (Living Room)" };
const br = await chromium.launch();
for (const [z, vw, vh, dpr, u] of [['100', 1920, 1080, 1, 'compact'], ['200-tiny', 960, 540, 2, 'tiny'], ['phone', 390, 844, 3, 'compact']]) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, isMobile: z === 'phone', hasTouch: z === 'phone' }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(u => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); localStorage.setItem('wavwiz.uiscale', u); localStorage.setItem('wavwiz.layout', 'full'); }, u);
  await c.route(/\/api\/v1\/zones(\?|$)/, async r => { try { const res = await r.fetch(), j = await res.json();
    for (const x of j) { if (NAMES[x.id]) x.name = NAMES[x.id]; x.connected = x.id !== 1;
      if (x.id === 1) { x.isReference = true; x.outputs = [{ name: 'Bluetooth headset', kind: 'bluetooth', active: true }]; } if (x.id === 2) { x.isReference = true; x.muted = true; x.outputs = [{ name: 'BT speaker', kind: 'bluetooth', active: true }]; } }
    await r.fulfill({ response: res, json: j }); } catch { } });
  await c.route(/\/api\/v1\/groups(\?|$)/, async r => { try { const res = await r.fetch(), j = await res.json();
    j.unshift({ ...j[0], id: 990, name: 'Whole-Home', deviceIds: [5, 1, 2], members: 3 }); await r.fulfill({ response: res, json: j }); } catch { } });
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(B + '/'); await p.waitForTimeout(2500); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(e => e.close()));
  await p.evaluate(() => window.dispatchEvent(new CustomEvent('wavwiz:mixer'))); await p.waitForTimeout(1500);
  const R = await p.evaluate(() => { const d = document.querySelector('dialog.mixer-dlg'); if (!d) return null; const rc = e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width }; };
    const cards = [...d.querySelectorAll('.mv-card')].filter(e => e.offsetParent), lefts = new Set(cards.map(e => Math.round(e.getBoundingClientRect().left)));
    const wh = d.querySelector('.mv-card[data-group="990"]'), rows = [];
    for (const row of d.querySelectorAll('.mv-card .mv-row')) { if (!row.offsetParent) continue; const s = row.querySelector('input.mv-s'), n = row.querySelector('.n .ell');
      rows.push({ card: row.closest('.mv-card').dataset.group, name: n.textContent, trunc: n.scrollWidth > n.clientWidth + 1, tr: rc(s), name_r: rc(n), tags: [...row.querySelectorAll('.mv-tag')].map(t => ({ ...rc(t), x: t.textContent })), pct: rc(row.querySelector('.mv-pct')) }); }
    return { cols: lefts.size, cardW: cards.map(e => e.getBoundingClientRect().width), body: d.querySelector('.mv-body').getBoundingClientRect().width, wh: !!wh, rows }; });
  ok(`[${z}] mixer opened with the Whole-Home card`, R && R.wh, JSON.stringify(R && R.rows.length));
  if (!R) { await c.close(); continue; }
  ok(`[${z}] zone cards stack in ONE column`, R.cols === 1, R.cols);
  ok(`[${z}] each card spans the full width`, R.cardW.every(w => w >= R.body - 2), JSON.stringify([R.body, R.cardW]));
  const ov = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const wr = R.rows.filter(r => r.card === '990'); ok(`[${z}] Whole-Home has the zone row + 3 speakers`, wr.length === 4, wr.length);
  const v3 = wr.find(r => r.name === 'PCBOXV3D'); ok(`[${z}] PCBOXV3D shows REF, OFFLINE, BT`, v3 && v3.tags.map(t => t.x).join() === 'REF,OFFLINE,BT', JSON.stringify(v3?.tags.map(t => t.x)));
  ok(`[${z}] "PCBOXV3D" is shown in full (no ellipsis)`, v3 && !v3.trunc);
  for (const r of R.rows) for (const t of r.tags) {
    ok(`[${z}] ${r.name} tag ${t.x} does not overlap its slider track`, !ov(t, r.tr), JSON.stringify([t, r.tr]));
    ok(`[${z}] ${r.name} tag ${t.x} sits on its own line under the name`, t.t >= r.name_r.b - 0.5 && !ov(t, r.pct), JSON.stringify([t, r.name_r]));
  }
  for (const g of [...new Set(R.rows.map(r => r.card))]) { const l = R.rows.filter(r => r.card === g), sp = f => Math.max(...l.map(f)) - Math.min(...l.map(f));
    ok(`[${z}] card ${g}: ${l.length} tracks share left edge, width, center within 1 px`, sp(x => x.tr.l) <= 1 && sp(x => x.tr.w) <= 1 && sp(x => (x.tr.l + x.tr.r) / 2) <= 1, JSON.stringify(l.map(x => [x.name, Math.round(x.tr.l), Math.round(x.tr.w)]))); }
  if (z !== 'phone') { const w = wr[0].tr.w, cw = R.cardW[0]; ok(`[${z}] the slider stays long (track ${Math.round(w)} px = ${Math.round(100 * w / cw)} % of the card)`, w >= cw * 0.45, JSON.stringify([w, cw])); }
  ok(`[${z}] no page errors`, !errs.length, errs.join(' | '));
  await p.screenshot({ path: `${OUT}/mixer-${z}.png` });
  { const bb = await p.locator('dialog.mixer-dlg .mv-card[data-group="990"]').boundingBox(); if (bb) await p.screenshot({ path: `${OUT}/wholehome-card-${z}.png`, clip: bb }); }
  await c.close();
}
await br.close(); console.log(`f79mixertags: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

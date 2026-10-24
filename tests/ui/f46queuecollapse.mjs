// 0.4.6 F46: collapsing / expanding the Queue can never change its order. 20 cycles per layout (plain clicks, fast double clicks, click-drag that
// starts on the collapse / expand button and moves over the rows), then the server-side order must be unchanged and no /queue/move was sent.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(); let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
let ZQ = '';
const order = async p => p.evaluate(async zq => (await (await fetch('/api/v1/queue' + zq)).json()).items.map(x => x.id).join(','), ZQ);
const br = await chromium.launch();
for (const [lay, vw, vh, d] of [['full', 1920, 1080, 1], ['full', 960, 540, 2], ['roomy', 1920, 1080, 1]]) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([lay]) => { if (sessionStorage.getItem('f46')) return; sessionStorage.setItem('f46', '1'); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); localStorage.setItem('wavwiz.layout', lay);
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' })); }, [lay]);
  const p = await c.newPage(); const moves = []; p.on('request', r => { if (r.method() === 'POST' && /\/queue\/move/.test(r.url())) moves.push(r.postData()); });
  await p.goto(B + '/'); await p.waitForTimeout(2800); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  const pid = await p.evaluate(() => document.querySelector('.zwrap42.ctl')?.dataset.playbackId || ''); ZQ = pid && pid !== 'default' ? '?zoneId=' + pid : '';
  if ((await order(p)).split(',').filter(Boolean).length < 5) { await p.evaluate(async zq => { await fetch('/api/v1/queue/add' + zq, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'tracks', ids: [1, 2, 3, 4, 5, 6] }) }); }, ZQ); await p.reload(); await p.waitForTimeout(2500); }
  const tg = `[${lay} ${d * 100}%]`, before = await order(p);
  ok(`${tg} the queue has rows to protect`, before.split(',').length >= 3, before);
  const btn = async () => { const b = p.locator('.listpanel .listcol:visible, .listpanel .listup:visible').first(); return (await b.count()) ? b : null; };
  for (let i = 0; i < 20; i++) { const b = await btn(); if (!b) break; const bb = await b.boundingBox(); if (!bb) break; const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2;
    if (i % 4 === 0) await p.mouse.click(x, y);
    else if (i % 4 === 1) { await p.mouse.dblclick(x, y); }
    else if (i % 4 === 2) { await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x, y + 30, { steps: 3 }); await p.mouse.move(x - 120, y + 140, { steps: 6 }); await p.mouse.up(); }
    else { await p.mouse.move(x, y); await p.mouse.down(); await p.waitForTimeout(60); await p.mouse.move(x, y - 80, { steps: 5 }); await p.mouse.move(x, y + 200, { steps: 8 }); await p.mouse.up(); }
    await p.waitForTimeout(i % 3 ? 90 : 420); }
  await p.waitForTimeout(800);
  const after = await order(p);
  ok(`${tg} 20 collapse / expand cycles: server queue order unchanged`, after === before, `${before} -> ${after}`);
  if (await p.evaluate(() => document.querySelector('.desk').classList.contains('listcollapsed'))) { await p.evaluate(() => document.querySelector('.listpanel .listup')?.click()); await p.waitForTimeout(600); }
  const view = await p.evaluate(() => ({ chip: !document.querySelector('.sortchip')?.hidden, sorted: !!document.querySelector('.qtable th.sorted'), titles: [...document.querySelectorAll('.qtable tbody tr[data-i]')].map(r => +r.dataset.i).join(',') }));
  ok(`${tg} the Queue VIEW is still in queue order (no column sort applied by a stray click)`, !view.chip && !view.sorted && view.titles === view.titles.split(',').map((_, k) => k).join(','), JSON.stringify(view));
  ok(`${tg} no /queue/move request was sent`, moves.length === 0, JSON.stringify(moves.slice(0, 3)));
  await c.close(); }
await br.close(); console.log(`f46queuecollapse: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

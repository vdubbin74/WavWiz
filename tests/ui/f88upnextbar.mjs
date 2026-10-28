// WavWiz 0.5.0 F88: with the Queue open at standard size the title bar shows "Up next" again (the server's next song, same source as the
// collapsed bar). Too-narrow windows fall back to the row pill. Expanded Library keeps the F83 hide. Fictional titles only.
import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(); let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const PICK = 'F88 Shuffle Pick', NEIGH = 'F88 List Neighbour';
const br = await chromium.launch();
for (const [lib, vw, vh, dpr] of [['normal', 1920, 1080, 1], ['normal', 1920, 1080, 2], ['expanded', 1920, 1080, 1]]) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
  await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(l => { if (sessionStorage.f88) return; sessionStorage.f88 = 1; localStorage.clear(); for (const [k, v] of [['wavwiz.whatsnew', '9.9.9'], ['wavwiz.gettingStarted.shown', '1'], ['wavwiz.webRoom.autojoin', '0'],
    ['wavwiz.panels', JSON.stringify({ lib: l, dev: 'normal', exp: null, list: 'open', ctl: 'normal', ctlSet: true })]]) localStorage.setItem(k, v); }, lib);
  await c.route(/\/api\/v1\/stream(\?|$)/, async r => { if (r.request().method() !== 'GET') return r.fallback(); try { const res = await r.fetch(), j = await res.json();
    const base = j.queue.items[0] || { id: 1, kind: 'track', title: 'x', artist: '' };
    const items = [0, 1, 2, 3, 4, 5].map(i => ({ ...base, id: 9100 + i, title: i === 1 ? NEIGH : i === 4 ? PICK : 'F88 Song ' + i, artist: 'F88 Artist' }));
    j.queue.items = items; j.now = { ...j.now, state: 'paused', index: 0, item: items[0], shuffle: true, nextIndex: 4, nextTrack: items[4] };
    await r.fulfill({ response: res, json: j }); } catch { /* closed */ } });
  const p = await c.newPage(); const tg = `[lib ${lib} ${dpr * 100}%]`;
  await p.goto(B + '/'); await p.waitForTimeout(3500); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close())); await p.waitForTimeout(500);
  const r = await p.evaluate(() => { const nb = document.querySelector('.listpanel .plnext, .plnext'); const pill = document.querySelector('.qnextpill');
    return { desk: document.querySelector('.desk').className, bar: nb && !nb.hidden && nb.offsetParent ? nb.textContent : '', pill: pill?.closest('tr')?.textContent || '', pillVis: !!(pill && pill.offsetParent && getComputedStyle(pill).display !== 'none') }; });
  ok(`${tg} queue is open at standard size`, !/listcollapsed|listexpanded/.test(r.desk), r.desk);
  if (lib === 'normal') ok(`${tg} title bar shows Up next = the shuffle pick`, r.bar.includes(PICK) && !r.bar.includes(NEIGH), JSON.stringify(r));
  if (lib === 'normal') ok(`${tg} row UP NEXT pill stays visible alongside the title bar`, r.pillVis, JSON.stringify(r));
  else ok(`${tg} F83: title-bar Up next stays hidden beside the expanded Library`, r.bar === '' || !/libexpanded/.test(r.desk), JSON.stringify(r));
  if (process.env.SH) { mkdirSync('/workspace/screens/050-upnext', { recursive: true }); await p.screenshot({ path: `/workspace/screens/050-upnext/lib-${lib}-${dpr * 100}.png` }); }
  await c.close(); }
await br.close(); console.log(`f88upnextbar: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

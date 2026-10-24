// 0.4.9 F73: "Up next" shows the song the server says plays next (now.nextIndex / now.nextTrack - the shuffle pick), not the list neighbour.
// The /stream state is mocked with shuffle on and a pick that is NOT the next row; desktop Now Playing, the minimized-queue line and the phone remote
// must all show the pick; nextIndex -1 shows "Nothing queued after this".
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(); let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const PICK = 'F73 Shuffle Pick', NEIGH = 'F73 List Neighbour';
let mode = 'pick';
const br = await chromium.launch();
for (const [view, vw, vh, dpr, phone] of [['desktop', 1920, 1080, 1, false], ['desktop', 960, 540, 2, false], ['phone', 390, 844, 3, true]]) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, ...(phone ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' } : {}) });
  await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); });
  await c.route(/\/api\/v1\/stream(\?|$)/, async r => { if (r.request().method() !== 'GET') return r.fallback(); try { const res = await r.fetch(), j = await res.json();
    const base = j.queue.items[0] || { id: 1, kind: 'track', title: 'x', artist: '' };
    const items = [0, 1, 2, 3, 4].map(i => ({ ...base, id: 9000 + i, title: i === 1 ? NEIGH : i === 3 ? PICK : 'F73 Song ' + i, artist: 'F73 Artist' }));
    j.queue.items = items; j.now = { ...j.now, state: 'paused', index: 0, item: items[0], shuffle: true, nextIndex: mode === 'pick' ? 3 : -1, nextTrack: mode === 'pick' ? items[3] : null };
    await r.fulfill({ response: res, json: j }); } catch { /* closed */ } });
  const p = await c.newPage(); const tg = `[${view} ${dpr * 100}%]`;
  mode = 'pick'; await p.goto(B + '/'); await p.waitForTimeout(3000); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  const read = () => p.evaluate(() => ({ up: [...document.querySelectorAll('.np-upnext')].map(e => e.textContent).join(' | '), pl: [...document.querySelectorAll('.plnext')].map(e => e.textContent + ' ' + e.title).join(' | ') }));
  let r = await read();
  ok(`${tg} Now Playing "Up next" shows the shuffle pick`, r.up.includes(PICK) && !r.up.includes(NEIGH), r.up);
  ok(`${tg} the next-track line shows the shuffle pick`, r.pl.includes(PICK) && !r.pl.includes(NEIGH), r.pl);
  if (phone) { const vis = await p.evaluate(t => [...document.querySelectorAll('.np-upnext')].some(e => e.offsetParent && e.textContent.includes(t)), PICK); ok(`${tg} the phone remote shows it on screen`, vis); }
  if (process.env.SH) await p.screenshot({ path: `/workspace/screens/049-shuffle/${view}-${dpr * 100}-upnext.png` });
  mode = 'end'; await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await p.reload(); await p.waitForTimeout(3000);
  r = await read(); ok(`${tg} nothing follows (end of the shuffle cycle): "Nothing queued after this", not the neighbour`, !r.up.includes(NEIGH) && r.pl.includes('Nothing queued after this'), JSON.stringify(r));
  await c.close(); }
await br.close(); console.log(`f73shufflenext: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

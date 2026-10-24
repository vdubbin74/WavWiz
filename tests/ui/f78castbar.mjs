// 0.4.9 F78: "Casting: AirPlay Everywhere" bar on top of every Devices panel + AIRPLAY zone tag, Stop ends it, hidden when nothing casts.
// The phone session is simulated by the /cast answer (the server side - a simulated RAOP INIT + feed - is in Release049AirPlayEverywhereTests).
import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), OUT = '/workspace/screens/049-cast'; mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const br = await chromium.launch();
async function run(vw, vh, dpr, sc, lay, exp, phone) {
  const t = `${lay}${exp ? ' expanded' : ''} ${sc}${phone ? ' phone' : ''}`;
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, hasTouch: phone, isMobile: phone }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([lay, sc]) => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); if (sessionStorage.getItem('f78')) return; sessionStorage.setItem('f78', '1'); localStorage.setItem('wavwiz.uiscale', sc); localStorage.setItem('wavwiz.layout', lay); localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' })); }, [lay, sc]);
  await c.route(/\/api\/v1\/zones(\?|$)/, async r => { try { const res = await r.fetch(), j = await res.json(); for (const z of j) z.connected = true; await r.fulfill({ response: res, json: j }); } catch {} });
  let casting = true, stops = 0, zones = (await (await c.request.get(B + '/api/v1/groups')).json()).map(g => g.id);
  await c.route(/\/api\/v1\/groups(\?|$)/, async r => { try { const res = await r.fetch(), j = await res.json(); await r.fulfill({ response: res, json: j }); } catch {} });
  const dto = () => casting ? { active: true, kind: 'airplay', name: 'WavWiz – Everywhere', sender: "Vic's iPhone", title: 'Blinding Lights', artist: 'The Weeknd', zones } : { active: false };
  await c.route(/\/api\/v1\/cast(\?|$)/, r => r.fulfill({ json: dto() }));
  await c.route(/\/api\/v1\/cast\/stop/, r => { stops++; casting = false; return r.fulfill({ json: dto() }); });
  const p = await c.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(B + '/'); await p.waitForTimeout(3000); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  if (lay === 'roomy') { await p.click('.desk.devcollapsed .devpanel .prail').catch(() => {}); await p.waitForTimeout(800); }
  if (exp) { await p.click('.devpanel .devexp'); await p.waitForTimeout(1000); }
  if (phone) { await p.click('.hamburger'); await p.waitForTimeout(400); await p.click('.drawer.open nav >> text=Devices & Zones'); await p.waitForTimeout(1500); }
  const bar = p.locator('.cast42 >> visible=true');
  ok(await bar.count() === 1, `${t}: one Casting bar`);
  const txt = (await bar.first().textContent().catch(() => '')) || '';
  ok(/Casting: AirPlay Everywhere/.test(txt) && txt.includes("Vic's iPhone") && txt.includes('Blinding Lights') && txt.includes('The Weeknd'), `${t}: bar text ${txt}`);
  const g = await p.evaluate(() => { const b = document.querySelector('.cast42'), m = document.querySelector('.dmaster'); if (!b) return {}; const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    return { radius: cs.borderTopLeftRadius, above: !m || !m.offsetParent || r.bottom <= m.getBoundingClientRect().top + 1, h: r.height, over: b.scrollWidth > b.clientWidth + 1 }; });
  ok(g.radius === '3px' && g.above && !g.over, `${t}: 3px corners, above the master, no overflow ${JSON.stringify(g)}`);
  ok(await p.locator('.dtag.zcast >> visible=true').count() >= 1, `${t}: AIRPLAY zone tag`);
  await p.screenshot({ path: `${OUT}/${lay}${exp ? '-expanded' : ''}-${sc}${phone ? '-phone' : ''}.png` });
  await bar.first().locator('.cast42-stop').click(); await p.waitForTimeout(2500);
  ok(stops === 1 && await p.locator('.cast42 >> visible=true').count() === 0 && await p.locator('.dtag.zcast >> visible=true').count() === 0, `${t}: Stop ends it and hides the bar and tags ${stops} ${await p.locator('.cast42 >> visible=true').count()} ${await p.locator('.dtag.zcast >> visible=true').count()}`);
  ok(errs.length === 0, `${t}: no page errors ${errs.join('|')}`);
  await c.close();
}
for (const [vw, vh, dpr, sc] of [[1920, 1080, 1, 'compact'], [960, 540, 2, 'tiny']]) { for (const lay of ['classic', 'roomy', 'full']) await run(vw, vh, dpr, sc, lay, false, false); await run(vw, vh, dpr, sc, 'full', true, false); }
await run(390, 844, 3, 'compact', 'full', false, true);
await br.close(); console.log(`f78castbar: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

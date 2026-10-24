// 0.4.9 F69 fix: real pointer drags of the zone ⋮ handle (.zgut42) - Full/Roomy, expanded, 100% and 200%+tiny, and the phone (touch hold).
// Catches the regression: the Jukebox row is a .qb42 the model doesn't have, so index matching threw and moved the wrong zone.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim();
const ON = new Set([1, 2, 3, 6]); const br = await chromium.launch();
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
async function run(vw, vh, dpr, sc, lay, exp, phone, jbFirst) {
const tag = `${lay} ${sc} exp=${exp} phone=${phone}${jbFirst ? ' jb-first' : ''}`;
const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, hasTouch: phone, isMobile: phone }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
await c.addInitScript(([lay, sc]) => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); if (sessionStorage.getItem('pp')) return; sessionStorage.setItem('pp','1'); localStorage.removeItem('wavwiz.devorder.v1'); localStorage.setItem('wavwiz.uiscale', sc); localStorage.setItem('wavwiz.layout',lay); localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' })); }, [lay, sc]);
await c.route(/\/api\/v1\/zones(\?|$)/, async r => { try { const res = await r.fetch(), j = await res.json(); for (const z of j) z.connected = ON.has(z.id); await r.fulfill({ response: res, json: j }); } catch {} });
await c.route(/\/api\/v1\/groups(\?|$)/, async r => { try { const res = await r.fetch(), j = await res.json(); for (const g of j) { g.linked = []; g.playbackId = 'zg:' + g.id; } await r.fulfill({ response: res, json: j }); } catch {} });
await c.route(/\/api\/v1\/(groups\/\d+|zones\/\d+\/group)(\?|$)/, async r => { if (r.request().method() === 'GET') return r.fallback(); await r.fulfill({ status: 200, json: {} }); });
const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(B + '/'); await p.waitForTimeout(3000); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
if (lay === 'roomy') { await p.click('.desk.devcollapsed .devpanel .prail').catch(() => {}); await p.waitForTimeout(800); }
if (exp) { await p.click('.devpanel .devexp').catch(() => {}); await p.waitForTimeout(900); }
if (phone) { await p.click('.hamburger'); await p.waitForTimeout(400); await p.click('.drawer.open nav >> text=Devices & Zones'); await p.waitForTimeout(1500); }
const ord = () => p.evaluate(() => [...document.querySelectorAll('.tree42 > section[data-leader-id]')].filter(e => e.offsetParent && !e.classList.contains('jb42')).map(e => e.dataset.leaderId).join(','));
if (jbFirst) await p.evaluate(() => { const t = document.querySelector('.tree42'), j = t?.querySelector(':scope > .jb42'); if (j) t.prepend(j); });
const box = async (id, sel = '') => p.locator(`.tree42 > section[data-leader-id="${id}"] ${sel} >> visible=true`).first().boundingBox({ timeout: 1500 }).catch(() => null);
const drag = async (fromId, toId) => {
  const a = await box(fromId, '.zgut42'), b = await box(toId); if (!a || !b) return false;
  const x0 = a.x + a.width / 2, y0 = a.y + a.height / 2, y1 = Math.min(b.y + b.height * 0.9, b.y + b.height / 2 + 40);   // stay clear of the phone mini player
  if (phone) { const s = await c.newCDPSession(p), t = (type, x, y) => s.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await t('touchStart', x0, y0); await p.waitForTimeout(600); for (let i = 1; i <= 12; i++) { await t('touchMove', x0, y0 + (y1 - y0) * i / 12); await p.waitForTimeout(30); } await t('touchEnd'); }
  else { await p.mouse.move(x0, y0); await p.mouse.down(); for (let i = 1; i <= 12; i++) { await p.mouse.move(x0, y0 + (y1 - y0) * i / 12); await p.waitForTimeout(30); } await p.mouse.up(); }
  await p.waitForTimeout(900); return true; };
const [f, t] = jbFirst ? ['2', '3'] : ['1', '2'], o0 = await ord();
ok(await drag(f, t), tag + ' handles visible');
const want = o0.split(','); want.splice(want.indexOf(f), 1); want.splice(want.indexOf(t) + 1, 0, f);
ok(await ord() === want.join(','), `${tag}: active zone reorders ${o0} -> ${await ord()} (want ${want})`);
ok(await p.locator('.ctxmenu').count() === 0 && await p.locator('.pd42-sheet >> visible=true').count() === 0, tag + ': a drag is not a tap');
if (!phone && !jbFirst) { const o1 = await ord(); await drag('4', '1'); ok(await ord() === o1, tag + ': inactive zone is not draggable'); await p.keyboard.press('Escape'); }
ok(errs.length === 0, `${tag}: no page errors ${errs.join('|')}`);
await c.close(); }
for (const [vw, vh, dpr, sc] of [[1920, 1080, 1, 'compact'], [960, 540, 2, 'tiny']]) for (const lay of ['full', 'roomy']) for (const exp of [false, true]) await run(vw, vh, dpr, sc, lay, exp, false);
await run(1920, 1080, 1, 'compact', 'full', false, false, true);
await run(390, 844, 3, 'compact', 'full', false, true);
await br.close(); console.log(`f69zonedrag: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

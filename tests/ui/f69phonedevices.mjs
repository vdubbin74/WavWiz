// 0.4.9 F69: Devices - one manual zone order over all zones; shown as ACTIVE (a speaker online) in that order, then INACTIVE (speakers, none online)
// in that order, then EMPTY (no speakers). Inactive / empty zones are one compact row (name, Offline / No speakers, gear) with no move options.
// Move to top / up / down / bottom (active only, ends disabled) reorders among the active zones inside the full list, so a zone that comes back
// online pops into its remembered slot - live, through the normal zones refresh. Phone: tap a zone = control it and go to the remote, gear = settings,
// Back + history back. Desktop Full / Roomy / Expanded at 100 % and 200 % tiny. Online state and playback are mocked in THIS TEST ONLY.
import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SH, OUT = '/workspace/screens/049-devices'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
if (SH) mkdirSync(OUT, { recursive: true });
const ON = new Set([1, 2, 3, 6]);   // Kitchen 1,2 / Basement 3,5 / Patio 6 online; Garage has no speakers
const br = await chromium.launch();
async function open(vw, vh, dpr, scale, layout) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, hasTouch: vw < 700, isMobile: vw < 700 }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([sc, lay]) => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
    if (sessionStorage.getItem('f69')) return; sessionStorage.setItem('f69', '1'); localStorage.removeItem('wavwiz.devorder.v1'); localStorage.setItem('wavwiz.uiscale', sc); localStorage.setItem('wavwiz.layout', lay);
    localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' })); }, [scale, layout]);
  await c.route(/\/api\/v1\/zones(\?|$)/, async r => { try { const res = await r.fetch(), j = await res.json(); for (const z of j) z.connected = ON.has(z.id); await r.fulfill({ response: res, json: j }); } catch { /* closed */ } });
  await c.route(/\/api\/v1\/groups(\?|$)/, async r => { try { const res = await r.fetch(), j = await res.json();
    for (const g of j) { g.linked = []; g.playbackId = 'zg:' + g.id; g.now = g.name === 'Kitchen' ? { state: 'playing', title: 'Mock Song', artist: 'Mock Artist', kind: 'track', positionMs: 5000, durationMs: 200000 } : g.name === 'Patio' ? { state: 'paused', title: 'Paused Song', artist: 'A', kind: 'track', positionMs: 9000, durationMs: 200000 } : null; }
    await r.fulfill({ response: res, json: j }); } catch { /* closed */ } });
  c.writes = []; await c.route(/\/api\/v1\/(groups\/\d+|zones\/\d+\/group)(\?|$)/, async r => { if (r.request().method() === 'GET') return r.fallback(); c.writes.push({ u: r.request().url(), m: r.request().method(), b: r.request().postData() }); await r.fulfill({ status: 200, json: {} }); });
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(3000); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close())); return { c, p };
}
const order = (p, scope = '') => p.evaluate(s => [...document.querySelectorAll(`${s} .tree42 > section[data-leader-id]:not(.jb42)`)].filter(e => e.offsetParent).map(e => +e.dataset.leaderId + (e.classList.contains('off42') ? 'o' : e.classList.contains('empty42') ? 'e' : '')).join(','), scope);
const waitOrder = async (p, want, scope = '') => { let o; for (let i = 0; i < 40; i++) { o = await order(p, scope); if (o === want) return o; await p.waitForTimeout(250); } return o; };
const esc = async p => { if (await p.locator('.ctxmenu').count()) await p.keyboard.press('Escape'); await p.waitForTimeout(100); };
const menu = async (p, id, right = true) => { await esc(p); const el = p.locator(`.tree42 section[data-leader-id="${id}"] .zwrap42 >> visible=true`).first();
  if (right) await el.click({ button: 'right', position: { x: 40, y: 12 } }); else await p.locator(`.tree42 section[data-leader-id="${id}"] .zgut42 >> visible=true`).first().click(); await p.waitForTimeout(250);
  return p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ctxmenu .ctx-item')].filter(b => /^move(top|up|down|bottom)$/.test(b.dataset.ctx)).map(b => [b.dataset.ctx, !b.disabled]))); };
const dragBy = async (p, from, to, dy = 0.75) => { const a = await p.locator(from + ' >> visible=true').first().boundingBox(), b = await p.locator(to + ' >> visible=true').first().boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.down(); for (let i = 1; i <= 12; i++) { await p.mouse.move(a.x + a.width / 2 + (b.x + b.width / 2 - a.x - a.width / 2) * i / 12, a.y + a.height / 2 + (b.y + b.height * dy - a.y - a.height / 2) * i / 12); await p.waitForTimeout(30); }
  await p.mouse.up(); await p.waitForTimeout(700); };
const navState = p => p.evaluate(() => ({ sheet: !!document.querySelector('.pd42-sheet')?.offsetParent, exp: !!document.querySelector('.devpanel.expanded'), back: !!document.querySelector('.d42-back')?.offsetParent }));
const pick = async (p, act) => { await p.click(`.ctxmenu .ctx-item[data-ctx="${act}"]`); await p.waitForTimeout(400); };
const emptyRow = (p, id) => p.evaluate(i => { const s = document.querySelector(`.tree42 > section[data-leader-id="${i}"]`); if (!s) return null; const v = e => !!e && !!e.offsetParent;
  return { minimal: !v(s.querySelector('.qb42-vol,[role="slider"],.npbar42,.zl-now,.qb42-h,.pill42,.tog')), note: s.querySelector('.ze42-note')?.textContent, handle: v(s.querySelector('.zgut42,.dgrip')), nameBtn: v(s.querySelector('.zname')), hint: v(s.querySelector('.ze42-drop')), h: Math.round(s.getBoundingClientRect().height), drop: !!s.querySelector('[data-drop]') }; }, id);

// ---- desktop: Full column, Roomy slide-out, Expanded; 100 % and 200 % tiny ----
for (const [vw, vh, dpr, scale, z] of [[1920, 1080, 1, 'compact', '100'], [960, 540, 2, 'tiny', '200-tiny']]) for (const layout of ['full', 'roomy']) {
  ON.clear(); [1, 2, 3, 6].forEach(x => ON.add(x));
  const { c, p } = await open(vw, vh, dpr, scale, layout), t = `[${layout} ${z}]`;
  if (layout === 'roomy') { await p.click('.desk.devcollapsed .devpanel .prail').catch(() => {}); await p.waitForTimeout(700); }
  ok(`${t} all online: manual (default) order, empty Garage last`, (await waitOrder(p, '1,2,3,4e')) === '1,2,3,4e', await order(p));
  const e = await emptyRow(p, 4); ok(`${t} empty zone: one compact row - name, No speakers, no handle, no player / slider / toggle, drop hint hidden, still a drop target`, e && e.minimal && e.note === 'No speakers' && !e.handle && e.nameBtn && !e.hint && e.drop && e.h < 60, JSON.stringify(e));
  const m0 = await menu(p, 1); ok(`${t} top active zone: Move up / to top disabled, down / bottom enabled`, m0.movetop === false && m0.moveup === false && m0.movedown && m0.movebottom, JSON.stringify(m0));
  if (SH) await p.screenshot({ path: `${OUT}/${layout}-${z}-rightclick-menu.png` });
  const m4 = await menu(p, 4); ok(`${t} empty zone has no move options`, Object.keys(m4).length === 0, JSON.stringify(m4)); await esc(p);
  await menu(p, 3); await pick(p, 'movetop'); ok(`${t} Kitchen > Move to top`, (await waitOrder(p, '3,1,2,4e')) === '3,1,2,4e', await order(p));
  const m3 = await menu(p, 3); ok(`${t} now-top zone's up items disabled`, m3.moveup === false && m3.movedown, JSON.stringify(m3)); await esc(p);
  ON.delete(3); const o1 = await waitOrder(p, '3,2,1o,4e'); ok(`${t} Basement's speaker goes offline -> live: it drops below the active zones, marked Offline`, o1 === '3,2,1o,4e', o1);
  const b = await emptyRow(p, 1); ok(`${t} inactive zone: compact row with Offline, no drag handle`, b && b.minimal && b.note === 'Offline' && !b.handle, JSON.stringify(b));
  const g1 = await p.evaluate(() => { const s = document.querySelector('.tree42 > section[data-leader-id="1"]'); return [...s.querySelectorAll('.sp42.gone[data-device-id]')].filter(e => e.offsetParent).map(e => ({ id: +e.dataset.deviceId, grip: !!e.querySelector('.dgrip42') })); });
  ok(`${t} F160 inactive zone still lists its speakers as dimmed gone rows with grips`, g1.length >= 1 && g1.every(x => x.grip), JSON.stringify(g1));
  await esc(p); await p.locator('.tree42 section[data-leader-id="1"] .sp42.gone >> visible=true').first().click({ button: 'right' }); await p.waitForTimeout(250);
  const gm = await p.evaluate(() => [...document.querySelectorAll('.ctxmenu .ctx-item')].map(b => b.dataset.ctx)); ok(`${t} F160 gone row has the speaker menu (Move / Remove)`, gm.length > 0, JSON.stringify(gm)); await esc(p);
  const e4 = await p.evaluate(() => document.querySelectorAll('.tree42 > section[data-leader-id="4"] .sp42').length); ok(`${t} F160 empty zone still has no rows`, e4 === 0, String(e4));
  const m1 = await menu(p, 1); ok(`${t} inactive zone has no move options`, Object.keys(m1).length === 0, JSON.stringify(m1)); await esc(p);
  if (SH) await p.screenshot({ path: `${OUT}/${layout}-${z}-offline-zone.png` });
  await menu(p, 2); await pick(p, 'movetop'); ok(`${t} Patio > Move to top (Basement offline)`, (await waitOrder(p, '2,3,1o,4e')) === '2,3,1o,4e', await order(p));
  ON.add(3); const o2 = await waitOrder(p, '2,1,3,4e'); ok(`${t} Basement back online -> live: it pops back into its remembered slot (after Patio, before Kitchen)`, o2 === '2,1,3,4e', o2);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('wavwiz.devorder.v1') || '{}').g); ok(`${t} one saved list over all zones`, JSON.stringify(saved) === '["2","1","3","4"]', JSON.stringify(saved));
  if (SH) await p.screenshot({ path: `${OUT}/${layout}-${z}-list.png` });
  if (layout === 'full') {
    await p.setViewportSize({ width: vw, height: 1700 }); await p.waitForTimeout(600);   // room for both rows on screen
    const n0 = await navState(p); await dragBy(p, '.tree42 section[data-leader-id="1"] .sp42[data-device-id="5"] .dgrip42', '.tree42 section[data-leader-id="4"] .zwrap42', 0.5);
    const n1 = await navState(p); ok(`${t} drag a speaker (⋮ handle) onto the empty Garage: a membership write, no navigation`, c.writes.some(w => /groups\/4|zones\/5/.test(w.u)) && n1.exp === n0.exp && !n1.back, JSON.stringify([c.writes, n0, n1]));
    await dragBy(p, '.tree42 section[data-leader-id="2"] .zgut42', '.tree42 section[data-leader-id="3"]', 0.92);
    const od = await waitOrder(p, '1,3,2,4e'); await p.setViewportSize({ width: vw, height: vh }); await p.waitForTimeout(500); ok(`${t} drag an active zone by its ⋮ handle: reorders (Patio after Kitchen), no menu / navigation`, od === '1,3,2,4e' && !(await p.locator('.ctxmenu').count()) && !(await navState(p)).back, od);
    if (SH) await p.screenshot({ path: `${OUT}/${layout}-${z}-after-zone-drag.png` });
    await p.locator('.tree42 section[data-leader-id="1"] .zcount42 >> visible=true').first().click(); await p.waitForTimeout(1200);
    const n2 = await navState(p); ok(`${t} clicking the zone name row opens zone settings with a Back`, n2.exp && n2.back, JSON.stringify(n2));
    if (SH) await p.screenshot({ path: `${OUT}/${layout}-${z}-zone-settings-back.png` });
    await p.click('.d42-back'); await p.waitForTimeout(1200); const n3 = await navState(p); ok(`${t} Back returns to the Devices column`, !n3.exp && !n3.back, JSON.stringify(n3));
    await p.locator('.tree42 section[data-leader-id="3"] .qb42-pick >> visible=true').first().click(); await p.waitForTimeout(800);
    const cz = await p.evaluate(() => document.querySelector('.tree42 section[data-leader-id="3"]')?.classList.contains('ctl') || !!document.querySelector('.tree42 section[data-leader-id="3"] .zwrap42.ctl')); ok(`${t} clicking the Queue header makes the zone Controlling`, cz);
    await p.locator('.tree42 .sp42[data-device-id="6"] .dot >> visible=true').first().click(); await p.waitForTimeout(1200);
    const n4 = await navState(p); ok(`${t} clicking a speaker row opens speaker settings with a Back`, n4.exp && n4.back, JSON.stringify(n4)); await p.click('.d42-back').catch(() => {}); await p.waitForTimeout(800);
  }
  await p.click('.devpanel .devexp').catch(() => {}); await p.waitForTimeout(900);
  const ex = await order(p); ok(`${t} expanded Devices (E1 Zones column) shows the same order`, ex === (layout === 'full' ? '1,3,2,4e' : '2,1,3,4e'), ex);
  if (SH) await p.screenshot({ path: `${OUT}/${layout}-${z}-expanded.png` });
  await c.close();
}

// ---- phone ----
{
  ON.clear(); [1, 2, 3, 6].forEach(x => ON.add(x));
  const { c, p } = await open(390, 844, 3, 'compact', 'full'), t = '[phone]';
  const toDevices = async () => { await p.click('.hamburger'); await p.waitForTimeout(400); await p.click('.drawer.open nav >> text=Devices & Zones'); await p.waitForTimeout(1500); };
  await toDevices();
  ok(`${t} list: default order, empty zone last`, (await waitOrder(p, '1,2,3,4e')) === '1,2,3,4e', await order(p));
  const e = await emptyRow(p, 4); ok(`${t} empty zone compact row`, e && e.minimal && e.note === 'No speakers' && !e.handle && !e.hint, JSON.stringify(e));
  const m = await menu(p, 1, false); ok(`${t} ⋮ menu has the move items (top disabled)`, m.moveup === false && m.movedown, JSON.stringify(m));
  await pick(p, 'movebottom'); ok(`${t} Basement > Move to bottom (of the active zones)`, (await waitOrder(p, '2,3,1,4e')) === '2,3,1,4e', await order(p));
  await p.locator('.tree42 section[data-leader-id="2"] .zwrap42 >> visible=true').first().dispatchEvent('contextmenu'); await p.waitForTimeout(250);
  ok(`${t} long-press / contextmenu menu shows move items`, await p.locator('.ctxmenu .ctx-item[data-ctx="movedown"]').count() === 1); await esc(p);
  ON.delete(1); ON.delete(2); ok(`${t} Kitchen offline -> live: listed after the active zones`, (await waitOrder(p, '2,1,3o,4e')) === '2,1,3o,4e', await order(p));
  ON.add(1); ok(`${t} Kitchen back online -> back in its slot`, (await waitOrder(p, '2,3,1,4e')) === '2,3,1,4e', await order(p));
  if (SH) await p.screenshot({ path: `${OUT}/phone-list-active-first.png` });
  const sc0 = await p.evaluate(() => { const e = document.scrollingElement; e.scrollTop = 60; return e.scrollTop; });
  await p.locator('.tree42 section[data-leader-id="2"] .zcount42 >> visible=true').first().click(); await p.waitForTimeout(700);
  const sh = await p.evaluate(() => { const b = document.querySelector('.pd42-sheet .pd42-close'); return b && { vis: !!b.offsetParent, txt: b.textContent, left: Math.round(b.getBoundingClientRect().left), st: history.state?.pd42, title: document.querySelector('.pd42-sheet')?.textContent.slice(0, 80) }; });
  ok(`${t} tapping the zone name row opens ZONE settings with a top-left Back`, sh && sh.vis && /Back/.test(sh.txt) && sh.left < 60 && sh.st === 1, JSON.stringify(sh));
  if (SH) await p.screenshot({ path: `${OUT}/phone-zone-settings-back.png` });
  await p.goBack(); await p.waitForTimeout(700); const sc1 = await p.evaluate(() => document.scrollingElement.scrollTop);
  ok(`${t} back gesture closes it, list at the same scroll`, !(await p.locator('.pd42-sheet >> visible=true').count()) && Math.abs(sc1 - sc0) <= 2, JSON.stringify([sc0, sc1]));
  await p.locator('.tree42 .sp42[data-device-id="6"] .dot >> visible=true').first().click(); await p.waitForTimeout(700);
  ok(`${t} tapping a speaker row opens SPEAKER settings`, (await p.locator('.pd42-sheet >> visible=true').count()) > 0);
  if (SH) await p.screenshot({ path: `${OUT}/phone-speaker-settings-back.png` });
  await p.click('.pd42-sheet .pd42-close'); await p.waitForTimeout(700); ok(`${t} its Back button closes it`, !(await p.locator('.pd42-sheet >> visible=true').count()));
  await p.locator('.tree42 section[data-leader-id="4"] .zname >> visible=true').first().click(); await p.waitForTimeout(700);
  ok(`${t} empty zone: tapping its name opens its settings`, (await p.locator('.pd42-sheet >> visible=true').count()) > 0); await p.goBack(); await p.waitForTimeout(700);
  await p.locator('.tree42 section[data-leader-id="3"] .qb42-pick >> visible=true').first().click(); await p.waitForTimeout(1000);
  const nv = await p.evaluate(() => ({ pill: document.querySelector('.nowcol .zl-ov')?.textContent || '', vis: !!document.querySelector('.nowcol')?.offsetParent }));
  ok(`${t} tapping the Queue header controls the zone and opens the remote`, nv.vis && /Kitchen/.test(nv.pill), JSON.stringify(nv));
  if (SH) await p.screenshot({ path: `${OUT}/phone-after-tap-remote.png` });
  ok(`${t} no horizontal overflow`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await c.close();
}
await br.close(); console.log(`f69phonedevices: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

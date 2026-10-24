// 0.4.9 F80: the grab hand only on the ⋮ drag handles (zone .zgut42, speaker .dgrip42); the zone card body / name and the queue box title show the
// pointer, plain text the default cursor; grabbing only during a drag. Full / Roomy / Classic, collapsed + expanded, 100 % and 200 % + tiny.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(); let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const br = await chromium.launch();
for (const [vw, vh, dpr, sc] of [[1920, 1080, 1, 'compact'], [960, 540, 2, 'tiny']]) for (const lay of ['full', 'roomy', 'classic']) for (const exp of [false, true]) {
  const tg = `[${lay} ${sc} exp=${exp}]`;
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([lay, sc]) => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); if (sessionStorage.getItem('f80')) return; sessionStorage.setItem('f80', '1'); localStorage.setItem('wavwiz.uiscale', sc); localStorage.setItem('wavwiz.layout', lay); localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' })); }, [lay, sc]);
  await c.route(/\/api\/v1\/zones(\?|$)/, async r => { try { const res = await r.fetch(), j = await res.json(); for (const z of j) z.connected = true; await r.fulfill({ response: res, json: j }); } catch { } });   // live speakers: active zones with handles
  await c.route(/\/api\/v1\/(groups\/\d+|zones\/\d+\/group)(\?|$)/, async r => { if (r.request().method() === 'GET') return r.fallback(); await r.fulfill({ status: 200, json: {} }); });   // a drop never changes the server
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2500); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(e => e.close()));
  if (lay === 'roomy') { await p.click('.desk.devcollapsed .devpanel .prail').catch(() => {}); await p.waitForTimeout(800); }
  if (exp) { await p.click('.devpanel .devexp', { timeout: 3000 }).catch(() => {}); await p.waitForTimeout(900); }
  const r = await p.evaluate(() => { const vis = e => e && e.offsetParent, cur = s => { const e = [...document.querySelectorAll(s)].find(vis); return e ? getComputedStyle(e).cursor : null; };
    const plain = [...document.querySelectorAll('.tree42 .zcard42 .zc42-body *')].find(e => vis(e) && !e.closest('button,input,a,[role=slider],[role=switch],.zacts,.tagact') && e.children.length === 0 && e.textContent.trim());
    // every visible element of a zone card / box, outside the handles, must not show grab
    const bad = [...document.querySelectorAll('.tree42 .qb42 *, .tree42 .zcard42')].filter(e => vis(e) && !e.closest('.zgut42,.dgrip42') && /grab/.test(getComputedStyle(e).cursor)).map(e => e.className).slice(0, 5);
    return { tree: !!document.querySelector('.tree42'), gut: cur('.qb42:not(.empty42):not(.off42) .zgut42'), grip: cur('.tree42 .dgrip42:not(.ro)'), body: cur('.tree42 .zcard42 .zc42-body'), name: cur('.tree42 .zcard42 .zname'), pick: cur('.tree42 .qb42-pick'), slider: cur('.tree42 input[type=range]'), plain: plain ? getComputedStyle(plain).cursor : null, bad }; });
  ok(`${tg} the Devices zone tree is shown`, r.tree); if (!r.tree) { await c.close(); continue; }
  ok(`${tg} zone ⋮ handle shows grab`, r.gut === 'grab', r.gut);
  ok(`${tg} speaker ⋮ grip shows grab`, r.grip === 'grab', r.grip);
  ok(`${tg} zone card body shows pointer (opens the zone), not grab`, r.body === 'pointer', r.body);
  ok(`${tg} zone name row shows pointer, not grab`, r.name === 'pointer', r.name);
  ok(`${tg} queue box title shows pointer, not grab`, r.pick == null || r.pick === 'pointer', r.pick);
  ok(`${tg} sliders keep their cursor (not grab)`, r.slider == null || !/grab/.test(r.slider), r.slider);
  ok(`${tg} no element outside the handles shows grab`, !r.bad.length, JSON.stringify(r.bad));
  // grabbing during a real handle drag, then back to normal
  const g = p.locator('.qb42:not(.empty42):not(.off42) .zgut42 >> visible=true').first(); const bb = await g.boundingBox().catch(() => null);
  if (bb && await p.locator('.qb42:not(.empty42):not(.off42) .zgut42 >> visible=true').count() > 1) {
    await p.mouse.move(bb.x + bb.width / 2, bb.y + 10); await p.mouse.down(); await p.mouse.move(bb.x + bb.width / 2, bb.y + 40, { steps: 6 }); await p.waitForTimeout(150);
    const d = await p.evaluate(() => { const t = document.querySelector('.tree42.zdrag'); const b = t && t.querySelector('.zcard42 .zc42-body'); return { on: !!t, c: b ? getComputedStyle(b).cursor : null }; });
    ok(`${tg} grabbing while a zone is dragged`, d.on && d.c === 'grabbing', JSON.stringify(d));
    await p.keyboard.press('Escape'); await p.mouse.move(bb.x + bb.width / 2, bb.y + 10, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(500);
    ok(`${tg} card body is back to pointer after the drag`, await p.evaluate(() => getComputedStyle([...document.querySelectorAll('.tree42 .zcard42 .zc42-body')].find(e => e.offsetParent)).cursor) === 'pointer');
  }
  await c.close();
}
await br.close(); console.log(`f80grabcursor: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

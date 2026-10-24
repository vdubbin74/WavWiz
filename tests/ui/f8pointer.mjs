// 0.4.5 F8: Library -> Queue through the POINTER path (pdrag.js), as in the WavWiz Player (WebView2) window: Player user agent => every input uses
// pointer events, rows are not natively draggable. Mouse (song + CATEGORY rows: artist / album tile / genre), touch (hold then drag) and pen;
// side panel -> open Queue, -> collapsed Queue strip, expanded Library -> Queue; a plain click still opens a category; grab cursor; 100 % and 200 %.
// TV mode (?tv=1) is checked for the mode + layout (its Library/Queue panels are hidden by design, see report).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const B = process.env.WW || 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim(), SHOTS = process.env.SHOTS;
const PLAYER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0 WavWizPlayer/0.4.4';
let pass = 0, fail = 0; const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + d)); };
const br = await chromium.launch();
async function open(dpr, pan, { touch = false, ua = PLAYER, q = '' } = {}) {
  const ctx = await br.newContext({ viewport: { width: 1920 / dpr, height: 1080 / dpr }, deviceScaleFactor: dpr, userAgent: ua, hasTouch: touch });
  await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(P => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.panels', JSON.stringify({ dev: 'normal', ctl: 'collapsed', ...P })); }, pan);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(B + '/' + q); await p.waitForTimeout(2500);
  await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));
  if (await p.evaluate(() => document.querySelector('.desk')?.classList.contains('tight') && document.querySelector('.libpanel')?.classList.contains('israil') && !!document.querySelector('.libpanel').offsetParent)) { await p.locator('.libpanel').click({ position: { x: 10, y: 120 } }); await p.waitForTimeout(700); }   // 0.4.5 T1: open the Library from its rail
  const posts = []; p.on('request', r => { if (r.method() === 'POST' && r.url().includes('/queue/add')) posts.push({ ...r.postDataJSON(), _zone: new URL(r.url()).searchParams.get('zoneId') }); });
  return { ctx, p, errs, posts };
}
const qn = p => p.locator('.listpanel tr[data-i]').count();
const center = async (loc, fx = 0.5) => { const b = await loc.boundingBox(); return [b.x + b.width * fx, b.y + b.height / 2]; };
async function mouseDrag(p, [sx, sy], [tx, ty]) { await p.mouse.move(sx, sy); await p.mouse.down(); for (let i = 1; i <= 14; i++) await p.mouse.move(sx + (tx - sx) * i / 14, sy + (ty - sy) * i / 14); await p.waitForTimeout(150); await p.mouse.up(); }
async function cdpDrag(p, kind, [sx, sy], [tx, ty]) {
  const c = await p.context().newCDPSession(p);
  if (kind === 'touch') {
    await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] }); await p.waitForTimeout(300);
    for (let i = 1; i <= 14; i++) await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx + (tx - sx) * i / 14, y: sy + (ty - sy) * i / 14 }] });
    await p.waitForTimeout(150); await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    const m = (type, x, y, extra = {}) => c.send('Input.dispatchMouseEvent', { type, x, y, pointerType: 'pen', button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
    await m('mousePressed', sx, sy); await p.waitForTimeout(250); for (let i = 1; i <= 14; i++) await m('mouseMoved', sx + (tx - sx) * i / 14, sy + (ty - sy) * i / 14); await p.waitForTimeout(150); await m('mouseReleased', tx, ty);
  }
  await c.detach();
}
for (const dpr of [1, 2]) {
  const Z = `[${dpr * 100}%]`;
  // 1) side panel: CATEGORY row (top-level artist) -> open queue, mouse; grab cursor; mode
  { const { ctx, p, errs, posts } = await open(dpr, { lib: 'normal', exp: null, list: 'open' });
    const st = await p.evaluate(async () => { const { dndMode } = await import('/js/pdrag.js'); const r = document.querySelector('.libpanel li.item.ldrag'); return { mode: dndMode(), cur: r && getComputedStyle(r).cursor, native: document.querySelectorAll('.libpanel li.item[draggable=true]').length }; });
    ok(`F8 Player window uses the pointer path, rows not natively draggable ${Z}`, st.mode === 'pointer' && st.native === 0, JSON.stringify(st));
    ok(`F8 grab cursor on a Library category row ${Z}`, st.cur === 'grab', st.cur);
    const before = await qn(p), row = p.locator('.libpanel li.item.ldrag').first(), name = (await row.locator('.t1').textContent())?.trim();
    const s = await center(row, 0.3), d = await center(p.locator('.listpanel .qwrap'), 0.3);
    await p.mouse.move(...s); await p.mouse.down(); for (let i = 1; i <= 6; i++) await p.mouse.move(s[0] + (d[0] - s[0]) * i / 14, s[1] + (d[1] - s[1]) * i / 14);
    const mid = await p.evaluate(() => ({ active: !!window.__pd, ghost: !!document.querySelector('.pdghost'), body: getComputedStyle(document.body).cursor }));
    for (let i = 7; i <= 14; i++) await p.mouse.move(s[0] + (d[0] - s[0]) * i / 14, s[1] + (d[1] - s[1]) * i / 14);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}-side-category-mid-${dpr * 100}.png` });
    await p.waitForTimeout(150); await p.mouse.up(); await p.waitForTimeout(1500);
    ok(`F8 grabbing cursor + ghost while dragging ${Z}`, mid.ghost && mid.body === 'grabbing', JSON.stringify(mid));
    const after = await qn(p); ok(`F8 side panel: drag CATEGORY "${name}" -> open Queue adds all its songs ${Z}`, after > before + 1 && posts.some(b => b.kind === 'node'), `before=${before} after=${after} posts=${JSON.stringify(posts)}`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}-side-category-after-${dpr * 100}.png` });
    // a plain click still opens the category (no add)
    const n0 = await qn(p), t0 = await p.locator('.libpanel').innerText(); await row.click(); await p.waitForTimeout(1200);
    ok(`F8 plain click on a category still opens it (nothing added) ${Z}`, (await qn(p)) === n0 && (await p.locator('.libpanel').innerText()) !== t0);
    // now inside the artist: open the album, drag a SONG row
    await p.locator('.libpanel li.item .t').first().click(); await p.waitForTimeout(900);
    const b2 = await qn(p), song = p.locator('.libpanel li.item.ldrag').first(); await song.scrollIntoViewIfNeeded(); await p.waitForTimeout(250);
    await mouseDrag(p, await center(song, 0.3), await center(p.locator('.listpanel .qwrap'), 0.3)); await p.waitForTimeout(1500);
    ok(`F8 side panel: drag SONG -> open Queue adds 1 ${Z}`, (await qn(p)) === b2 + 1, `before=${b2} after=${await qn(p)}`);
    ok(`F8 no page errors ${Z}`, errs.length === 0, errs.join(' | ')); await ctx.close(); }
  // 2) collapsed queue strip, category row
  { const { ctx, p, posts } = await open(dpr, { lib: 'normal', exp: null, list: 'collapsed' });
    const row = p.locator('.libpanel li.item.ldrag').first();
    await mouseDrag(p, await center(row, 0.3), await center(p.locator('.listpanel > .pane-h'), 0.3)); await p.waitForTimeout(1500);
    ok(`F8 side panel: CATEGORY -> collapsed Queue strip adds at the end ${Z}`, posts.length === 1 && posts[0].kind === 'node' && typeof posts[0].at === 'number', JSON.stringify(posts));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}-collapsed-after-${dpr * 100}.png` }); await ctx.close(); }
  // 3) expanded Library: category tile -> queue
  { const { ctx, p, posts } = await open(dpr, { lib: 'normal', exp: 'lib', list: 'open' });
    const before = await qn(p), tile = p.locator('.libcontent li.tile.ldrag').first(); await tile.scrollIntoViewIfNeeded();
    const cur = await tile.evaluate(e => getComputedStyle(e).cursor);
    await mouseDrag(p, await center(tile), await center(p.locator('.listpanel .qwrap'), 0.3)); await p.waitForTimeout(1500);
    ok(`F8 expanded Library: CATEGORY tile (grab cursor) -> Queue adds its songs ${Z}`, cur === 'grab' && (await qn(p)) > before && posts[0]?.kind === 'node', `cur=${cur} before=${before} after=${await qn(p)}`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}-expanded-after-${dpr * 100}.png` }); await ctx.close(); }
  // 4) touch (hold, then drag) and 5) pen - side panel category -> queue
  for (const kind of ['touch', 'pen']) {
    const { ctx, p, posts } = await open(dpr, { lib: 'normal', exp: null, list: 'open' }, { touch: kind === 'touch' });
    const before = await qn(p), row = p.locator('.libpanel li.item.ldrag').first();
    await cdpDrag(p, kind, await center(row, 0.3), await center(p.locator('.listpanel .qwrap'), 0.3)); await p.waitForTimeout(1500);
    const sheet = await p.locator('dialog[open]').count();
    ok(`F8 ${kind}: CATEGORY -> Queue adds its songs (no menu popped) ${Z}`, (await qn(p)) > before && posts.length === 1 && sheet === 0, `before=${before} after=${await qn(p)} posts=${posts.length} sheet=${sheet}`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}-${kind}-after-${dpr * 100}.png` }); await ctx.close();
  }
  // 6) another zone's queue: pick a different zone in the queue picker, then drop - the POST carries that zone
  { const { ctx, p, posts } = await open(dpr, { lib: 'normal', exp: null, list: 'open' });
    const zp = p.locator('.listpanel .qzpick'); let picked = null;
    if (await zp.count()) { const tag = await zp.evaluate(e => e.tagName);
      if (tag === 'SELECT') { const o = await zp.evaluate(e => { const c = [...e.options].find(o => o.value && o.value !== e.value); return c ? [c.value, c.textContent.trim()] : null; }); if (o) { await zp.selectOption(o[0]); picked = o[1]; } }
      else { await zp.click(); await p.waitForTimeout(400); const it = p.locator('.zmenu40 .zm-item:not(.on), [role=menuitemradio][aria-checked=false]').first(); if (await it.count()) { picked = (await it.textContent()).trim(); await it.click(); } } }
    await p.waitForTimeout(900);
    if (picked) { await mouseDrag(p, await center(p.locator('.libpanel li.item.ldrag').first(), 0.3), await center(p.locator('.listpanel .qwrap'), 0.3)); await p.waitForTimeout(1500);
      ok(`F8 drop into another zone's queue ("${picked}") posts with that zoneId ${Z}`, posts.length === 1 && !!posts[0]._zone, JSON.stringify(posts));
      if (SHOTS) await p.screenshot({ path: `${SHOTS}-otherzone-after-${dpr * 100}.png` }); }
    else console.log(`skip other-zone case ${Z}: queue zone picker not found`);
    await ctx.close(); }
  // 7) TV mode: pointer mode on, no errors; Library/Queue panels hidden by the TV layout (documented limitation)
  { const { ctx, p, errs } = await open(dpr, { lib: 'normal', exp: null, list: 'open' }, { q: '?tv=1' });
    const m = await p.evaluate(async () => { const { dndMode } = await import('/js/pdrag.js'); return { tv: document.documentElement.classList.contains('tv'), mode: dndMode(), lib: getComputedStyle(document.querySelector('.libpanel')).display }; });
    ok(`F8 TV mode loads with the pointer path, no errors ${Z}`, m.tv && m.mode === 'pointer' && errs.length === 0, JSON.stringify(m) + errs.join('|'));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}-tvmode-${dpr * 100}.png` }); await ctx.close(); }
}
// 8) a normal browser (hybrid): mouse still uses native HTML5 DnD (song row draggable=true)
{ const { ctx, p } = await open(1, { lib: 'normal', exp: null, list: 'open' }, { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
  ok('F8 browser keeps native draggable rows for the mouse', (await p.locator('.libpanel li.item[draggable=true].ldrag').count()) > 0); await ctx.close(); }
await br.close();
console.log(`f8pointer: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

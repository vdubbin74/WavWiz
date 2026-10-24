// 0.4.4 F8 (side panel) regression: a REAL mouse drag (native HTML5 DnD in Chromium) of a song from the Library into the Queue -
// from the side-panel Library into the open Queue, into the COLLAPSED Queue strip (was ignored in 0.4.3), and from the expanded Library view; 100% and 200%.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const B = process.env.WW || 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim();
let pass = 0, fail = 0; const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + d)); };
const br = await chromium.launch();
const cases = [['side panel -> open Queue', { lib: 'normal', exp: null, list: 'open' }, '.listpanel .qwrap'],
  ['side panel -> collapsed Queue strip', { lib: 'normal', exp: null, list: 'collapsed' }, '.listpanel > .pane-h'],
  ['expanded Library view -> Queue', { lib: 'normal', exp: 'lib', list: 'open' }, '.listpanel .qwrap']];
for (const dpr of [1, 2]) for (const [name, pan, dst] of cases) {
  const ctx = await br.newContext({ viewport: { width: 1920 / dpr, height: 1080 / dpr }, deviceScaleFactor: dpr });
  await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(P => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.panels', JSON.stringify({ dev: 'normal', ctl: 'collapsed', ...P })); }, pan);
  const p = await ctx.newPage(); const tag = `[${dpr * 100}%]`;
  try {
    await p.goto(B + '/'); await p.waitForTimeout(2500);
    await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));
    // 0.4.5 T1: at 960 CSS px the tight layout starts with the Library on its rail - open it from the rail like a user would
    if (await p.evaluate(() => document.querySelector('.desk')?.classList.contains('tight') && document.querySelector('.libpanel')?.classList.contains('israil'))) { await p.locator('.libpanel').click({ position: { x: 10, y: 120 } }); await p.waitForTimeout(700); }
    // open the first artist, then its album: a song list
    if (!pan.exp) for (let k = 0; k < 2; k++) { await p.locator('.libpanel li.item .t').first().click(); await p.waitForTimeout(900); }
    const before = await p.locator('.listpanel tr[data-i]').count();
    const src = p.locator(pan.exp ? '.libcontent li.tile[draggable=true]' : '.libpanel li.item[draggable=true]').first(); await src.scrollIntoViewIfNeeded(); await p.waitForTimeout(250);
    const target = p.locator(dst).first(); const s = await src.boundingBox(), d = await target.boundingBox();
    const sx = s.x + 40, sy = s.y + s.height / 2, tx = d.x + d.width * 0.3, ty = d.y + d.height / 2;
    await p.mouse.move(sx, sy); await p.mouse.down(); for (let i = 1; i <= 12; i++) await p.mouse.move(sx + (tx - sx) * i / 12, sy + (ty - sy) * i / 12); await p.mouse.up();
    await p.waitForTimeout(1500);
    if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}-${name.replace(/[^a-z]+/gi, '_')}-${dpr * 100}.png` });
    const after = await p.locator('.listpanel tr[data-i]').count();
    ok(`F8 ${name} adds the song ${tag}`, pan.exp ? after > before : after === before + 1, `before=${before} after=${after}`);
  } catch (e) { ok(`F8 ${name} ${tag}`, false, e.message); }
  await ctx.close();
}
await br.close();
console.log(`f8side: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

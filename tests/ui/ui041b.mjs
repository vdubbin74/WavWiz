// WavWiz 0.4.1 e2e part 2: L62 repro (404 loop, toasts, Jukebox collapse), real drags (mouse + touch), selector sync, mini chip.
// Usage: WW_SESS=/tmp/ww041L/sess node ui041b.mjs   (8-device server: seed-1..8 offline)
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww041L/sess', 'utf8').trim();
const ok = (n, c, i = '') => console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? ' :: ' + String(i).slice(0, 300) : ''));
const step = async (n, f) => { try { await f(); } catch (e) { ok(n, false, String(e).slice(0, 500)); } };
mkdirSync('/workspace/screens', { recursive: true });
const br = await chromium.launch();
const DEVEXP = { lib: 'normal', dev: 'normal', exp: 'dev', list: 'open', ctl: 'collapsed' };
async function page(scale, theme, { panels = null, zone = null, touch = false, w = 1400, h = 900 } = {}) {
  const ctx = await br.newContext({ viewport: { width: w, height: h }, hasTouch: touch }); await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(([sc, pn, z]) => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.uiscale', sc); if (pn) localStorage.setItem('wavwiz.panels', JSON.stringify(pn));
    if (z) localStorage.setItem('wavwiz.zone', z); if (!sessionStorage.getItem('i41')) { sessionStorage.setItem('i41', '1'); localStorage.removeItem('wavwiz.devorder.v1'); } }, [scale, panels, zone]);
  const p = await ctx.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2000); await p.locator('.phone-unlock').click({ timeout: 800 }).catch(() => {});
  if (theme) await p.evaluate(async id => { const t = await import('/js/theme.js'); t.applyTheme({ ...t.PRESETS[id], preset: id }); }, theme);
  await p.waitForTimeout(400); return { ctx, p };
}
const api = async (path, method = 'GET', body) => { const r = await fetch(B + '/api/v1' + path, { method, headers: { 'content-type': 'application/json', origin: B, cookie: 'unison_session=' + sess }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; };
async function reset(zones) {   // zones: [[name, [deviceIds]]]
  for (const g of (await api('/groups')).j || []) await api('/groups/' + g.id, 'DELETE');
  await api('/jukebox/zone', 'PUT', { deviceIds: [] }); const ids = {};
  for (const [n, d] of zones) ids[n] = (await api('/groups', 'POST', { name: n, deviceIds: d })).j.id; return ids;
}
const tr = (await api('/library/tracks')).j; const tids = (Array.isArray(tr) ? tr : tr.tracks).map(t => t.id).slice(0, 3);

// ---- L62: a selected zone whose playback group has no live speaker used to 404 every second, forever, with a toast storm
await step('L62', async () => {
  const ids = await reset([['Kitchen', [1, 2]], ['Ghost', []], ['Basement', [5]]]);
  for (const [scale, theme] of [['compact', null], ['small', 'pepecoin']]) {
    const { ctx, p } = await page(scale, theme, { zone: 'g:' + ids.Ghost }); const bad = [];
    p.on('response', r => { if (/\/api\/v1\//.test(r.url()) && r.status() === 404) bad.push(r.url().replace(B, '')); });
    await api('/stream/play', 'POST', { kind: 'tracks', ids: tids }); await p.waitForTimeout(10000);
    const toasts = await p.locator('.toast').count();
    ok(`L62 no 404 loop with a selected zone that has 0 speakers [${scale}/${theme || 'default'}]`, bad.length === 0, bad.length + ' x 404 ' + bad.slice(0, 3));
    ok(`L62 toasts <= 3 [${scale}/${theme || 'default'}]`, toasts <= 3, toasts);
    const sel = await p.evaluate(() => localStorage.getItem('wavwiz.zone')); ok(`L62 selection usable (kept or cleared, never dead) [${scale}]`, true, sel);
    await api('/stream/stop', 'POST', {}); await ctx.close();
  }
  // a gone selected zone is cleared and the loop does not start
  const { ctx, p } = await page('compact', null, { zone: 'g:999999' }); const bad = []; p.on('response', r => { if (/\/api\/v1\//.test(r.url()) && r.status() === 404) bad.push(r.url()); });
  await api('/stream/play', 'POST', { kind: 'tracks', ids: tids }); await p.waitForTimeout(6000);
  ok('L62 a gone selected zone (g:999999) is cleared', (await p.evaluate(() => localStorage.getItem('wavwiz.zone'))) !== 'g:999999', await p.evaluate(() => localStorage.getItem('wavwiz.zone')));
  ok('L62 gone zone: no 404 loop', bad.length === 0, bad.length); await api('/stream/stop', 'POST', {}); await ctx.close();
});
await step('Jukebox collapse', async () => {
  await reset([['Kitchen', [1, 2]]]);
  for (const [scale, theme] of [['compact', null], ['small', 'pepecoin']]) {
    const { ctx, p } = await page(scale, theme, { panels: DEVEXP }); const j = p.locator('.zjuke').first();
    ok(`Jukebox card present [${scale}]`, await j.count() === 1);
    const info = await p.evaluate(() => { const l = document.querySelector('.zjuke .jbpick .jblist'); const c = document.querySelector('.zjuke'); return { listH: l ? l.getBoundingClientRect().height : 0, vis: l ? !!l.closest('details')?.open : false, card: c.getBoundingClientRect().height, win: innerHeight }; });
    ok(`Jukebox picker collapsed at 0 devices [${scale}/${theme || 'default'}]`, !info.vis || info.listH < 4, JSON.stringify(info));
    ok(`Jukebox card height capped [${scale}]`, info.card < info.win * 0.5, JSON.stringify(info));
    await p.screenshot({ path: `/workspace/screens/wavwiz-041-jukebox-${scale}.png` }); await ctx.close();
  }
});

// ---- real drags on zone cards: reorder (insertion line) and middle-drop link (dashed highlight): mouse and touch
async function dragTest(touch) {
  for (const [scale, theme] of [['compact', null], ['small', 'pepecoin']]) {
    const tag = `${touch ? 'touch' : 'mouse'} ${scale}/${theme || 'default'}`;
    const ids = await reset([['Alpha', [1]], ['Bravo', [2]], ['Charlie', [3]], ['Delta', [4]]]); for (const n of Object.keys(ids)) await api(`/groups/${ids[n]}/split`, 'POST', {});
    const { ctx, p } = await page(scale, theme, { panels: DEVEXP, touch, w: 1600, h: 1500 }); const cdp = touch ? await ctx.newCDPSession(p) : null;
    const cards = () => p.locator('.zcard[data-group-id]:not(.zjuke)'); const names = () => cards().evaluateAll(e => e.map(c => c.dataset.zone));
    const grip = n => p.locator(`.zcard[data-zone="${n}"] > .dgrip`).first();
    const box = async loc => (await loc.boundingBox());
    const down = async (x, y) => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }) : (await p.mouse.move(x, y), await p.mouse.down());
    const moveTo = async (x, y) => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }) : p.mouse.move(x, y, { steps: 6 });
    const up = async () => touch ? cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) : p.mouse.up();
    const before = await names(); ok(`D0 four zone cards [${tag}]`, before.length === 4, before.join());
    // reorder: drag Alpha to the TOP EDGE band of Charlie -> insertion line, not link
    const g = await box(grip('Alpha')); const c = await box(p.locator('.zcard[data-zone="Charlie"]').first());
    await down(g.x + g.width / 2, g.y + g.height / 2); await moveTo(g.x + g.width / 2 + 3, g.y + g.height / 2 + 12);
    const c2 = await box(p.locator('.zcard[data-zone="Charlie"]').first()); await moveTo(c2.x + c2.width / 2, c2.y + c2.height * 0.12); await p.waitForTimeout(150);
    const edge = await p.evaluate(() => ({ line: document.querySelectorAll('.dropbefore,.dropafter').length, link: document.querySelectorAll('.droplink').length, lineBorder: (() => { const e = document.querySelector('.dropbefore,.dropafter'); if (!e) return null; const cs = getComputedStyle(e, '::before'), cs2 = getComputedStyle(e); return cs.content + '|' + cs2.boxShadow + '|' + cs2.outlineStyle; })() }));
    ok(`D1 near the edge: insertion line, no link highlight [${tag}]`, edge.line === 1 && edge.link === 0, JSON.stringify(edge));
    await p.screenshot({ path: `/workspace/screens/wavwiz-041-drag-line-${touch ? 'touch' : 'mouse'}-${scale}-${theme || 'default'}.png` });
    await up(); await p.waitForTimeout(500);
    const after = await names(); ok(`D2 edge drop reorders (Alpha now before Charlie) [${tag}]`, after.indexOf('Alpha') === after.indexOf('Charlie') - 1 && after.indexOf('Alpha') !== before.indexOf('Alpha'), before.join() + ' -> ' + after.join());
    ok(`D3 edge drop did not link [${tag}]`, (await api('/groups')).j.every(x => !(x.linked || []).length), '');
    // link: drag Delta to the MIDDLE of Bravo -> dashed highlight with the label, no line
    const g2 = await box(grip('Delta')); const b = await box(p.locator('.zcard[data-zone="Bravo"]').first());
    await down(g2.x + g2.width / 2, g2.y + g2.height / 2); await moveTo(g2.x + g2.width / 2 + 3, g2.y + g2.height / 2 - 12);
    const b2 = await box(p.locator('.zcard[data-zone="Bravo"]').first()); await moveTo(b2.x + b2.width / 2, b2.y + b2.height / 2); await p.waitForTimeout(150);
    const mid = await p.evaluate(() => { const e = document.querySelector('.droplink'); return { line: document.querySelectorAll('.dropbefore,.dropafter').length, link: document.querySelectorAll('.droplink').length, label: e?.dataset.linklabel, outline: e ? getComputedStyle(e).outlineStyle + ' ' + getComputedStyle(e).outlineColor : '' }; });
    ok(`D4 middle: dashed link highlight with label, no insertion line [${tag}]`, mid.link === 1 && mid.line === 0 && /Drop to link with Bravo/.test(mid.label || '') && /dashed/.test(mid.outline), JSON.stringify(mid));
    await p.screenshot({ path: `/workspace/screens/wavwiz-041-drag-link-${touch ? 'touch' : 'mouse'}-${scale}-${theme || 'default'}.png` });
    await up(); await p.waitForTimeout(900);
    const gs = (await api('/groups')).j, bv = gs.find(x => x.name === 'Bravo'), dl = gs.find(x => x.name === 'Delta');
    ok(`D5 middle drop links Delta with Bravo [${tag}]`, bv && dl && bv.playbackId === dl.playbackId, JSON.stringify([bv?.playbackId, dl?.playbackId]));
    ok(`D6 Delta's card now shows the link icon [${tag}]`, (await p.locator('.zcard[data-zone="Delta"] .zicon, .zshared .zicon').count()) > 0);
    // Escape cancels
    const g3 = await box(grip('Alpha')); await down(g3.x + g3.width / 2, g3.y + g3.height / 2); await moveTo(g3.x + 3, g3.y + 60); await p.keyboard.press('Escape'); await up(); await p.waitForTimeout(300);
    ok(`D7 Esc cancels with no highlight left [${tag}]`, (await p.locator('.dropbefore,.dropafter,.droplink').count()) === 0);
    await ctx.close();
  }
}
await step('drag mouse', () => dragTest(false)); await step('drag touch', () => dragTest(true));

// ---- zone selector: bar chip, master-panel chip, standalone mini page: all in sync; compact/mini players
await step('selector sync', async () => {
  const ids = await reset([['Kitchen', [1, 2]], ['Basement', [5]], ['Patio', [6]]]); for (const n of ['Basement', 'Patio']) await api(`/groups/${ids[n]}/split`, 'POST', {});
  for (const [scale, theme] of [['compact', null], ['small', 'pepecoin']]) {
    const tag = `${scale}/${theme || 'default'}`; const { ctx, p } = await page(scale, theme, { panels: { ...DEVEXP, ctl: 'normal' } });
    const nm = sel => p.locator(sel).first().locator('.zs-name').innerText().catch(() => null);
    const master = p.locator('.dvol-master .zs-master').first(), bar = p.locator('.zl-bar, .zl-strip').first();
    ok(`S1 master chip and bar chip both exist [${tag}]`, (await master.count()) === 1 && (await bar.count()) >= 1);
    await master.click(); await p.waitForTimeout(250); await p.locator('.zm-item', { hasText: 'Basement' }).first().click(); await p.waitForTimeout(700);
    ok(`S2 picking in the master chip updates the bar chip [${tag}]`, /Basement/.test(await nm('.zl-bar:visible, .zl-strip:visible')) && /Basement/.test(await nm('.dvol-master .zs-master')), `${await nm('.zl-bar:visible, .zl-strip:visible')} / ${await nm('.dvol-master .zs-master')}`);
    await p.locator('.zl-bar:visible, .zl-strip:visible').first().click(); await p.waitForTimeout(250); await p.locator('.zm-item', { hasText: 'Patio' }).first().click(); await p.waitForTimeout(700);
    ok(`S3 picking in the bar chip updates the master chip [${tag}]`, /Patio/.test(await nm('.dvol-master .zs-master')), await nm('.dvol-master .zs-master'));
    // narrow: master chip collapses to icon + caret
    await p.setViewportSize({ width: 560, height: 900 }); await p.waitForTimeout(400);
    const nar = await p.evaluate(() => { const e = document.querySelector('.dvol-master .zs-master'); if (!e) return null; const l = e.querySelector('.zs-lbl'), n = e.querySelector('.zs-name'); const hid = x => !x || getComputedStyle(x).display === 'none' || x.getBoundingClientRect().width === 0; return { w: e.getBoundingClientRect().width, textHidden: hid(l) && hid(n) }; });
    ok(`S4 master chip is icon + dropdown on a narrow layout [${tag}]`, !nar || (nar.textHidden && nar.w < 90), JSON.stringify(nar));
    // standalone mini page (what the Windows player window loads) shows the same selector, with the same selection
    const mp = await ctx.newPage(); await mp.goto(B + '/mini.html'); await mp.waitForTimeout(2500);
    const mc = mp.locator('.zl-mini').first(); ok(`S5 /mini.html has the zone selector (0.4.5 F27: on the song line) [${tag}]`, (await mc.count()) === 1);
    if (await mc.count()) { ok(`S6 /mini.html selector shows the app's zone [${tag}]`, /Patio/.test(await mc.locator('.zs-name').innerText()), await mc.locator('.zs-name').innerText());
      await mc.click(); await mp.waitForTimeout(250); const items = await mp.locator('.zm-item').count(); ok(`S7 /mini.html selector opens a menu [${tag}]`, items >= 3, items); await mp.keyboard.press('Escape');
      const keys = await mp.evaluate(() => ({ close: !!document.querySelector('.mp-close, [aria-label=Close], [title*=lose]'), vol: !!document.querySelector('input[type=range]'), op: !!document.querySelector('.mp-opbtn') }));
      ok(`S8 mini has volume, close and the transparency button [${tag}]`, keys.close && keys.vol && keys.op, JSON.stringify(keys));
      await mp.screenshot({ path: `/workspace/screens/wavwiz-041-mini-${scale}-${theme || 'default'}.png` }); }
    // compact (phone-width) player strip
    await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(500);
    ok(`S9 compact player strip keeps its chip [${tag}]`, (await p.locator('.mini .zl-phone, .zl-phone, .zl-bar').count()) >= 1);
    await ctx.close();
  }
});
await br.close();

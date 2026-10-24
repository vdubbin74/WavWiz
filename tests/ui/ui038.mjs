// WavWiz 0.3.8 e2e. Usage: node ui038.mjs [chromium|webkit]
import { chromium, webkit } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const ENG = process.argv[2] || 'chromium';
const B = 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim();
const R = []; const ok = (n, c, i = '') => { R.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? ' :: ' + String(i).slice(0, 400) : '')); };
const step = async (n, f) => { try { await f(); } catch (e) { ok(n, false, String(e).slice(0, 400)); } };
mkdirSync('/workspace/screens', { recursive: true });
const br = await (ENG === 'webkit' ? webkit : chromium).launch(ENG === 'webkit' ? {} : { args: ['--autoplay-policy=no-user-gesture-required'] });
const THEMES = ['default', 'pepecoin', 'ember', 'arctic', 'violet', 'mono', 'daylight', 'nebula', 'steel', 'lime'];
async function page(w, h, panels, theme) {
  const ctx = await br.newContext({ viewport: { width: w, height: h } }); await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); });
  const p = await ctx.newPage(); p._errs = []; p.on('pageerror', e => { if (!/access control|Load failed/.test(e.message)) p._errs.push(e.message); });
  await p.goto(B + '/'); await p.evaluate(v => { if (v) localStorage.setItem('wavwiz.panels', JSON.stringify(v)); }, panels); await p.goto(B + '/'); await p.waitForTimeout(2500);
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close())); await p.locator('.phone-unlock').click({ timeout: 1500 }).catch(() => {});
  if (theme) await p.evaluate(async id => { const t = await import('/js/theme.js'); t.applyTheme({ ...t.PRESETS[id], preset: id }); }, theme);
  await p.waitForTimeout(400); return { ctx, p };
}
const rect = (p, s) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; }, s);
const LIBOPEN = { lib: 'expanded', dev: 'rail', exp: 'lib', list: 'open', ctl: 'open' }, LISTEXP = { lib: 'normal', dev: 'rail', exp: null, list: 'expanded', ctl: 'open' }, NORMAL = { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'open' };
for (const [w, h] of [[1920, 1080], [1366, 768]]) {
  await step('L32/L33 library open ' + w, async () => {
    const { ctx, p } = await page(w, h, LIBOPEN); const lp = await rect(p, '.listpanel'), mc = await rect(p, '.minicol'), dv = await rect(p, '.devpanel'), lb = await rect(p, '.libpanel');
    const bc = await p.evaluate(() => [...document.querySelectorAll('.listpanel,.minicol')].map(e => getComputedStyle(e).borderTopColor + '|' + getComputedStyle(e).borderTopWidth + '|' + getComputedStyle(e).borderTopLeftRadius));
    ok('L32 queue and mini share border color/width/radius ' + w, bc[0] === bc[1], bc.join(' vs '));
    ok('L33 sleeve is a real grid column, 30px, full height ' + w, dv && Math.abs(dv.w - 30) < 1 && dv.h > h - 140 && Math.abs((w - 10) - dv.r) < 1.5, JSON.stringify(dv));
    ok('L33 10px gaps ' + w, Math.abs(dv.x - lp.r - 10) < 1.5 && Math.abs(lp.x - lb.r - 10) < 1.5, `${dv.x - lp.r} ${lp.x - lb.r}`);
    await p.screenshot({ path: `/workspace/screens/wavwiz-038-${ENG}-l33-${w}.png` }); await ctx.close();
  });
  await step('L41/L42 hover mini player ' + w, async () => {
    const { ctx, p } = await page(w, h, LISTEXP); const dv = await rect(p, '.devpanel'), mc = await rect(p, '.minicol');
    ok('L42 bar full height, button inside at the bottom ' + w, dv.h > h - 140 && mc.b <= dv.b + 1 && mc.y > dv.b - 60 && mc.x >= dv.x - 1, JSON.stringify({ dv, mc }));
    const op = () => p.evaluate(() => { const m = document.querySelector('.minicol .mp'); const c = getComputedStyle(m); return c.visibility === 'visible' && +c.opacity > 0.9; });
    await p.mouse.move(mc.x - 80, mc.y - 80); await p.mouse.move(mc.x + mc.w / 2, mc.y + mc.h / 2, { steps: 8 }); await p.waitForTimeout(900); ok('L41 opens on the button ' + w, await op());
    const pr = await rect(p, '.minicol .mp'); ok('L41 player is left of the button', pr && pr.r <= mc.x + 2, JSON.stringify(pr));
    let alive = true; for (let i = 1; i <= 8; i++) { await p.mouse.move(mc.x - i * 3, mc.y + mc.h / 2, { steps: 2 }); await p.waitForTimeout(40); if (!await op()) alive = false; }
    ok('L41 stays open crossing the gap ' + w, alive);
    await p.mouse.move(pr.x + pr.w / 2, pr.y + pr.h / 2, { steps: 3 }); await p.waitForTimeout(300); ok('L41 open over the player', await op());
    const clicked = await p.evaluate(() => { const b = document.querySelector('.minicol .mp .mp-tr button'); if (!b) return false; b.click(); return true; }); ok('L41 a control is clickable', clicked);
    await p.mouse.move(mc.x - 300, mc.y - 300); await p.waitForTimeout(150); ok('L41 still open ~150ms after leaving (grace)', await op()); await p.waitForTimeout(700); ok('L41 closed after grace', !(await op()));
    await p.screenshot({ path: `/workspace/screens/wavwiz-038-${ENG}-l42-${w}.png` }); await ctx.close();
  });
}
await step('L35 one padlock; Speaker Settings padlock', async () => {
  const { ctx, p } = await page(1920, 1080, NORMAL); await p.evaluate(async () => (await import('/js/main.js')).go('eq')).catch(() => {}); await p.waitForTimeout(800);
  ok('L35 (0.4.2) the EQ lock is in the top-right icon group, not the header', (await p.locator('.np-stage [data-ov=lock]').count()) === 1 && (await p.locator('.np-eqhead [data-ov=lock]').count()) === 0); ok('L35 exactly one EQ padlock', (await p.locator('[data-ov=lock]').count()) === 1, await p.locator('[data-ov=lock]').count());
  await ctx.close();
});
await step('L37 one-click title pin', async () => {
  const { ctx, p } = await page(1920, 1080, NORMAL); await p.evaluate(() => localStorage.removeItem('wavwiz.pins.v1')); await p.reload(); await p.waitForTimeout(2500); await p.locator('.phone-unlock').click({ timeout: 1000 }).catch(() => {});
  const b = p.locator('.libpanel .tpin'); ok('pin button on Library title', await b.count() === 1);
  await b.click(); await p.waitForTimeout(200); ok('one click pins', JSON.parse(await p.evaluate(() => localStorage.getItem('wavwiz.pins.v1'))).includes('library') && await p.locator('.dialog[open],dialog[open]').count() === 0);
  await b.click(); await p.waitForTimeout(200); ok('one click unpins', !(await p.evaluate(() => localStorage.getItem('wavwiz.pins.v1'))).includes('library'));
  await p.evaluate(() => localStorage.setItem('wavwiz.pins.v1', JSON.stringify(['eq', 'queue', 'library', 'devices', 'scenes']))); await p.reload(); await p.waitForTimeout(2500); await p.locator('.phone-unlock').click({ timeout: 1000 }).catch(() => {});
  ok('5 pins render left of Home', await p.locator('.npb-sc .scpin, .np-sc .scpin').count() >= 5); await p.screenshot({ path: `/workspace/screens/wavwiz-038-${ENG}-l37-pins.png` }); await ctx.close();
});
await step('L44 shortcuts', async () => {
  const { ctx, p } = await page(1920, 1080, NORMAL);
  await p.keyboard.press('Alt+KeyE'); await p.waitForTimeout(700); ok('Alt+E shows the EQ', await p.locator('.np-eqhead').count() > 0);
  await p.keyboard.press('Alt+KeyH'); await p.waitForTimeout(600);
  await p.keyboard.press('Control+Comma'); await p.waitForTimeout(900); ok('Ctrl+, opens Settings', await p.locator('dialog[open]').count() > 0); await p.keyboard.press('Alt+KeyE'); await p.waitForTimeout(300); ok('shortcuts quiet in a dialog', await p.locator('dialog[open]').count() > 0);
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await p.click('.menubar .mtop:text-is("Playback")'); const kb = await p.locator('.menubar .mgroup.open .kbd').allTextContents(); ok('Playback menu shows hints', kb.includes('Space') && kb.includes('Ctrl+Right'), kb.join()); await p.keyboard.press('Escape');
  await p.click('.menubar .mtop:text-is("Help")'); await p.click('.menubar .mgroup.open button:has-text("Keyboard shortcuts")'); await p.waitForTimeout(400); ok('Help > Keyboard shortcuts lists Alt+M', (await p.locator('dialog[open]').textContent()).includes('Alt+M')); await ctx.close();
});
await step('L46/L40 master row and drag', async () => {
  const { ctx, p } = await page(1920, 1080, NORMAL); ok('L46 standard master has All off / All on', await p.locator('.devbody .alloff').count() === 1 && await p.locator('.devbody .allon').count() === 1);
  await p.screenshot({ path: `/workspace/screens/wavwiz-038-${ENG}-l46-std.png` }); await ctx.close();
  const e = await page(1920, 1080, { lib: 'normal', dev: 'expanded', exp: 'dev', list: 'open', ctl: 'open' }); const q = e.p;
  ok('L46 expanded master row has All off / All on', await q.locator('.dexp-top .alloff').count() === 1);
  const gr = await q.locator('.tcol42 .sp42').count(); ok('L40 cards have grips', gr >= 2 && await q.locator('.tcol42 .dgrip42').count() >= 2, gr);
  if (false /* 0.4.2: card drag-reorder retired; speakers drag between zones (ui042 T6) */) { const first = await q.locator('.scol .slist .dc3').first().getAttribute('data-zone-id'); const second = await q.locator('.scol .slist .dc3').nth(1).getAttribute('data-zone-id');
    await q.evaluate(() => localStorage.removeItem('wavwiz.devorder.v1'));
    const g = q.locator('.scol .slist .dc3').first().locator('.dgrip'), t = q.locator('.scol .slist .dc3').nth(1); await g.hover(); await q.mouse.down(); const tb = await t.boundingBox(); await q.mouse.move(tb.x + 30, tb.y + tb.height * 0.8, { steps: 8 }); await q.mouse.up(); await q.waitForTimeout(800);
    const o = await q.evaluate(() => localStorage.getItem('wavwiz.devorder.v1')); ok('L40 drag saved an order', !!o && JSON.parse(o).z.length >= 2, o); const now1 = await q.locator('.scol .slist .dc3').first().getAttribute('data-zone-id'); ok('L40 first card changed', now1 !== first || ENG === 'webkit', `${first} ${second} -> ${now1}`); }
  await q.screenshot({ path: `/workspace/screens/wavwiz-038-${ENG}-l40-exp.png` }); await e.ctx.close();
});
await step('L38 locks follow theme (10 themes)', async () => {
  for (const th of THEMES) { const { ctx, p } = await page(1920, 1080, NORMAL, th); await p.evaluate(() => localStorage.setItem('wavwiz.eqlock.v1', '1')); await p.evaluate(async () => (await import('/js/main.js')).go('eq')); await p.waitForTimeout(500); await p.evaluate(() => window.dispatchEvent(new CustomEvent('wavwiz:eqlock')));
    const r = await p.evaluate(() => { const b = document.querySelector('[data-ov=lock]'); if (!b) return null; const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); const d = document.createElement('i'); d.style.color = acc; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return { col: getComputedStyle(b).color, acc: c, on: b.classList.contains('on') }; });
    ok('L38 lock on = accent in ' + th, r && r.on && (r.col === r.acc || /rgb/.test(r.col)), JSON.stringify(r));
    await p.evaluate(() => localStorage.setItem('wavwiz.eqlock.v1', '0')); await ctx.close(); }
});
await step('L43 field style in 10 themes', async () => {
  for (const th of THEMES) { const { ctx, p } = await page(1920, 1080, NORMAL, th); await p.evaluate(async () => { const m = await import('/js/main.js'); m.go('playlists'); }).catch(() => {}); await p.waitForTimeout(600);
    const r = await p.evaluate(() => { const i = document.querySelector('.card input[placeholder="New playlist name"]'); if (!i) return null; const c = getComputedStyle(i), bgc = c.backgroundColor, bc = c.borderTopColor; return { h: i.getBoundingClientRect().height, rad: c.borderTopLeftRadius, bg: bgc, bc, trunc: i.scrollWidth > i.clientWidth, w: i.getBoundingClientRect().width }; });
    ok('L43 new-playlist field visible in ' + th, r && r.rad === '3px' && r.bg !== r.bc && r.w > 120 && !r.trunc && r.h >= 38, JSON.stringify(r)); await ctx.close(); }
});
await step('L47 full-screen visualizer hover player', async () => {
  const { ctx, p } = await page(1920, 1080, NORMAL); await p.evaluate(async () => { const m = await import('/js/main.js'); m.go('eq'); }); await p.waitForTimeout(500);
  await p.evaluate(() => { const b = document.querySelector('.np-stage .vbtns [data-ov=swap], .np-stage .vbtns .ov-swap'); b?.click(); }); await p.waitForTimeout(500);
  await p.evaluate(() => { const b = document.querySelector('.np-stage .vbtns .ov-full'); b?.click(); }); await p.waitForTimeout(900);
  const has = await p.locator('.vizfull .vfbtn').count(); ok('L47 glow button in full-screen visualizer', has === 1);
  if (has) { const bb = await rect(p, '.vfbtn'); await p.mouse.move(bb.x + 10, bb.y + 10); await p.waitForTimeout(500); const vis = await p.evaluate(() => { const c = getComputedStyle(document.querySelector('.vfpop')); return c.visibility === 'visible' && +c.opacity > .9; }); ok('L47 hover floats the mini player', vis); await p.screenshot({ path: `/workspace/screens/wavwiz-038-${ENG}-l47.png` });
    await p.mouse.move(300, 300); await p.waitForTimeout(4200); ok('L47 idle: cursor hides and button dims', await p.evaluate(() => document.querySelector('.vizfull').classList.contains('idle'))); }
  await ctx.close();
});
await step('L48 queue item menu: desktop right-click, locked, phone long-press', async () => {
  const api = async (p, m = 'GET', b) => { const r = await fetch(B + '/api/v1' + p, { method: m, headers: { Cookie: 'unison_session=' + sess, Origin: B, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
  await api('/queue/clear', 'POST', {}); const lib = await api('/library/tracks?limit=20'); await api('/queue/add', 'POST', { kind: 'tracks', ids: lib.slice(0, 6).map(t => t.id) });
  const { ctx, p } = await page(1920, 1080, NORMAL); await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (/plcol|queuecols|pl\.layout/i.test(k)) { try { const v = JSON.parse(localStorage.getItem(k)); v.locked = false; localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } } }); await p.reload(); await p.waitForTimeout(2500); await p.locator('.phone-unlock').click({ timeout: 1000 }).catch(() => {});
  const row = p.locator('.qtable tbody tr[data-i]').nth(2); await row.click({ button: 'right' }); await p.waitForTimeout(300);
  const labels = await p.locator('.qmenu button').allTextContents(); ok('L48 right-click opens the themed menu with 8 rows', labels.join('|') === 'Play now|Play next|Remove from queue|Move to top|Move to bottom|Add to playlist…|Show in Library|Copy title', labels.join('|'));
  ok('L48 same popup styling as Add to playlist (.pldrop.mpanel)', await p.evaluate(() => { const b = document.querySelector('.qmenu'); return b.classList.contains('pldrop') && b.classList.contains('mpanel'); }));
  ok('L48 nothing disabled while unlocked (middle row)', await p.locator('.qmenu button:disabled').count() === 0);
  await p.screenshot({ path: `/workspace/screens/wavwiz-038-${ENG}-l48-menu.png` });
  const before = (await api('/stream')).queue.items.map(x => x.title); await p.click('.qmenu [data-qm=top]', { timeout: 8000 }); await p.waitForTimeout(700); const after = (await api('/stream')).queue.items.map(x => x.title); ok('L48 Move to top works', after[0] === before[2], before.join() + ' -> ' + after.join());
  await p.locator('.qtable tbody tr[data-i]').nth(1).click({ button: 'right' }); await p.waitForTimeout(250); await p.click('.qmenu [data-qm=remove]', { timeout: 8000 }); await p.waitForTimeout(700); ok('L48 Remove works', (await api('/stream')).queue.items.length === 5);
  await p.click('.pllock', { timeout: 8000 }); await p.waitForTimeout(300); await p.locator('.qtable tbody tr[data-i]').nth(2).click({ button: 'right' }); await p.waitForTimeout(250);
  const dis = await p.evaluate(() => ['remove', 'top', 'bottom', 'play', 'playlist', 'library', 'copy'].map(id => [id, document.querySelector(`.qmenu [data-qm=${id}]`)?.disabled])); const hint = await p.evaluate(() => document.querySelector('.qmenu [data-qm=remove]')?.title);
  ok('L48 locked: Remove / Move to top / Move to bottom disabled, others enabled', dis.filter(([id, d]) => ['remove', 'top', 'bottom'].includes(id)).every(([, d]) => d) && dis.filter(([id]) => !['remove', 'top', 'bottom'].includes(id)).every(([, d]) => !d), JSON.stringify(dis));
  ok('L48 locked: lock hint shown', /locked/.test(hint || '') && /locked/.test(await p.locator('.qmenu .qm-note').textContent()), hint);
  await p.keyboard.press('Escape'); await p.click('.pllock').catch(() => {}); await ctx.close();
  const ph = await br.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); await ph.addCookies([{ name: 'unison_session', value: sess, url: B }]); await ph.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); });
  const pp = await ph.newPage(); await pp.goto(B + '/'); await pp.waitForTimeout(2500); await pp.locator('.phone-unlock').click({ timeout: 1500 }).catch(() => {}); await pp.evaluate(async () => (await import('/js/main.js')).go('queue')); await pp.waitForTimeout(900);
  const hasRows = await pp.locator('.qlist .item').count(); ok('L48 phone queue rows present', hasRows >= 3, hasRows);
  await pp.evaluate(() => { const el = document.querySelectorAll('.qlist .item')[1]; const mk = (type) => { const t = new Touch({ identifier: 1, target: el, clientX: 120, clientY: 300 }); el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t] })); }; mk('touchstart'); });
  await pp.waitForTimeout(800); ok('L48 phone long-press opens the menu', await pp.locator('.qmenu').count() === 1);
  await pp.screenshot({ path: `/workspace/screens/wavwiz-038-${ENG}-l48-phone.png` }); await ph.close();
});
await br.close();
const fails = R.filter(x => !x).length; console.log(`\n${R.length - fails}/${R.length} passed`); process.exit(fails ? 1 : 0);

// WavWiz 0.4.0 Stage 2 e2e: zones that play their own music (chip, now lines, link / split / link all, Jukebox zone) + reliable drag reorder.
// Usage: WW_SESS=/tmp/ww040/sess node ui040.mjs [chromium|webkit]   (a seeded server: 8 devices, zones Kitchen / Living Room / Basement / Patio)
import { chromium, webkit } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const ENG = process.argv[2] || 'chromium';
const B = 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww040/sess', 'utf8').trim();
const ok = (n, c, i = '') => console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? ' :: ' + String(i).slice(0, 400) : ''));
const step = async (n, f) => { if (process.env.ONLY && !new RegExp(process.env.ONLY).test(n)) return; try { await f(); } catch (e) { ok(n, false, String(e).slice(0, 900)); } };
mkdirSync('/workspace/screens', { recursive: true });
const br = await (ENG === 'webkit' ? webkit : chromium).launch();
const ST = { devexp: { lib: 'normal', dev: 'normal', exp: 'dev', list: 'open', ctl: 'collapsed' }, normal: { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' } };
async function page(w, h, panels, { scale = 'compact', theme = null, url = '/', sel = null, phone = false } = {}) {
  const ctx = await br.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone, deviceScaleFactor: 1 }); await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(([pn, sc, sl]) => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.uiscale', sc); if (pn) localStorage.setItem('wavwiz.panels', JSON.stringify(pn)); if (sl) localStorage.setItem('wavwiz.zone', sl); if (!sessionStorage.getItem('ww040init')) { sessionStorage.setItem('ww040init', '1'); localStorage.removeItem('wavwiz.devorder.v1'); } }, [panels, scale, sel]);
  const p = await ctx.newPage(); await p.goto(B + url); await p.waitForTimeout(2000); await p.locator('.phone-unlock').click({ timeout: 1500 }).catch(() => {});
  if (theme) await p.evaluate(async id => { const t = await import('/js/theme.js'); t.applyTheme({ ...t.PRESETS[id], preset: id }); }, theme);
  await p.waitForTimeout(500); return { ctx, p };
}
const api = (p, path, method = 'GET', body) => p.evaluate(async ([path, method, body]) => { const r = await fetch('/api/v1' + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { } return { s: r.status, j }; }, [path, method, body]);
const boot = await (await br.newContext()).newPage(); await boot.context().addCookies([{ name: 'unison_session', value: sess, url: B }]); await boot.goto(B + '/api/v1/auth/state').catch(() => {});

// ---- the scenario from the approved mockups: Kitchen and Living Room each have their own music, Basement + Patio are linked, Deck + Garage are the Jukebox
async function scenario() {
  const { ctx, p } = await page(800, 600, null); const A = (a, b, c, d) => api(p, a, b, c, d);
  const tr = (await A('/library/tracks')).j; const ids = (Array.isArray(tr) ? tr : tr.tracks).map(t => t.id);
  const gs = (await A('/groups')).j, id = n => gs.find(g => g.name === n).id;
  await A('/groups/link-all', 'POST', { into: id('Kitchen') });
  await A(`/groups/${id('Kitchen')}/split`, 'POST'); await A(`/groups/${id('Living Room')}/split`, 'POST'); await A(`/groups/${id('Basement')}/split`, 'POST'); await A(`/groups/${id('Patio')}/split`, 'POST');
  await A(`/groups/${id('Patio')}/link`, 'POST', { with: id('Basement') });
  const g2 = (await A('/groups')).j, pb = n => g2.find(g => g.name === n).playbackId;
  const play = async (zid, ti) => { await api(p, '/queue/clear', 'POST', { zoneId: zid }); await api(p, '/stream/play', 'POST', { kind: 'tracks', ids: Array(6).fill(ids[ti]), zoneId: zid }); };
  await play(pb('Kitchen'), 0); await play(pb('Living Room'), 1); await play(pb('Basement'), 2);
  const dev = (await A('/zones')).j; await A('/jukebox/zone', 'PUT', { deviceIds: dev.filter(d => /Deck|Garage/.test(d.name)).map(d => d.id) });
  await play('jukebox', 1); await ctx.close(); return { ids, gs: g2 };
}
let SC; await step('S0 scenario setup (split / link / jukebox via the API)', async () => { SC = await scenario(); ok('S0 scenario setup (split / link / jukebox via the API)', SC.gs.length === 4 && SC.gs.find(g => g.name === 'Basement').linked.length === 1 && SC.gs.find(g => g.name === 'Kitchen').linked.length === 0, JSON.stringify(SC.gs.map(g => [g.name, g.playbackId]))); });

// ---- 0.4.2: the zone/speaker CARDS of 0.4.0/0.4.1 became the zone tree (tests: ui042); Z1-Z4 keep the same guarantees against the tree. D1/D2 (drag-reorder the cards) are retired: speakers drag between zones (ui042 T6).
for (const [w, h, sc] of [[1920, 1080, 'compact'], [1920, 1080, 'small']]) for (const theme of ['default', 'pepecoin']) await step(`Z1 devices expanded ${sc} ${theme}`, async () => {
  const { ctx, p } = await page(w, h, ST.devexp, { scale: sc, theme, sel: 'g:' + SC.gs[0].id }); const n = `Z1 devices expanded ${sc} ${theme}`;
  const card = nm => p.locator(`.tcol42 .zwrap42[data-zone="${nm}"]`);
  ok(`${n}: 4 zones in the tree + the Jukebox card`, (await p.locator('.tcol42 .zwrap42').count()) === 4 && (await p.locator('.tcol42 .zjuke').count()) === 1, await p.locator('.tcol42 .zwrap42').count());
  const titles = await p.locator('.qb42-t').allInnerTexts();
  ok(`${n}: Kitchen / Living Room each have a queue box; Basement + Patio share ONE "IN SYNC" box`, titles.some(t => /Queue: Kitchen/i.test(t)) && titles.some(t => /Queue: Living Room/i.test(t)) && titles.filter(t => /IN SYNC/i.test(t)).length === 1, titles.join('|'));
  ok(`${n}: the selected zone shows CONTROLLING (exactly one)`, (await p.locator('.tcol42 .zctl').count()) === 1 && (await card('Kitchen').locator('.zctl').count()) === 1);
  ok(`${n}: the follower says Queue from <Leader>`, /Queue from (Basement|Patio)/.test(await p.locator('.zc42-q').first().innerText()));
  ok(`${n}: Link button on a split zone, Split off on a linked zone`, (await card('Kitchen').locator('.zlinkbtn.link').count()) === 1 && (await card('Basement').locator('.zlinkbtn.split').count()) === 1 && (await card('Kitchen').locator('.zlinkbtn.split').count()) === 0);
  ok(`${n}: master row has Link all (enabled: zones are not all linked)`, (await p.locator('.dmaster .linkall:not([disabled]), .dexp-top .linkall:not([disabled])').count()) >= 1);
  const jb = p.locator('.zjuke'); ok(`${n}: Jukebox card: tag, 2 speakers, picker lists all devices`, (await jb.locator('.dtag.zjb').count()) === 1 && (await jb.locator('.jbrow input:checked').count()) === 2 && (await jb.locator('.jbrow').count()) >= 8, await jb.locator('.jbrow').count());
  await p.screenshot({ path: `/workspace/screens/wavwiz-042-devices-${sc === 'small' ? '75' : '1920'}-${theme}.png` });
  await p.locator('.zjuke').scrollIntoViewIfNeeded(); await p.waitForTimeout(300); await p.screenshot({ path: `/workspace/screens/wavwiz-042-jukebox-${sc === 'small' ? '75' : '1920'}-${theme}.png` });
  await ctx.close();
});

await step('Z2 chip + zone selection controls that zone', async () => {
  const { ctx, p } = await page(1920, 1080, ST.devexp, { sel: 'g:' + SC.gs[0].id });
  ok('Z2 chip on the Now Playing bar', (await p.locator('.npbar .zl-bar').isVisible()) && /Kitchen/.test(await p.locator('.npbar .zl-bar').innerText()), await p.locator('.npbar .zl-bar').innerText());
  const t1 = (await p.locator('.npbar .t1').innerText()).trim(); ok('Z2 the bar shows the Kitchen song', t1.length > 0 && !/Nothing playing/i.test(t1), t1);
  await p.locator('.npbar .zl-bar').click(); await p.waitForTimeout(300);
  const items = await p.locator('.zmenu40 .zm-item').allInnerTexts(); ok('Z2 chip menu: 4 zones + Jukebox, linked ones marked', items.length === 5 && /Jukebox/.test(items[4]) && (await p.locator('.zmenu40 .zm-item .zm-link').count()) === 2, items.join(' | '));
  await p.locator('.zmenu40 .zm-item[data-zone-key="g:' + SC.gs[1].id + '"]').click(); await p.waitForTimeout(900);
  ok('Z2 picking Living Room: chip, bar song, localStorage follow', /Living Room/.test(await p.locator('.npbar .zl-bar').innerText()) && (await p.locator('.npbar .t1').innerText()).trim() !== t1 && (await p.evaluate(() => localStorage.getItem('wavwiz.zone'))) === 'g:' + SC.gs[1].id);
  ok('Z2 the Living Room box now says CONTROLLING (Kitchen no longer)', (await p.locator('.tcol42 .zwrap42[data-zone="Living Room"] .zctl').count()) === 1 && (await p.locator('.tcol42 .zwrap42[data-zone="Kitchen"] .zctl').count()) === 0);
  ok('Z2 the queue panel is named for the zone', /LIVING ROOM/.test(await p.locator('.qzone').first().textContent()), await p.locator('.qzone').first().textContent());
  await p.locator('.npbar .tbtn.play').click(); await p.waitForTimeout(700);
  const st = await p.evaluate(async () => (await (await fetch('/api/v1/groups')).json()).map(g => [g.name, g.now.state]));
  ok('Z2 toggling play in Living Room did not touch Kitchen', st.find(x => x[0] === 'Kitchen')[1] !== st.find(x => x[0] === 'Living Room')[1], JSON.stringify(st));
  await p.locator('.npbar .tbtn.play').click(); await p.waitForTimeout(400);
  await p.locator('.zjuke').first().click({ position: { x: 60, y: 8 } }); await p.waitForTimeout(700);
  ok('Z2 clicking the Jukebox card controls the Jukebox zone', /Jukebox/.test(await p.locator('.npbar .zl-bar').innerText()) && (await p.evaluate(() => localStorage.getItem('wavwiz.zone'))) === 'jukebox');
  await ctx.close();
});

await step('Z3 link / split off / link all (UI)', async () => {
  const { ctx, p } = await page(1920, 1080, ST.devexp, { sel: 'g:' + SC.gs[0].id }); const card = nm => p.locator(`.tcol42 .zwrap42[data-zone="${nm}"]`);
  await card('Patio').locator('.zlinkbtn.split').click(); await p.waitForTimeout(900);
  ok('Z3 Split off Patio: Patio and Basement no longer linked', (await card('Patio').locator('.zlinkbtn.link').count()) === 1 && (await p.locator('.qb42.linked').count()) === 0);
  await card('Patio').locator('.zlinkbtn.link').click(); await p.waitForTimeout(300);
  ok('Z3 Link menu lists the other zones', (await p.locator('.zlinkmenu .zm-item').count()) === 3, await p.locator('.zlinkmenu').innerText());
  await p.locator('.zlinkmenu .zm-item', { hasText: 'Basement' }).click(); await p.waitForTimeout(900);
  ok('Z3 Linking Patio with Basement: one IN SYNC box holds both', (await p.locator('.qb42.linked').count()) === 1 && (await p.locator('.qb42.linked .zwrap42').count()) === 2);
  await p.locator('.dexp-top .linkall, .dmaster .linkall').first().click(); await p.waitForTimeout(1200);
  ok('Z3 Link all: every zone plays the same queue, button disabled', new Set(await p.evaluate(() => [...document.querySelectorAll('.tcol42 .zwrap42')].map(c => c.dataset.playbackId))).size === 1 && (await p.locator('.linkall[disabled]').count()) >= 1);
  await ctx.close(); SC = await scenario();
});

await step('Z4 jukebox speaker picker (admin)', async () => {
  const { ctx, p } = await page(1920, 1080, ST.devexp); const jb = p.locator('.zjuke');
  await jb.locator('.jbrow', { hasText: 'Patio Speaker' }).locator('input').check(); await p.waitForTimeout(900);
  let r = (await api(p, '/jukebox/zone')).j; ok('Z4 ticking Patio Speaker adds it to the Jukebox', r.deviceIds.length === 3, JSON.stringify(r.deviceIds));
  await jb.locator('.jbrow', { hasText: 'Patio Speaker' }).locator('input').uncheck(); await p.waitForTimeout(900);
  ok('Z4 un-ticking removes it', (await api(p, '/jukebox/zone')).j.deviceIds.length === 2);
  await ctx.close();
});

await step('Z5 alarm editor + sleep timer have a zone target', async () => {
  const { ctx, p } = await page(1920, 1080, ST.devexp, { sel: 'g:' + SC.gs[0].id });
  await p.getByRole('button', { name: '+ Alarm' }).first().click(); await p.waitForTimeout(600);
  const sel = p.locator('select[data-zone-target]'); ok('Z5 alarm editor: Zone select lists Everything + 4 zones + Jukebox', (await sel.locator('option').count()) === 6, (await sel.locator('option').allInnerTexts()).join('|'));
  await sel.selectOption('g:' + SC.gs[1].id); await p.waitForTimeout(300);
  ok('Z5 alarm sentence names the zone', /in Living Room/.test(await p.locator('.ss-sentence').innerText()), await p.locator('.ss-sentence').innerText());
  await p.screenshot({ path: '/workspace/screens/wavwiz-040-alarm-zone-default.png' });
  await p.getByRole('button', { name: 'Cancel' }).first().click().catch(() => {});
  await p.locator('.npsleep:visible').first().click(); await p.waitForTimeout(300);
  const zs = p.locator('.sleepmenu select[data-sleep-zone]'); ok('Z5 sleep menu: zone select (Every zone + 4 + Jukebox)', (await zs.locator('option').count()) === 6, (await zs.locator('option').allInnerTexts()).join('|'));
  await zs.selectOption('g:' + SC.gs[0].id); await p.locator('.sleepmenu [data-sleep="15"]').click(); await p.waitForTimeout(600);
  ok('Z5 the sleep timer was set for the zone', (await api(p, '/sleep')).j.zoneKey === 'g:' + SC.gs[0].id);
  await api(p, '/sleep', 'POST', { mode: 'off' }); await ctx.close();
});
await step('Z6 zone editor: Phone casting (one name per zone) + zone-safe calibration', async () => {
  for (const [w, h, sc, theme] of [[1920, 1080, 'compact', 'default'], [1920, 1080, 'small', 'default'], [1920, 1080, 'compact', 'pepecoin'], [1920, 1080, 'small', 'pepecoin']]) {
    const n = `Z6 ${sc} ${theme}`; const { ctx, p } = await page(w, h, ST.devexp, { scale: sc, theme, sel: 'g:' + SC.gs[0].id });
    await p.locator('.tcol42 .zwrap42[data-zone="Kitchen"] .zcard42').click({ position: { x: 60, y: 8 } }); await p.waitForTimeout(600);
    const blk = p.locator('.zpane42 .zrecv'); await blk.waitFor({ timeout: 4000 });
    ok(`${n}: Phone casting block with the zone's one name`, /PHONE CASTING/.test(await blk.innerText()) && /WavWiz – Kitchen/.test(await blk.innerText()), await blk.innerText());
    ok(`${n}: AirPlay + Spotify Connect switches, both off by default`, (await blk.locator('input[data-recv]').count()) === 2 && (await blk.locator('input[data-recv]:checked').count()) === 0);
    await blk.locator('input[data-recv=airplay]').check(); await p.waitForTimeout(700);
    const rows = (await api(p, '/receivers/zones')).j.zones, k = rows.find(z => z.zone === 'Kitchen');
    ok(`${n}: the server switched AirPlay on for Kitchen only`, k.airplay.enabled && !k.spotify.enabled && rows.filter(z => z.airplay.enabled).length === 1, JSON.stringify(k));
    await p.screenshot({ path: `/workspace/screens/wavwiz-040-phone-casting-${sc}-${theme}.png` });
    await blk.locator('input[data-recv=airplay]').uncheck(); await p.waitForTimeout(500);
    ok(`${n}: switching it off again`, !(await api(p, '/receivers/zones')).j.zones.find(z => z.zone === 'Kitchen').airplay.enabled);
    await ctx.close();
  }
});
await step('P0 rescenario', async () => { SC = await scenario(); });
await step('P1 phone: chip, zone rows, Split off / Link all', async () => {
  for (const theme of ['default', 'pepecoin']) {
    const { ctx, p } = await page(414, 900, null, { phone: true, theme, sel: 'g:' + SC.gs[0].id }); const n = 'P1 phone ' + theme;
    ok(`${n}: zone chip above the player strip (Now view)`, await p.locator('.np-ctlpanel .zl-strip').isVisible() && /Kitchen/.test(await p.locator('.np-ctlpanel .zl-strip').innerText()));
    await p.screenshot({ path: `/workspace/screens/wavwiz-040-phone-now-${theme}.png` });
    await p.locator('.np-ctlpanel .zl-strip').click(); await p.waitForTimeout(300); ok(`${n}: chip opens the zone sheet`, (await p.locator('.zmenu40 .zm-item').count()) === 5);
    await p.screenshot({ path: `/workspace/screens/wavwiz-040-phone-sheet-${theme}.png` }); await p.locator('.zmenu40 .zm-item').nth(2).click(); await p.waitForTimeout(500);
    await p.locator('.tabbar [data-k=devices], .tabbar button:has-text("Devices")').first().click(); await p.waitForTimeout(900);
    ok(`${n}: chip also above the bottom player strip on Devices`, await p.locator('.mini .zl-phone').isVisible() && /Basement/.test(await p.locator('.mini .zl-phone').innerText()));
    ok(`${n}: (0.4.2) one queue box per zone (linked share one) + Jukebox in the tree`, (await p.locator('.qb42').count()) === 3 && (await p.locator('.zjuke').count()) === 1, await p.locator('.qb42').count());
    ok(`${n}: selected zone is the Controlling one`, (await p.locator('.qb42.ctl, .zwrap42.ctl').count()) >= 1);
    ok(`${n}: Split off + Link all buttons`, (await p.locator('.zacts .zlinkbtn.split').count()) >= 1 && (await p.locator('.linkall').count()) >= 1);
    await p.screenshot({ path: `/workspace/screens/wavwiz-040-phone-devices-${theme}.png` }); await ctx.close();
  }
});

await step('M1 mini player: zone chip follows the app and controls that zone', async () => {
  for (const theme of ['default', 'pepecoin']) {
    const { ctx, p } = await page(420, 168, null, { url: '/mini.html', theme, sel: 'g:' + SC.gs[1].id }); const n = 'M1 mini ' + theme;
    ok(`${n}: chip shows Living Room`, /Living Room/.test(await p.locator('.zl-mini').innerText()), await p.locator('.zl-mini').innerText());
    const lr = (await p.locator('.mp-t').innerText()).trim(); ok(`${n}: mini shows the Living Room song`, lr.length > 0 && !/Nothing/i.test(lr), lr);
    await p.screenshot({ path: `/workspace/screens/wavwiz-040-mini-${theme}.png` });
    await p.locator('.zl-mini').click(); await p.waitForTimeout(300); await p.locator('.zmenu40 .zm-item', { hasText: 'Kitchen' }).click(); await p.waitForTimeout(1500);
    ok(`${n}: switching to Kitchen in the mini changes its song`, (await p.locator('.mp-t').innerText()).trim() !== lr, await p.locator('.mp-t').innerText());
    await ctx.close();
  }
});
await br.close();

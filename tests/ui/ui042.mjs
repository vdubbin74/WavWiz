// WavWiz 0.4.2 e2e: zone tree, queue boxes, drag, context menus, expanded 3-column view, speaker page, EQ header, queue title, phone.
// Usage: WW_SESS=/tmp/ww032/sess node ui042.mjs [quick]   (server on 172.30.0.2:47800; /workspace/seed042.sh seeds Basement[5,3] Patio[6]+Kitchen[1,2] linked, Garage[], unassigned 4,7,8)
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
const B = 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim(), QUICK = process.argv[2] === 'quick';
let pass = 0, fail = 0;
const ok = (n, c, i = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (i !== '' && !c ? ' :: ' + String(i).slice(0, 300) : '')); };
mkdirSync('/workspace/screens', { recursive: true });
const seed = () => execSync('WWDIR=/tmp/ww032 bash /workspace/seed042.sh', { stdio: 'ignore' });
const br = await chromium.launch();
const EXP = { lib: 'normal', dev: 'normal', exp: 'dev', list: 'open', ctl: 'collapsed' };
async function page(o, { theme = null, panels = null, spk = null, zone = null, phone = false } = {}) {
  const ctx = await br.newContext({ viewport: { width: o.w, height: o.h }, deviceScaleFactor: o.dpr || 1, hasTouch: phone, isMobile: phone }); await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(([sc, pn, sp, z]) => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.uiscale', sc); if (pn) localStorage.setItem('wavwiz.panels', JSON.stringify(pn)); if (sp) sessionStorage.setItem('wavwiz.spk', String(sp)); if (z) localStorage.setItem('wavwiz.zone', z); }, [o.scale, panels, spk, zone]);
  const p = await ctx.newPage(); p.on('pageerror', e => ok('no page error: ' + e.message.slice(0, 80), false));
  await p.goto(B + '/'); await p.waitForTimeout(2200); await p.evaluate(() => document.querySelector('.phone-unlock')?.click());
  if (theme) await p.evaluate(async id => { const t = await import('/js/theme.js'); t.applyTheme({ ...t.PRESETS[id], preset: id }); }, theme);
  await p.waitForTimeout(500); if (await p.evaluate(() => document.querySelector('.desk')?.classList.contains('tight') && !document.querySelector('.desk').classList.contains('devexpanded'))) { await p.locator('.devtab').click(); await p.waitForTimeout(500); }   // 0.4.5 T1: Devices is behind the right-edge tab at < 1600 CSS px
  return { ctx, p };
}
const api = (p, path, method = 'GET', body) => p.evaluate(async ([path, method, body]) => { const r = await fetch('/api/v1' + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { /* none */ } return { s: r.status, j }; }, [path, method, body]);
const groups = async p => (await api(p, '/groups')).j;
const gid = async (p, name) => (await groups(p)).find(g => g.name === name)?.id;
const inVp = (p, sel) => p.evaluate(s => [...document.querySelectorAll(s)].every(e => { const r = e.getBoundingClientRect(); return r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5; }), sel);
const CONF = [{ n: '100%', scale: 'compact', w: 1400, h: 900 }, { n: '75%', scale: 'small', w: 1400, h: 900 }, { n: '200%', scale: 'compact', w: 1920, h: 1080, dpr: 2 }];
const THEMES = ['pepecoin', null];
const idOf = async (o, name) => { const { ctx, p } = await page(o); const id = await gid(p, name); await ctx.close(); return id; };

for (const o of QUICK ? CONF.slice(0, 1) : CONF) for (const theme of QUICK ? [null] : THEMES) {
  const tag = `${o.n}/${theme || 'default'}`; seed();
  { const { ctx, p } = await page(o, { theme });
    const d = await p.evaluate(() => ({ boxes: [...document.querySelectorAll('.qb42')].map(b => ({ k: b.dataset.box, t: b.querySelector('.qb42-t')?.textContent, ctl: b.classList.contains('ctl'), zones: b.querySelectorAll('.zwrap42').length })), head: document.querySelector('.tree42-n')?.textContent,
      un: [...document.querySelectorAll('.un42 .sp42')].map(e => e.dataset.device), drop: [...document.querySelectorAll('.zwrap42')].filter(w => w.querySelector('.drop42')).map(w => w.dataset.zone), old: document.querySelectorAll('.dcard.dc3, .zcard.dlike').length }));
    ok(`T1 three boxes: solo, linked, solo [${tag}]`, d.boxes.length === 3 && d.boxes.map(b => b.k).join() === 'solo,linked,solo', JSON.stringify(d.boxes));
    ok(`T1 header "ZONES n · SPEAKERS m" [${tag}]`, /^ZONES 4 · SPEAKERS \d+$/.test(d.head), d.head);
    ok(`T2 titles Queue: <Zone> · PLAYING/IDLE and IN SYNC [${tag}]`, /^Queue: Basement · (PLAYING|IDLE)$/.test(d.boxes[0].t) && /^Queue: Patio · IN SYNC$/.test(d.boxes[1].t) && /^Queue: Garage · (PLAYING|IDLE)$/.test(d.boxes[2].t), JSON.stringify(d.boxes.map(b => b.t)));
    ok(`T2 linked box holds two zones, others one [${tag}]`, d.boxes[1].zones === 2 && d.boxes[0].zones === 1);
    ok(`T3 unassigned group lists the free speakers [${tag}]`, ['Bedroom', 'Office', 'Spare'].every(n => d.un.includes(n)), d.un.join());
    ok(`T3 empty zone says "Drop speakers here" [${tag}]`, d.drop.includes('Garage'), d.drop.join());
    ok(`T3 no old zone/speaker cards remain [${tag}]`, d.old === 0, d.old);
    const note = await p.locator('.zc42-q').allInnerTexts(); ok(`T2 follower says "Queue from Patio" [${tag}]`, note.length === 1 && note[0] === 'Queue from Patio', note.join());
    const st = await p.evaluate(() => { const L = getComputedStyle(document.querySelector('.qb42.linked')), S = getComputedStyle(document.querySelector('.qb42.solo:not(.ctl)')), C = getComputedStyle(document.querySelector('.qb42.ctl')), U = getComputedStyle(document.querySelector('.un42'));
      return { linked: L.borderTopColor, soloB: S.borderTopColor, ctlLeft: C.borderLeftWidth, ctlLeftC: C.borderLeftColor, un: U.borderTopStyle, unc: U.borderTopColor }; });
    ok(`T3 linked box has the accent outline, solo is neutral [${tag}]`, st.linked !== st.soloB, JSON.stringify(st));
    ok(`T4 Controlling wraps the WHOLE zone box with a thick accent edge [${tag}]`, parseFloat(st.ctlLeft) >= 3 && st.ctlLeftC === st.linked, JSON.stringify(st));
    ok(`T4 Controlling box contains the CONTROLLING tag and its speakers [${tag}]`, await p.evaluate(() => { const c = document.querySelector('.qb42.ctl'); return !!c && !!c.querySelector('.zctl') && c.querySelectorAll('.sp42').length === 2; }));
    ok(`T3 Unassigned is dashed amber, not the accent [${tag}]`, st.un === 'dashed' && st.unc !== st.linked, st.un + st.unc);
    const ov = await p.evaluate(() => [...document.querySelectorAll('.zc42-1')].map(r => { const n = r.querySelector('.zname'), a = r.querySelector('.zacts'); const nr = n.getBoundingClientRect(), ar = a.getBoundingClientRect(); return { name: n.textContent, clip: n.scrollWidth > n.clientWidth + 1, overlap: Math.abs(nr.top - ar.top) < 20 && nr.right > ar.left + 0.5 }; }));
    ok(`T5 zone names never clipped or covered [${tag}]`, ov.every(x => !x.clip && !x.overlap), JSON.stringify(ov));
    ok(`T5 speaker names do not run under the volume % [${tag}]`, await p.evaluate(() => [...document.querySelectorAll('.sp42')].every(r => { const n = r.querySelector('.sp42-n'), v = r.querySelector('.sp42-v'); if (!n || !v) return true; const a = n.getBoundingClientRect(), b = v.getBoundingClientRect(); return !(Math.abs(a.top - b.top) < 10 && a.right > b.left + 0.5); })));
    ok(`T5 tree has no horizontal overflow [${tag}]`, await p.evaluate(() => { const t = document.querySelector('.tree42'); return t.scrollWidth <= t.clientWidth + 1; }));
    ok(`T14 page is as wide as the viewport (mini.css does not leak) [${tag}]`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector('.desk').getBoundingClientRect().width >= innerWidth * 0.9));
    await p.screenshot({ path: `/workspace/screens/wavwiz-042-tree-std-${o.n.replace('%', '')}-${theme || 'default'}.png` });
    const garage = await gid(p, 'Garage');
    const drag = async (name, toSel) => { const g = p.locator(`.sp42[data-device="${name}"] .dgrip42`).first(), t = p.locator(toSel).first(); await g.scrollIntoViewIfNeeded(); await t.scrollIntoViewIfNeeded(); const a = await g.boundingBox(), b = await t.boundingBox();
      await p.mouse.move(a.x + 5, a.y + 5); await p.mouse.down(); await p.mouse.move(a.x + 12, a.y + 12, { steps: 3 }); await p.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 40), { steps: 8 }); const hov = await p.evaluate(() => !!document.querySelector('.dropping')); await p.mouse.up(); await p.waitForTimeout(900); return hov; };
    const hov = await drag('Bedroom', `.zwrap42[data-group-id="${garage}"]`);
    ok(`T6 drag highlights the drop target [${tag}]`, hov);
    ok(`T6 drag moves the speaker into the zone [${tag}]`, ((await groups(p)).find(g => g.id === garage).deviceIds || []).includes(4), JSON.stringify((await groups(p)).find(g => g.id === garage)?.deviceIds));
    ok(`T6 it left Unassigned and shows nested in Garage [${tag}]`, await p.evaluate(g => !!document.querySelector(`.zwrap42[data-group-id="${g}"] .sp42[data-device="Bedroom"]`) && !document.querySelector('.un42 .sp42[data-device="Bedroom"]'), garage));
    await drag('Bedroom', '.un42'); ok(`T6 dragging back to Unassigned removes it from every zone [${tag}]`, !(await groups(p)).some(g => (g.deviceIds || []).includes(4)));
    await p.locator('.un42 .sp42[data-device="Office"] .saddzone').click(); await p.waitForTimeout(250); const am = await p.locator('.ctxmenu .ctx-item').allInnerTexts();
    ok(`T7 "Add to zone" lists the zones [${tag}]`, ['Basement', 'Patio', 'Kitchen', 'Garage'].every(z => am.includes(z)), am.join()); await p.locator('.ctxmenu .ctx-item', { hasText: 'Garage' }).click(); await p.waitForTimeout(900);
    ok(`T7 Add to zone moves the speaker [${tag}]`, ((await groups(p)).find(g => g.id === garage).deviceIds || []).includes(7));
    await api(p, `/groups/${await gid(p, 'Basement')}`, 'PATCH', { name: 'Basement', deviceIds: [5, 3, 6] }); const gs = await groups(p); const cnt = {}; for (const g of gs) for (const id of g.deviceIds) cnt[id] = (cnt[id] || 0) + 1;
    ok(`T7 a speaker is in exactly one zone (the server moves it) [${tag}]`, Object.values(cnt).every(n => n === 1) && gs.find(g => g.name === 'Patio').deviceIds.length === 0, JSON.stringify(cnt)); await ctx.close(); }
  seed();
  { const { ctx, p } = await page(o, { theme }); await p.waitForTimeout(400);
    const items = () => p.locator('.ctxmenu:not(.ctx-sub) > .ctx-item').allInnerTexts().then(a => a.map(s => s.replace(/[›\s]+$/, '').trim()));
    const fits = () => p.evaluate(() => [...document.querySelectorAll('.ctxmenu')].every(e => { const r = e.getBoundingClientRect(); return r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5; }));
    await p.locator('.zwrap42[data-zone="Kitchen"] .zcard42').click({ button: 'right' }); await p.waitForTimeout(250);
    let it = await items(); ok(`M1 zone menu items (linked) [${tag}]`, ['Pause', 'Play'].includes(it[0]) && it.slice(1).join() === 'Mute,Set as Controlling,Open queue,Link to…,Split off,Rename,Delete zone', it.join());
    ok(`M1 items have icons; menu is accent themed [${tag}]`, await p.evaluate(() => document.querySelectorAll('.ctxmenu .ctx-item svg.ctx-ic').length >= 7 && getComputedStyle(document.querySelector('.ctxmenu')).borderTopColor === getComputedStyle(document.querySelector('.qb42.linked')).borderTopColor));
    ok(`M1 menu inside the window [${tag}]`, await fits());
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); const f = await p.evaluate(() => document.activeElement?.dataset?.ctx); ok(`M1 arrow keys move focus [${tag}]`, f === 'mute' || f === 'control', f);
    await p.keyboard.press('Escape'); await p.waitForTimeout(150); ok(`M1 Esc closes the menu [${tag}]`, (await p.locator('.ctxmenu').count()) === 0);
    await p.locator('.zwrap42[data-zone="Kitchen"] .zcard42').click({ button: 'right' }); await p.waitForTimeout(200);
    await p.locator('.ctxmenu [data-ctx=link]').hover(); await p.waitForTimeout(250); const sub = await p.locator('.ctxmenu.ctx-sub .ctx-item').allInnerTexts();
    ok(`M1 Link to… submenu lists the other zones [${tag}]`, sub.includes('Basement') && sub.includes('Garage') && !sub.includes('Kitchen'), sub.join()); ok(`M1 submenu inside the window (flips/clamps) [${tag}]`, await fits());
    await p.keyboard.press('Escape'); ok(`M1 Esc closes the submenu first [${tag}]`, (await p.locator('.ctxmenu.ctx-sub').count()) === 0 && (await p.locator('.ctxmenu').count()) === 1); await p.keyboard.press('Escape');
    await p.locator('.zwrap42[data-zone="Garage"] .zcard42').click({ button: 'right' }); await p.waitForTimeout(200); it = await items(); ok(`M1 unlinked zone has no "Split off" [${tag}]`, !it.includes('Split off'), it.join());
    await p.locator('.ctxmenu [data-ctx=control]').click(); await p.waitForTimeout(1000); ok(`M1 Set as Controlling works [${tag}]`, await p.evaluate(() => document.querySelector('.qb42.ctl .zname')?.textContent) === 'Garage');
    await p.locator('.zwrap42[data-zone="Kitchen"] .zcard42').click({ button: 'right' }); await p.waitForTimeout(200); await p.locator('.ctxmenu [data-ctx=split]').click(); await p.waitForTimeout(1000);
    ok(`M1 Split off works [${tag}]`, (await p.locator('.qb42.linked').count()) === 0 && (await p.locator('.qb42').count()) === 4);
    await p.locator('.zwrap42[data-zone="Kitchen"] .zcard42').click({ button: 'right' }); await p.waitForTimeout(200); await p.locator('.ctxmenu [data-ctx=link]').hover(); await p.waitForTimeout(250); await p.locator('.ctx-sub .ctx-item', { hasText: 'Patio' }).click(); await p.waitForTimeout(1000);
    ok(`M1 Link to… works [${tag}]`, (await p.locator('.qb42.linked').count()) === 1);
    await p.locator('.zwrap42[data-zone="Garage"] .zcard42').click({ button: 'right' }); await p.waitForTimeout(200); await p.locator('.ctxmenu [data-ctx=delete]').click(); await p.waitForTimeout(500);
    ok(`M1 Delete zone asks first [${tag}]`, /Remove zone/.test(await p.locator('dialog[open], .dlg, .dialog').first().innerText().catch(() => '')) && (await groups(p)).some(g => g.name === 'Garage')); await p.locator('button:has-text("Cancel")').first().click({ timeout: 800 }).catch(() => {}); await p.waitForTimeout(300);
    await p.locator('.sp42[data-device="Sub"]').click({ button: 'right' }); await p.waitForTimeout(250); it = await items();
    ok(`M2 speaker menu items [${tag}]`, it.join() === 'Mute,Settings,Move to zone,Calibrate,Rename,Disable', it.join()); ok(`M2 inside the window [${tag}]`, await fits());
    await p.locator('.ctxmenu [data-ctx=move]').hover(); await p.waitForTimeout(250); const mv = await p.locator('.ctxmenu.ctx-sub .ctx-item').allInnerTexts();
    ok(`M2 Move to zone lists other zones and Unassigned [${tag}]`, mv.includes('Patio') && mv.includes('Unassigned') && !mv.includes('Basement'), mv.join()); ok(`M2 submenu inside the window [${tag}]`, await fits());
    await p.locator('.ctx-sub .ctx-item', { hasText: 'Unassigned' }).click(); await p.waitForTimeout(900); ok(`M2 Move to zone → Unassigned works [${tag}]`, !(await groups(p)).some(g => g.deviceIds.includes(3)));
    await p.locator('.sp42[data-device="Sub"]').click({ button: 'right' }); await p.waitForTimeout(250); const un = await items(); ok(`M3 unassigned speaker menu: Add to zone, Settings [${tag}]`, un.join() === 'Add to zone,Settings', un.join());
    await p.locator('.ctxmenu [data-ctx=add]').hover(); await p.waitForTimeout(250); await p.locator('.ctx-sub .ctx-item', { hasText: 'Basement' }).click(); await p.waitForTimeout(900); ok(`M3 Add to zone works [${tag}]`, (await groups(p)).find(g => g.name === 'Basement').deviceIds.includes(3));
    await p.locator('.sp42[data-device="Sub"]').click({ button: 'right' }); await p.waitForTimeout(250); await p.locator('.ctxmenu [data-ctx=mute]').click(); await p.waitForTimeout(800); ok(`M2 Mute works [${tag}]`, (await api(p, '/zones')).j.find(z => z.id === 3).muted === true);
    await p.locator('.sp42[data-device="Sub"]').click({ button: 'right' }); await p.waitForTimeout(250); ok(`M2 label flips to Unmute [${tag}]`, /Unmute/.test((await items())[0])); await p.keyboard.press('Escape');
    await p.locator('.sp42[data-device="Sub"] .sp42-n').focus(); await p.keyboard.press('Shift+F10'); await p.waitForTimeout(250); ok(`M2 Shift+F10 opens the menu from the keyboard [${tag}]`, (await p.locator('.ctxmenu').count()) === 1); await p.keyboard.press('Escape');
    // 0.4.3 #9 (approved): no ⋯ button (the render has none); Shift+F10 on the speaker opens the same menu
    ok(`M2 no ⋯ button on speaker rows [${tag}]`, (await p.locator('.sp42-menu').count()) === 0);
    await p.locator('.sp42[data-device="Sub"] .sp42-n').focus(); await p.keyboard.press('Shift+F10'); await p.waitForTimeout(250); ok(`M2 Shift+F10 opens the same menu [${tag}]`, (await p.locator('.ctxmenu').count()) === 1); await p.keyboard.press('Escape');
    await p.setViewportSize({ width: 700, height: 520 }).catch(() => {}); await p.waitForTimeout(500);
    const row = p.locator('.sp42[data-device="Deck"]').first(); if (await row.count() && await row.isVisible()) { await row.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {}); await row.click({ button: 'right' }); await p.waitForTimeout(250); await p.locator('.ctxmenu [data-ctx=move]').hover(); await p.waitForTimeout(250); ok(`M2 menus fit a small window (700x520) [${tag}]`, await fits()); await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); }
    await ctx.close(); }
}
if (!QUICK) for (const o of CONF) { const tag = o.n; seed();
  { const { ctx, p } = await page(o, { panels: EXP, spk: 5 }); await p.waitForTimeout(800);
    const c = await p.evaluate(() => { const r = s => document.querySelector(s)?.getBoundingClientRect(); const a = r('.sscol'), d = r('.dcol42'), t = r('.tcol42'); return { s: a && a.left, d: d && d.left, t: t && t.left, crumb: document.querySelector('.dpath42')?.textContent, hint: document.querySelector('.dhint42')?.textContent }; });
    ok(`E1 three columns: Scenes | detail | tree [${tag}]`, c.s < c.d && c.d < c.t, JSON.stringify(c)); ok(`E1 breadcrumb "Basement > PCBOXV1" and a hint line [${tag}]`, c.crumb === 'Basement > PCBOXV1' && /Pick a zone or a speaker/.test(c.hint || ''), c.crumb);
    ok(`E1 selected speaker row has the accent highlight [${tag}]`, await p.evaluate(() => { const r = document.querySelector('.sp42.sel[data-device="PCBOXV1"]'); return !!r && getComputedStyle(r).backgroundColor !== 'rgba(0, 0, 0, 0)'; }));
    const sp = await p.evaluate(() => { const q = s => document.querySelector(s); const root = q('.d42-pane .spkset'); const t = root?.innerText || ''; return { root: !!root, rename: !!q('[data-act=spk-rename]'), zone: q('.spk-zonerow')?.innerText, vol: /Volume/.test(t), max: /Max volume/.test(t), nolocked: !/\(locked\)/.test(t), nopad: !q('.d42-pane .eqpadlock, .d42-pane [data-act=eqpadlock]'), cal: !!q('.d42-pane .calbtn'), delay: /Delay/.test(t), bands: document.querySelectorAll('.d42-pane .eqb').length, presets: [...document.querySelectorAll('.spk-presel option:not([disabled])')].map(b => b.textContent), eqon: !!q('[data-act=eq-on]'), reset: !!q('[data-act=eq-reset]'), sap: !!q('[data-act=preset-saveas]'), bass: /Bass/.test(t), treble: /Treble/.test(t), loud: !!q('[data-act=loudness]'), out: /OUTPUT/.test(t) }; });
    ok(`S1 full speaker page pieces [${tag}]`, sp.root && sp.rename && /Basement/.test(sp.zone) && sp.vol && sp.max && sp.cal && sp.delay && sp.out && sp.bass && sp.treble && sp.loud, JSON.stringify(sp));
    ok(`S1 Max volume has no lock; EQ is never locked (10 bands) [${tag}]`, sp.nolocked && sp.nopad && sp.bands === 10);
    ok(`S2 PRESETS row has the 8 built-ins [${tag}]`, ['Flat', 'Bass Boost', 'Treble Boost', 'Vocal', 'Late Night', 'Movie Night', 'Bluetooth Speaker', 'Rock / Metal'].every(n => sp.presets.includes(n)), sp.presets.join());
    ok(`S2 EQ on/off, Reset, Save as preset exist [${tag}]`, sp.eqon && sp.reset && sp.sap);
    await p.locator('.spk-presel').selectOption({ label: 'Bass Boost' });   // 0.4.4 F20: dropdown await p.waitForTimeout(1200);
    const dev = (await api(p, '/zones')).j.find(z => z.id === 5).outputs[0].deviceId; const g1 = await api(p, '/dsp/assignments/' + encodeURIComponent(dev)); ok(`S2 clicking a preset applies it [${tag}]`, g1.s === 200 && g1.j && g1.j.presetId != null, JSON.stringify(g1.j));
    await p.locator('[data-act=eq-reset]').click(); await p.waitForTimeout(600);
    await api(p, '/zones/5/volcap', 'PUT', { cap: 70, locked: true }); await p.waitForTimeout(1800);
    const tags = await p.evaluate(() => ({ row: [...document.querySelectorAll('.sp42[data-device="PCBOXV1"] .dtag')].map(e => e.textContent).join('|'), page: [...document.querySelectorAll('.spk-tags .dtag')].map(e => e.textContent).join('|') }));
    ok(`S3 any cap under 100% shows CAPPED 70% (row and page) [${tag}]`, /CAPPED 70%/.test(tags.row) && /CAPPED 70%/.test(tags.page), JSON.stringify(tags)); await api(p, '/zones/5/volcap', 'PUT', { cap: 100, locked: false });
    await p.locator('.spk-zsel').selectOption({ label: 'Garage' }); await p.waitForTimeout(1500); ok(`S4 Move to zone on the speaker page [${tag}]`, (await groups(p)).find(g => g.name === 'Garage').deviceIds.includes(5));
    ok(`S4 breadcrumb follows [${tag}]`, (await p.locator('.dpath42').innerText()) === 'Garage > PCBOXV1', await p.locator('.dpath42').innerText());
    await p.screenshot({ path: `/workspace/screens/wavwiz-042-expanded-speaker-${o.n.replace('%', '')}.png` });
    await p.locator('.zwrap42[data-zone="Patio"] .zname').click(); await p.waitForTimeout(800);
    const z = await p.evaluate(() => { const q = s => document.querySelector(s); return { crumb: q('.dpath42')?.textContent, name: !!q('.zp42-name'), q: /Queue: Patio/.test(q('.zpane42')?.innerText || ''), oq: !!q('[data-act=zone-open-queue]'), link: !!q('[data-act=zone-link]') || !!q('[data-act=zone-split]'), del: !!q('[data-act=zone-delete]') }; });
    ok(`Z1 zone settings pane: rename, queue + Open queue, Link/Split, Delete [${tag}]`, z.crumb === 'Patio' && z.name && z.q && z.oq && z.link && z.del, JSON.stringify(z));
    await p.screenshot({ path: `/workspace/screens/wavwiz-042-expanded-zone-${o.n.replace('%', '')}.png` });
    ok(`E1 no horizontal overflow in the expanded devices view [${tag}]`, !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))); await ctx.close(); }
  seed();
  { const { ctx, p } = await page(o, { panels: EXP }); await p.waitForTimeout(800); ok(`E1 detail pane defaults to the Controlling zone [${tag}]`, (await p.locator('.dpath42').innerText()) === 'Basement', await p.locator('.dpath42').innerText()); await ctx.close(); }
  for (const [zn, re, lab] of [['Patio', /PATIO \+ KITCHEN/, 'linked leader: QUEUE · PATIO + KITCHEN'], ['Kitchen', /FROM PATIO/, 'follower: QUEUE FROM PATIO']]) {
    const { ctx, p } = await page(o, { zone: 'g:' + await idOf(o, zn) }); await p.waitForTimeout(800); const qt = await p.locator('.listpanel .qzone').first().innerText().catch(() => ''); ok(`Q1 ${lab} [${tag}]`, re.test(qt), qt); await ctx.close(); }
  { const { ctx, p } = await page(o, { panels: { lib: 'normal', dev: 'normal', list: 'open', ctl: 'collapsed' } }); await p.waitForTimeout(500);
    const sw = p.locator('[data-ov=swap]').first(); if (!(await p.locator('.np-eqhead').count()) && await sw.count()) { await sw.click(); await p.waitForTimeout(1500); }
    const e = await p.evaluate(() => { const r = s => document.querySelector(s)?.getBoundingClientRect(); const a = r('.eqallbtn'); return { has: !!a, one: !!a && a.height < 40, lockTop: !!document.querySelector('[data-ov=lock]'), noHeadLock: !document.querySelector('.np-eqhead .eqpadlock'), lockRight: (() => { const l = r('[data-ov=lock]'); return !!l && l.left > innerWidth / 2; })(), adj: /Adjusting:/.test(document.querySelector('.np-eqname')?.textContent || '') || (/^Sound$/.test(document.querySelector('.np-eqname')?.textContent || '') && /Connect a speaker/.test(document.body.innerText)) }; });
    ok(`V1 EQ view: lock in the top-right icon group, not the header [${tag}]`, e.has && e.lockTop && e.noHeadLock && e.lockRight, JSON.stringify(e)); ok(`V1 "All sound settings" on one line [${tag}]`, e.one, JSON.stringify(e)); ok(`V1 header shows Adjusting: <speaker> [${tag}]`, e.adj, JSON.stringify(e));
    await ctx.close(); }
}
{ seed(); const o = { n: 'phone', scale: 'compact', w: 414, h: 900 }; const { ctx, p } = await page(o, { phone: true }); await p.locator('.tabbar [data-k=devices], .tabbar button:has-text("Devices")').first().click(); await p.waitForTimeout(1500);
  ok('P1 phone: the same tree (boxes, unassigned, header)', (await p.locator('.qb42').count()) === 3 && (await p.locator('.un42').count()) === 1 && /ZONES 4/.test(await p.locator('.tree42-n').innerText()));
  ok('P1 phone: no horizontal scroll', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  ok('P1 phone: zone names not clipped', await p.evaluate(() => [...document.querySelectorAll('.zc42-1')].every(r => { const n = r.querySelector('.zname'); return n.scrollWidth <= n.clientWidth + 1; })));
  await p.locator('.un42 .sp42[data-device="Bedroom"] .saddzone').click(); await p.waitForTimeout(300); await p.locator('.ctxmenu .ctx-item', { hasText: 'Garage' }).click(); await p.waitForTimeout(900); ok('P1 phone: Add to zone', (await groups(p)).find(g => g.name === 'Garage').deviceIds.includes(4));
  const press = sel => p.evaluate(s => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); e.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, clientX: r.left + 60, clientY: r.top + 8 })); }, sel);
  await press('.sp42[data-device="Sub"]'); await p.waitForTimeout(900);
  ok('P1 phone: long-press opens the speaker menu', (await p.locator('.ctxmenu').count()) === 1 && /Move to zone/.test(await p.locator('.ctxmenu').innerText()), await p.locator('.ctxmenu').allInnerTexts()); ok('P1 phone: menu fits the screen', await inVp(p, '.ctxmenu')); await p.keyboard.press('Escape');
  await press('.zwrap42[data-zone="Garage"] .zcard42'); await p.waitForTimeout(900);
  ok('P1 phone: long-press opens the zone menu', (await p.locator('.ctxmenu').count()) === 1 && /Open queue/.test(await p.locator('.ctxmenu').innerText())); await p.keyboard.press('Escape');
  await p.locator('.sp42[data-device="Sub"] .sp42-n').click(); await p.waitForTimeout(1800); ok('P1 phone: tapping a speaker opens its full page (Max volume, presets)', /Max volume/.test(await p.locator('.pd42 .spkset').innerText().catch(() => '')) && (await p.locator('.spk-presel option:not([disabled])').count()) >= 8);
  await p.screenshot({ path: '/workspace/screens/wavwiz-042-phone-speaker.png', fullPage: true }); await ctx.close(); seed(); }
// ---- 0.4.2 extras: Undo when clearing another zone's queue; phone Queue page zone picker; delete-zone confirm text; Phone casting in the zone pane
if (!QUICK) { seed(); const o = CONF[0];
  const g = await (async () => { const { ctx, p } = await page(o); const r = await groups(p); const tr = (await api(p, '/library/tracks')).j; const ids = (Array.isArray(tr) ? tr : tr.tracks).map(t => t.id).slice(0, 3);
    const gar = r.find(x => x.name === 'Garage'); await api(p, '/queue/clear', 'POST', { zoneId: gar.playbackId }); await api(p, '/stream/play', 'POST', { kind: 'tracks', ids, zoneId: gar.playbackId }); await ctx.close(); return { gar, n: ids.length }; })();
  { const { ctx, p } = await page(o); await p.locator('.qzpick').selectOption({ label: 'Garage' }).catch(async () => { await p.locator('.qzpick').selectOption({ index: 3 }); }); await p.waitForTimeout(1200);
    await p.locator('.devscrim').click({ force: true, timeout: 2000 }).catch(() => {});   // 0.4.5 T1: close the Devices slide-over first
    await p.locator('[data-act=clearqueue]').first().click(); await p.waitForTimeout(400); await p.locator('dialog[open] button.danger').click(); await p.waitForTimeout(1200);
    const q0 = (await api(p, '/queue?zoneId=' + g.gar.playbackId)).j; const n0 = (q0.items || q0.queue || q0).length;
    ok('U1 clearing another zone\'s queue empties it and offers Undo', n0 === 0 && (await p.locator('.toast.undo').count()) === 1, n0);
    await p.locator('.toast.undo [data-act=undo]').click(); await p.waitForTimeout(1500);
    const q1 = (await api(p, '/queue?zoneId=' + g.gar.playbackId)).j; const n1 = (q1.items || q1.queue || q1).length;
    ok('U1 Undo puts the tracks back in THAT zone', n1 === g.n, n1); await ctx.close(); }
  { const { ctx, p } = await page(o, { panels: EXP }); await p.locator('.zwrap42[data-zone="Basement"] .zcard42').click({ button: 'right' }); await p.locator('.ctxmenu [data-ctx=delete]').click(); await p.waitForTimeout(500);
    const t = await p.locator('dialog[open]').innerText(); ok('D3 delete-zone confirm names the speakers that move to Unassigned', /will move to Unassigned: .*PCBOXV1/.test(t) || /will move to Unassigned: .*Sub/.test(t), t.slice(0, 200)); await p.locator('dialog[open] button:has-text("Cancel")').click(); await ctx.close(); }
  { const { ctx, p } = await page(o, { panels: EXP }); await p.locator('.zwrap42[data-zone="Kitchen"] .zcard42').click({ position: { x: 60, y: 8 } }); await p.waitForTimeout(800);
    ok('Z6 zone pane has Phone casting (AirPlay + Spotify Connect switches)', (await p.locator('.zpane42 .zrecv input[data-recv]').count()) === 2); await ctx.close(); }
  { const { ctx, p } = await page({ n: 'phone', scale: 'compact', w: 414, h: 900 }, { phone: true }); await p.evaluate(async () => (await import('/js/main.js')).go('queue')); await p.waitForTimeout(1500);
    const pk = p.locator('.pqwrap .qzpick').first(); ok('Q2 phone Queue page has the zone picker, inside the screen', (await pk.count()) === 1 && await pk.isVisible() && await inVp(p, '.qzpick') && (await pk.locator('option').count()) >= 4, await pk.locator('option').count());
    await pk.selectOption({ index: 1 }); await p.waitForTimeout(900); ok('Q2 picking a zone names it in the Queue title', /· /.test(await p.locator('.qzone').last().innerText().catch(() => '')), await p.locator('.qzone').last().innerText().catch(() => ''));
    await p.screenshot({ path: '/workspace/screens/wavwiz-042-phone-queue.png' }); await ctx.close(); }
  seed(); }
console.log(`\nui042: ${pass} passed, ${fail} failed`);
await br.close(); process.exit(fail ? 1 : 0);

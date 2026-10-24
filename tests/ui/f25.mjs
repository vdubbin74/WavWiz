// 0.4.4 F25: per-speaker mute/unmute toggle in the tree rows (panel + expanded, next to the %), on the speaker page (right of the Volume bar)
// and in the phone layout; the amber MUTED tag unmutes everywhere. SHOTS=<prefix> saves screenshots. 100% + 200%.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = process.env.WW || 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim(), SH = process.env.SHOTS;
let pass = 0, fail = 0; const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + d)); };
const api = async (u, m = 'GET', body) => { const r = await fetch(B + '/api/v1' + u, { method: m, headers: { cookie: 'unison_session=' + sess, 'content-type': 'application/json', origin: B }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const KL = (await api('/zones')).find(z => z.name === 'Kitchen-Left'); const muted = async () => (await api('/zones')).find(z => z.id === KL.id).muted;
const setMuted = async v => { await api('/zones/' + KL.id, 'PATCH', { muted: v }); };
const until = async (f, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await new Promise(r => setTimeout(r, 150)); } return false; };
const br = await chromium.launch();
const views = { panel: { vp: [1920, 1080], pan: { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' } }, expanded: { vp: [1920, 1080], pan: { lib: 'rail', dev: 'expanded', exp: 'dev', list: 'normal', ctl: 'collapsed' } }, phone: { vp: [390, 844], phone: true, pan: { lib: 'rail', dev: 'normal', exp: null, list: 'normal', ctl: 'collapsed' } } };
for (const [view, V] of Object.entries(views)) for (const dpr of [1, 2]) {
  const tag = `[${view} ${dpr * 100}%]`, vp = V.phone ? V.vp : [V.vp[0] / dpr, V.vp[1] / dpr];
  const c = await br.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: dpr, ...(V.phone ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' } : {}) });
  await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  // 0.4.9 F69: zones with no speaker online collapse to a one-line row, so report Kitchen-Left as connected to keep its zone (and row) open
  await c.route(/\/api\/v1\/zones(\?|$)/, async r => { try { const res = await r.fetch(), j = await res.json(); for (const z of j) if (z.name === 'Kitchen-Left') z.connected = true; await r.fulfill({ response: res, json: j }); } catch { /* closed */ } });
  await c.addInitScript(P => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); localStorage.setItem('wavwiz.panels', JSON.stringify(P)); }, V.pan);
  const p = await c.newPage();
  try {
    await setMuted(true);
    await p.goto(B + '/'); await p.waitForTimeout(2800);
    await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));
    if (!V.phone) if (await p.evaluate(() => document.querySelector('.desk')?.classList.contains('tight') && !document.querySelector('.desk').classList.contains('devexpanded'))) { await p.locator('.devtab').click(); await p.waitForTimeout(500); }   // 0.4.5 T1: Devices is behind the right-edge tab at < 1600 CSS px
    if (V.phone) { await p.evaluate(() => [...document.querySelectorAll('button')].filter(e => e.offsetParent && /Devices$/.test(e.textContent.trim())).pop()?.click()); await p.waitForTimeout(1200); }
    const rowSel = (V.phone ? '#p-zones ' : '') + '.sp42[data-device="Kitchen-Left"]';
    const row = p.locator(rowSel).first(); await row.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
    if (SH) await p.screenshot({ path: `${SH}-${view}-${dpr * 100}-row.png` });
    const geo = await row.evaluate(r => { const m = r.querySelector('.sp42-mute'), v = r.querySelector('.sp42-v'); const mb = m?.getBoundingClientRect(), vb = v?.getBoundingClientRect(); return { has: !!m, pressed: m?.getAttribute('aria-pressed'), right: !!(mb && vb && mb.left >= vb.right - 1 && Math.abs((mb.top + mb.bottom) / 2 - (vb.top + vb.bottom) / 2) < 8), w: mb?.width }; });
    ok(`F25 speaker row has a mute toggle right of the % (pressed while muted) ${tag}`, geo.has && geo.pressed === 'true' && geo.right, JSON.stringify(geo));
    // the amber MUTED tag unmutes
    const t = row.locator('.dtag.muted').first();
    if (await t.count()) { await (V.phone ? t.tap() : t.click()); ok(`F25 tapping the MUTED tag on the row unmutes ${tag}`, await until(async () => !(await muted()))); } else ok(`F25 MUTED tag on the row ${tag}`, false, 'no tag');
    await setMuted(true); await p.waitForTimeout(900);
    const m = p.locator(rowSel + ' .sp42-mute').first();
    if (await m.count()) { await (V.phone ? m.tap() : m.click()); ok(`F25 row toggle unmutes ${tag}`, await until(async () => !(await muted()))); await p.waitForTimeout(700); await (V.phone ? p.locator(rowSel + ' .sp42-mute').first().tap() : p.locator(rowSel + ' .sp42-mute').first().click()); ok(`F25 row toggle mutes again ${tag}`, await until(async () => await muted())); }
    else ok(`F25 row toggle ${tag}`, false, 'missing');
    // the speaker page: toggle right of the Volume bar
    await setMuted(true); await p.waitForTimeout(700);
    await p.locator(rowSel + ' .sp42-n').first().click(); await p.waitForTimeout(1500);
    const sp = p.locator(`.spkset[data-zone-id="${KL.id}"]`).first();
    const sg = await sp.evaluate(s => { const r = s.querySelector('.spk-row.spk-vol .spk-range') || [...s.querySelectorAll('.spk-row')].find(x => /^Volume/.test(x.textContent))?.querySelector('.spk-range'); const m = s.querySelector('.spk-mute'); const rb = r?.getBoundingClientRect(), mb = m?.getBoundingClientRect(); return { has: !!m, pressed: m?.getAttribute('aria-pressed'), right: !!(rb && mb && mb.left >= rb.right - 1 && Math.abs((mb.top + mb.bottom) / 2 - (rb.top + rb.bottom) / 2) < 14) }; }).catch(e => ({ err: e.message }));
    if (SH) { await sp.scrollIntoViewIfNeeded().catch(() => {}); await p.screenshot({ path: `${SH}-${view}-${dpr * 100}-page.png` }); }
    ok(`F25 speaker page has a mute toggle right of the Volume bar ${tag}`, sg.has && sg.pressed === 'true' && sg.right, JSON.stringify(sg));
    const pm = sp.locator('.spk-mute').first();
    if (await pm.count()) { await (V.phone ? pm.tap() : pm.click()); ok(`F25 speaker page toggle unmutes ${tag}`, await until(async () => !(await muted()))); }
    await setMuted(true); await p.waitForTimeout(900);
    const pt = sp.locator('.dtag.muted').first();
    if (await pt.count()) { await (V.phone ? pt.tap() : pt.click()); ok(`F25 MUTED tag on the speaker page unmutes ${tag}`, await until(async () => !(await muted()))); }
  } catch (e) { ok(`F25 ${tag}`, false, e.message.split('\n')[0]); }
  await c.close();
}
await setMuted(false); await br.close();
console.log(`f25: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

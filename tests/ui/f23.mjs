// 0.4.4 F23: a web speaker's settings page must not rebuild on its status ticks. Phone = separate browser context joined as a web speaker.
// Checks over 10 s of ticks: .spkset node kept (no replacement), detail column scroll kept, focus kept, slider drag not interrupted. TAG=before|after
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim(), TAG = process.env.TAG || 'after';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? 'ok  ' : 'FAIL', m); };
const br = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const init = (name, join, panels) => () => {};
async function ctxFor(dpr, join, panels, vp = [1920, 1080]) {
  const c = await br.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: dpr, ...(join ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } } : {}) }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([j, pn]) => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', j ? '1' : '0'); if (j) localStorage.setItem('wavwiz.webRoom.name', 'F23 iPhone'); localStorage.setItem('wavwiz.panels', JSON.stringify(pn)); }, [join, panels]);
  return c;
}
const phoneCtx = await ctxFor(1, true, { lib: 'rail', dev: 'normal', exp: null, list: 'normal', ctl: 'collapsed' });
const phone = await phoneCtx.newPage(); await phone.goto(B + '/'); await phone.waitForTimeout(3500);
await phone.evaluate(async () => { try { (await import('/js/room.js')).unlockAudio(); } catch {} });
await phone.waitForTimeout(1000);
// the phone plays in Basement so it sends real ticks (buffer / offset / state)
const api = async (u, m = 'GET', body) => { const r = await fetch(B + '/api/v1' + u, { method: m, headers: { cookie: 'unison_session=' + sess, 'content-type': 'application/json', origin: B }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const pid = await phone.evaluate(() => localStorage.getItem('wavwiz.webRoom.id')); const me = (await api('/zones')).find(z => z.playerId === pid);
const groups = await api('/groups'); const base = groups.find(g => g.name === 'Basement');
for (const g of groups) if (g.deviceIds.includes(me.id) && g.id !== base.id) await api('/groups/' + g.id, 'PATCH', { deviceIds: g.deviceIds.filter(d => d !== me.id) });
if (!base.deviceIds.includes(me.id)) await api('/groups/' + base.id, 'PATCH', { deviceIds: [...base.deviceIds, me.id] });
if (process.env.PLAY !== '0') { await api('/stream/jump?zoneId=' + base.playbackId, 'POST', { index: 0 }); await api('/stream/resume?zoneId=' + base.playbackId, 'POST', {}); }
await phone.waitForTimeout(2000);
for (const [z, dpr] of [['100', 1], ['200', 2]]) {
  const VIEW = process.env.VIEW || 'expanded', VP = { expanded: [1920, 1080], panel: [1920, 1080], small: [1280, 720], phone: [390, 844] }[VIEW];
  const c = await ctxFor(dpr, false, VIEW === 'panel' || VIEW === 'phone' ? { lib: 'rail', dev: 'normal', exp: null, list: 'normal', ctl: 'collapsed' } : { lib: 'rail', dev: 'expanded', exp: 'dev', list: 'normal', ctl: 'collapsed' }, VP); const p = await c.newPage();
  await p.goto(B + '/'); await p.waitForTimeout(2800);
  if (VIEW === 'phone') { await p.evaluate(() => [...document.querySelectorAll('button, a')].filter(e => e.offsetParent && /^\W*Devices$/.test(e.textContent.trim())).pop()?.click()); await p.waitForTimeout(1200); }
  const clicked = await p.evaluate(() => { const b = [...document.querySelectorAll((document.querySelector('#p-zones')?.offsetParent ? '#p-zones ' : '') + '.sp42:not(.gone) .sp42-n')].find(e => e.textContent.trim() === 'F23 iPhone'); b?.click(); return !!b; });
  await p.waitForTimeout(1500);
  ok(clicked && await p.locator('.spkset').count() > 0, `F23 ${z}% speaker page open for the web speaker`);
  const setup = await p.evaluate(() => {
    const sp = document.querySelector('.spkset'); let col = sp; while (col && !(col.scrollHeight > col.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(col).overflowY))) col = col.parentElement;
    if (!col && sp && document.scrollingElement.scrollHeight > innerHeight + 5) col = document.scrollingElement;
    window.__f23 = { sp, col, removed: 0, scrolls: [], inner: {} };
    new MutationObserver(ms => { for (const m of ms) for (const n of m.removedNodes) if (n.nodeType === 1) { const k = (m.target.className || m.target.tagName) + ' > ' + (n.className || n.tagName); window.__f23.inner[k] = (window.__f23.inner[k] || 0) + 1; } }).observe(sp, { childList: true, subtree: true });
    new MutationObserver(ms => { for (const m of ms) for (const n of m.removedNodes) if (n.nodeType === 1 && (n === window.__f23.sp || n.contains?.(window.__f23.sp) || n.querySelector?.('.spk-range'))) window.__f23.removed++; }).observe(document.body, { childList: true, subtree: true });
    if (col) { col.scrollTop = Math.round((col.scrollHeight - col.clientHeight) * 0.6); window.__f23.want = col.scrollTop; }
    return { col: col?.className || col?.tagName, want: col?.scrollTop, max: col ? col.scrollHeight - col.clientHeight : 0 };
  });
  ok(setup.col && setup.want > 20, `F23 ${z}% page scrolls (${setup.col} top ${setup.want}/${setup.max})`);
  // focus a control and watch 10 s of phone ticks
  await p.evaluate(() => { const i = window.__f23.sp.querySelector('input[type=range], button'); i?.focus({ preventScroll: true }); window.__f23.focus = i; });
  const samples = [];
  for (let i = 0; i < 20; i++) { if (process.env.FLAP && i % 6 === 2) phone.reload().then(() => phone.evaluate(async () => { try { (await import('/js/room.js')).unlockAudio(); } catch {} })).catch(() => {}); await p.waitForTimeout(500); samples.push(await p.evaluate(() => ({ top: window.__f23.col?.scrollTop, same: document.querySelector('.spkset') === window.__f23.sp, foc: document.activeElement === window.__f23.focus, rm: window.__f23.removed }))); }
  const last = samples.at(-1); if (process.env.DIAG) console.log(JSON.stringify(await p.evaluate(() => window.__f23.inner)));
  ok(samples.every(s => s.same) && last.rm === 0, `F23 ${z}% no DOM replacement during 10 s of ticks (removed ${last.rm})`);
  ok(samples.every(s => Math.abs(s.top - setup.want) <= 2), `F23 ${z}% scroll stays put (${[...new Set(samples.map(s => s.top))].join(',')})`);
  ok(samples.every(s => s.foc), `F23 ${z}% focus kept`);
  if (z === '100') await p.screenshot({ path: `/workspace/screens/wavwiz-044-F23-${TAG}${VIEW === 'expanded' ? '' : '-' + VIEW}-100.png` }); else await p.screenshot({ path: `/workspace/screens/wavwiz-044-F23-${TAG}${VIEW === 'expanded' ? '' : '-' + VIEW}-200.png` });
  // drag a slider for 3 s: the same input element survives and keeps its value
  const r = p.locator('.spkset input[type=range]:visible').first();
  if (await r.count()) {
    await r.scrollIntoViewIfNeeded(); const bb = await r.boundingBox(); await p.evaluate(() => { window.__f23.rng = document.querySelector('.spkset input[type=range]'); });
    await p.mouse.move(bb.x + bb.width * 0.3, bb.y + bb.height / 2); await p.mouse.down(); const rm0 = await p.evaluate(() => window.__f23.removed + Object.values(window.__f23.inner).reduce((a, b) => a + b, 0)); const v0 = await p.evaluate(() => window.__f23.rng.value);
    let same = true; for (let i = 0; i < 6; i++) { await p.mouse.move(bb.x + bb.width * (0.3 + i * 0.04), bb.y + bb.height / 2, { steps: 3 }); await p.waitForTimeout(500); same = same && await p.evaluate(() => document.querySelector('.spkset input[type=range]') === window.__f23.rng && window.__f23.rng.isConnected); }
    const rm1 = await p.evaluate(() => window.__f23.removed + Object.values(window.__f23.inner).reduce((a, b) => a + b, 0)), v1 = await p.evaluate(() => window.__f23.rng.value);
    await p.mouse.up(); same = same && rm1 === rm0 && v1 !== v0; ok(same, `F23 ${z}% slider drag not interrupted (input kept, no DOM removal while dragging, value followed the drag)`);
  } else ok(false, `F23 ${z}% no slider found`);
  await c.close();
}
await api('/stream/stop?zoneId=' + base.playbackId, 'POST', {});
await br.close(); console.log(`${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);

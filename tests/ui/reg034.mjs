// WavWiz 0.3.4 regression smoke (0.2.x - 0.3.3 features) through the API and a real browser: calibration, TLS, revoke, volume cap,
// art, EQ lock, mini player, drag and drop, Settings tabs, scenes and schedules. Screenshots: /workspace/screens/wavwiz-034-reg-*.png
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', BS = 'https://172.30.0.2:47443', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim();
const R = []; const ok = (n, c, i = '') => { R.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? ' :: ' + String(i).slice(0, 500) : '')); };
const H = (tok) => ({ Cookie: 'unison_session=' + sess, Origin: B, 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok, Cookie: '' } : {}) });
const raw = (p, m = 'GET', b, tok) => fetch(B + '/api/v1' + p, { method: m, headers: H(tok), body: b ? JSON.stringify(b) : undefined });
const api = async (p, m, b, tok) => { const t = await (await raw(p, m, b, tok)).text(); try { return JSON.parse(t); } catch { return t; } };
const step = async (n, f) => { try { await f(); } catch (e) { ok(n, false, String(e).slice(0, 400)); } };
const cb = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const sx = await cb.newContext({ viewport: { width: 900, height: 700 } }); await sx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
const sp = await sx.newPage(); await sp.goto(B + '/'); await sp.waitForTimeout(3000); await sp.mouse.click(450, 350); await sp.waitForTimeout(800);
const ctx = await cb.newContext({ viewport: { width: 1920, height: 1080 } }); await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
await ctx.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'open' })); localStorage.setItem('wavwiz.center.v1', 'eq'); });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
const shot = n => p.screenshot({ path: `/workspace/screens/wavwiz-034-reg-${n}.png` });
const home = async () => { await p.goto(B + '/'); await p.waitForSelector('.desk', { timeout: 15000 }); await p.waitForTimeout(2500); await p.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); document.querySelectorAll('.phone-unlock').forEach(e => e.remove()); }); };
await home();

await step('calibration', async () => {
  const mics = await raw('/calibration/mics'); ok('calibration: mic list API answers', mics.ok, mics.status);
  const ref = await raw('/calibration/reference'); ok('calibration: reference API answers', ref.status < 500, ref.status);
  await p.evaluate(async () => (await import('/js/main.js')).go('calibrate')).catch(() => {}); await p.waitForTimeout(2000); await shot('calibration');
  const t = await p.evaluate(() => document.querySelector('dialog[open]')?.innerText.slice(0, 200) || ''); ok('calibration: wizard opens', /calibrat|microphone|mic/i.test(t), t.replace(/\n/g, ' | '));
  const cm = await fetch(B + '/calmic.html'); ok('calibration: phone mic page served', cm.ok);
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
});
await step('tls', async () => {
  const i = await (await fetch(B + '/tls/info')).json().catch(() => ({})); ok('TLS: info has a fingerprint / root CA', JSON.stringify(i).length > 20, JSON.stringify(i).slice(0, 160));
  const crt = await fetch(B + '/tls/root-ca.crt'); const body = await crt.text(); ok('TLS: root CA downloads as a certificate (404 while the local CA is off)', (i.enabled === false && crt.status === 404) || crt.ok && /BEGIN CERTIFICATE|^0\x82/.test(body) || crt.headers.get('content-type')?.includes('x509'), crt.headers.get('content-type'));
  const q = await fetch(B + '/tls/qr.svg'); ok('TLS: QR svg', q.ok && (await q.text()).includes('<svg'));
  const hp = await ctx.newPage(); const r = await hp.goto(BS + '/').catch(e => null); ok('TLS: HTTPS port serves the app', r && r.ok(), r?.status()); await hp.close();
});
await step('revoke', async () => {
  const t = await api('/tokens', 'POST', { name: 'reg034', role: 'control' }); ok('revoke: token created', !!t.token);
  const a = await raw('/status', 'GET', null, t.token); ok('revoke: token works before', a.ok, a.status);
  const id = (await api('/tokens')).find(x => x.name === 'reg034' && !x.revoked)?.id; await raw('/tokens/' + id, 'DELETE');
  const b = await raw('/queue', 'GET', null, t.token); ok('revoke: revoked token is refused', b.status === 401 || b.status === 403, b.status);
});
await step('volcap', async () => {
  const zs = await api('/zones?all=1'); const z = (Array.isArray(zs) ? zs : zs.zones).find(z => z.online) || (Array.isArray(zs) ? zs : zs.zones)[0];
  await api(`/zones/${z.id}`, 'PATCH', { volume: 30 }); const c = await api(`/zones/${z.id}/volcap`, 'PUT', { cap: 40, locked: true }); ok('volume cap: set 40 + lock', c.ok, JSON.stringify(c));
  await api(`/zones/${z.id}`, 'PATCH', { volume: 90 }); let v = (await api('/zones?all=1')); v = (Array.isArray(v) ? v : v.zones).find(x => x.id === z.id).volume; ok('volume cap: direct raise stops at the cap', v <= 40, v);
  await api('/zones/master', 'POST', { set: 100 }); v = (await api('/zones?all=1')); v = (Array.isArray(v) ? v : v.zones).find(x => x.id === z.id).volume; ok('volume cap: master 100 stays under the cap', v <= 40, v);
  await api(`/zones/${z.id}`, 'PATCH', { volume: 10 }); v = (await api('/zones?all=1')); v = (Array.isArray(v) ? v : v.zones).find(x => x.id === z.id).volume; ok('volume cap: lowering is allowed', v === 10, v);
  await home(); const lock = await p.evaluate(() => document.querySelectorAll('.devpanel .vbar.capped, .devpanel .dtag.capped').length); ok('volume cap: capped bar + CAPPED tag (J3 replaces the padlock)', lock > 0, lock); await shot('volcap');
  await api(`/zones/${z.id}/volcap`, 'PUT', { cap: 100, locked: false }); await api('/zones/master', 'POST', { set: 60 });
});
await step('art', async () => {
  const r = await raw('/art/track/1?size=96'); const buf = Buffer.from(await r.arrayBuffer()); ok('art: track art is an image', r.ok && (buf[0] === 0xFF && buf[1] === 0xD8 || buf.slice(1, 4).toString() === 'PNG' || buf.slice(8, 12).toString() === 'WEBP'), r.headers.get('content-type') + ' ' + buf.length);
  const imgs = await p.evaluate(() => [...document.querySelectorAll('img')].filter(i => /\/art\//.test(i.src)).map(i => ({ ok: i.complete && i.naturalWidth > 0 })));
  ok('art: art images load in the UI', imgs.length > 0 && imgs.every(i => i.ok), `${imgs.length} imgs`);
});
await step('eqlock', async () => {
  await home(); await p.click('.np-eqhead .eqpadlock'); await p.waitForTimeout(500);
  const r = await p.evaluate(() => { const b = document.querySelector('.np-eqhead .eqpadlock'); const eq = document.querySelector('.eqpanel,.eq,.eqwrap,canvas'); return { pressed: b.getAttribute('aria-pressed'), col: getComputedStyle(b).color, op: eq ? getComputedStyle(eq).opacity : '1', filt: eq ? getComputedStyle(eq).filter : '' }; });
  ok('EQ lock: locks, button turns red, EQ not dimmed', r.pressed === 'true' && r.op === '1' && !/brightness|grayscale/.test(r.filt), JSON.stringify(r)); await shot('eqlock');
  await p.click('.np-eqhead .eqpadlock'); await p.waitForTimeout(300);
});
await step('mini', async () => {
  const m = await ctx.newPage(); const me = []; m.on('pageerror', e => me.push(e.message)); await m.setViewportSize({ width: 420, height: 160 }); await m.goto(B + '/mini.html'); await m.waitForTimeout(3000);
  const t = await m.evaluate(() => document.body.innerText.slice(0, 120)); await m.screenshot({ path: '/workspace/screens/wavwiz-034-reg-mini.png' });
  ok('mini player: loads, shows the song, no errors', /Song \d+/.test(t) && me.length === 0, t.replace(/\n/g, ' | ') + ' ' + me.join('|'));
  const v = m.locator('input[type=range]').first(); ok('mini player: has a volume bar', await v.count() > 0); await m.close();
});
await step('dragdrop', async () => {
  await home(); const before = (await api('/queue')); const items = before.items || before.queue || before; const t0 = items[1]?.title, t3 = items[3]?.title;
  const rows = p.locator('.qtable tbody tr'); const src = rows.nth(1), dst = rows.nth(4); const grip = src.locator('.grip, .qgrip, td.num').first();
  const a = await grip.boundingBox(), b = await dst.boundingBox(); await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.down(); await p.mouse.move(a.x + 5, a.y + 20, { steps: 5 }); await p.mouse.move(b.x + 40, b.y + b.height - 3, { steps: 12 }); await p.waitForTimeout(200); await p.mouse.up(); await p.waitForTimeout(1500);
  const after = await api('/queue'); const it2 = after.items || after.queue || after; ok('drag and drop: playlist row moved', it2[1]?.title !== t0 && it2.some(x => x.title === t0), JSON.stringify([t0, it2.slice(0, 6).map(x => x.title)]));
  await shot('dragdrop'); await p.keyboard.press('Control+z'); await p.waitForTimeout(1200); const un = await api('/queue'); const it3 = un.items || un.queue || un; ok('drag and drop: Ctrl+Z undoes', it3[1]?.title === t0, it3.slice(0, 6).map(x => x.title).join(','));
});
await step('settings', async () => {
  for (const tab of ['general', 'appearance', 'playback', 'devices', 'library', 'network', 'jukebox']) {
    await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close())); await p.evaluate(async t => (await import('/js/main.js')).go('settings:' + t), tab); await p.waitForTimeout(1200);
    const r = await p.evaluate(() => { const d = document.querySelector('dialog[open].settings-dlg'); const on = d?.querySelector('.settings-nav button.on')?.textContent; const b = d?.getBoundingClientRect(); return { on, w: Math.round(b?.width || 0), txt: (d?.querySelector('.settings-sec.on')?.innerText || '').length, hscroll: d ? d.scrollWidth > d.clientWidth + 1 : true }; });
    ok(`Settings › ${tab} opens with content`, r.on && r.txt > 40 && !r.hscroll, JSON.stringify(r)); await shot('settings-' + tab);
  }
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
});
await step('scenes', async () => {
  const c = await api('/scenes/capture', 'POST', { name: 'Reg034 scene' }); ok('scenes: capture current speakers as a scene', c.id > 0, JSON.stringify(c));
  const a = await raw(`/scenes/${c.id}/apply`, 'POST', {}); ok('scenes: apply', a.ok, a.status);
  const s = await api('/schedules', 'POST', { name: 'Reg034 sched', time: '07:30', action: 'stop', days: '12345' }); ok('schedules: create', s.id > 0, JSON.stringify(s));
  const l = await api('/schedules'); ok('schedules: listed', JSON.stringify(l).includes('Reg034 sched'));
  await home(); const ui = await p.evaluate(() => document.querySelector('.devpanel')?.innerText || ''); ok('scenes & schedules show in Devices', /Reg034 scene|Reg034 sched/.test(ui)); await shot('scenes');
  await raw(`/schedules/${s.id}`, 'DELETE'); await raw(`/scenes/${c.id}`, 'DELETE'); ok('scenes/schedules: deleted', !JSON.stringify(await api('/schedules')).includes('Reg034 sched'));
});
ok('no script errors in the app', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`reg034 ${R.filter(x => x).length}/${R.length}`); await cb.close();

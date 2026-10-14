// WavWiz 0.3.5 Jukebox: J13 empty start + playlist restore, J9 #13 host panel, J14 big screen fills 1080p AND 4K in Modern and Retro CD
// (16:9 stage scaled to the screen, also with display size Large), J18 "N available plays" live on two guest phones. Usage: node jukebox035.mjs [webkit]
import { chromium, webkit, devices } from 'playwright';
import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim();
const api = async (p, m = 'GET', b) => { const r = await fetch(B + '/api/v1' + p, { method: m, headers: { Cookie: 'unison_session=' + sess, Origin: B, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const R = []; const ok = (n, c, i = '') => { R.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? ' :: ' + String(i).slice(0, 500) : '')); };
const step = async (n, f) => { try { await f(); } catch (e) { ok(n, false, String(e).slice(0, 500)); } };
const GE = process.argv[2] === 'webkit' ? await webkit.launch() : null;
const cb = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctxOf = async (b, opt, init) => { const c = await b.newContext(opt); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]); await c.addInitScript(i => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); if (i) for (const [k, v] of Object.entries(i)) localStorage.setItem(k, v); }, init || null); return c; };
const lib = await api('/library/tracks?limit=50');
for (const style of ['modern', 'retro']) {
  await api('/jukebox/stop', 'POST', { pin: '2468' }).catch(() => {});
  await api('/queue/clear', 'POST', {}); await api('/queue/add', 'POST', { kind: 'tracks', ids: lib.slice(0, 4).map(t => t.id) });
  const before = (await api('/queue')).items?.map(x => x.refId) ?? null;
  await api('/jukebox/config', 'PUT', { style, perGuest: 3 });
  const st = await api('/jukebox/start', 'POST', { pin: '2468' });
  await step(`[${style}] J13`, async () => { const q = await api('/queue'); const items = q.items || q; ok(`[${style}] J13 Jukebox starts with an empty playlist (or one filler song)`, items.length <= 1, items.length); });
  for (const [vp, w, hgt, z] of [['1080p', 1920, 1080, null], ['4k', 3840, 2160, null], ['4k-large', 3840, 2160, 'large']]) await step(`[${style}] J14 ${vp}`, async () => {
    const c = await ctxOf(cb, { viewport: { width: w, height: hgt } }, z ? { 'wavwiz.uiscale': z } : null); const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(B + '/'); await p.waitForTimeout(3000); await p.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); document.querySelectorAll('.phone-unlock').forEach(e => e.remove()); });
    await p.locator('#jbchip').click(); await p.waitForTimeout(600);
    const panel = await p.evaluate(() => { const e = document.querySelector('.jbpanel'); return !!e && e.getBoundingClientRect().height > 0 && !document.querySelector('dialog[open]'); });
    if (vp === '1080p') ok(`[${style}] J9#13 host controls are a dropdown under the chip, not a window`, panel);
    await p.locator('.jbpanel button', { hasText: 'Open big screen' }).click(); await p.waitForTimeout(2500);
    const r = await p.evaluate(() => { const s = document.querySelector('.jb-stage'); if (!s) return null; const b = s.getBoundingClientRect(); const fs = el => el ? parseFloat(getComputedStyle(el).fontSize) * (b.width / s.offsetWidth) : 0;
      return { w: Math.round(b.width), h: Math.round(b.height), l: Math.round(b.left), t: Math.round(b.top), vw: innerWidth, vh: innerHeight, k: getComputedStyle(document.querySelector('.jb')).getPropertyValue('--k2').trim() }; });
    await p.screenshot({ path: `/workspace/screens/wavwiz-035-jb-${style}-${vp}.png` });
    const cover = r && Math.max(r.w / r.vw, r.h / r.vh) >= 0.97;
    ok(`[${style}] J14 ${vp} big screen fills the screen (no tiny letterboxed layout)`, cover, JSON.stringify(r));
    ok(`[${style}] J14 ${vp} no page errors`, errs.length === 0, errs.join('|')); await c.close();
  });
  if (style === 'modern') await step('J18 two guests', async () => {
    const gb = GE || cb; const gs = [];
    for (const n of ['A', 'B']) { const c = await gb.newContext({ ...devices['iPhone 13'], ...(GE ? {} : { defaultBrowserType: undefined }) }); const p = await c.newPage(); await p.goto(B + '/jukebox.html?j=' + encodeURIComponent(st.code)); await p.waitForTimeout(2500); gs.push({ c, p, n }); }
    const left = g => g.p.evaluate(() => { const e = document.querySelector('.jb-plays'); return e ? { n: +e.dataset.left, t: e.textContent } : null; });
    const gid = g => g.p.evaluate(() => Object.entries(localStorage).find(([k]) => /guest/i.test(k) && !/name/i.test(k))?.[1]);
    let a = await left(gs[0]), b = await left(gs[1]);
    ok('J18 both guests start at "3 available plays"', a?.t === '3 available plays' && b?.t === '3 available plays', JSON.stringify([a, b]));
    const add = async (g, i) => g.p.evaluate(async ([tid, nm]) => { const m = await import('/js/jukebox-core.js'); const r = await fetch('/api/v1/jukebox/guest/add', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WavWiz-Guest': new URLSearchParams(location.search).get('j') }, body: JSON.stringify({ guest: m.guestId(), name: nm, trackId: tid }) }); return r.status; }, [lib[i].id, 'Guest ' + g.n]);
    const s1 = await add(gs[0], 5); await gs[0].p.waitForTimeout(2500); a = await left(gs[0]); b = await left(gs[1]);
    ok('J18 A adds one: A shows 2, B still 3 (live, no reload)', s1 === 200 && a?.n === 2 && b?.n === 3, JSON.stringify([s1, a, b]));
    await add(gs[0], 6); await add(gs[0], 7); await gs[0].p.waitForTimeout(2500); a = await left(gs[0]);
    ok('J18 after 3 picks A shows 0 available plays', a?.n === 0, JSON.stringify(a));
    ok('J18 a 4th pick is blocked', (await add(gs[0], 8)) === 409);
    await gs[0].p.reload(); await gs[0].p.waitForTimeout(2500); a = await left(gs[0]); ok('J18 count survives a page refresh', a?.n === 0, JSON.stringify(a));
    await gs[0].p.screenshot({ path: '/workspace/screens/wavwiz-035-jb-guest-plays.png' });
    for (const g of gs) await g.c.close();
  });
  await api('/jukebox/stop', 'POST', { pin: '2468' });
  await step(`[${style}] J13 restore`, async () => { const after = (await api('/queue')).items?.map(x => x.refId) ?? null; ok(`[${style}] J13 stop puts the host playlist back`, before && after && before.every(id => after.includes(id)), JSON.stringify({ before, after })); });
}
await cb.close(); await GE?.close();
console.log(`\njukebox035: ${R.filter(Boolean).length}/${R.length} passed`); process.exit(R.every(Boolean) ? 0 : 1);

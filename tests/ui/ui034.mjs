// WavWiz 0.3.4: views + layout the way a user uses the app. 1920/1440/1280 + iPhone 13. Screenshots to /workspace/screens/wavwiz-034-v-*.png
import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim();
const R = []; const ok = (n, c, i = '') => { R.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? ' :: ' + String(i).slice(0, 600) : '')); };
const api = async (p, m = 'GET', b) => { const r = await fetch(B + '/api/v1' + p, { method: m, headers: { Cookie: 'unison_session=' + sess, Origin: B, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const step = async (n, f) => { try { await f(); } catch (e) { ok(n, false, String(e).slice(0, 600)); } };
const THEMES = ['default', 'pepecoin', 'ember', 'arctic', 'violet', 'mono', 'daylight', 'nebula', 'steel', 'lime'];
const NORMAL = { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'open' };
const cb = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
for (let i = 0; i < 4; i++) { const x = await cb.newContext({ viewport: { width: 900, height: 700 } }); await x.addCookies([{ name: 'unison_session', value: sess, url: B }]); const sp = await x.newPage(); await sp.goto(B + '/'); await sp.waitForTimeout(2500); await sp.mouse.click(450, 350); await sp.waitForTimeout(500); }
await api('/jukebox/stop', 'POST', { pin: '2468' }).catch(() => {});
await api('/queue/clear', 'POST', {}); const lib = await api('/library/tracks?limit=50');
await api('/queue/add', 'POST', { kind: 'tracks', ids: lib.map(t => t.id) }); await api('/stream/jump', 'POST', { index: 0 });
// realistic Devices data: two zones (one muted), like the approved render
{ const zs = await api('/zones?all=1'); const ids = (Array.isArray(zs) ? zs : zs.zones || []).map(z => z.id).filter(Boolean);
  for (const g of (await api('/groups')) || []) await api('/groups/' + g.id, 'DELETE');
  if (ids.length >= 3) { await api('/groups', 'POST', { name: 'Living Room', deviceIds: ids.slice(0, 2) }); await api('/groups', 'POST', { name: 'Patio', deviceIds: ids.slice(2, 3) }); const gl = await api('/groups'); if (gl[1]) await api(`/groups/${gl[1].id}/mute`, 'POST', { muted: true }); }
  console.log('zones', JSON.stringify(await api('/groups')).slice(0, 300)); }
const VPS = (process.argv[2]==='h3') ? [['1440', { viewport: { width: 1440, height: 900 } }]] : [['1920', { viewport: { width: 1920, height: 1080 } }], ['1440', { viewport: { width: 1440, height: 900 } }], ['1280', { viewport: { width: 1280, height: 720 } }], ['iphone', devices['iPhone 13']]];
const inside = (a, b, t = 1) => a.left >= b.left - t && a.right <= b.right + t && a.top >= b.top - t && a.bottom <= b.bottom + t;
for (const [tag, opt] of VPS) {
  const ctx = await cb.newContext(opt); await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const shot = n => p.screenshot({ path: `/workspace/screens/wavwiz-034-v-${n}-${tag}.png` });
  const home = async pan => { if (pan) await p.evaluate(v => localStorage.setItem('wavwiz.panels', JSON.stringify(v)), pan); await p.goto(B + '/'); await p.waitForTimeout(3000); await p.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); document.querySelectorAll('.phone-unlock').forEach(e => e.remove()); }); await p.waitForTimeout(300); };
  await p.goto(B + '/'); await p.waitForTimeout(500);
  const phone = tag === 'iphone';
  await step(`[${tag}] standard`, async () => {
    await home(NORMAL); await shot('home');
    if (!phone) {
      const r = await p.evaluate(() => { const rows = [...document.querySelectorAll('.devpanel .drow')]; return { n: rows.length, swIn: rows.every(r => { const s = r.querySelector('.sw'); if (!s) return true; const a = s.getBoundingClientRect(), b = r.getBoundingClientRect(); return a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1; }) }; });
      ok(`[${tag}] standard Devices: rows render, switches inside their rows`, r.n > 0 && r.swIn, JSON.stringify(r));
    }
    // H2 playlist numbers 10+
    const q = await p.evaluate(() => { const rows = [...document.querySelectorAll('.qtable tbody tr')].filter(r => r.offsetParent); const nums = rows.map(r => r.querySelector('td.num')).filter(Boolean);
      return { n: rows.length, hs: [...new Set(rows.map(r => Math.round(r.getBoundingClientRect().height)))], wrap: nums.filter(td => td.scrollHeight > td.clientHeight + 2 || td.getClientRects().length > 1).length, numText: nums.slice(9, 13).map(t => t.textContent.trim()) }; });
    ok(`[${tag}] H2 playlist ${q.n} rows, 10+ on one line (one row height)`, q.n >= 12 ? q.hs.length === 1 && q.wrap === 0 : phone, JSON.stringify(q));
    await p.evaluate(() => { const t = document.querySelector('.qtable'); t?.closest('.listpanel,.qwrap,.scroll')?.scrollTo?.(0, 400); document.querySelectorAll('.qtable tbody tr')[11]?.scrollIntoView({ block: 'center' }); }); await p.waitForTimeout(300); await shot('playlist');
  });
  if (!phone) {
    await step(`[${tag}] devices expanded`, async () => {
      await home({ ...NORMAL, exp: 'dev' }); await shot('devices-expanded');
      const r = await p.evaluate(() => { const bar = document.querySelector('.npbar'), pan = document.querySelector('.devpanel'); const b = bar.getBoundingClientRect(), d = pan.getBoundingClientRect();
        const ss = document.querySelector('.e1 .sscol')?.getBoundingClientRect(); const rows = [...document.querySelectorAll('.e1 .srow')];
        const swBad = rows.filter(r => { const s = r.querySelector('.sw').getBoundingClientRect(), l = r.querySelector('.sline').getBoundingClientRect(); return !(s.left >= l.left - 1 && s.right <= l.right + 1 && s.top >= l.top - 1 && s.bottom <= l.bottom + 1) || (ss && s.right > ss.left); }).length;
        const outs = rows.map(r => { const o = r.querySelector('.sout'); return o ? { t: o.textContent.trim(), w: Math.round(o.getBoundingClientRect().width) } : null; });
        return { barVis: getComputedStyle(bar).visibility !== 'hidden' && b.height > 0, overlap: b.top < d.bottom - 1, b: [b.top, b.bottom].map(Math.round), d: [d.top, d.bottom].map(Math.round), n: rows.length, swBad, outs, page: document.documentElement.scrollWidth <= innerWidth + 1 }; });
      ok(`[${tag}] H8 expanded Devices: NP bar visible and below the panel (no overlap)`, r.barVis && !r.overlap, JSON.stringify({ b: r.b, d: r.d }));
      ok(`[${tag}] H8b switches stay in their rows, not in the Scenes column`, r.n > 0 && r.swBad === 0, `${r.n} rows, bad ${r.swBad}`);
      ok(`[${tag}] H8b output names show`, r.outs.every(o => o && o.t.length > 0 && o.w > 20), JSON.stringify(r.outs));
      ok(`[${tag}] no horizontal page scroll`, r.page);
      const hc = await p.evaluate(() => [...document.querySelectorAll('.devpanel .devbody :is(.pane-h.dsec-h,.dss>.pane-h,.slimsub)>span:first-child')].filter(e => e.offsetParent).map(e => e.textContent.trim() + '=' + getComputedStyle(e).color));
      ok(`[${tag}] H9 Zones / Speakers / Scenes & Schedules headings same color`, hc.length >= 3 && new Set(hc.map(x => x.split('=')[1])).size === 1, hc.join(', '));
    });
    await step(`[${tag}] library expanded`, async () => {
      await home({ ...NORMAL, exp: 'lib' }); await shot('library-expanded');
      const r = await p.evaluate(() => { const b = document.querySelector('.npbar').getBoundingClientRect(), d = document.querySelector('.libpanel').getBoundingClientRect(); return { vis: b.height > 0 && getComputedStyle(document.querySelector('.npbar')).visibility !== 'hidden', b: [b.top, b.bottom].map(Math.round), d: [d.top, d.bottom].map(Math.round), inView: b.bottom <= innerHeight + 1 }; });
      ok(`[${tag}] H8 expanded Library: NP bar visible, below the panel, on screen`, r.vis && r.b[0] >= r.d[1] - 1 && r.inView, JSON.stringify(r));
      await p.evaluate(v => localStorage.setItem('wavwiz.panels', JSON.stringify(v)), { ...NORMAL, exp: 'lib', list: 'expanded' }); await home(); 
      const r2 = await p.evaluate(() => { const b = document.querySelector('.npbar').getBoundingClientRect(), d = document.querySelector('.libpanel').getBoundingClientRect(); return { b: Math.round(b.top), d: Math.round(d.bottom), h: Math.round(b.height) }; });
      ok(`[${tag}] H8 expanded Library + expanded Playlist state: still no overlap`, r2.h > 0 && r2.b >= r2.d - 1, JSON.stringify(r2)); await shot('library-expanded-listexp');
    });
  }
  await step(`[${tag}] settings jukebox`, async () => {
    await home(NORMAL); await p.evaluate(async () => (await import('/js/main.js')).go('settings:jukebox')); await p.waitForTimeout(2000); await shot('settings-jukebox');
    const r = await p.evaluate(() => { const cs = [...document.querySelectorAll('dialog[open] .jbcard')]; const d = document.querySelector('dialog[open]').getBoundingClientRect(); return { n: cs.length, styles: cs.map(c => c.dataset.style), inside: cs.every(c => { const a = c.getBoundingClientRect(); return a.width > 100 && a.right <= d.right + 1 && a.left >= d.left - 1; }), on: cs.filter(c => c.classList.contains('on')).length,
      over: cs.filter(c => { const pv = c.firstElementChild; return pv && pv.scrollWidth > pv.clientWidth + 2; }).length }; });
    ok(`[${tag}] H4b Jukebox style preview cards (Modern + Retro CD), fit the dialog, one selected`, r.n >= 2 && r.styles.includes('modern') && r.styles.includes('retro') && r.inside && r.on === 1 && r.over === 0, JSON.stringify(r));
    const card = p.locator('dialog[open] .jbcard[data-style=retro]'); await card.scrollIntoViewIfNeeded(); await card.click(); await p.waitForTimeout(1200);
    ok(`[${tag}] H4 clicking Retro CD card saves the style`, (await api('/jukebox/config')).style === 'retro'); await shot('settings-jukebox-retro');
    await p.locator('dialog[open] .jbcard[data-style=modern]').click(); await p.waitForTimeout(1000); ok(`[${tag}] ...and back to Modern`, (await api('/jukebox/config')).style === 'modern');
  });
  if (tag === '1440') await step('H3 slider styles x10 themes', async () => {
    for (const st of ['gradient', 'flat']) for (const t of THEMES) {
      await p.evaluate(({ t, st }) => { localStorage.setItem('wavwiz.theme', JSON.stringify({ preset: t })); localStorage.setItem('wavwiz.sliderstyle', st); }, { t, st });
      await home(NORMAL); await p.evaluate(async t => { const m = await import('/js/theme.js'); m.applyTheme({ ...m.PRESETS[t], preset: t }); }, t); await p.waitForTimeout(400);
      const r = await p.evaluate(() => { const i = [...document.querySelectorAll('.dvol input[type=range]')].find(e => e.offsetParent); i.value = '80'; i.style.setProperty('--v', '80%'); return { ds: document.documentElement.dataset.slider, tv: getComputedStyle(document.documentElement).getPropertyValue('--voltrack').trim() }; });
      await p.waitForTimeout(200);
      for (let k = 0; k < 3; k++) { try { await p.locator('.dvol input[type=range]').first().screenshot({ path: `/workspace/screens/wavwiz-034-v-slider-${st}-${t}.png`, timeout: 5000 }); break; } catch { await p.waitForTimeout(500); } }
      ok(`H3 [${t}] ${st} applied`, r.ds === st, JSON.stringify(r));
    }
    await p.evaluate(() => { localStorage.setItem('wavwiz.theme', JSON.stringify({ preset: 'default' })); localStorage.setItem('wavwiz.sliderstyle', 'gradient'); });
  });
  ok(`[${tag}] no script errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}
console.log(`ui034 ${R.filter(x => x).length}/${R.length}`); await cb.close();

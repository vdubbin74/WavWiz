// WavWiz 0.3.7 (L1-L26): the app the way a user uses it. Usage: node ui035.mjs [chromium|webkit] [shots]
// Viewports: 1920x1080, 1280x720, iPhone 13, 4K (3840x2160). Screenshots: /workspace/screens/wavwiz-036-<engine>-<n>-<vp>.png;
// with "shots": every theme x desktop/phone/1080p/4K -> /workspace/screens/wavwiz-036-theme-<theme>-<vp>.png
import { chromium, webkit, devices } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const ENG = process.argv[2] || 'chromium', SHOTS = process.argv.includes('shots'), ONLYSHOTS = process.argv.includes('onlyshots');
const B = 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim();
const R = []; const ok = (n, c, i = '') => { R.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? ' :: ' + String(i).slice(0, 500) : '')); };
const api = async (p, m = 'GET', b) => { const r = await fetch(B + '/api/v1' + p, { method: m, headers: { Cookie: 'unison_session=' + sess, Origin: B, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const zlist = async () => { const x = await api('/zones?all=1'); return Array.isArray(x) ? x : x.zones || []; };
const step = async (n, f) => { try { await f(); } catch (e) { ok(n, false, String(e).slice(0, 500)); } };
const THEMES = ['default', 'pepecoin', 'ember', 'arctic', 'violet', 'mono', 'daylight', 'nebula', 'steel', 'lime'];
const NORMAL = { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'open' };
mkdirSync('/workspace/screens', { recursive: true });
const br = await (ENG === 'webkit' ? webkit : chromium).launch(ENG === 'webkit' ? {} : { args: ['--autoplay-policy=no-user-gesture-required'] });
await api('/jukebox/stop', 'POST', { pin: '2468' }).catch(() => {});
const zones = await zlist(); const capZ = zones.find(z => z.connected) || zones[0];
const VPS = [['1920', { viewport: { width: 1920, height: 1080 } }], ['1280', { viewport: { width: 1280, height: 720 } }], ['iphone', devices['iPhone 13']], ['4k', { viewport: { width: 3840, height: 2160 } }]];
async function newPage(opt) {
  const o = { ...opt }; delete o.defaultBrowserType; if (ENG === 'chromium') { /* isMobile works in Chromium */ } else if (ENG === 'webkit') { /* ok */ }
  const ctx = await br.newContext(o); await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); });
  const p = await ctx.newPage(); p._errs = []; p.on('pageerror', e => { if (!/due to access control checks|Load failed/.test(e.message)) p._errs.push(e.message); }); return { ctx, p };   // WebKit reports fetches cut off by our own page.goto as errors
}
const closeDlg = p => p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
const home = async (p, pan, theme) => { await p.goto(B + '/'); await p.evaluate(([v, t]) => { if (v) localStorage.setItem('wavwiz.panels', JSON.stringify(v)); }, [pan, theme]); await p.goto(B + '/'); await p.waitForTimeout(2500); await closeDlg(p); await p.locator('.phone-unlock').click({ timeout: 1500 }).catch(() => {}); if (theme) { await p.evaluate(async id => { const t = await import('/js/theme.js'); t.applyTheme({ ...t.PRESETS[id], preset: id }); }, theme); } await p.waitForTimeout(theme ? 600 : 200); };   // the 'Tap anywhere to start sound' prompt
const go = (p, k) => p.evaluate(async k => (await import('/js/main.js')).go(k), k);
const dlgW = p => p.evaluate(() => { const d = document.querySelector('dialog[open]'); return d ? Math.round(d.getBoundingClientRect().width) : -1; });
const hoverItem = async (p, top, label) => { await p.click(`.menubar .mtop:text-is("${top}")`); const it = p.locator(`.menubar .mgroup.open > .mpanel > .msub > button:text-is("${label}"), .menubar .mgroup.open > .mpanel > button:text-is("${label}")`).first(); await it.hover(); await p.waitForTimeout(450); return it; };
  // 0.3.7: every EQ entry point -> the ONE center EQ (never the old Sound popup), on the shared glide + pulse
  await step('EQ entry points', async () => {
    for (const [vpn, vopt] of VPS) {
      const { ctx, p } = await newPage(vopt); const phone = vpn === 'iphone';
      const fresh = async (pan) => { await p.goto(B + '/'); await p.evaluate(([v]) => { localStorage.setItem('wavwiz.center.v1', 'viz'); localStorage.setItem('wavwiz.center.migrated030', '1'); if (v) localStorage.setItem('wavwiz.panels', JSON.stringify(v)); }, [pan]); await p.goto(B + '/'); await p.waitForTimeout(2200); await closeDlg(p); };
      const check = async (name) => {
        await p.waitForTimeout(700);
        const r = await p.evaluate(() => ({ dlg: !!document.querySelector('dialog[open]'), title: document.querySelector('dialog[open] h2,dialog[open] header')?.textContent || '',
          eq: !!document.querySelector('.np-stage.eqmode'), eqv: !!document.querySelector('.np-stage .eqv, .np-stage .ceq, .np-stage canvas.eqcanvas, .np-stage [class*=eq]'), pulsed: !!document.querySelector('.np-stage.k-pulse, .np-stage[data-eqfront]'),
          vis: (() => { const s = document.querySelector('.np-stage'); if (!s) return false; const b = s.getBoundingClientRect(); return b.width > 20 && b.height > 20 && b.bottom > 0 && b.top < innerHeight; })() }));
        ok(`EQ[${vpn}] ${name}: center EQ, no Sound popup, visible, pulsed`, !r.dlg && r.eq && r.vis && r.pulsed, JSON.stringify(r));
        await p.screenshot({ path: `/workspace/screens/wavwiz-037-${ENG}-eq-${vpn}-${name.replace(/\W+/g, '')}.png` });
      };
      // every EQ button in the Now Playing panel (bar, full panel, control strip)
      await fresh(NORMAL);
      const n = await p.evaluate(() => document.querySelectorAll('.eqbtn').length); ok(`EQ[${vpn}] Now Playing has EQ buttons`, n >= 1, n);
      for (let i = 0; i < n; i++) {
        await fresh(NORMAL);
        const vis = await p.evaluate(i => { const b = [...document.querySelectorAll('.eqbtn')][i]; return !!(b && b.getClientRects().length); }, i);
        if (!vis) continue;
        await p.evaluate(i => [...document.querySelectorAll('.eqbtn')][i].click(), i); await check('button' + i);
      }
      if (!phone) {   // from an expanded Library / Devices / Queue the EQ button (and the menu) must collapse it and bring the center EQ forward
        for (const [nm, pan] of [['lib', { lib: 'normal', dev: 'normal', exp: 'lib', list: 'open', ctl: 'open' }], ['dev', { lib: 'normal', dev: 'normal', exp: 'dev', list: 'open', ctl: 'open' }]]) {
          await fresh(pan); const ok1 = await p.evaluate(() => { const b = [...document.querySelectorAll('.eqbtn')].find(b => b.getClientRects().length); if (b) b.click(); return !!b; });
          if (ok1) { await check(`from-${nm}-expanded`); ok(`EQ[${vpn}] expanded ${nm} collapsed`, !(await p.evaluate(() => document.querySelector('.desk')?.className || '')).includes(nm + 'expanded')); }
        }
        await fresh(NORMAL); await go(p, 'eq'); await check('go-eq');
        await fresh(NORMAL); await p.evaluate(() => window.dispatchEvent(new Event('resize')));
        try { await hoverItem(p, 'Playback', 'Sound / EQ'); await p.evaluate(() => { const o = [...document.querySelectorAll('.menubar .msub.open > .mpanel button')].find(b => /Open the EQ/.test(b.textContent)); o?.click(); }); await check('menu-open-the-eq'); } catch (e) { ok(`EQ[${vpn}] menu`, false, e); }
      } else { await fresh(null); await go(p, 'eq'); await check('go-eq'); }
      ok(`EQ[${vpn}] no page errors`, !p._errs.length, p._errs.join('|')); await ctx.close();
    }
  });
await br.close();
const fails = R.filter(x => !x).length; console.log(`\n${R.length - fails}/${R.length} passed`); process.exit(fails ? 1 : 0);

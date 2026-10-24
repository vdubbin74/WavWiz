// 0.4.7: the side Library tab row on a cold first load (side Library standard / collapsed, 100 % and 200 %), after expand -> collapse, and when the
// panel has no width at the first measure: the tabs are visible with a nonzero width and the "⋯" overflow never holds every tab.
// The active tab's text uses the theme's on-accent color: contrast >= 4.5:1 on its accent fill in all 10 themes (+ a light lilac custom theme).
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SH, TAG = process.env.TAG || 'after'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const base = { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' };
const probe = () => { const row = document.querySelector('.libpanel .ctabs'); if (!row || !row.offsetParent) return null; const t = [...row.querySelectorAll('button[role=tab]:not(.tabmore)')];
  const vis = t.filter(b => !b.hidden && b.getBoundingClientRect().width > 0); return { rowW: row.getBoundingClientRect().width, n: t.length, vis: vis.map(b => b.textContent), minW: Math.min(...vis.map(b => b.getBoundingClientRect().width)) }; };
const br = await chromium.launch();
const ctx = async (vw, vh, d, pn, css) => { const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([pn, css]) => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
    if (sessionStorage.getItem('f47')) return; sessionStorage.setItem('f47', '1');
    localStorage.setItem('wavwiz.theme.v1', JSON.stringify({ v: 4, preset: 'daylight', accent: '#E03500', accent2: '#0E8F82', hl: '#6B4EE6', bg: '#F3F1EE', ink: '#1A1D21' }));
    localStorage.setItem('wavwiz.layout', 'full'); localStorage.setItem('wavwiz.panels', JSON.stringify(pn));
    if (css) { const s = document.createElement('style'); s.textContent = css; document.documentElement.appendChild(s); setTimeout(() => s.remove(), 1500); } }, [pn, css]);
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(css ? 3200 : 2500); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close())); return [c, p]; };
const good = r => r && r.vis.length >= 1 && r.vis.length <= r.n && r.minW > 0 && r.rowW > 0;
for (const [vw, vh, d, z] of [[1920, 1080, 1, '100'], [960, 540, 2, '200']]) {
  for (const [sn, css] of [['cold', ''], ['cold-width0', '.libpanel{width:0!important;min-width:0!important;overflow:hidden!important}'], ['cold-hidden', '.libpanel .ctabwrap{display:none!important}']]) {
    const [c, p] = await ctx(vw, vh, d, base, css), t = `[${z} ${sn}]`; const r = await p.evaluate(probe);
    ok(`${t} the tabs are visible with a nonzero width and the overflow does not hold them all`, good(r), JSON.stringify(r));
    if (SH && sn === 'cold') await p.locator('.libpanel .ctabwrap').screenshot({ path: `/workspace/screens/047/tabs-${TAG}-coldload-${z}.png` });
    if (sn === 'cold') {   // the restore path: expand the Library, then back to standard
      await p.evaluate(() => document.querySelector('.libpanel .libexp')?.click()); await p.waitForTimeout(900);
      await p.evaluate(() => document.querySelector('.desk.libexpanded .libexp')?.click()); await p.waitForTimeout(1200);
      const wasExp = await p.evaluate(() => 1); const r2 = await p.evaluate(probe); ok(`${t} after expand -> standard the tabs are still visible`, good(r2), JSON.stringify(r2));
      if (r && r2) ok(`${t} the same tabs show before and after the round trip`, r.vis.join() === r2.vis.join(), JSON.stringify([r.vis, r2.vis]));
    }
    await c.close();
  }
}
// the active (accent-filled) tab: on-accent text, contrast >= 4.5:1, in every theme
{ const [c, p] = await ctx(1920, 1080, 1, base, '');
  const THEMES = ['default', 'pepecoin', 'ember', 'arctic', 'violet', 'mono', 'daylight', 'nebula', 'steel', 'lime', 'custom-lilac'];
  for (const th of THEMES) {
    await p.evaluate(async t => { const m = await import('/js/theme.js'); const th = t === 'custom-lilac' ? { preset: 'custom', accent: '#C8A2E8', bg: '#F6F4FA', ink: '#1A1D21' } : { preset: t, ...m.PRESETS[t] }; m.applyTheme(th); }, th); await p.waitForTimeout(150);
    const r = await p.evaluate(() => { const e = document.querySelector('.libpanel .ctabs button.on'); if (!e) return null; const cs = getComputedStyle(e), P = s => s.match(/[\d.]+/g).slice(0, 3).map(Number);
      const L = c => { const v = c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      const a = L(P(cs.color)), b = L(P(cs.backgroundColor)); return { fg: cs.color, bg: cs.backgroundColor, cr: Math.round((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) * 100) / 100, ink: getComputedStyle(document.documentElement).getPropertyValue('--accent-ink').trim() }; });
    ok(`[${th}] active tab text contrast >= 4.5:1 on its accent fill (${r?.cr})`, r && r.cr >= 4.5, JSON.stringify(r));
    if (SH && ['default', 'daylight', 'mono', 'lime', 'violet', 'custom-lilac'].includes(th)) await p.locator('.libpanel .ctabwrap').screenshot({ path: `/workspace/screens/047/active-${TAG}-${th}.png` });
  }
  await c.close(); }
await br.close(); console.log(`f47tabs: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

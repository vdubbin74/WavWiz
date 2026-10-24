// 0.4.6 F38: the condensed player (expanded Library) carries the chosen Now Playing layout (pn-<style>) in every theme, 100 % / 200 % (element shots
// for a contact sheet). F39: expanded Devices - the Library rail runs full height, the Now Playing bar is exactly the Devices area's width and left edge
// (±1 px), Full and Roomy, every layout. SHOTS=1 writes /workspace/screens/f38f39/*.
import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SHOTS, D = '/workspace/screens/f38f39-' + (process.env.TAG || 'after'); let pass = 0, fail = 0; if (SH) mkdirSync(D, { recursive: true });
const ok = (n, c, x = '') => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const THEMES = ['default', 'pepecoin', 'ember', 'arctic', 'violet', 'mono', 'daylight', 'nebula', 'steel', 'lime'], STYLES = ['classic', 'center', 'stack', 'horizon'];
const br = await chromium.launch();
const page = async (vw, vh, d, lay, pn) => { const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([lay, pn]) => { if (sessionStorage.getItem('f38')) return; sessionStorage.setItem('f38', '1'); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
    localStorage.setItem('wavwiz.uiscale', 'compact'); localStorage.setItem('wavwiz.layout', lay); localStorage.setItem('wavwiz.panels', JSON.stringify(pn)); }, [lay, pn]);
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2800); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close())); return { c, p }; };
const setStyle = (p, s) => p.evaluate(async s => { const m = await import('/js/npstyle.js'); m.saveNpPrefs({ ...m.loadNpPrefs(), style: s }); }, s);
const setTheme = (p, t) => p.evaluate(async t => { const m = await import('/js/theme.js'); const th = { preset: t, ...(m.PRESETS[t] || {}) }; try { m.saveTheme(th); } catch { } m.applyTheme(th); }, t);
for (const [vw, vh, d, zt] of [[1920, 1080, 1, '100'], [960, 540, 2, '200']]) {
  // F38
  { const { c, p } = await page(vw, vh, d, 'full', { lib: 'normal', dev: 'normal', exp: 'lib', list: 'open', ctl: 'collapsed' });
    for (const s of STYLES) { await setStyle(p, s); for (const th of THEMES) { await setTheme(p, th); await p.waitForTimeout(150);
      const r = await p.evaluate(() => { const m = document.querySelector('.minicol'); return { cls: m?.className, vis: !!m?.offsetParent, w: Math.round(m?.getBoundingClientRect().width || 0), h: Math.round(m?.getBoundingClientRect().height || 0), transp: !![...(m?.querySelectorAll('button') || [])].find(b => /transparen/i.test(b.textContent + b.title)) }; });
      ok(`[F38 ${zt} ${s} ${th}] condensed player carries pn-${s}, visible, Transparency kept`, r.vis && r.cls.split(' ').includes('pn-' + s) && r.transp, JSON.stringify(r));
      if (SH) await p.locator('.minicol').screenshot({ path: `${D}/F38-${zt}-${s}-${th}.png` }); } }
    await setStyle(p, 'classic'); await setTheme(p, 'default'); await c.close(); }
  // F39
  for (const lay of ['full', 'roomy']) { const { c, p } = await page(vw, vh, d, lay, { lib: 'normal', dev: 'expanded', exp: 'dev', list: 'open', ctl: 'collapsed' });
    for (const s of STYLES) { await setStyle(p, s); await p.waitForTimeout(300);
      const g = await p.evaluate(() => { const R = s => document.querySelector(s)?.getBoundingClientRect(); const lib = R('.libpanel'), bar = R('.npbar'), dev = R('.devpanel'), desk = R('.desk');
        return { cls: document.querySelector('.desk').className, lib: lib && [lib.left, lib.right, lib.top, lib.bottom], bar: bar && [bar.left, bar.right, bar.top, bar.bottom], dev: dev && [dev.left, dev.right, dev.top, dev.bottom] }; });
      const t = `[F39 ${zt} ${lay} ${s}]`;
      ok(`${t} the Library rail runs full height (to the bar's bottom)`, g.lib && g.bar && Math.abs(g.lib[3] - g.bar[3]) <= 1, JSON.stringify(g));
      ok(`${t} the bar's left / right edges match the Devices panel (±1 px)`, g.bar && g.dev && Math.abs(g.bar[0] - g.dev[0]) <= 1 && Math.abs(g.bar[1] - g.dev[1]) <= 1, JSON.stringify(g));
      ok(`${t} the bar sits below the Devices panel`, g.bar && g.dev && g.bar[2] >= g.dev[3] - 1, JSON.stringify(g));
      if (SH) await p.screenshot({ path: `${D}/F39-${zt}-${lay}-${s}.png` }); }
    await setStyle(p, 'classic'); await c.close(); }
}
await br.close(); console.log(`f38f39: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

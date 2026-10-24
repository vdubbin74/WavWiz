// 0.4.8 F48: the full-screen Queue shows the SAME full-size Now Playing bar as the collapsed Queue (the chosen layout's bar, pn-<style>, in the
// theme's colors) - never the legacy generic .npbar. Every layout x all 10 themes, Full + Roomy, 100 % / 200 %: the bar's class, size, surface,
// background / text / accent colors must equal the collapsed-Queue reference and the theme vars. Expanded Library / Devices bars: theme vars only.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(); let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const THEMES = ['default', 'pepecoin', 'ember', 'arctic', 'violet', 'mono', 'daylight', 'nebula', 'steel', 'lime'], STYLES = ['classic', 'center', 'stack', 'horizon'];
const base = { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' };
const br = await chromium.launch();
async function open(vw, vh, d, lay, pn) { const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([lay, pn]) => { if (sessionStorage.getItem('f48')) return; sessionStorage.setItem('f48', '1'); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
    localStorage.setItem('wavwiz.uiscale', 'compact'); localStorage.setItem('wavwiz.layout', lay); localStorage.setItem('wavwiz.panels', JSON.stringify(pn)); }, [lay, pn]);
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2800);
  await p.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(x => x.close()); const s = document.createElement('style'); s.textContent = '*,*::before,*::after{transition:none!important}'; document.head.append(s); }); return { c, p }; }
const set = (p, s, th) => p.evaluate(async ([s, t]) => { const n = await import('/js/npstyle.js'); n.saveNpPrefs({ ...n.loadNpPrefs(), style: s }); window.dispatchEvent(new CustomEvent('wavwiz:npstyle'));
  const m = await import('/js/theme.js'); m.applyTheme({ preset: t, ...(m.PRESETS[t] || {}) }); await new Promise(r => setTimeout(r, 60)); }, [s, th]);
const probe = p => p.evaluate(() => { const rgb = v => { const e = document.createElement('i'); e.style.color = v; document.body.append(e); const o = getComputedStyle(e).color; e.remove(); return o; };
  const rv = k => rgb(getComputedStyle(document.documentElement).getPropertyValue(k).trim()), vis = e => !!e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 50;
  const bars = [...document.querySelectorAll('.np-ctlpanel, .npbar, .minicol')].filter(vis); const b = bars[0]; if (!b) return { n: 0 };
  const cs = getComputedStyle(b), R = b.getBoundingClientRect(), pl = b.querySelector('.tbtn.play, .mp-b.play'), t1 = b.querySelector('.t1, .np-ctlnow, .mp-t');
  return { n: bars.length, cls: b.className, w: Math.round(R.width), h: Math.round(R.height), bg: cs.backgroundColor, bgi: cs.backgroundImage, ink: rv('--ink'), panel: rv('--panel'), acc: rv('--accent'),
    col: t1 ? getComputedStyle(t1).color : cs.color, play: pl ? getComputedStyle(pl).backgroundColor : null, legacy: vis(document.querySelector('.npbar')) }; });
for (const [vw, vh, d, zt] of [[1920, 1080, 1, '100'], [960, 540, 2, '200']]) for (const lay of ['full', 'roomy']) {
  const A = await open(vw, vh, d, lay, { ...base, list: 'collapsed' }), Q = await open(vw, vh, d, lay, { ...base, list: 'expanded' });
  for (const s of STYLES) for (const th of THEMES) { await set(A.p, s, th); await set(Q.p, s, th); const ref = await probe(A.p), r = await probe(Q.p), t = `[${zt} ${lay} queuefull ${s} ${th}]`;
    ok(`${t} exactly one player bar, not the legacy .npbar`, r.n === 1 && !r.legacy && /np-ctlpanel/.test(r.cls), JSON.stringify(r));
    ok(`${t} carries pn-${s}`, r.cls?.split(' ').includes('pn-' + s), r.cls);
    ok(`${t} same size as the collapsed-Queue bar`, r.w === ref.w && r.h === ref.h, `${r.w}x${r.h} vs ${ref.w}x${ref.h}`);
    ok(`${t} same surface as the collapsed-Queue bar`, r.bgi === ref.bgi && r.bg === ref.bg, r.bgi?.slice(0, 50));
    ok(`${t} background / text / accent are the theme's`, r.bg === r.panel && r.col === ref.col && r.play === r.acc, JSON.stringify([r.bg, r.panel, r.col, ref.col, r.play, r.acc])); }
  await A.c.close(); await Q.c.close();
  for (const [loc, pn] of [['devexpanded', { ...base, dev: 'expanded', exp: 'dev' }], ...(lay === 'full' ? [['libexpanded', { ...base, exp: 'lib' }]] : [])]) { const X = await open(vw, vh, d, lay, pn);
    for (const th of THEMES) { await set(X.p, 'classic', th); const r = await probe(X.p); ok(`[${zt} ${lay} ${loc} ${th}] bar background is the theme's --panel`, r.n >= 1 && r.bg === r.panel, JSON.stringify(r)); }
    await X.c.close(); } }
await br.close(); console.log(`f48playerbar: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

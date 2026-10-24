// 0.4.6 F42 + F43: iPhone (WebKit 390x844; Safari + emulated standalone PWA). F42: the EQ card header controls never overlap and are >= 44 px on touch;
// also PC (Chromium) 100 % / 200 % / narrow window: no overlap. F43: walks Now / Library / Devices / menu / Settings (+ a sub-page) / Scenes:
// no unthemed control, no horizontal overflow, nav controls >= 44 px, every sheet / page has a Back / Done / Close. SHOTS=1 TAG=x -> /workspace/screens/wavwiz-046-F4{2,3}-*.
import { webkit, chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SHOTS, TAG = process.env.TAG || 'after'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ctx = async (br, o, mode, theme) => { const c = await br.newContext(o); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(([mode]) => { if (mode === 'standalone') { Object.defineProperty(navigator, 'standalone', { get: () => true }); const mm = window.matchMedia.bind(window); window.matchMedia = q => /display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); }
    localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); }, [mode]);
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2800); await p.evaluate(() => document.querySelectorAll('dialog[open],.phone-unlock').forEach(e => e.close?.() || e.remove()));
  if (theme) { await p.evaluate(async t => { const m = await import('/js/theme.js'); m.applyTheme({ preset: t, ...(m.PRESETS[t] || {}) }); }, theme); await p.waitForTimeout(250); }
  return { c, p }; };
// header overlap check (F42)
const head = p => p.evaluate(() => { const h = document.querySelector('.np-eqhead'); if (!h) return null; const st = h.closest('.np-stage') || h.parentElement;
  const els = [...st.querySelectorAll('.vbtns .ib, .np-eqhead button, .np-eqhead select, .np-eqhead .np-eqname')].filter(e => e.getBoundingClientRect().width > 0);
  const R = els.map(e => { let r = e.getBoundingClientRect(); if (e.classList.contains('np-eqname')) { const g = document.createRange(); g.selectNodeContents(e); r = g.getBoundingClientRect(); r = { left: r.left, top: r.top, right: Math.min(r.right, e.getBoundingClientRect().right - parseFloat(getComputedStyle(e).paddingRight)), bottom: r.bottom, width: r.width, height: r.height }; } return { n: e.className, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, ctl: e.matches('button,select') }; });
  const ov = []; for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) { const a = R[i], b = R[j]; const x = Math.min(a.r, b.r) - Math.max(a.l, b.l), y = Math.min(a.b, b.b) - Math.max(a.t, b.t); if (x > 1 && y > 1) ov.push(a.n + ' x ' + b.n); }
  // the name's text may not reach under the buttons: compare its content box
  return { ov, small: R.filter(r => r.ctl && (r.h < 44 || r.w < 44)).map(r => r.n + ' ' + Math.round(r.w) + 'x' + Math.round(r.h)), n: R.length }; });
// F43 screen audit
const audit = p => p.evaluate(() => { const dark = !document.documentElement.className.includes('light') && getComputedStyle(document.body).backgroundColor.match(/\d+/g).slice(0, 3).reduce((a, b) => a + +b, 0) < 384;
  const UA_BG = ['rgb(239, 239, 239)', 'rgb(240, 240, 240)', 'rgb(233, 233, 237)', 'rgb(255, 255, 255)', 'rgb(221, 221, 221)'], bad = [];
  const scope = document.querySelector('dialog[open]') || document;
  for (const e of scope.querySelectorAll('button,input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]):not([type=color]),select,textarea')) { const r = e.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight) continue; const s = getComputedStyle(e);
    if (s.visibility === 'hidden' || +s.opacity === 0) continue;
    const ua = (dark && UA_BG.includes(s.backgroundColor)) || s.borderTopStyle === 'outset' || s.borderTopStyle === 'inset' || (dark && s.color === 'rgb(0, 0, 0)' && (UA_BG.includes(s.backgroundColor) || s.backgroundColor === 'rgba(0, 0, 0, 0)'));
    if (ua) bad.push(e.tagName + '.' + e.className + ' ' + s.backgroundColor + ' ' + s.color + ' ' + s.borderTopStyle); }
  const se = document.scrollingElement, dlg = document.querySelector('dialog[open]');
  const over = se.scrollWidth > se.clientWidth + 1 || (dlg && dlg.scrollWidth > dlg.clientWidth + 1);
  return { bad: bad.slice(0, 4), nbad: bad.length, over, sw: se.scrollWidth, dw: dlg && [dlg.scrollWidth, dlg.clientWidth] }; });
const closer = p => p.evaluate(() => { const d = document.querySelector('dialog[open]') || document.querySelector('.drawer.open nav') || document.querySelector('.sheet .panel'); if (!d) return { none: true };
  const b = [...d.querySelectorAll('button')].filter(e => e.getBoundingClientRect().width && /^(‹\s*)?(Close|Done|Back|✕|×)|^‹/.test((e.textContent || e.getAttribute('aria-label') || '').trim()));
  return { has: b.length > 0, big: b.some(e => e.getBoundingClientRect().height >= 44), lab: b.map(e => e.textContent.trim()).slice(0, 3) }; });
const wk = await webkit.launch();
for (const mode of ['standalone', 'safari']) for (const theme of mode === 'standalone' ? ['default', 'daylight', 'ember'] : ['default']) {
  const { c, p } = await ctx(wk, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA }, mode, theme);
  const T = (s) => `[${mode} ${theme} ${s}]`;
  const hd = await head(p); ok(`${T('Now')} F42 EQ header: no overlapping controls`, hd && hd.ov.length === 0, JSON.stringify(hd)); ok(`${T('Now')} F42 EQ header: every control >= 44 px`, hd && hd.small.length === 0, JSON.stringify(hd?.small));
  if (SH && theme === 'default') await p.screenshot({ path: `/workspace/screens/wavwiz-046-F42-${TAG}-${mode}-390.png` });
  const tab = async n => { await p.evaluate(n => [...document.querySelectorAll('button')].filter(e => e.offsetParent && new RegExp(n + '$').test(e.textContent.trim())).pop()?.click(), n); await p.waitForTimeout(900); };
  for (const n of ['Now', 'Library', 'Devices']) { await tab(n); const a = await audit(p); ok(`${T(n)} F43 themed controls`, a.nbad === 0, JSON.stringify(a.bad)); ok(`${T(n)} F43 no horizontal overflow at 390`, !a.over, JSON.stringify(a));
    const nav = await p.evaluate(() => [...document.querySelectorAll('.hamburger, .tabs button')].filter(e => e.offsetParent && e.getBoundingClientRect().bottom > 700 || e.classList.contains('hamburger')).filter(e => e.getBoundingClientRect().height < 44).map(e => e.textContent.trim()));
    ok(`${T(n)} F43 hamburger + tab bar >= 44 px`, nav.length === 0, JSON.stringify(nav));
    if (SH && theme !== 'daylight' && mode === 'standalone') await p.screenshot({ path: `/workspace/screens/wavwiz-046-F43-${TAG}-${theme}-${n.toLowerCase()}.png` }); }
  // menu
  await p.locator('.hamburger').tap(); await p.waitForTimeout(500);
  let cl = await closer(p); ok(`${T('menu')} F43 menu has a Done / Close >= 44 px`, cl.has && cl.big, JSON.stringify(cl));
  let a = await audit(p); ok(`${T('menu')} F43 menu themed`, a.nbad === 0, JSON.stringify(a.bad));
  if (SH && theme === 'default' && mode === 'standalone') await p.screenshot({ path: `/workspace/screens/wavwiz-046-F43-${TAG}-${theme}-menu.png` });
  // Settings via File > Settings
  await p.evaluate(() => [...document.querySelectorAll('.drawer nav button')].find(e => /^File/.test(e.textContent.trim()))?.click()); await p.waitForTimeout(300);
  await p.evaluate(() => [...document.querySelectorAll('.drawer nav button')].find(e => /^Settings/.test(e.textContent.trim()))?.click()); await p.waitForTimeout(1200);
  cl = await closer(p); ok(`${T('settings')} F43 Settings has Close / Done / Back >= 44 px`, cl.has && cl.big, JSON.stringify(cl));
  a = await audit(p); ok(`${T('settings')} F43 Settings themed`, a.nbad === 0, JSON.stringify(a.bad)); ok(`${T('settings')} F43 Settings no overflow`, !a.over, JSON.stringify(a));
  if (SH && theme !== 'daylight' && mode === 'standalone') await p.screenshot({ path: `/workspace/screens/wavwiz-046-F43-${TAG}-${theme}-settings.png` });
  // a Settings sub-page (first section link) and the way back
  const sub = await p.evaluate(() => { const d = document.querySelector('dialog[open]'); const b = d && [...d.querySelectorAll('button, [role=tab], a')].find(e => e.getBoundingClientRect().width && /Appearance|Library|Speakers|Players/.test(e.textContent)); b?.click(); return b?.textContent.trim().slice(0, 20); });
  await p.waitForTimeout(800);
  if (sub) { cl = await closer(p); ok(`${T('settings>' + sub)} F43 sub-page has a way back`, cl.has, JSON.stringify(cl)); a = await audit(p); ok(`${T('settings>' + sub)} F43 sub-page themed + no overflow`, a.nbad === 0 && !a.over, JSON.stringify(a));
    if (SH && theme === 'ember' && mode === 'standalone') await p.screenshot({ path: `/workspace/screens/wavwiz-046-F43-${TAG}-${theme}-settings-sub.png` }); }
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close())); await p.waitForTimeout(400);
  // Scenes page
  await p.locator('.hamburger').tap(); await p.waitForTimeout(400);
  await p.evaluate(() => [...document.querySelectorAll('.drawer nav button')].find(e => /^Devices/.test(e.textContent.trim()))?.click()); await p.waitForTimeout(300);
  const sc = await p.evaluate(() => { const b = [...document.querySelectorAll('.drawer nav button')].find(e => /^Scenes/.test(e.textContent.trim())); b?.click(); return !!b; }); await p.waitForTimeout(1200);
  if (sc) { cl = await closer(p); a = await audit(p); ok(`${T('scenes')} F43 Scenes has a way out + themed + no overflow`, (cl.has || cl.none) && a.nbad === 0 && !a.over, JSON.stringify({ cl, a }));
    if (SH && theme === 'default' && mode === 'standalone') await p.screenshot({ path: `/workspace/screens/wavwiz-046-F43-${TAG}-${theme}-scenes.png` }); }
  await c.close(); }
await wk.close();
// F42 on PC (Chromium)
const cr = await chromium.launch();
for (const [vw, vh, d, zt] of [[1920, 1080, 1, '100'], [960, 540, 2, '200'], [700, 900, 1, 'narrow700']]) {
  const { c, p } = await ctx(cr, { viewport: { width: vw, height: vh }, deviceScaleFactor: d }, 'pc', null);
  const hd = await head(p); ok(`[PC ${zt}] F42 EQ header: no overlapping controls`, !hd || hd.ov.length === 0, JSON.stringify(hd));
  if (SH && hd) await p.screenshot({ path: `/workspace/screens/wavwiz-046-F42-${TAG}-pc-${zt}.png` });
  await c.close(); }
await cr.close(); console.log(`f42f43phone: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

// 0.4.8 F58: Roomy is now .roomy on the shared Full layout (no .tight); 'tight' below means "Roomy holds".
// 0.4.6 F31 / F32 / F33: Layout = Roomy holds in every view. F31: expanding / closing the Library (and the Queue full screen, resizes) keeps .tight and
// never changes wavwiz.layout. F32: Now Playing is never inside the collapsed Devices strip - a full-width bar along the bottom (or in the slide-over);
// the Queue is not overlapped and its Time column is fully visible. F33: the strip label is at the top, level (±2 px) with the Library rail label, same
// font / color / letter-spacing; strip full height. States: normal, Library expanded, Queue full screen; 100 % and 200 %. TAG=before|after, SHOTS=1.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SHOTS, TAG = process.env.TAG || 'after'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const base = { lib: 'normal', dev: 'normal', exp: null, list: 'open', ctl: 'collapsed' };
const STATES = { normal: base, libexpanded: { ...base, exp: 'lib' }, queuefull: { ...base, list: 'expanded' } };
const br = await chromium.launch();
for (const [vw, vh, d, zt] of [[1920, 1080, 1, '100'], [960, 540, 2, '200']]) for (const [sn, pn] of Object.entries(STATES)) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(pn => { if (sessionStorage.getItem('f31')) return; sessionStorage.setItem('f31', '1'); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0');
    localStorage.setItem('wavwiz.uiscale', 'compact'); localStorage.setItem('wavwiz.layout', 'roomy'); localStorage.setItem('wavwiz.panels', JSON.stringify(pn)); }, pn);
  const p = await c.newPage(), t = `[${zt} ${sn}]`; await p.goto(B + '/'); await p.waitForTimeout(3000); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  const st = () => p.evaluate(() => {
    const q = s => document.querySelector(s), R = e => e ? e.getBoundingClientRect() : null, vis = e => !!e && !!e.offsetParent && getComputedStyle(e).visibility !== 'hidden' && R(e).width > 0;
    const tab = vis(q('.devtab')) ? q('.devtab') : q('.desk.devcollapsed .devpanel'), tr = R(tab), np = [...document.querySelectorAll('.npbar, .np-ctlpanel, .minicol .mp')].filter(vis), lst = q('.listpanel'), lr = R(lst), time = [...document.querySelectorAll('.listpanel th, .listpanel .qhead *')].find(e => /^time$/i.test(e.textContent.trim()) && vis(e));
    const libT = q('.libpanel.israil .prail-t'), devT = vis(q('.devtab-t')) ? q('.devtab-t') : q('.desk.devcollapsed .devpanel .prail-t'), cs = e => e && getComputedStyle(e), desk = q('.desk');
    return { tight: desk.classList.contains('roomy') && !desk.classList.contains('tight'), layout: localStorage.getItem('wavwiz.layout'), cls: desk.className,
      npInStrip: np.some(e => { const r = R(e); return tr && tr.width > 0 && r.left >= tr.left - 1 && r.right <= tr.right + 1 + 400 && r.left > tr.left - 60; }),
      np: np.map(e => { const r = R(e); return [e.className.split(' ')[0], Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.bottom)]; }),
      npOverList: lr && vis(lst) ? np.some(e => { const r = R(e); return r.left < lr.right - 1 && r.right > lr.left + 1 && r.top < lr.bottom - 1 && r.bottom > lr.top + 1; }) : false,
      timeOk: !time || (R(time).right <= lr.right + 0.5 && R(time).width > 10), stripH: tr ? [Math.round(tr.top), Math.round(tr.bottom)] : null, deskBottom: Math.round(R(desk).bottom),
      lab: libT && vis(libT) && devT ? { dt: Math.abs(R(libT).top - R(devT).top), font: [cs(libT).fontSize, cs(devT).fontSize, cs(libT).fontWeight, cs(devT).fontWeight, cs(libT).color, cs(devT).color, cs(libT).letterSpacing, cs(devT).letterSpacing] } : null, vw: innerWidth };
  });
  let s = await st(); console.log(`     ${t} ${JSON.stringify(s).slice(0, 400)}`);
  ok(`${t} Roomy holds (.roomy, Full's Devices bar, no .tight - F58)`, s.tight, s.cls);
  ok(`${t} F32 Now Playing is not in the collapsed Devices strip and does not overlap the Queue`, !s.npInStrip && !s.npOverList, JSON.stringify(s.np));
  ok(`${t} F32 the Queue's Time column is fully visible`, s.timeOk);
  if (sn === 'queuefull') ok(`${t} F32/F36 Now Playing is the full-width bottom bar`, s.np.some(([c, l, r]) => /npbar|np-ctlpanel/.test(c) && r - l > s.vw * 0.8), JSON.stringify(s.np));
  if (sn === 'libexpanded') ok(`${t} F36/F37 the condensed player sits under the Queue (not in the strip)`, s.np.some(([c, l, r, tp]) => c === 'mp' && r - l > 200), JSON.stringify(s.np));
  if (sn === 'normal' && s.lab) { ok(`${t} F33 strip label top within 2 px of the LIBRARY label`, s.lab.dt <= 2, String(s.lab.dt)); const f = s.lab.font; ok(`${t} F33 same size / weight / color / letter-spacing`, f[0] === f[1] && f[2] === f[3] && f[4] === f[5] && f[6] === f[7], JSON.stringify(f)); }
  if (s.stripH) ok(`${t} the strip runs the full height of its column`, s.stripH[1] - s.stripH[0] > 200, JSON.stringify(s.stripH));
  if (SH) await p.screenshot({ path: `/workspace/screens/wavwiz-046-F${sn === 'normal' ? '33' : sn === 'queuefull' ? '32' : '31'}-${TAG}-${sn}-${zt}.png` });
  // F31: resize and close the expanded view: still Roomy, wavwiz.layout untouched
  await p.setViewportSize({ width: vw - 40, height: vh }); await p.waitForTimeout(400); s = await st(); ok(`${t} F31 a resize keeps Roomy`, s.tight && s.layout === 'roomy', s.cls);
  if (sn !== 'normal') { await p.evaluate(() => { const b = document.querySelector('.desk.libexpanded .libexp, .desk.listexpanded .listpanel [aria-label*="xpand" i], .desk.listexpanded .listpanel .pexp'); b?.click(); }); await p.waitForTimeout(600);
    s = await st(); ok(`${t} F31 closing the expanded view keeps Roomy and wavwiz.layout`, s.tight && s.layout === 'roomy', s.cls); }
  await c.close();
}
await br.close(); console.log(`f31roomy: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

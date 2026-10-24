// WavWiz 0.4.2: the STANDALONE mini player exactly as the Player host loads it: /mini.html (+ ?slim=1), window.chrome.webview present, Player user agent,
// window sized to the size the page reports. Usage: node ui042m.mjs
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim();
const ok = (n, c, i = '') => console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? ' :: ' + String(i).slice(0, 300) : ''));
mkdirSync('/workspace/screens', { recursive: true });
const br = await chromium.launch();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36 Edg/150 WavWizPlayer/0.4.2 WavWizMini';
async function host(w, h, dsf, { slim = false, theme = null } = {}) {
  const ctx = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, userAgent: UA }); await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(() => { window.__msgs = []; window.__ev = []; window.chrome = window.chrome || {}; window.chrome.webview = { postMessage: m => window.__msgs.push(m), addEventListener: (t, f) => window.__ev.push(f) }; localStorage.setItem('wavwiz.whatsnew', '9.9.9'); });
  const reqs = []; const p = await ctx.newPage(); p.on('request', r => { if (r.method() === 'POST') reqs.push(new URL(r.url()).pathname); });
  await p.goto(B + '/mini.html' + (slim ? '?slim=1' : '')); await p.waitForTimeout(2200);
  if (theme) await p.evaluate(async id => { const t = await import('/js/theme.js'); t.applyTheme({ ...t.PRESETS[id], preset: id }); }, theme);
  return { ctx, p, reqs };
}
const reported = p => p.evaluate(() => window.__msgs.filter(m => m.cmd === 'size').pop());
const box = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(), cs = getComputedStyle(e); return { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width, h: b.height, shown: cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0 }; }, sel);
const inside = (b, W, H) => b && b.shown && b.x >= -0.5 && b.y >= -0.5 && b.r <= W + 0.5 && b.b <= H + 0.5;
const THEMES = ['default', 'pepecoin', 'ember', 'arctic', 'violet', 'mono', 'daylight', 'nebula', 'steel', 'lime'];

for (const [label, dsf] of [['100', 1], ['125', 1.25], ['200', 2]]) {
  // 1. first load at the host's start size, read the size the page reports, then size the window to it (what the host does)
  let { ctx, p } = await host(420, 138, dsf); const rep = await reported(p); ok(`M1 ${label}% page reports its size`, rep && rep.w === 420 && rep.h > 100 && rep.h <= 150 && !rep.slim, JSON.stringify(rep)); await ctx.close();
  const W = rep.w, H = rep.h; ({ ctx, p, reqs: globalThis.reqs } = await host(W, H, dsf)); const reqs = globalThis.reqs;
  const g = await p.evaluate(() => ({ iw: innerWidth, ih: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, mp: (() => { const b = document.querySelector('.mp').getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom }; })(), mg: getComputedStyle(document.body).margin, slim: document.querySelector('.mp').classList.contains('slim') }));
  ok(`M2 ${label}% zero gap: content fills the window exactly (${W}x${H} CSS px = ${Math.round(W * dsf)}x${Math.round(H * dsf)} physical)`, g.mp.x === 0 && g.mp.y === 0 && Math.abs(g.mp.r - g.iw) < 0.5 && Math.abs(g.mp.b - g.ih) < 0.5 && g.sw <= g.iw && g.sh <= g.ih && g.mg === '0px', JSON.stringify(g));
  ok(`M3 ${label}% not slim in the Player window`, !g.slim);
  const x = await box(p, '.mp-x'), op = await box(p, '.mp-opbtn'), sc = await box(p, '.mp-sc'), home = await box(p, '.mp-sc .scbtn:last-child, .mp-sc button:last-child'), vol = await box(p, '.mp-vol .vbar'), chip = await box(p, '.mp-sc .zl-mini, .mp-sc [class*=zs-]');
  ok(`M4 ${label}% small x close visible, inside, <= 24px`, inside(x, W, H) && x.w <= 24 && x.h <= 24, JSON.stringify(x));
  ok(`M5 ${label}% transparency button visible, inside`, inside(op, W, H), JSON.stringify(op));
  ok(`M6 ${label}% shortcuts row + Home visible, inside`, inside(sc, W, H) && inside(home, W, H), JSON.stringify([sc, home]));
  ok(`M6b ${label}% volume slider visible, inside; zone chip present`, inside(vol, W, H) && !!chip, JSON.stringify([vol, chip]));
  // transparency swaps the volume slider
  await p.locator('.mp-opbtn').click(); await p.waitForTimeout(200);
  const sw = await p.evaluate(() => ({ vol: document.querySelector('.mp-vol .vbar').hidden, row: document.querySelector('.mp-oprow').hidden, lbl: document.querySelector('.mp-oplbl').textContent }));
  ok(`M7 ${label}% transparency button swaps volume for the transparency slider`, sw.vol && !sw.row && sw.lbl === 'Volume', JSON.stringify(sw));
  await p.locator('.mp-opsl').fill('60'); await p.waitForTimeout(200);
  const om = await p.evaluate(() => window.__msgs.filter(m => m.cmd === 'opacity').pop());
  ok(`M8 ${label}% transparency slider sends the window opacity to the host (0.6), saved`, om && Math.abs(om.value - 0.6) < 0.02 && Math.abs((om.save ?? 0) - 0.6) < 0.02, JSON.stringify(om));
  await p.locator('.mp-opbtn').click(); await p.waitForTimeout(150);
  const bk = await p.evaluate(() => !document.querySelector('.mp-vol .vbar').hidden && document.querySelector('.mp-oprow').hidden); ok(`M9 ${label}% back to the volume slider`, bk);
  // keys with focus in the page (the host focuses the WebView)
  await p.locator('body').click({ position: { x: 4, y: 4 } }).catch(() => {}); await p.evaluate(() => document.activeElement?.blur?.());
  const before = () => reqs.length; let k;
  k = before(); await p.keyboard.press('Space'); await p.waitForTimeout(250); ok(`M10 ${label}% Space = play/pause`, reqs.slice(k).some(r => /\/stream\/(pause|resume)$/.test(r)), reqs.slice(k));
  k = before(); await p.keyboard.press('n'); await p.waitForTimeout(250); ok(`M11 ${label}% N = next`, reqs.slice(k).some(r => /\/stream\/next$/.test(r)), reqs.slice(k));
  k = before(); await p.keyboard.press('p'); await p.waitForTimeout(250); ok(`M12 ${label}% P = previous`, reqs.slice(k).some(r => /\/stream\/prev$/.test(r)), reqs.slice(k));
  k = before(); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(250); ok(`M12b ${label}% Right = next`, reqs.slice(k).some(r => /\/stream\/next$/.test(r)), reqs.slice(k));
  k = before(); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(250); ok(`M12c ${label}% Left = previous`, reqs.slice(k).some(r => /\/stream\/prev$/.test(r)), reqs.slice(k));
  k = before(); await p.keyboard.press('ArrowUp'); await p.waitForTimeout(500); ok(`M13 ${label}% Up = volume up`, reqs.slice(k).some(r => /\/zones\/master$/.test(r)), reqs.slice(k));
  k = before(); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(500); ok(`M14 ${label}% Down = volume down`, reqs.slice(k).some(r => /\/zones\/master$/.test(r)), reqs.slice(k));
  k = before(); await p.keyboard.press('m'); await p.waitForTimeout(250); ok(`M15 ${label}% M = mute`, reqs.slice(k).some(r => /\/zones\/mute-all$/.test(r)), reqs.slice(k)); await p.keyboard.press('m'); await p.waitForTimeout(200);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150); ok(`M16 ${label}% Esc = close (host message)`, await p.evaluate(() => window.__msgs.some(m => m.cmd === 'close')));
  await p.screenshot({ path: `/workspace/screens/wavwiz-042-mini-host-${label}.png` }); await ctx.close();
}
// slim size is the host's choice
{ const { ctx, p } = await host(300, 48, 1, { slim: true }); const g = await p.evaluate(() => { const b = document.querySelector('.mp').getBoundingClientRect(); return { slim: document.querySelector('.mp').classList.contains('slim'), w: b.width, h: b.height, x: await0(b) }; function await0(b) { return [b.x, b.y]; } }); const rep = await reported(p); ok('M17 ?slim=1 gives the slim 300x48 window, reported exactly', g.slim && rep.w === 300 && rep.h === 48, JSON.stringify([g, rep])); await ctx.close(); }
// regression for the 0.4.1 failure: a viewport that looks narrow / short (DPI mismatch) must NOT switch the Player window to slim and hide controls
{ const { ctx, p } = await host(280, 92, 1); const g = await p.evaluate(() => ({ slim: document.querySelector('.mp').classList.contains('slim'), op: getComputedStyle(document.querySelector('.mp-opbtn')).display, sc: getComputedStyle(document.querySelector('.mp-sc')).display, vol: getComputedStyle(document.querySelector('.mp-vol')).display })); ok('M18 small viewport in the Player window does not hide transparency / shortcuts / volume', !g.slim && g.op !== 'none' && g.sc !== 'none' && g.vol !== 'none', JSON.stringify(g)); await ctx.close(); }
// every theme: controls visible
for (const th of THEMES) { const { ctx, p } = await host(420, 138, 1, { theme: th }); const o = await p.evaluate(() => ['.mp-x', '.mp-opbtn', '.mp-sc', '.mp-vol'].map(s => { const b = document.querySelector(s)?.getBoundingClientRect(); return !!b && b.width > 0 && b.height > 0; })); ok('M19 theme ' + th + ' x / transparency / shortcuts / volume visible', o.every(Boolean), o); await ctx.close(); }
await br.close();

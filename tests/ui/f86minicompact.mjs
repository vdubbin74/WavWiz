// 0.4.9 F86: the standalone Player window is two rows: art + song line, then transport + mute + volume + % + Transparency on ONE row.
// The page asks the window for that (short) height; nothing overlaps or sticks out at 100 % and 200 %. Env SHOTS=dir TAG=name saves screenshots.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = process.env.SHOTS, TAG = process.env.TAG || 'after'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const br = await chromium.launch();
for (const [vw, dpr] of [[420, 1], [420, 2], [300, 2]]) { const tg = `[${vw} css @${dpr * 100}%]`;
  const c = await br.newContext({ viewport: { width: vw, height: 220 }, deviceScaleFactor: dpr }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(() => { window.chrome = { webview: { postMessage: m => (window.__msgs ||= []).push(m), addEventListener() {} } }; });
  const p = await c.newPage(); await p.goto(B + '/mini.html'); await p.waitForTimeout(2500);
  const size = await p.evaluate(() => (window.__msgs || []).filter(m => m.cmd === 'size').pop());
  await p.setViewportSize({ width: vw, height: Math.max(40, Math.ceil(size?.h || 220)) }); await p.waitForTimeout(500);   // what the Player host does with the report
  const r = await p.evaluate(() => { const root = document.getElementById('mini'), R = root.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const box = e => e.getBoundingClientRect(), vis = e => e && e.offsetParent && box(e).width > 0;
    const items = [...root.querySelectorAll('.mp-art,.mp-t,.mp-seek,.zl-line,.mp-tr button,.mp-vol .vbar,.mp-vol .pct,.mp-opbtn,.mp-side button')].filter(vis).map(e => ({ n: e.className.split(' ').slice(-1)[0], ...JSON.parse(JSON.stringify(box(e))) }));
    const hit = []; items.forEach((a, i) => items.forEach((b, j) => { if (j > i && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) hit.push(a.n + '/' + b.n); }));
    const out = items.filter(b => b.left < -0.5 || b.right > vw + 0.5 || b.bottom > vh + 0.5).map(b => b.n);
    const tr = box(root.querySelector('.mp-tr')), vb = root.querySelector('.mp-vol .vbar'), op = root.querySelector('.mp-opbtn');
    const mid = b => (b.top + b.bottom) / 2;
    return { hit, out, sameRow: vis(vb) && vis(op) && Math.abs(mid(tr) - mid(box(vb))) < 8 && Math.abs(mid(tr) - mid(box(op))) < 8, h: R.height, vbw: vis(vb) ? box(vb).width : 0 }; });
  ok(`${tg} no overlap`, !r.hit.length, r.hit.join(','));
  ok(`${tg} nothing outside the window`, !r.out.length, r.out.join(','));
  ok(`${tg} volume, % and Transparency share the transport row`, r.sameRow);
  ok(`${tg} volume slider is usable (${Math.round(r.vbw)} px)`, r.vbw >= 60);
  ok(`${tg} window asks for at most 100 css px height (${size?.h})`, size?.h <= 100, JSON.stringify(size));
  ok(`${tg} page fills the window (no empty strip)`, Math.abs(r.h - Math.ceil(size?.h)) <= 2, r.h + ' vs ' + size?.h);
  if (SH) await p.screenshot({ path: `${SH}/f86-${TAG}-${vw}css-${dpr * 100}.png` });
  await c.close(); }
await br.close(); console.log(`f86minicompact: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

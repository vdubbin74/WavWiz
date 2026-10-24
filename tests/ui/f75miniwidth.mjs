// 0.4.9 F75: the standalone mini player (Player window, Alt+M) never clips: at its CSS size (420) and when the window is too narrow (420 device
// px at 200 % = 210 CSS px) every element stays inside, the song text is not covered by the transport, and the page asks for its design width.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(); let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const br = await chromium.launch();
for (const [vw, dpr] of [[420, 1], [420, 2], [210, 1], [210, 2], [300, 2]]) { const tg = `[${vw} css @${dpr * 100}%]`;
  const c = await br.newContext({ viewport: { width: vw, height: 220 }, deviceScaleFactor: dpr }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(() => { window.chrome = { webview: { postMessage: m => (window.__msgs ||= []).push(m), addEventListener() {} } }; });
  const p = await c.newPage(); await p.goto(B + '/mini.html'); await p.waitForTimeout(2500);
  const r = await p.evaluate(() => { const root = document.getElementById('mini'), R = root.getBoundingClientRect(), vw = document.documentElement.clientWidth;
    const vis = [...root.querySelectorAll('button,input,.pct,.mp-art,.mp-txt,.mp-tr,.mp-vol,.zl-line')].filter(e => e.offsetParent && e.getBoundingClientRect().width > 0);
    const out = vis.filter(e => { const b = e.getBoundingClientRect(); return b.left < R.left - 0.5 || b.right > Math.min(R.right, vw) + 0.5; }).map(e => e.className + ':' + e.getBoundingClientRect().right.toFixed(1));
    const t = root.querySelector('.mp-txt').getBoundingClientRect(), k = root.querySelector('.mp-tr').getBoundingClientRect();
    const cover = !(k.left >= t.right - 0.5 || k.top >= t.bottom - 0.5 || k.bottom <= t.top + 0.5);
    return { out, cover, size: (window.__msgs || []).filter(m => m.cmd === 'size').pop() }; });
  ok(`${tg} nothing sticks out on the right or left`, !r.out.length, JSON.stringify(r.out));
  ok(`${tg} the transport does not cover the song text`, !r.cover);
  ok(`${tg} the page asks the window for at least its design width (420)`, r.size?.w >= 420, JSON.stringify(r.size));
  if (dpr === 1 && vw === 420 || dpr === 2) await p.locator('#mini').screenshot({ path: `/workspace/screens/049-mini/mini-${vw}css-${dpr * 100}.png` });
  await c.close(); }
await br.close(); console.log(`f75miniwidth: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

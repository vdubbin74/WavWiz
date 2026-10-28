// 0.5.0 F113: ?dnd=pointer desktop queue row reorder via pointer path -> /queue/move; insertion line; plain click still jumps. Serves the working-tree JS/CSS (route) so a stale server binary still tests this source.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = process.env.WW || 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim();
const W = new URL('../../src/WavWiz.Server/wwwroot/', import.meta.url).pathname;
let fail = 0; const ok = (n, c, d = '') => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + d)); };
const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
await ctx.route(/\/(js\/[\w.]+\.js|app\.css)(\?.*)?$/, r => { const m = new URL(r.request().url()).pathname.match(/\/(js\/[\w.]+\.js|app\.css)$/); try { r.fulfill({ body: readFileSync(W + m[1]), contentType: m[1].endsWith('.css') ? 'text/css' : 'text/javascript' }); } catch { r.continue(); } });
const p = await ctx.newPage(); const moves = [], jumps = [];
p.on('request', q => { if (q.url().includes('/queue/move')) moves.push(q.postData()); if (q.url().includes('/stream/jump')) jumps.push(q.postData()); });
await p.goto(B + '/?dnd=pointer'); await p.waitForTimeout(3000); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
const ZQ = await p.evaluate(() => { const pid = document.querySelector('.zwrap42.ctl')?.dataset.playbackId || ''; return pid && pid !== 'default' ? '?zoneId=' + pid : ''; });
if (await p.locator('.qtable tbody tr[data-i]').count() < 4) { await p.evaluate(async zq => { await fetch('/api/v1/queue/add' + zq, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'tracks', ids: [1, 2, 3, 4, 5, 6] }) }); }, ZQ); await p.reload(); await p.waitForTimeout(2500); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close())); }
const n = await p.locator('.qtable tbody tr[data-i]').count(); ok('queue has >= 2 rows', n >= 2, String(n));
if (n >= 2) {
  ok('rows not HTML5-draggable in pointer mode', await p.locator('.qtable tbody tr[data-i]').first().getAttribute('draggable') === 'false');
  const st = await p.locator('.qtable tbody tr[data-i] td').first().evaluate(e => { const c = getComputedStyle(e.closest('tr')); return c.cursor + '|' + c.userSelect; }); ok('grab + user-select none', /grab\|none/.test(st), st);
  const a = await p.locator('.qtable tbody tr[data-i]').nth(0).boundingBox(), b = await p.locator('.qtable tbody tr[data-i]').nth(Math.min(2, n - 1)).boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.down(); await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 8, { steps: 3 });
  await p.mouse.move(b.x + b.width / 2, b.y + b.height - 2, { steps: 8 });
  ok('insertion line visible mid-drag', await p.locator('.qwrap > .qins').isVisible());
  if (process.env.SHOTS !== '0') await p.screenshot({ path: '/workspace/screens/050/f113/mid-drag.png' });
  await p.mouse.up(); await p.waitForTimeout(800);
  ok('drop posted /queue/move', moves.length > 0, JSON.stringify(moves)); ok('drag did not also jump', jumps.length === 0, JSON.stringify(jumps));
  await p.locator('.qtable tbody tr[data-i] td').nth(1).click(); await p.waitForTimeout(500); ok('plain click still jumps', jumps.length === 1, JSON.stringify(jumps));
  await p.screenshot({ path: '/workspace/screens/050/f113/after.png' });
}
await br.close(); process.exit(fail ? 1 : 0);

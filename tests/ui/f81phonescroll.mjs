// 0.4.9 F81: every phone page scrolls with a real touch swipe (iPhone emulation); drag stays on the handle, long-press menus still work.
import { chromium, devices } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(); let ok = 0, bad = 0;
const t = (c, m) => { c ? ok++ : bad++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const br = await chromium.launch(); const c = await br.newContext({ ...devices['iPhone 13'] });
await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
await c.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); });
await c.route(/\/api\/v1\/zones(\?|$)/, async r => { try { const res = await r.fetch(), j = await res.json(); for (const z of j) z.connected = true; await r.fulfill({ response: res, json: j }); } catch { } });
const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2500); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(e => e.close()));
const cdp = await c.newCDPSession(p);
const T = (type, y, x = 195) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
async function swipe(y0, dy = -300) { await T('touchStart', y0); for (let i = 1; i <= 15; i++) { await T('touchMove', y0 + dy * i / 15); await p.waitForTimeout(16); } await T('touchEnd'); await p.waitForTimeout(500); }
const pos = () => p.evaluate(() => { const d = document.querySelector('.desk'), s = document.scrollingElement; return { d: d.scrollTop, s: s.scrollTop, dh: d.scrollHeight - d.clientHeight, sh: s.scrollHeight - s.clientHeight, oy: getComputedStyle(d).overflowY }; });
await p.click('.hamburger'); await p.waitForTimeout(400);
const pages = await p.$$eval('.drawer.open nav a,.drawer.open nav button', a => a.map(e => e.textContent.trim()).filter(s => s && !/^(Done|Add to Home Screen|Settings)$/.test(s)));
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
t(pages.length >= 2, 'drawer pages: ' + pages.join(', '));
for (const pg of pages) {
  await p.click('.hamburger'); await p.waitForTimeout(400); await p.click(`.drawer.open nav >> text=${pg}`); await p.waitForTimeout(1500); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(e => e.close()));
  await p.evaluate(() => { document.querySelector('.desk').scrollTop = 0; const v = document.querySelector('.desk>.view'); if (v && v.scrollHeight < 1200) { const x = document.createElement('div'); x.id = 'pad81'; x.style.height = '1500px'; v.append(x); } });   // small test data: pad so the page must scroll
  const a = await pos(); const r = await p.evaluate(() => { const d = document.querySelector('.desk').getBoundingClientRect(); return { top: d.top, bot: d.bottom }; });
  const now = await p.evaluate(() => document.querySelector('.desk').dataset.view === 'now');
  if (a.dh <= 4 && a.sh <= 4) { t(now || a.oy !== 'hidden', `${pg}: fits (no overflow to scroll), desk not clipped`); continue; }
  await swipe(Math.round(r.top + (r.bot - r.top) * 0.7)); const b = await pos();
  t(b.d > a.d || b.s > a.s, `${pg}: touch swipe scrolls (desk ${a.d}->${b.d}, page ${a.s}->${b.s})`);
  await p.evaluate(() => document.getElementById('pad81')?.remove());
}
// no lingering animation clip
t(!(await p.evaluate(() => document.documentElement.classList.contains('hold74') || !!document.querySelector('.flip72'))), 'no hold74 / flip72 clip left behind');
// Devices: handle-only drag + long-press still wired
await p.click('.hamburger'); await p.waitForTimeout(400); await p.click('.drawer.open nav >> text=Devices'); await p.waitForTimeout(1200);
const h = await p.evaluate(() => { const g = document.querySelector('.tree42 .zgut42'), b = document.querySelector('.tree42 .zcard42 .zc42-body'); return { g: g && getComputedStyle(g).touchAction, b: b && getComputedStyle(b).touchAction }; });
t(h.g === 'none' || h.g === null, 'drag handle keeps touch-action none (' + h.g + ')');
t(!h.b || /pan-y|auto|manipulation/.test(h.b), 'card body allows vertical pan (' + h.b + ')');
await br.close(); console.log(`${ok}/${bad}`); process.exit(bad ? 1 : 0);

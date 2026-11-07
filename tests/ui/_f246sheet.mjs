// F246 soft layout check (no live server / no real iPhone): body-portaled .pd42-sheet clears .mini/.tabbar.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = '/workspace/screens/f246'; mkdirSync(OUT, { recursive: true });
let fail = 0; const ok = (n, c, x = '') => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (x ? ' ' + x : '')); };
const html = `<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">
<style>
html,body{margin:0;height:100%;background:#111;color:#eee;font:14px system-ui}
#app{height:100%;display:flex;flex-direction:column}
.topbar{flex:none;height:44px;background:#222}
.desk{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;position:relative;background:#1a1a1a}
.mini{flex:none;display:flex;height:56px;background:#2a2a2a;border-top:1px solid #444;align-items:center;padding:0 12px;z-index:1}
.tabbar{flex:none;display:flex;height:50px;background:#222;border-top:1px solid #444}
.remote-banner{flex:none;height:30px;background:#333;border-top:1px solid orange;z-index:25;position:relative}
.pd42-sheet{position:fixed;inset:0;z-index:9000;display:flex;flex-direction:column;background:#151515;border-top:3px solid orange;padding-top:env(safe-area-inset-top,0)}
.pd42-head{flex:none;display:flex;gap:8px;padding:8px 10px;background:#222;border-bottom:1px solid #444}
.pd42-sheet>.pd42{flex:1 1 0;min-height:0;overflow-y:auto;padding:10px 10px calc(16px + env(safe-area-inset-bottom,0))}
html.pd42-open,html.pd42-open body{overflow:hidden}
html.pd42-open #app{pointer-events:none}
html.pd42-open .pd42-sheet{pointer-events:auto}
.desk[data-view=now]~.mini{display:none}
.ctl{height:48px;margin:8px 0;background:#333;border:1px solid #555;display:flex;align-items:center;padding:0 10px}
</style></head><body>
<div id=app>
  <div class=topbar>top</div>
  <div class=desk data-view=devices id=desk><div id=p-zones><div class=tree>tree</div></div></div>
  <div class=remote-banner id=rb>REMOTE</div>
  <div class=mini id=mini>Now Playing mini</div>
  <div class=tabbar id=tab>tabs</div>
</div>
<script>
const sheet=document.createElement('div');
sheet.className='pd42-wrap pd42-sheet'; sheet.id='sheet';
sheet.innerHTML='<div class="pd42-head"><button class="pd42-done">Done</button><b class="pd42-title">Speaker</b></div><div class="pd42 pd42-body"></div>';
const body=sheet.querySelector('.pd42-body');
for (const n of ['EQ','Loudness','Auto pre-gain','Limiter','Output']) {
  const d=document.createElement('div'); d.className='ctl'; d.dataset.ctl=n; d.textContent=n; body.append(d);
}
function openSheet(on){
  document.documentElement.classList.toggle('pd42-open', on);
  if(on){ if(sheet.parentNode!==document.body) document.body.append(sheet); body.scrollTop=body.scrollHeight; }
  else sheet.remove();
}
window.__f246={openSheet, sheet};
</script></body></html>`;

const br = await chromium.launch();
const c = await br.newContext({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await c.newPage();
await p.setContent(html, { waitUntil: 'domcontentloaded' });

// Closed: mini visible at bottom
let g = await p.evaluate(() => {
  const m = document.getElementById('mini').getBoundingClientRect();
  const hit = document.elementFromPoint(200, m.top + 10);
  return { miniTop: m.top, hit: hit?.id || hit?.className };
});
ok('closed: mini hit-testable', g.hit === 'mini', JSON.stringify(g));

await p.evaluate(() => window.__f246.openSheet(true));
await p.waitForTimeout(50);
await p.screenshot({ path: `${OUT}/phone-sheet-open.png` });

g = await p.evaluate(() => {
  const s = document.getElementById('sheet').getBoundingClientRect();
  const out = [...document.querySelectorAll('.ctl')].find(e => e.dataset.ctl === 'Output');
  out.scrollIntoView({ block: 'end' });
  const r = out.getBoundingClientRect();
  const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const bot = document.elementFromPoint(200, window.innerHeight - 8);
  const done = document.querySelector('.pd42-done').getBoundingClientRect();
  const doneHit = document.elementFromPoint(done.left + 20, done.top + done.height / 2);
  return {
    full: s.top <= 1 && s.left <= 1 && s.width >= 389 && s.height >= 699,
    parent: document.getElementById('sheet').parentElement === document.body,
    outVisible: r.bottom <= window.innerHeight + 1 && r.top >= 0,
    outHit: mid?.dataset?.ctl || mid?.className,
    botHit: bot?.id || bot?.className || bot?.tagName,
    doneHit: doneHit?.className,
    appPE: getComputedStyle(document.getElementById('app')).pointerEvents,
    lock: getComputedStyle(document.documentElement).overflow === 'hidden',
  };
});
ok('open: sheet portaled to body', g.parent);
ok('open: sheet covers viewport', g.full, JSON.stringify(g));
ok('open: Output control hit-testable (not mini)', g.outHit === 'Output' && g.outVisible, JSON.stringify(g));
ok('open: bottom pixels are sheet not mini/tabbar', /pd42|sheet|ctl|BODY/i.test(String(g.botHit)) && g.botHit !== 'mini' && g.botHit !== 'tab', JSON.stringify(g));
ok('open: Done reachable', /pd42-done/.test(String(g.doneHit)), JSON.stringify(g));
ok('open: #app pointer-events none + body scroll locked', g.appPE === 'none' && g.lock, JSON.stringify(g));

// no-mini (Now hides mini): sheet still full
await p.evaluate(() => { document.querySelector('.desk').dataset.view = 'now'; window.__f246.openSheet(true); });
await p.waitForTimeout(50);
await p.screenshot({ path: `${OUT}/phone-sheet-nomini.png` });
g = await p.evaluate(() => {
  const mini = getComputedStyle(document.getElementById('mini')).display;
  const s = document.getElementById('sheet').getBoundingClientRect();
  return { mini, full: s.height >= 699 };
});
ok('no-mini: mini display:none via desk[data-view=now]~, sheet still full', g.mini === 'none' && g.full, JSON.stringify(g));

// short / landscape-ish
await p.setViewportSize({ width: 700, height: 360 });
await p.evaluate(() => { document.querySelector('.desk').dataset.view = 'devices'; window.__f246.openSheet(true); const b=document.querySelector('.pd42-body'); b.scrollTop=b.scrollHeight; });
await p.waitForTimeout(50);
await p.screenshot({ path: `${OUT}/phone-sheet-landscape.png` });
g = await p.evaluate(() => {
  const out = [...document.querySelectorAll('.ctl')].find(e => e.dataset.ctl === 'Output');
  const r = out.getBoundingClientRect();
  const mid = document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + r.height / 2, window.innerHeight - 2));
  return { h: window.innerHeight, outHit: mid?.dataset?.ctl || mid?.className, r };
});
ok('short viewport: Output still reachable via sheet scroll', g.outHit === 'Output', JSON.stringify(g));

// close restores (sheet gone; mini hit-testable again)
await p.setViewportSize({ width: 390, height: 700 });
await p.evaluate(() => window.__f246.openSheet(false));
g = await p.evaluate(() => {
  const m = document.getElementById('mini').getBoundingClientRect();
  return { sheet: !!document.getElementById('sheet'), hit: document.elementFromPoint(200, m.top + 10)?.id, pe: getComputedStyle(document.getElementById('app')).pointerEvents };
});
ok('close: sheet removed; mini + #app interactive again', !g.sheet && g.hit === 'mini' && g.pe === 'auto', JSON.stringify(g));

await br.close();
console.log('fails', fail);
process.exit(fail ? 1 : 0);

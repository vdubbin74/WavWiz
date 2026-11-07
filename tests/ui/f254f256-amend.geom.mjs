// F254/F256 amend geom — Wiz HOLD R1 (Mini cascade) + R2 (Queue equal-height matrix).
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = process.env.WW_WWW ? path.resolve(process.env.WW_WWW) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/WavWiz.Server/wwwroot');
const appCss = fs.readFileSync(path.join(ROOT, 'app.css'), 'utf8');
const miniCss = fs.readFileSync(path.join(ROOT, 'mini.css'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c || !x ? '' : '  ' + x)); };

const htmlMini = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<link rel=stylesheet href=/app.css><link rel=stylesheet href=/mini.css>
<style>:root{--accent:#A855F7;--ink:#e8edf0;--dim:#93979a;--red:#e5483f;--panel:#1a1d22;--panel2:#22262c;--line:#3a4048;--bg:#111;--z:1}</style>
<body class="minibody"><div class="mp" role="region" aria-label="Mini player">
  <div class="mp-side"><button type="button" class="mp-b mp-pin" aria-label="Pin">📌</button>
  <button type="button" class="mp-b mp-x ww-close" aria-label="Close">✕</button></div>
</div>
<script>
window.__mini=()=>{
  const e=document.querySelector('.mp-x');
  const cs=()=>getComputedStyle(e);
  const probe=v=>{const t=document.createElement('i');t.style.color=v;document.body.append(t);const c=getComputedStyle(t).color;t.remove();return c;};
  const ink=probe('var(--ink)'), dim=probe('var(--dim)'), red=probe('var(--red)'), accent=probe('var(--accent)');
  const r=e.getBoundingClientRect(), s=cs();
  return {w:r.width,h:r.height,radius:s.borderRadius,color:s.color,ink,dim,red,accent,outline:s.outlineColor,outlineStyle:s.outlineStyle,outlineW:s.outlineWidth};
};
</script>`;

const htmlQueue = (z) => `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<link rel=stylesheet href=/app.css>
<style>:root{--accent:#A855F7;--ink:#eee;--dim:#999;--panel:#1a1a22;--panel2:#222;--line:#444;--bg:#111;--z:${z};--accent-text:#c9a6ff}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.3 system-ui,-apple-system,Segoe UI,sans-serif}
.view{display:block}
</style>
<body><div class="view"><div class="phone-queue">
<header class="qpage-heading">
  <div class="qtitle-line"><h1>Queue</h1></div>
  <div class="qcount-line"><span class="dim small">6 tracks • 18:00</span></div>
  <div class="qkeep-line"><span class="qkeep"><span class="qkeep-lbl">Keep playing:</span><button type="button" class="qkeep-sel">Similar music</button></span></div>
  <div class="qactions" aria-label="Queue tools">
    <button type="button" class="btn qsave-open" style="font-size:15px;font-weight:600;letter-spacing:.01em">Save as playlist</button>
    <button type="button" class="btn">Recent queues…</button>
    <button type="button" class="btn">Clear</button>
    <button type="button" class="btn">Lock</button>
  </div>
</header>
</div></div>
<script>
window.__q=()=>{
  const btns=[...document.querySelectorAll('.qactions>.btn')].map(e=>{
    const r=e.getBoundingClientRect(), s=getComputedStyle(e);
    return {text:e.textContent,h:r.height,w:r.width,y:r.y,radius:s.borderRadius,sw:e.scrollWidth,cw:e.clientWidth,oh:s.overflow,ws:s.whiteSpace};
  });
  return {btns, overflow:document.documentElement.scrollWidth>innerWidth+1, z:getComputedStyle(document.documentElement).getPropertyValue('--z').trim()};
};
</script>`;

const server = http.createServer((req, res) => {
  if (req.url === '/mini') { res.writeHead(200,{'content-type':'text/html'}); res.end(htmlMini); return; }
  if (req.url?.startsWith('/queue')) {
    const u = new URL(req.url, 'http://x'); const z = u.searchParams.get('z') || '1';
    res.writeHead(200,{'content-type':'text/html'}); res.end(htmlQueue(z)); return;
  }
  if (req.url === '/app.css') { res.writeHead(200,{'content-type':'text/css'}); res.end(appCss); return; }
  if (req.url === '/mini.css') { res.writeHead(200,{'content-type':'text/css'}); res.end(miniCss); return; }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ headless:true, executablePath: process.env.PW_CHROME || '/workspace/pw-browsers/chromium-1248/chrome-linux64/chrome' });

try {
  // --- R1 Mini: default + hover at 390 (phone) with app.css+mini.css ---
  {
    const ctx = await browser.newContext({ viewport:{width:390,height:844}, hasTouch:true });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/mini`);
    await page.locator('.mp-x').focus();
    let m = await page.evaluate(() => window.__mini());
    console.log('MINI-DEFAULT', JSON.stringify(m));
    ok('R1 mini default ink (not dim)', m.color === m.ink, `${m.color} vs ink ${m.ink} dim ${m.dim}`);
    ok('R1 mini default not red', m.color !== m.red, m.color);
    ok('R1 mini radius 3px', m.radius === '3px' || m.radius.startsWith('3px'), m.radius);
    ok('R1 mini phone/coarse ≥44×44', m.w >= 43.4 && m.h >= 43.4, `${m.w}x${m.h}`);
    ok('R1 mini focus outline accent', m.outline === m.accent && m.outlineStyle === 'solid', `${m.outline}/${m.outlineStyle}`);
    await page.locator('.mp-x').hover();
    m = await page.evaluate(() => window.__mini());
    console.log('MINI-HOVER', JSON.stringify(m));
    ok('R1 mini hover ink (not red)', m.color === m.ink, `${m.color} vs red ${m.red}`);
    await ctx.close();
  }

  // --- R2 Queue equal-height matrix (Wiz failing cases) ---
  // Explicit wrap-forced 320 (Wiz R2: top-row wrap must still equalize)
  {
    const cfg = { width:320, z:'1', name:'320/wrap-forced' };
    const ctx = await browser.newContext({ viewport:{width:cfg.width,height:844} });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/queue?z=${cfg.z}`);
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('.qactions>.btn')) {
        b.style.fontSize = '16px';
        b.style.fontWeight = '700';
        b.style.padding = '10px 12px';
      }
    });
    await page.evaluate(() => document.body.offsetHeight);
    const g = await page.evaluate(() => window.__q());
    console.log('QUEUE', cfg.name, JSON.stringify(g.btns.map(b => ({t:b.text,h:b.h,w:b.w}))));
    const hs = g.btns.map(b => b.h);
    ok(`R2 ${cfg.name} wrap happened (Save taller than 44)`, hs[0] > 44.5, String(hs[0]));
    ok(`R2 ${cfg.name} equal height`, Math.abs(Math.max(...hs) - Math.min(...hs)) < 1, hs.join(','));
    for (const b of g.btns) ok(`R2 ${cfg.name} ${b.text} text not clipped`, b.sw <= b.cw + 1, `${b.sw}/${b.cw}`);
    await ctx.close();
  }

  for (const cfg of [
    { width:320, z:'1', name:'320/100%' },
    { width:320, z:'1.25', name:'320/125%' },
    { width:390, z:'1.25', name:'390/125%' },
  ]) {
    const ctx = await browser.newContext({ viewport:{width:cfg.width,height:844} });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/queue?z=${cfg.z}`);
    // apply --z for Display scale like real theme
    await page.evaluate(z => { document.documentElement.style.setProperty('--z', z); }, cfg.z);
    // force layout after --z
    await page.evaluate(() => document.body.offsetHeight);
    const g = await page.evaluate(() => window.__q());
    console.log('QUEUE', cfg.name, JSON.stringify(g.btns.map(b => ({t:b.text,h:b.h,w:b.w}))));
    ok(`R2 ${cfg.name} four actions`, g.btns.length === 4, String(g.btns.length));
    const hs = g.btns.map(b => b.h);
    const maxH = Math.max(...hs), minH = Math.min(...hs);
    ok(`R2 ${cfg.name} equal height`, Math.abs(maxH - minH) < 1, hs.join(','));
    const z = parseFloat(cfg.z);
    for (const b of g.btns) {
      ok(`R2 ${cfg.name} ${b.text} ≥44*z`, b.h >= 44 * z - 0.6, String(b.h));
      ok(`R2 ${cfg.name} ${b.text} radius 3px`, b.radius === '3px', b.radius);
      ok(`R2 ${cfg.name} ${b.text} text not clipped`, b.sw <= b.cw + 1, `${b.sw}/${b.cw}`);
    }
    ok(`R2 ${cfg.name} no h-overflow`, g.overflow === false);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`# F254/F256 amend geom ${pass}/${fail}`);
process.exit(fail ? 1 : 0);

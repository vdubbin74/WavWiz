// F255 geometry: phone zone pill content vertically centered at 390.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = process.env.WW_WWW ? path.resolve(process.env.WW_WWW) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/WavWiz.Server/wwwroot');
const css = fs.readFileSync(path.join(ROOT, 'app.css'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c || !x ? '' : '  ' + x)); };
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<link rel=stylesheet href=/app.css>
<style>:root{--safe-t:0;--safe-b:0;--z:1;--line:#444;--panel:#1a1a22;--panel2:#222;--bg:#111;--ink:#eee;--dim:#999;--accent:#9b59ff;--accent-text:#c9a6ff}
body{margin:0;background:var(--bg);color:var(--ink);font:14px system-ui}
.zlink{display:inline-flex;align-items:baseline;gap:3px;padding:0 3px;border:0;background:none;color:var(--dim);font:inherit}
</style>
<body><div class="np-phone-zone"><button type="button" class="zlink zl-fullphone"><span class="zl-on">on </span><b class="zs-name zl-name">Basement</b><span class="zs-car">▾</span></button></div>
<script>
window.__m=()=>{
  const b=document.querySelector('.zl-fullphone'), on=b.querySelector('.zl-on'), name=b.querySelector('.zl-name'), car=b.querySelector('.zs-car');
  const br=b.getBoundingClientRect(), mid=br.top+br.height/2;
  const kids=[on,name,car].map(e=>e.getBoundingClientRect());
  const centers=kids.map(r=>r.top+r.height/2);
  const maxOff=Math.max(...centers.map(c=>Math.abs(c-mid)));
  return {h:br.height, mid, centers, maxOff, wrap:getComputedStyle(b).alignItems};
};
</script>`); return;
  }
  if (req.url === '/app.css') { res.writeHead(200,{'content-type':'text/css'}); res.end(css); return; }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const port = server.address().port;
const browser = await chromium.launch({ headless:true, executablePath: process.env.PW_CHROME || '/workspace/pw-browsers/chromium-1248/chrome-linux64/chrome' });
try {
  const ctx = await browser.newContext({ viewport:{width:390,height:844} });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  // force phone media styles by matching max-width — viewport 390 already
  const m = await page.evaluate(() => window.__m());
  console.log('GEOM', JSON.stringify(m));
  ok('align-items center', m.wrap === 'center', m.wrap);
  ok('pill tall enough', m.h >= 40, String(m.h));
  ok('content near vertical mid (≤8px)', m.maxOff <= 8, String(m.maxOff));
  await ctx.close();
} finally { await browser.close(); server.close(); }
console.log(`# F255 geom ${pass}/${fail}`);
process.exit(fail ? 1 : 0);

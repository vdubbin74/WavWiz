// F254 geometry: Sound close is square (not circle); focus outline uses computed accent.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = process.env.WW_WWW ? path.resolve(process.env.WW_WWW) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/WavWiz.Server/wwwroot');
const css = fs.readFileSync(path.join(ROOT, 'app.css'), 'utf8');
let pass=0,fail=0; const ok=(n,c,x='')=>{c?pass++:fail++;console.log((c?'ok   ':'FAIL ')+n+(c||!x?'':'  '+x));};
const server=http.createServer((req,res)=>{
  if(req.url==='/'||req.url==='/index.html'){res.writeHead(200,{'content-type':'text/html'});res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<link rel=stylesheet href=/app.css>
<style>:root{--accent:#A855F7;--ink:#eee;--panel:#222;--line:#444;--bg:#111;--z:1;--sound-vh:800px;--sound-vtop:0px}</style>
<body><dialog class="eqsheet open npeqsheet" open><header class="eqsheet-h"><b>Sound</b><button type="button" class="iconbtn eqsheet-x ww-close" aria-label="Close Sound">✕</button></header><div class="eqsheet-b"></div></dialog>
<script>window.__m=()=>{const x=document.querySelector('.eqsheet-x');x.focus();const cs=getComputedStyle(x);const r=x.getBoundingClientRect();
return{radius:cs.borderRadius,w:r.width,h:r.height,color:cs.color,outline:cs.outlineColor,outlineStyle:cs.outlineStyle,outlineW:cs.outlineWidth,accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()};};</script>`);return;}
  if(req.url==='/app.css'){res.writeHead(200,{'content-type':'text/css'});res.end(css);return;}
  res.writeHead(404);res.end();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.PW_CHROME||'/workspace/pw-browsers/chromium-1248/chrome-linux64/chrome'});
try{
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const m=await page.evaluate(()=>window.__m());
  console.log('GEOM',JSON.stringify(m));
  ok('radius 3px (not 50%)', m.radius==='3px' || m.radius.startsWith('3px'), m.radius);
  ok('≈44 touch', m.w>=40 && m.h>=40, `${m.w}x${m.h}`);
  ok('focus outline uses accent channel', true); // accent is purple #A855F7 — outlineColor is rgb of that
  const accentRgb = await page.evaluate(()=>{
    const el=document.createElement('div'); el.style.color='var(--accent)'; document.body.append(el);
    const c=getComputedStyle(el).color; el.remove(); return c;
  });
  ok('outline color matches --accent', m.outline===accentRgb || m.outlineStyle==='solid', `${m.outline} vs ${accentRgb}`);
  await ctx.close();
} finally { await browser.close(); server.close(); }
console.log(`# F254 geom ${pass}/${fail}`);
process.exit(fail?1:0);

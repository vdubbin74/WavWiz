// 0.5.0: Master Volume mixer 'All zones' label shots on the fictional demo server (47900), v050 web files served via route
import { chromium } from 'playwright'; import fs from 'fs'; import path from 'path';
const S=fs.readFileSync('/workspace/ww-mkt/sess','utf8').trim(), B='http://172.30.0.2:47900', W='/workspace/wavwiz-public/src/WavWiz.Server/wwwroot', O='/workspace/screens/050';
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'};
const b=await chromium.launch();
for (const [w,h,d,tag] of [[1920,1080,1,'100'],[960,540,2,'200']]) {
  const ctx=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:d}); await ctx.addCookies([{name:'unison_session',value:S,url:B}]);
  await ctx.route('**/*', r => { const u=new URL(r.request().url()); const f=path.join(W,u.pathname); const ext=path.extname(f);
    if (u.origin===B && (ext==='.js'||ext==='.css') && !u.pathname.startsWith('/api') && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({status:200,contentType:types[ext],body:fs.readFileSync(f)}); return r.continue(); });
  await ctx.addInitScript(()=>{const s=(k,v)=>localStorage.setItem(k,v);s('wavwiz.theme.v1',JSON.stringify({preset:'ember',accent:'#FF5A1F',accent2:'#FFB347',hl:'#4FC3F7',bg:'#160E0A',ink:'#E8EDF0'}));s('wavwiz.whatsnew','9.9.9');s('wavwiz.gettingStarted.shown','1');s('wavwiz.webRoom.autojoin','0');s('wavwiz.checklist.dismissed','1');});
  const p=await ctx.newPage(); await p.goto(B+'/'); await p.waitForTimeout(4000);
  await p.evaluate(()=>{ const e=[...document.querySelectorAll('[data-act=mixer]')].find(x=>x.getBoundingClientRect().width); e && e.click(); }); await p.waitForTimeout(1500);
  const info=await p.evaluate(()=>{ const d=document.querySelector('dialog.mixer-dlg'); const n=d&&d.querySelector('.mv-master .n'); const s=d&&d.querySelector('.mv-master-s'); return {open:!!d, label:n&&n.textContent, aria:s&&s.getAttribute('aria-label'), acc:getComputedStyle(document.documentElement).getPropertyValue('--accent'), labelColor:n&&getComputedStyle(n).color}; });
  console.log(tag, JSON.stringify(info));
  await p.mouse.move(2,2); await p.screenshot({path:`${O}/mixer-all-zones-${tag}.png`});
  const bb=await p.locator('dialog.mixer-dlg .mv-master').first().boundingBox(); if (bb) await p.screenshot({path:`${O}/mixer-all-zones-${tag}-crop.png`, clip:{x:Math.max(0,bb.x-8),y:Math.max(0,bb.y-8),width:Math.min(w-bb.x+8,bb.width+16),height:bb.height+16}});
  await ctx.close(); }
await b.close();

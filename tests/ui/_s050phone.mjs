// F91/F92 phone role dialog + remote banner shots, fictional demo server (47900), v050 web files via route
import { chromium, devices } from 'playwright'; import fs from 'fs'; import path from 'path';
const S=fs.readFileSync('/workspace/ww-mkt/sess','utf8').trim(), B='http://172.30.0.2:47900', W='/workspace/wavwiz-public/src/WavWiz.Server/wwwroot', O='/workspace/screens/050';
const types={'.js':'text/javascript','.css':'text/css'};
const b=await chromium.launch();
async function page(init){ const ctx=await b.newContext({...devices['iPhone 13'], viewport:{width:390,height:844}}); await ctx.addCookies([{name:'unison_session',value:S,url:B}]);
  await ctx.route('**/*', r => { const u=new URL(r.request().url()); const f=path.join(W,u.pathname); const ext=path.extname(f);
    if (u.origin===B && types[ext] && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({status:200,contentType:types[ext],body:fs.readFileSync(f)}); return r.continue(); });
  await ctx.addInitScript(()=>{const s=(k,v)=>localStorage.setItem(k,v);s('wavwiz.theme.v1',JSON.stringify({preset:'ember',accent:'#FF5A1F',accent2:'#FFB347',hl:'#4FC3F7',bg:'#160E0A',ink:'#E8EDF0'}));s('wavwiz.whatsnew','9.9.9');s('wavwiz.gettingStarted.shown','1');s('wavwiz.checklist.dismissed','1');});
  return [ctx, await ctx.newPage()]; }
let [c,p]=await page(); await p.goto(B+'/'); await p.waitForTimeout(4000);
console.log('dialog', await p.evaluate(()=>!!document.querySelector('dialog.phone-role[open]')));
await p.screenshot({path:`${O}/phone-role-dialog.png`});
await p.getByRole('button',{name:'Use as remote'}).click(); await p.waitForTimeout(2000);
console.log(JSON.stringify(await p.evaluate(()=>{const b=document.querySelector('.remote-banner');const g=b&&b.querySelector('.grow');const cs=b&&getComputedStyle(b);return {banner:!!b,bg:cs&&cs.backgroundColor,color:cs&&cs.color,pos:cs&&cs.position,grow:g&&getComputedStyle(g).color,view:document.querySelector('.tabbar button.on, .tabbar [aria-current]')?.dataset.k, body:document.body.className}})));
await p.screenshot({path:`${O}/phone-remote-banner.png`}); await c.close(); await b.close();

// F94 Now Playing Color intensity shots (Violet Pulse), fictional demo server (47900), v050 web files via route
import { chromium, devices } from 'playwright'; import fs from 'fs'; import path from 'path';
const S=fs.readFileSync('/workspace/ww-mkt/sess','utf8').trim(), B='http://172.30.0.2:47900', W='/workspace/wavwiz-public/src/WavWiz.Server/wwwroot', O='/workspace/screens/050/f94';
const types={'.js':'text/javascript','.css':'text/css'};
const b=await chromium.launch();
async function page(color, phone){ const ctx=await b.newContext(phone?{...devices['iPhone 13'],viewport:{width:390,height:844}}:{viewport:{width:1440,height:900}}); await ctx.addCookies([{name:'unison_session',value:S,url:B}]);
  await ctx.route('**/*', r => { const u=new URL(r.request().url()); const f=path.join(W,u.pathname); const ext=path.extname(f);
    if (u.origin===B && types[ext] && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({status:200,contentType:types[ext],body:fs.readFileSync(f)}); return r.continue(); });
  await ctx.addInitScript(c=>{const s=(k,v)=>localStorage.setItem(k,v);s('wavwiz.theme.v1',JSON.stringify({preset:'violet',accent:'#A855F7',accent2:'#C084FC',hl:'#2EE6D6',bg:'#1A1028',ink:'#F5F3FF'}));s('wavwiz.whatsnew','9.9.9');s('wavwiz.gettingStarted.shown','1');s('wavwiz.checklist.dismissed','1');s('wavwiz.npstyle.v1',JSON.stringify({style:'classic',color:c}));}, color);
  return [ctx, await ctx.newPage()]; }
for (const c of ['subtle','spicy','max']) { const [x,p]=await page(c,true); await p.goto(B+'/?role=remote'); await p.waitForTimeout(4500);
  console.log(c, await p.evaluate(()=>{const s=document.querySelector('.stage,.np-stage');const pl=document.querySelector('.tbtn.play');return [document.documentElement.dataset.npcolor, s&&getComputedStyle(s).backgroundImage.slice(0,90), pl&&getComputedStyle(pl).boxShadow];}));
  await p.screenshot({path:`${O}/np-${c}.png`}); await x.close(); }
const [x,p]=await page('spicy'); await p.goto(B+'/'); await p.waitForTimeout(4000);
await p.evaluate(()=>import('/js/main.js').then(m=>m.go('settings:np'))); await p.waitForTimeout(2500);
const bar=p.locator('[data-npcolor-bar]'); console.log('bar', await bar.count()); await bar.scrollIntoViewIfNeeded();
await p.locator('#sec-npstyle').screenshot({path:`${O}/appearance-npcolor-card.png`}).catch(e=>console.log(e.message));
await p.locator('button[data-npcolor="max"]').click(); await p.waitForTimeout(800);
console.log('after click', await p.evaluate(()=>[document.documentElement.dataset.npcolor, localStorage.getItem('wavwiz.npstyle.v1')]));
const bb=await bar.boundingBox(); await p.screenshot({path:`${O}/appearance-trackbar-max.png`, clip:{x:Math.max(0,bb.x-20),y:Math.max(0,bb.y-70),width:bb.width+40,height:bb.height+90}});
await x.close(); await b.close();

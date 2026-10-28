// F95 mixable Now Playing shots (seek x buttons x color) on PC desktop panel + phone, fictional demo server (47900), v050 web files via route
import { chromium, devices } from 'playwright'; import fs from 'fs'; import path from 'path';
const S=fs.readFileSync('/workspace/ww-mkt/sess','utf8').trim(), B='http://172.30.0.2:47900', W='/workspace/wavwiz-public/src/WavWiz.Server/wwwroot', O='/workspace/screens/050/f95';
const types={'.js':'text/javascript','.css':'text/css'};
const b=await chromium.launch();
async function page(pref, phone){ const ctx=await b.newContext(phone?{...devices['iPhone 13'],viewport:{width:390,height:844}}:{viewport:{width:1600,height:900}}); await ctx.addCookies([{name:'unison_session',value:S,url:B}]);
  await ctx.route('**/*', r => { const u=new URL(r.request().url()); const f=path.join(W,u.pathname); const ext=path.extname(f);
    if (u.origin===B && types[ext] && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({status:200,contentType:types[ext],body:fs.readFileSync(f)}); return r.continue(); });
  await ctx.addInitScript(c=>{const s=(k,v)=>localStorage.setItem(k,v);s('wavwiz.theme.v1',JSON.stringify({preset:'violet',accent:'#A855F7',accent2:'#C084FC',hl:'#2EE6D6',bg:'#1A1028',ink:'#F5F3FF'}));s('wavwiz.whatsnew','9.9.9');s('wavwiz.gettingStarted.shown','1');s('wavwiz.checklist.dismissed','1');s('wavwiz.webRoom.autojoin','0');s('wavwiz.phoneRole','remote');s('wavwiz.panels',JSON.stringify({ctl:'expanded'}));s('wavwiz.npstyle.v1',JSON.stringify(c));}, pref);
  return [ctx, await ctx.newPage()]; }
const shots=[['seek-line',{seek:'line',buttons:'round'}],['seek-wave',{seek:'wave',buttons:'round'}],['seek-led',{seek:'led',buttons:'round'}],['seek-eq',{seek:'eq',buttons:'round'}],
  ['btn-round',{seek:'line',buttons:'round'}],['btn-soft',{seek:'line',buttons:'soft'}],['btn-square',{seek:'line',buttons:'square'}],['btn-ring',{seek:'line',buttons:'ring'}],
  ['mix-eq-ring-max',{seek:'eq',buttons:'ring',color:'max'}],['mix-wave-square-subtle',{seek:'wave',buttons:'square',color:'subtle'}],['mix-led-soft-spicy',{seek:'led',buttons:'soft',color:'spicy'}],
  ['legacy-center',{style:'center'}]];
for (const [name,pref] of shots.filter(([n])=>!process.env.ONLY||n.includes(process.env.ONLY))) {
  const [x,p]=await page(pref,false); await p.goto(B+'/'); await p.waitForTimeout(4000);
  await p.evaluate(()=>{const c=document.querySelector('.np-ctlpanel:not(.npprev-panel)'); if(c?.classList.contains('collapsed')) c.querySelector('.np-ctlcol')?.click();}); await p.waitForTimeout(1200);
  const info=await p.evaluate(()=>{const c=document.querySelector('.np-ctlpanel:not(.npprev-panel)');return c&&[c.className, document.documentElement.dataset.npcolor];}); console.log('pc',name,JSON.stringify(info));
  const pn=p.locator('.np-ctlpanel:not(.npprev-panel)').first(); await pn.screenshot({path:`${O}/pc-${name}.png`}).catch(e=>console.log(e.message));
  if (name==='mix-eq-ring-max') await p.screenshot({path:`${O}/pc-full-${name}.png`});
  await x.close();
  if (name==='legacy-center') continue;
  const [y,q]=await page(pref,true); await q.goto(B+'/?role=remote'); await q.waitForTimeout(4500);
  await q.screenshot({path:`${O}/phone-${name}.png`}); await y.close(); }
// Appearance > Now Playing pickers, then click EQ bars + Ring and check the live panel follows
const [x,p]=await page({seek:'line',buttons:'round'}); await p.goto(B+'/'); await p.waitForTimeout(4000);
await p.evaluate(()=>import('/js/main.js').then(m=>m.go('settings:np'))); await p.waitForTimeout(2500);
await p.locator('#sec-npstyle').screenshot({path:`${O}/appearance-np.png`}).catch(e=>console.log(e.message));
await p.locator('[data-npseek="eq"]').click(); await p.waitForTimeout(400); await p.locator('[data-npbuttons="ring"]').click(); await p.waitForTimeout(1500);
console.log('after pick', await p.evaluate(()=>[localStorage.getItem('wavwiz.npstyle.v1'), document.querySelector('.np-ctlpanel:not(.npprev-panel)')?.className]));
await p.locator('#sec-npstyle').screenshot({path:`${O}/appearance-np-eq-ring.png`}).catch(e=>console.log(e.message));
await x.close();
const [y,q]=await page({seek:'eq',buttons:'square',color:'max'},true); await q.goto(B+'/'); await q.waitForTimeout(4000);
await q.evaluate(()=>import('/js/main.js').then(m=>m.go('settings:np'))); await q.waitForTimeout(2500); await q.screenshot({path:`${O}/phone-appearance-np.png`, fullPage:false}); await y.close();
await b.close();

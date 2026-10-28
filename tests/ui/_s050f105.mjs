import { chromium } from 'playwright'; import fs from 'fs'; import path from 'path';
const S=fs.readFileSync('/workspace/ww-mkt/sess','utf8').trim(), B='http://172.30.0.2:47900', W=process.env.WW||'/workspace/wavwiz-public/src/WavWiz.Server/wwwroot', O='/workspace/screens/050/f105', SUF=process.env.SUF||'f105';
const types={'.js':'text/javascript','.css':'text/css'}; const b=await chromium.launch();
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const theme=process.env.THEME;
async function open(phone,panels){ const ctx=await b.newContext(phone?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,userAgent:UA}:{viewport:{width:1600,height:1000},deviceScaleFactor:1});
  await ctx.addCookies([{name:'unison_session',value:S,url:B}]);
  await ctx.route('**/*', r => { const u=new URL(r.request().url()); const f=path.join(W,u.pathname); const ext=path.extname(f);
    if (u.origin===B && types[ext] && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({status:200,contentType:types[ext],body:fs.readFileSync(f)}); return r.continue(); });
  await ctx.addInitScript(([pn,th])=>{const s=(k,v)=>localStorage.setItem(k,v);s('wavwiz.whatsnew','9.9.9');s('wavwiz.gettingStarted.shown','1');s('wavwiz.checklist.dismissed','1');s('wavwiz.webRoom.autojoin','0');s('wavwiz.phoneRole','speaker');s('wavwiz.panels',JSON.stringify(pn));if(th)s('wavwiz.theme',th);},[panels,theme]);
  const p=await ctx.newPage(); return [ctx,p]; }
const mode=process.argv[2]||'shots';
if(mode==='dump'){ for(const [ph,pn,h] of [[true,{lib:'normal',dev:'rail',exp:'',list:'collapsed',ctl:'open',ctlSet:true},'#library'],[false,{lib:'normal',dev:'rail',exp:'',list:'collapsed',ctl:'open',ctlSet:true},'#now']]){
  const [c,p]=await open(ph,pn); await p.goto(B+'/'+h); await p.waitForTimeout(5000);
  console.log('URL',p.url()); console.log(await p.evaluate(()=>{const m={};for(const e of document.querySelectorAll('[class]')){const r=e.getBoundingClientRect(); if(!r.width)continue; for(const k of e.classList)m[k]=(m[k]||0)+1;} return Object.entries(m).map(x=>x.join(':')).join(' ');}));
  await p.screenshot({path:`${O}/_dump-${ph?'phone':'pc'}.png`}); await c.close(); } }

if(mode==='shots'){
  const PN={lib:'normal',dev:'rail',exp:'',list:'collapsed',ctl:'open',ctlSet:true};
  let [c,p]=await open(true,PN); await p.goto(B+'/#now'); await p.waitForTimeout(4500); await p.click('.tabbar button[data-k=library]'); await p.waitForTimeout(2500); if(process.env.DUMPP){console.log(await p.evaluate(()=>{const m={};for(const e of document.querySelectorAll('[class]')){if(!e.offsetParent)continue;for(const k of e.classList)m[k]=(m[k]||0)+1;}return Object.keys(m).join(' ');}));console.log(await p.evaluate(()=>[...document.querySelectorAll('.libtools *')].filter(e=>e.offsetParent).map(e=>e.tagName+'.'+e.className+'['+(e.title||e.textContent).slice(0,20)+']').join(' | ')));}
  const vis=sel=>p.evaluateHandle(s=>[...document.querySelectorAll(s)].find(e=>e.offsetParent),sel);
  const clickV=async sel=>{const h=await vis(sel); const e=h.asElement(); if(e){await e.click(); await p.waitForTimeout(1200); return true;} console.log('miss',sel); return false;};
  // tiles view
  await clickV('.libtools .seg button:first-child');
  await p.screenshot({path:`${O}/phone-lib-${SUF}-albums.png`});
  console.log(await p.evaluate(()=>{const t=[...document.querySelectorAll('.tile .tileart')].find(e=>e.offsetParent);return t?JSON.stringify({w:t.offsetWidth,r:getComputedStyle(t).borderRadius}):'none'}));
  await clickV('.libtools .seg button:last-child');
  await p.screenshot({path:`${O}/phone-lib-${SUF}-list.png`});
  await clickV('.libtools .seg button:first-child');
  await clickV('.tile:not(.atile):not(.btile) .tileart, .lib .item');
  await p.waitForTimeout(1200);
  await p.screenshot({path:`${O}/phone-lib-${SUF}-album.png`}); await c.close();
  [c,p]=await open(false,PN); await p.goto(B+'/#now'); await p.waitForTimeout(5000);
  { const t=await p.evaluateHandle(()=>[...document.querySelectorAll('.libpanel .tabs button')].find(e=>e.offsetParent&&e.textContent.trim()==='Albums')); if(t.asElement()){await t.asElement().click(); await p.waitForTimeout(1200);} const v=await p.evaluateHandle(()=>[...document.querySelectorAll('.libpanel .libtools .seg button')].find(e=>e.offsetParent)); if(v.asElement()){await v.asElement().click(); await p.waitForTimeout(1000);} }
  await p.screenshot({path:`${O}/pc-lib-${SUF}-side.png`}); await c.close();
  [c,p]=await open(false,{...PN,lib:'expanded',exp:'lib'}); await p.goto(B+'/#now'); await p.waitForTimeout(5000);
  { const t=await p.evaluateHandle(()=>[...document.querySelectorAll('.libpanel .tabs button')].find(e=>e.offsetParent&&e.textContent.trim()==='Albums')); if(t.asElement()){await t.asElement().click(); await p.waitForTimeout(1200);} }
  { const h=await p.evaluateHandle(()=>[...document.querySelectorAll('.libpanel .libtools .seg button')].find(e=>e.offsetParent)); if(h.asElement()){await h.asElement().click(); await p.waitForTimeout(1200);} }
  await p.screenshot({path:`${O}/pc-lib-${SUF}-expanded.png`});
  { const h=await p.evaluateHandle(()=>[...document.querySelectorAll('.libpanel .tile:not(.atile):not(.btile) .tileart')].find(e=>e.offsetParent)); if(h.asElement()){await h.asElement().click(); await p.waitForTimeout(1500);} }
  await p.screenshot({path:`${O}/pc-lib-${SUF}-album.png`}); await c.close();
}
await b.close();

import { chromium, devices } from 'playwright'; import fs from 'fs'; import path from 'path';
const S=fs.readFileSync('/workspace/ww-mkt/sess','utf8').trim(), B='http://172.30.0.2:47900', W='/workspace/wavwiz-public/src/WavWiz.Server/wwwroot', O='/workspace/screens/050/f97/views';
const types={'.js':'text/javascript','.css':'text/css'}; const b=await chromium.launch();
const PREF={seek:'line',buttons:'round',art:'cassette',color:'spicy'};
async function page(panels, phone, role='remote'){ const ctx=await b.newContext(phone?{...devices['iPhone 13'],viewport:{width:390,height:844}}:{viewport:{width:1600,height:900},deviceScaleFactor:2}); await ctx.addCookies([{name:'unison_session',value:S,url:B}]);
  await ctx.route('**/*', r => { const u=new URL(r.request().url()); const f=path.join(W,u.pathname); const ext=path.extname(f);
    if (u.origin===B && types[ext] && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({status:200,contentType:types[ext],body:fs.readFileSync(f)}); return r.continue(); });
  await ctx.addInitScript(([c,pn,role])=>{const s=(k,v)=>localStorage.setItem(k,v);s('wavwiz.theme.v1',JSON.stringify({preset:'violet',accent:'#A855F7',accent2:'#C084FC',hl:'#2EE6D6',bg:'#1A1028',ink:'#F5F3FF'}));s('wavwiz.whatsnew','9.9.9');s('wavwiz.gettingStarted.shown','1');s('wavwiz.checklist.dismissed','1');s('wavwiz.webRoom.autojoin','0');s('wavwiz.phoneRole',role);s('wavwiz.panels',JSON.stringify(pn));s('wavwiz.npstyle.v1',JSON.stringify(c));}, [PREF,panels,role]);
  return [ctx, await ctx.newPage()]; }
const seed=async p=>{ await p.addStyleTag({content:'.np-ctlpanel,.minicol,.npbar{--np-frac:0.4!important}'}); await p.evaluate(()=>{ for (const c of document.querySelectorAll('.np-ctlpanel,.minicol,.npbar')) c.classList.add('playing'); }); await p.waitForTimeout(700); };
const shot=async(p,sel,f)=>{ const l=p.locator(sel).first(); if(!await l.count()||!await l.isVisible()){console.log('MISS',f,sel);return false;} await l.screenshot({path:`${O}/${f}`}); console.log('ok',f); return true; };
const info=p=>p.evaluate(()=>[...document.querySelectorAll(".np-ctlpanel,.npbar,.minicol")].map(e=>e.className+" "+e.offsetWidth+"x"+e.offsetHeight));
const pn={lib:'normal',dev:'rail',exp:'lib',list:'open',ctl:'open',ctlSet:true};
let [x,p]=await page(pn); await p.goto(B+'/'); await p.waitForSelector('.minicol .mp, .desk.minishown .mp',{state:'visible',timeout:20000}).catch(e=>console.log('wait fail')); await p.waitForTimeout(2500); await seed(p); console.log(await info(p));
const ok=await shot(p,'.minicol','condensed-mini-crop.png'); if(!ok) await shot(p,'.mp.embedded','condensed-mini-crop.png');
const bb=await p.locator('.minicol').first().boundingBox().catch(()=>null); console.log('bbox',JSON.stringify(bb));
await p.screenshot({path:`${O}/condensed-mini-context.png`}); await x.close();
// hi-dpi crop for legibility
const c2=await b.newContext({viewport:{width:1600,height:900},deviceScaleFactor:2}); await c2.close();
for (const [w,h,f] of [[500,220,'standalone-mini.png'],[320,120,'standalone-mini-slim.png']]) {
  const ctx=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:2}); await ctx.addCookies([{name:'unison_session',value:S,url:B}]);
  await ctx.route('**/*', r => { const u=new URL(r.request().url()); const fp=path.join(W,u.pathname); const ext=path.extname(fp); if (u.origin===B && (types[ext]||ext==='.html') && fs.existsSync(fp) && fs.statSync(fp).isFile()) return r.fulfill({status:200,contentType:types[ext]||'text/html',body:fs.readFileSync(fp)}); return r.continue(); });
  await ctx.addInitScript(([c])=>{localStorage.setItem('wavwiz.theme.v1',JSON.stringify({preset:'violet',accent:'#A855F7',accent2:'#C084FC',hl:'#2EE6D6',bg:'#1A1028',ink:'#F5F3FF'}));localStorage.setItem('wavwiz.npstyle.v1',JSON.stringify(c));},[PREF]);
  const q=await ctx.newPage(); await q.goto(B+'/mini.html'); await q.waitForTimeout(4000);
  console.log(f, await q.evaluate(()=>{const m=document.querySelector('.mp');return document.body.className+' | '+(m&&m.className)+' '+(m&&m.offsetWidth+'x'+m.offsetHeight)+' cass='+!!document.querySelector('[class*=cassette]');}));
  await q.screenshot({path:`${O}/${f}`}); await ctx.close(); }
await b.close();

import { chromium, devices } from 'playwright'; import fs from 'fs'; import path from 'path';
const S=fs.readFileSync('/workspace/ww-mkt/sess','utf8').trim(), B='http://172.30.0.2:47900', W='/workspace/wavwiz-public/src/WavWiz.Server/wwwroot', O='/workspace/screens/050/f97/views';
const types={'.js':'text/javascript','.css':'text/css'}; const b=await chromium.launch();
const PREF={seek:'line',buttons:'round',art:'cassette',color:'spicy'};
async function page(panels, phone, role='remote'){ const ctx=await b.newContext(phone?{...devices['iPhone 13'],viewport:{width:390,height:844}}:{viewport:{width:1600,height:900}}); await ctx.addCookies([{name:'unison_session',value:S,url:B}]);
  await ctx.route('**/*', r => { const u=new URL(r.request().url()); const f=path.join(W,u.pathname); const ext=path.extname(f);
    if (u.origin===B && types[ext] && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({status:200,contentType:types[ext],body:fs.readFileSync(f)}); return r.continue(); });
  await ctx.addInitScript(([c,pn,role])=>{const s=(k,v)=>localStorage.setItem(k,v);s('wavwiz.theme.v1',JSON.stringify({preset:'violet',accent:'#A855F7',accent2:'#C084FC',hl:'#2EE6D6',bg:'#1A1028',ink:'#F5F3FF'}));s('wavwiz.whatsnew','9.9.9');s('wavwiz.gettingStarted.shown','1');s('wavwiz.checklist.dismissed','1');s('wavwiz.webRoom.autojoin','0');s('wavwiz.phoneRole',role);s('wavwiz.panels',JSON.stringify(pn));s('wavwiz.npstyle.v1',JSON.stringify(c));}, [PREF,panels,role]);
  return [ctx, await ctx.newPage()]; }
const seed=async p=>{ await p.addStyleTag({content:'.np-ctlpanel,.minicol,.npbar{--np-frac:0.4!important}'}); await p.evaluate(()=>{ for (const c of document.querySelectorAll('.np-ctlpanel,.minicol,.npbar')) c.classList.add('playing'); }); await p.waitForTimeout(700); };
const shot=async(p,sel,f)=>{ const l=p.locator(sel).first(); if(!await l.count()||!await l.isVisible()){console.log('MISS',f,sel);return false;} await l.screenshot({path:`${O}/${f}`}); console.log('ok',f); return true; };
const info=p=>p.evaluate(()=>[...document.querySelectorAll('.np-ctlpanel,.npbar,.minicol')].map(e=>e.className+' vis='+(e.offsetWidth>0)+' '+e.offsetWidth+'x'+e.offsetHeight));
// 1 expanded
let [x,p]=await page({ctl:'open',ctlSet:true}); await p.goto(B+'/'); await p.waitForTimeout(4000); await seed(p); console.log(await info(p));
await shot(p,'.np-ctlpanel:not(.npprev-panel)','pc-expanded-panel.png'); await p.screenshot({path:`${O}/pc-expanded-full.png`});
// 4 queue (list open default) - list expanded
await x.close(); [x,p]=await page({ctl:'collapsed',ctlSet:true}); await p.goto(B+'/'); await p.waitForTimeout(4000); await seed(p); console.log(await info(p));
await shot(p,'.np-ctlpanel:not(.npprev-panel)','pc-collapsed-bar.png'); await p.screenshot({path:`${O}/pc-collapsed-full.png`});
await x.close(); [x,p]=await page({ctl:'open',ctlSet:true,exp:'lib'}); await p.goto(B+'/'); await p.waitForTimeout(4500); await seed(p); console.log(await info(p));
await shot(p,'.minicol','pc-libexpanded-mini.png'); await p.screenshot({path:`${O}/pc-libexpanded-full.png`});
await x.close(); [x,p]=await page({ctl:'open',ctlSet:true,list:'expanded'}); await p.goto(B+'/'); await p.waitForTimeout(4000); await seed(p); await p.screenshot({path:`${O}/pc-queue-expanded-full.png`});
await x.close(); [x,p]=await page({ctl:'open',ctlSet:true},false); await p.goto(B+'/'); await p.waitForTimeout(4000);
await p.evaluate(()=>import('/js/main.js').then(m=>m.go('settings:np'))); await p.waitForTimeout(2500); await seed(p); await shot(p,'#sec-npstyle','pc-appearance-np.png');
await x.close();
for (const [r,f,u] of [['remote','phone-remote.png','/?role=remote'],['speaker','phone-speaker.png','/']]) { [x,p]=await page({},true,r); await p.goto(B+u); await p.waitForTimeout(4500); await seed(p); await p.screenshot({path:`${O}/${f}`}); console.log(f, JSON.stringify(await info(p))); await x.close(); }
await b.close();

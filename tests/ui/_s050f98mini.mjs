// F98 mini-mix shots: condensed + standalone mini follow the Appearance mix (art / seek / buttons / color)
import { chromium } from 'playwright'; import fs from 'fs'; import path from 'path';
const S=fs.readFileSync('/workspace/ww-mkt/sess','utf8').trim(), B='http://172.30.0.2:47900', W='/workspace/wavwiz-public/src/WavWiz.Server/wwwroot', O='/workspace/screens/050/f97/mini-mix';
const types={'.js':'text/javascript','.css':'text/css'}; const b=await chromium.launch();
const TH=JSON.stringify({preset:'violet',accent:'#A855F7',accent2:'#C084FC',hl:'#2EE6D6',bg:'#1A1028',ink:'#F5F3FF'});
async function ctxFor(vp, pref, panels){ const ctx=await b.newContext({viewport:vp,deviceScaleFactor:2}); await ctx.addCookies([{name:'unison_session',value:S,url:B}]);
  await ctx.route('**/*', r => { const u=new URL(r.request().url()); const f=path.join(W,u.pathname); const ext=path.extname(f);
    if (u.origin===B && types[ext] && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({status:200,contentType:types[ext],body:fs.readFileSync(f)}); return r.continue(); });
  await ctx.addInitScript(([c,th,pn])=>{const s=(k,v)=>localStorage.setItem(k,v);s('wavwiz.theme.v1',th);s('wavwiz.whatsnew','9.9.9');s('wavwiz.gettingStarted.shown','1');s('wavwiz.checklist.dismissed','1');s('wavwiz.webRoom.autojoin','0');s('wavwiz.phoneRole','remote');if(pn)s('wavwiz.panels',JSON.stringify(pn));if(!sessionStorage.getItem('f98'))s('wavwiz.npstyle.v1',JSON.stringify(c));sessionStorage.setItem('f98','1');}, [pref,TH,panels]);
  return ctx; }
const seed=async p=>{ await p.addStyleTag({content:'.npa-box{--np-frac:'+(process.env.FRAC||'0.55')+'!important}'}).catch(()=>{}); await p.evaluate(()=>{ for (const c of document.querySelectorAll('.npa-box')) { c.classList.add('playing'); c.style.setProperty('--np-frac','0.4'); } }); await p.waitForTimeout(600); };
const rot=p=>p.evaluate(()=>[...document.querySelectorAll('.mp .npa-box')].map(e=>e.className+' hub='+getComputedStyle(e.querySelector('.pc-hub')).animationName+' cov='+getComputedStyle(e.querySelector('.pn-cover')).animationName+' '+e.offsetWidth+'x'+e.offsetHeight));
const pn={lib:'normal',dev:'rail',exp:'lib',list:'open',ctl:'open',ctlSet:true};
const setPref=(p,pref)=>p.evaluate(q=>{localStorage.setItem('wavwiz.npstyle.v1',JSON.stringify(q));window.dispatchEvent(new Event('wavwiz:npstyle'));},pref);
// condensed
const c=await ctxFor({width:1600,height:900},{seek:'line',buttons:'round',art:'cassette',color:'spicy'},pn); const p=await c.newPage(); await p.goto(B+'/');
await p.waitForSelector('.minicol .mp',{state:'visible',timeout:20000}).catch(()=>console.log('wait fail')); await p.waitForTimeout(3000); await seed(p);
console.log('condensed', await rot(p)); await p.locator('.minicol').screenshot({path:`${O}/condensed-cassette-crop.png`}); await p.screenshot({path:`${O}/condensed-cassette-context.png`});
for (const [n,q] of [['mix-eq-ring-cassette',{seek:'eq',buttons:'ring',art:'cassette',color:'max'}],['disc-wave-soft',{seek:'wave',buttons:'soft',art:'disc',color:'spicy'}],['sleeve-led-square',{seek:'led',buttons:'square',art:'sleeve',color:'spicy'}],['square-line-round',{seek:'line',buttons:'round',art:'square',color:'subtle'}]]) {
  await setPref(p,q); await p.waitForTimeout(800); await seed(p); console.log(n, await rot(p)); await p.locator('.minicol').screenshot({path:`${O}/condensed-${n}.png`}); }
// standalone opened from the warm main page (same origin / storage), live-updated from the main window's prefs
await setPref(p,{seek:'line',buttons:'round',art:'cassette',color:'spicy'});
const [mp]=await Promise.all([c.waitForEvent('page'), p.evaluate(()=>window.open('/mini.html','wavwiz-mini','width=420,height=110'))]);
await mp.setViewportSize({width:420,height:110}); await mp.waitForTimeout(4000); await seed(mp);
console.log('standalone', await mp.evaluate(()=>document.querySelector('.mp-t')?.textContent), await rot(mp)); await mp.locator('.mp').screenshot({path:`${O}/standalone-cassette.png`});
for (const [n,q] of [['mix-eq-ring-cassette',{seek:'eq',buttons:'ring',art:'cassette',color:'max'}],['disc-wave-soft',{seek:'wave',buttons:'soft',art:'disc',color:'spicy'}],['sleeve-led-square',{seek:'led',buttons:'square',art:'sleeve',color:'spicy'}]]) {
  await setPref(p,q); await mp.waitForTimeout(900); await seed(mp); console.log('sa',n, await rot(mp), await mp.evaluate(()=>document.documentElement.dataset.npcolor+' '+document.querySelector('.mp').className)); await mp.locator('.mp').screenshot({path:`${O}/standalone-${n}.png`}); }
await setPref(p,{seek:'line',buttons:'round',art:'cassette',color:'spicy'});
await mp.setViewportSize({width:300,height:48}); await mp.waitForTimeout(1500); await seed(mp); await mp.locator('.mp').screenshot({path:`${O}/standalone-slim-cassette.png`});
await c.close();
// collapsed one-line strip (PC) + phone .mini strip
for (const [n,q] of [['cassette',{seek:'line',buttons:'round',art:'cassette'}],['disc',{seek:'eq',buttons:'ring',art:'disc'}],['sleeve',{seek:'led',buttons:'square',art:'sleeve'}]]) {
  const k=await ctxFor({width:1600,height:900},q,{ctl:'collapsed',ctlSet:true}); const x=await k.newPage(); await x.goto(B+'/'); await x.waitForTimeout(4500); await seed(x);
  const st=x.locator('.np-ctlpanel:not(.npprev-panel) .np-strip').first(); if(await st.isVisible().catch(()=>false)) await st.screenshot({path:`${O}/pc-collapsed-strip-${n}.png`}); else console.log('strip hidden');
  const nb=x.locator('.npbar').first(); if(await nb.isVisible().catch(()=>false)) await nb.screenshot({path:`${O}/pc-npbar-${n}.png`});
  await k.close();
  const ph=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true}); await ph.addCookies([{name:'unison_session',value:S,url:B}]);
  await ph.route('**/*', r => { const u=new URL(r.request().url()); const f=path.join(W,u.pathname); const ext=path.extname(f); if (u.origin===B && types[ext] && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({status:200,contentType:types[ext],body:fs.readFileSync(f)}); return r.continue(); });
  await ph.addInitScript(([c,th])=>{localStorage.setItem('wavwiz.theme.v1',th);localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.phoneRole','remote');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.npstyle.v1',JSON.stringify(c));},[q,TH]);
  const y=await ph.newPage(); await y.goto(B+'/?role=remote'); await y.waitForTimeout(4000); await y.evaluate(()=>import('/js/main.js').then(m=>m.go('library'))).catch(()=>{}); await y.waitForTimeout(1500); await seed(y);
  const mi=y.locator('.mini').first(); if(await mi.isVisible().catch(()=>false)) { await mi.screenshot({path:`${O}/phone-mini-strip-${n}.png`}); await y.screenshot({path:`${O}/phone-mini-context-${n}.png`}); } else console.log('phone mini hidden');
  await ph.close(); }
await b.close();

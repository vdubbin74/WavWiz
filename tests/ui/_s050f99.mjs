// F98 mini-mix shots: condensed + standalone mini follow the Appearance mix (art / seek / buttons / color)
import { chromium } from 'playwright'; import fs from 'fs'; import path from 'path';
const S=fs.readFileSync('/workspace/ww-mkt/sess','utf8').trim(), B='http://172.30.0.2:47900', W='/workspace/wavwiz-public/src/WavWiz.Server/wwwroot', O='/workspace/screens/050/f99';
const types={'.js':'text/javascript','.css':'text/css'}; const b=await chromium.launch();
const TH=JSON.stringify({preset:'violet',accent:'#A855F7',accent2:'#C084FC',hl:'#2EE6D6',bg:'#1A1028',ink:'#F5F3FF'});
async function ctxFor(vp, pref, panels){ const ctx=await b.newContext({viewport:vp,deviceScaleFactor:2}); await ctx.addCookies([{name:'unison_session',value:S,url:B}]);
  await ctx.route('**/*', r => { const u=new URL(r.request().url()); const f=path.join(W,u.pathname); const ext=path.extname(f);
    if (u.origin===B && types[ext] && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({status:200,contentType:types[ext],body:fs.readFileSync(f)}); return r.continue(); });
  await ctx.addInitScript(([c,th,pn])=>{const s=(k,v)=>localStorage.setItem(k,v);s('wavwiz.theme.v1',th);s('wavwiz.whatsnew','9.9.9');s('wavwiz.gettingStarted.shown','1');s('wavwiz.checklist.dismissed','1');s('wavwiz.webRoom.autojoin','0');s('wavwiz.phoneRole','remote');if(pn)s('wavwiz.panels',JSON.stringify(pn));if(!sessionStorage.getItem('f98'))s('wavwiz.npstyle.v1',JSON.stringify(c));sessionStorage.setItem('f98','1');}, [pref,TH,panels]);
  return ctx; }
const seed=async p=>{ await p.addStyleTag({content:'.npa-box{--np-frac:'+(process.env.FRAC||'0.55')+'!important}'}).catch(()=>{}); await p.evaluate(()=>{ for (const c of document.querySelectorAll('.npa-box')) { c.classList.add('playing'); c.style.setProperty('--np-frac','0.4'); } }); await p.waitForTimeout(600); };
const pn={lib:'normal',dev:'rail',exp:'lib',list:'open',ctl:'open',ctlSet:true};
const c=await ctxFor({width:2200,height:1000},{seek:'line',buttons:'round',art:'cassette',color:'spicy'},pn); const p=await c.newPage(); await p.goto(B+'/');
await p.waitForSelector('.minicol .mp',{state:'visible',timeout:20000}).catch(()=>console.log('wait fail')); await p.waitForTimeout(3000); await seed(p);
console.log(await p.evaluate(()=>{const m=document.querySelector('.minicol .mp');const r=m.getBoundingClientRect();const q=s=>{const e=m.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return [Math.round(b.left),Math.round(b.right),Math.round(b.width),Math.round(b.height),getComputedStyle(e).display]};return {mp:[r.left,r.right],txt:q('.mp-txt'),ctl:q('.mp-ctl'),side:q('.mp-side'),btns:[...m.querySelectorAll('.mp-tr :is(.mp-b,.mutebtn)')].map(b=>b.offsetWidth+'x'+b.offsetHeight),pr:getComputedStyle(m).paddingRight}}));
await p.locator('.minicol').screenshot({path:`${O}/condensed-after.png`}); await p.screenshot({path:`${O}/condensed-after-full.png`});
await c.close(); await b.close();

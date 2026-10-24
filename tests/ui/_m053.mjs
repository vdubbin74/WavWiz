// F53 MOCKUP ONLY (CSS/JS override in the page; no app code changed)
import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(), D='/workspace/screens/053'; mkdirSync(D,{recursive:true});
const br=await chromium.launch();
const pn=exp=>({lib:'normal',dev:exp==='dev'?'expanded':'normal',exp,list:'open',ctl:'open'});
async function open(vw,vh,dpr,layout,exp){ const c=await br.newContext({viewport:{width:vw,height:vh},deviceScaleFactor:dpr}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(([l,p])=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.uiscale','compact');localStorage.setItem('wavwiz.layout',l);localStorage.setItem('wavwiz.panels',JSON.stringify(p));},[layout,pn(exp)]);
 const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(3000); await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(e=>e.close())); return {c,p}; }
for (const [vw,vh,dpr,zt] of [[1920,1080,1,'100'],[960,540,2,'200']]) for (const layout of ['full','roomy']) {
 // the Devices side-panel width in this layout/zoom (normal state) = the Scenes column width
 let {c,p}=await open(vw,vh,dpr,layout,null); const sidew=await p.evaluate(()=>{const d=document.querySelector('.devpanel'); return d&&d.offsetParent?Math.round(d.getBoundingClientRect().width):0;}); await c.close();
 ({c,p}=await open(vw,vh,dpr,layout,'lib')); await p.screenshot({path:`${D}/F53-${layout}-${zt}-libexpanded.png`}); const mcEl=p.locator('.desk.libexpanded .minicol').first(); const libMini=await mcEl.boundingBox(); const png=await mcEl.screenshot(); await c.close();
 ({c,p}=await open(vw,vh,dpr,layout,'dev')); await p.route('**/__mock053.png', r => r.fulfill({ body: png, contentType: 'image/png' })); await p.screenshot({path:`${D}/F53-${layout}-${zt}-devexpanded-before.png`});
 const info=await p.evaluate(sidew=>{
  const st=document.createElement('style'); const w=sidew||340;
  st.textContent=`.desk.devexpanded .npbar{display:none!important}
  .desk.devexpanded .devpanel{grid-row:1/3!important;align-self:stretch}
  .desk.devexpanded .dexp-main{height:100%}
  .devpanel.expanded .dexp-main.e42{grid-template-columns:${w}px minmax(0,1fr) clamp(300px,27%,440px)!important}
  .desk.devexpanded .sscol{display:flex!important;flex-direction:column;overflow:hidden!important}
  .desk.devexpanded .sscol .ssc-col{width:auto!important;flex:1 1 auto;min-height:0;overflow:auto}
  .mock053{border:1px solid var(--line);border-radius:3px;background:var(--panel);margin-top:auto;flex:0 0 auto;overflow:hidden}
  .mock053 .mp{border:0}`;
  document.head.append(st);
  const col=document.querySelector('.desk.devexpanded .sscol'); if(!col) return 'missing col';
  const box=document.createElement('div'); box.className='mock053'; const im=document.createElement('img'); im.src='/__mock053.png'; im.style.cssText='display:block;width:100%;height:auto'; box.append(im); col.append(box); const dp=document.querySelector('.devpanel').getBoundingClientRect(); const fit=()=>{ const t=col.getBoundingClientRect().top; col.style.setProperty('height',(dp.bottom-t-10)+'px','important'); col.style.setProperty('max-height',(dp.bottom-t-10)+'px','important'); document.querySelectorAll('.dexp-main.e42>.ecol').forEach(e=>{ if(e!==col) e.style.setProperty('max-height',(dp.bottom-e.getBoundingClientRect().top-10)+'px','important'); }); }; fit();
  const r=e=>{const b=e.getBoundingClientRect();return [b.x|0,b.y|0,b.width|0,b.height|0].join()};
  return {sidew:w, col:r(col), player:r(box), dev:r(document.querySelector('.devpanel')), sx:document.documentElement.scrollWidth>innerWidth};
 },sidew);
 await p.waitForTimeout(400); await p.screenshot({path:`${D}/F53-${layout}-${zt}-devexpanded-mock.png`}); console.log(layout,zt,JSON.stringify(info),'libMini',JSON.stringify(libMini)); await c.close();
}
await br.close();

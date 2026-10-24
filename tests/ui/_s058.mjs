// F58 comparison only: Full vs Full(Devices collapsed) vs Roomy
import { chromium } from 'playwright'; import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(), D='/workspace/screens/058/raw'; mkdirSync(D,{recursive:true});
const br=await chromium.launch(); const out={};
const SEL=['.libpanel','.devpanel','.npbar','.nowcol','.listpanel','.minicol','.np-ctlpanel','.statusbar','.menubar'];
for (const [vw,vh,dpr,zt] of [[1920,1080,1,'100'],[960,540,2,'200']]) for (const lib of ['rail','exp']) for (const list of ['open','expanded']) for (const [mode,layout,dev] of [['full','full','normal'],['fulldevrail','full','rail'],['roomy','roomy','normal']]) {
 const pn={lib:lib==='rail'?'rail':'normal',dev,exp:lib==='exp'?'lib':null,list,ctl:'open'};
 const c=await br.newContext({viewport:{width:vw,height:vh},deviceScaleFactor:dpr}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(([l,p])=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.uiscale','compact');localStorage.setItem('wavwiz.layout',l);localStorage.setItem('wavwiz.panels',JSON.stringify(p));},[layout,pn]);
 const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(2800); await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(e=>e.close()));
 const k=`${zt}-lib${lib}-queue${list}`; const f=`${D}/${k}-${mode}.png`; await p.screenshot({path:f});
 const r=await p.evaluate(S=>{const o={}; for(const s of S){const e=document.querySelector(s); if(!e) continue; const b=e.getBoundingClientRect(), cs=getComputedStyle(e); o[s]= (b.width&&b.height&&cs.visibility!=='hidden'&&cs.display!=='none')?{x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),bg:cs.backgroundColor,bd:cs.borderTopWidth+' '+cs.borderTopColor,rad:cs.borderTopLeftRadius,lbl:(e.querySelector('.pane-h,.railtitle,.rail-label')?.textContent||'').trim().slice(0,30)}:null;} o.desk=document.querySelector('.desk')?.className; return o;},SEL);
 (out[k]??={})[mode]=r; await c.close();
}
writeFileSync('/workspace/screens/058/rects.json',JSON.stringify(out,null,1)); await br.close(); console.log('done');

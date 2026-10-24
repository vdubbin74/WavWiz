import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(), TAG=process.env.TAG||'after', D='/workspace/screens/048/'+TAG; mkdirSync(D,{recursive:true});
const TH=(process.env.THEMES||'default,pepecoin,ember,arctic,violet,mono,daylight,nebula,steel,lime').split(','), ST=['classic','center','stack','horizon'];
const ZS=(process.env.ZS||'100,200').split(','), LAYS=(process.env.LAYS||'full').split(',');
const br=await chromium.launch();
for (const zt of ZS) for (const lay of LAYS) for (const list of ['collapsed','expanded']) { const [vw,vh,d]=zt==='100'?[1920,1080,1]:[960,540,2];
 const c=await br.newContext({viewport:{width:vw,height:vh},deviceScaleFactor:d}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(([lay,list])=>{if(sessionStorage.getItem('s48'))return;sessionStorage.setItem('s48','1');localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.uiscale','compact');localStorage.setItem('wavwiz.layout',lay);localStorage.setItem('wavwiz.panels',JSON.stringify({lib:'normal',dev:'normal',exp:null,list,ctl:'collapsed'}));},[lay,list]);
 const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(2800); await p.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(x=>x.close());const s=document.createElement('style');s.textContent='*{transition:none!important}';document.head.append(s);});
 for (const s of ST) { await p.evaluate(async s=>{const m=await import('/js/npstyle.js');m.saveNpPrefs({...m.loadNpPrefs(),style:s});window.dispatchEvent(new CustomEvent('wavwiz:npstyle'));},s);
  for (const th of TH) { await p.evaluate(async t=>{const m=await import('/js/theme.js');m.applyTheme({preset:t,...(m.PRESETS[t]||{})});},th); await p.waitForTimeout(80);
   const sel=await p.evaluate(()=>{const v=e=>e&&e.offsetParent!==null&&getComputedStyle(e).visibility!=='hidden'&&e.getBoundingClientRect().width>50; return v(document.querySelector('.np-ctlpanel'))?'.np-ctlpanel':v(document.querySelector('.npbar'))?'.npbar':null;});
   if(sel) await p.locator(sel).screenshot({path:`${D}/${lay}-${zt}-${s}-${th}-q${list}.png`}); else console.log('nobar',lay,zt,s,th,list); } }
 await p.screenshot({path:`${D}/page-${lay}-${zt}-q${list}.png`}); await c.close(); }
await br.close();

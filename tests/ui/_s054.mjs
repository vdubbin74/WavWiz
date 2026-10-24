import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(), TAG=process.env.TAG||'before', D='/workspace/screens/054/'+TAG; mkdirSync(D,{recursive:true});
const br=await chromium.launch(); const base={lib:'normal',dev:'normal',exp:null,list:'open',ctl:'open'};
const vis=async(p,sel)=>p.evaluate(s=>{const e=[...document.querySelectorAll(s)].find(e=>e.offsetParent&&getComputedStyle(e).visibility!=='hidden'&&e.getBoundingClientRect().width>40);if(e){e.setAttribute('data-shot','1');return true}return false},sel);
for (const [vw,vh,d,zt] of [[1920,1080,1,'100'],[960,540,2,'200']]) for (const [name,pn,sel,styles] of [['panel',base,'.np-ctlpanel',['classic','center','stack','horizon']],['strip',{...base,list:'collapsed',ctl:'collapsed'},'.np-ctlpanel',['classic']],['devexpanded',{...base,dev:'expanded',exp:'dev'},'.npbar',['classic']],['libexpanded',{...base,exp:'lib'},'.minicol',['classic']]]) {
 const c=await br.newContext({viewport:{width:vw,height:vh},deviceScaleFactor:d}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(pn=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.uiscale','compact');localStorage.setItem('wavwiz.layout','full');localStorage.setItem('wavwiz.panels',JSON.stringify(pn));},pn);
 const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(3000); await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(x=>x.close()));
 for (const s of styles) { await p.evaluate(async s=>{const m=await import('/js/npstyle.js');m.saveNpPrefs({...m.loadNpPrefs(),style:s});window.dispatchEvent(new CustomEvent('wavwiz:npstyle'));},s); await p.waitForTimeout(300);
  if (await vis(p,sel)) await p.locator('[data-shot="1"]').first().screenshot({path:`${D}/${name}-${s}-${zt}.png`}); await p.evaluate(()=>document.querySelectorAll('[data-shot]').forEach(e=>e.removeAttribute('data-shot'))); }
 if (name==='panel') { await p.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyM',key:'m',altKey:true,bubbles:true}))); await p.waitForTimeout(800); if (await vis(p,'.miniwin, .mini-pop, .minip, #mini, .mp')) await p.locator('[data-shot="1"]').first().screenshot({path:`${D}/mini-${zt}.png`}); }
 await c.close(); }
{ const c=await br.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(()=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');});
 const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(3000); await p.evaluate(()=>document.querySelectorAll('dialog[open],.phone-unlock').forEach(e=>e.close?.()||e.remove())); await p.screenshot({path:`${D}/phone-now-390.png`}); await c.close(); }
await br.close();

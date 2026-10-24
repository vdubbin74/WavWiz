import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(); const br=await chromium.launch(); const TAG=process.env.TAG||'before';
for (const [w] of [[420],[360],[330]]) for (const [z,d] of [['100',1],['200',2]]) { const c=await br.newContext({viewport:{width:w,height:260},deviceScaleFactor:d}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(()=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');});
 const p=await c.newPage(); await p.goto(B+'/mini.html'); await p.waitForTimeout(2500);
 const r=await p.evaluate(()=>{const ch=document.querySelector('.zs-mini'),sc=document.querySelector('.mp-sc'),mp=document.querySelector('.mp');const R=e=>e?.getBoundingClientRect();const icons=[...sc.children].filter(e=>e!==ch).map(e=>R(e));const cr=R(ch);
  const h0=R(mp).height; ch.style.display='none'; const h1=R(mp).height; ch.style.display=''; return {grow:Math.round(h0-h1), chip:!!ch&&cr.width>0, chipL:Math.round(cr.left-R(sc).left), sameRow:icons.every(i=>Math.abs((i.top+i.bottom)/2-(cr.top+cr.bottom)/2)<4), iconsRight:icons.every(i=>i.left>=cr.right-1), scH:Math.round(R(sc).height), mpH:Math.round(R(mp).height), docH:document.documentElement.scrollHeight, name:ch?.querySelector('.zs-name')?.textContent, lbl:R(ch.querySelector('.zs-lbl')).width>0, chipW:Math.round(cr.width), iconH:Math.round(Math.max(...icons.map(i=>i.height)))}});
 console.log(w,z,JSON.stringify(r)); await p.screenshot({path:`/workspace/screens/wavwiz-044-F15-${TAG}-w${w}-${z}.png`}); await c.close(); }
await br.close();

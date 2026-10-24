import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(); const br=await chromium.launch(); const TAG=process.env.TAG||'before';
for (const [w,h] of [[1920,1080],[1366,768]]) for (const [z,d] of [['100',1],['200',2]]) { const c=await br.newContext({viewport:{width:w,height:h},deviceScaleFactor:d}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(()=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.panels',JSON.stringify({lib:'expanded',dev:'rail',exp:'lib',list:'open',ctl:'open'}));});
 const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(2800);
 console.log(await p.evaluate(()=>{const m=document.querySelector('.embedded-host');return m?m.innerHTML.replace(/<svg.*?<\/svg>/g,'').slice(0,900):'nohost'})); const r=await p.evaluate(()=>{const ch=[...document.querySelectorAll('.zs-mini')].find(e=>e.offsetParent);if(!ch)return {none:true};const sc=ch.parentElement,mp=sc.parentElement;const R=e=>e?.getBoundingClientRect();const icons=[...sc.children].filter(e=>e!==ch&&R(e).width>0).map(R);const cr=R(ch);
  const h0=R(mp).height; ch.style.display='none'; const h1=R(mp).height; ch.style.display='';
  return {grow:Math.round(h0-h1),chip:cr.width>0,chipL:Math.round(cr.left-R(sc).left),sameRow:icons.every(i=>Math.abs((i.top+i.bottom)/2-(cr.top+cr.bottom)/2)<4),iconsRight:icons.every(i=>i.left>=cr.right-1),lbl:R(ch.querySelector('.zs-lbl')).width>0,mpW:Math.round(R(mp).width),overflow:sc.scrollWidth>sc.clientWidth+1}});
 console.log(w,z,JSON.stringify(r)); const m=p.locator('.zs-mini >> xpath=../..').first(); if(await m.count()) await m.screenshot({path:`/workspace/screens/wavwiz-044-F15-${TAG}-inapp-${w}-${z}.png`}).catch(()=>{}); await c.close(); }
await br.close();

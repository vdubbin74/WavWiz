import { chromium } from 'playwright';
const br=await chromium.launch();
for (const mode of ['collapsed','expanded']) { const p=await br.newPage({viewport:{width:1000,height:500}});
 await p.goto('http://localhost:8732/preview-f130-live.html?w=900&mode='+mode); await p.waitForSelector('body[data-ready]'); await p.waitForTimeout(800);
 const info=()=>p.evaluate(()=>{const pn=document.querySelector('.np-ctlpanel').getBoundingClientRect(),s=document.querySelector('.np-scside');const r=s.getBoundingClientRect();return {panel:[pn.left,pn.top,pn.right,pn.bottom].map(Math.round),strip:[r.left,r.top,r.right,r.bottom].map(Math.round),hidden:s.hidden,ovy:getComputedStyle(s).overflowY,order:[...s.querySelectorAll('.scpin')].map(b=>b.dataset.sc),store:localStorage.getItem('wavwiz.pins.v1')||Object.keys(localStorage).filter(k=>/pin/.test(k)).map(k=>k+'='+localStorage.getItem(k)).join()}});
 console.log(mode,'open',JSON.stringify(await info()));
 await p.screenshot({path:`/workspace/previews/f135e-${mode}-title.png`});
 const pins=await p.$$('.np-scside .scpin'); if(pins.length>=2){ if(mode==='collapsed') await p.dragAndDrop('.np-scside .scpin >> nth=1','.np-scside .scpin >> nth=0',{targetPosition:{x:24,y:4}}); else await p.dragAndDrop('.np-scside .scpin >> nth=0','.np-scside .scpin >> nth=-1'); await p.waitForTimeout(200); console.log(mode,'afterDrag',JSON.stringify((await info()).order), JSON.stringify((await info()).store));
  await p.click('.np-scside .scpin >> nth=0',{button:'right'}); await p.waitForTimeout(150); const m=await p.$$eval('.scpop button',b=>b.map(x=>x.textContent+(x.disabled?'(dis)':''))); console.log(mode,'menu',m);
  const en=await p.$('.scpop button:not([disabled])'); await en.click(); await p.waitForTimeout(150); console.log(mode,'afterMenu',JSON.stringify((await info()).order)); }
 await p.close(); }
await br.close();

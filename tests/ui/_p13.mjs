import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(); const br=await chromium.launch(); const TAG=process.env.TAG||'before';
for (const [z,d] of [['100',1],['200',2]]) {
 const c=await br.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:d}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(()=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.panels',JSON.stringify({lib:'normal',dev:'normal',exp:null,list:'normal',ctl:'collapsed'}));});
 const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(2600);
 const r=await p.evaluate(()=>{const v=e=>!!e&&!!e.offsetParent&&e.getBoundingClientRect().width>0;const np=document.querySelector('.ctlpanel, .nowpanel, [class*=np-]');const pn=document.querySelector('.zs-panel');const strip=pn?.parentElement;return {panelChip:v(pn),chips:[...document.querySelectorAll('.zsel, [class*=zs-]')].filter(e=>/^zs-(panel|bar|master|mini|phone)$/.test([...e.classList].find(c=>/^zs-/.test(c))||'')).map(e=>[...e.classList].join('.')+':'+v(e)),head:strip?.className, headHTML:strip?.innerText?.slice(0,120), pnRect:pn?.getBoundingClientRect().toJSON()}});
 console.log(z,JSON.stringify(r));
 const hd=p.locator('.np-ctlpanel .pane-h').first(); if(await hd.count()){const bb=await hd.boundingBox(); await p.screenshot({path:`/workspace/screens/wavwiz-044-F13-${TAG}-${z}.png`,clip:{x:Math.max(0,bb.x-20),y:Math.max(0,bb.y-20),width:1100,height:Math.min(200,1080-bb.y+20)}});}
 await c.close();}
await br.close();

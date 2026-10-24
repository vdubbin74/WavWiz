import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(), D='/workspace/screens/049/built'; const br=await chromium.launch();
for (const [n,vw,vh,d,sc,m] of [['pc100',1920,1080,1,'compact',0],['pc200',960,540,2,'compact',0],['phone390',390,844,3,'compact',1]]) {
 const c=await br.newContext({viewport:{width:vw,height:vh},deviceScaleFactor:d,...(m?{isMobile:true,hasTouch:true}:{})}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(sc=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.uiscale',sc);},sc);
 const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(3000); await p.evaluate(()=>document.querySelectorAll('dialog[open],.phone-unlock').forEach(e=>e.close?.()||e.remove()));
 if(!m) await p.screenshot({path:`${D}/${n}-playerbar.png`});
 await p.evaluate(()=>window.dispatchEvent(new CustomEvent('wavwiz:mixer'))); await p.waitForTimeout(700);
 await p.locator('.mv-chev:not([disabled])').first().click().catch(()=>{}); await p.waitForTimeout(300);
 await p.screenshot({path:`${D}/${n}-mixer.png`}); await c.close(); }
await br.close();

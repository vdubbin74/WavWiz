import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(), D='/workspace/screens/049/after'; mkdirSync(D,{recursive:true});
const br=await chromium.launch();
for (const [n,vw,vh,dpr,mob] of [['pc100',1920,1080,1,false],['pc200',960,540,2,false],['phone390',390,844,2,true]]) for (const theme of ['default','arctic']) {
 const c=await br.newContext({viewport:{width:vw,height:vh},deviceScaleFactor:dpr,isMobile:mob,hasTouch:mob}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(t=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.uiscale','compact');if(t!=='default')localStorage.setItem('wavwiz.theme',t);},theme);
 const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(3000); await p.evaluate(()=>document.querySelectorAll('dialog[open],.phone-unlock').forEach(e=>e.close?.()||e.remove()));
 if (!mob) await p.screenshot({path:`${D}/F49-${n}-${theme}-app-buttons.png`});
 await p.evaluate(()=>window.dispatchEvent(new CustomEvent('wavwiz:mixer'))); await p.waitForTimeout(800);
 await p.evaluate(()=>document.querySelectorAll('.mv-spk').forEach(r=>{ if(/Chrome on Linux/i.test(r.textContent)) r.style.display='none'; }));
 await p.locator('.mv-spk:visible .mv-chev').first().click().catch(()=>{}); await p.waitForTimeout(300);
 await p.screenshot({path:`${D}/F49-${n}-${theme}.png`}); await c.close();
}
await br.close(); console.log('done');

import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(); const br=await chromium.launch(); const c=await br.newContext({viewport:{width:1920,height:1080}}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
await c.addInitScript(()=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','1');localStorage.setItem('wavwiz.webRoom.name','Office Desk');localStorage.setItem('wavwiz.panels',JSON.stringify({lib:'rail',dev:'expanded',exp:'dev',list:'normal',ctl:'collapsed'}));});
const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(5000); await p.evaluate(()=>document.querySelectorAll('dialog[open],.phone-unlock').forEach(e=>e.close?.()||e.remove()));
console.log(await p.evaluate(()=>[...document.querySelectorAll('.tree42 .sp42 .sp42-n')].map(e=>e.closest('.sp42').className+':'+e.textContent.trim()).join(' | ')));
await p.evaluate(()=>{const b=[...document.querySelectorAll('.tree42 .sp42 .sp42-n')].find(e=>/Office Desk|Chrome/.test(e.textContent)); b?.click();}); await p.waitForTimeout(1500);
console.log(await p.evaluate(()=>[document.querySelectorAll('.spkset').length, document.querySelectorAll('.spk-num').length, [...document.querySelectorAll('.spkset .spk-l span:first-child')].map(e=>e.textContent).join(',')]));
await br.close();

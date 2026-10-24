import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(); const br=await chromium.launch(); const c=await br.newContext({viewport:{width:1920,height:1080}}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
await c.addInitScript(()=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.panels',JSON.stringify({lib:'normal',dev:'expanded',exp:'dev',list:'open',ctl:'collapsed'}));});
const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(3000); await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(x=>x.close()));
console.log(await p.evaluate(()=>[...document.querySelectorAll('.devpanel *')].filter(e=>e.children.length===0&&/^PCBOXV1$/.test(e.textContent.trim())).map(e=>e.tagName+'.'+e.className+' < '+e.parentElement.className).join('\n')));
await p.screenshot({path:'/workspace/v048/o.png'}); await br.close();

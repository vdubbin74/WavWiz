import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(); const br=await chromium.launch();
const c=await br.newContext({viewport:{width:1920,height:1080}}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
await c.addInitScript(()=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');});
const p=await c.newPage(); p.on('console',m=>console.log('C',m.text())); p.on('pageerror',e=>console.log('ERR',e.message)); p.on('request',r=>{if(/api/.test(r.url())&&!/status|zones$/.test(r.url()))console.log('R',r.url().replace(B,''))});
await p.goto(B+'/'); await p.waitForTimeout(3000); console.log('---select'); 
console.log(await p.evaluate(async()=>{const m=await import('/js/zones40.js');return JSON.stringify(m.choicesNow().map(c=>({k:c.key,kind:c.kind,pb:c.playbackId,ov:c.overlaps,zid:m.zoneIdFor(c)})))}));
await p.selectOption('.qzpick','g:2'); await p.waitForTimeout(2500); await br.close();

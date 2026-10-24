import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(); const br=await chromium.launch(); const c=await br.newContext(); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
const p=await c.newPage(); p.on('pageerror',e=>console.log('ERR',e.stack)); p.on('console',m=>m.type()==='error'&&console.log('CON',m.text())); await p.goto(B+'/'); await p.waitForTimeout(3000); console.log(await p.evaluate(()=>!!document.querySelector('.listpanel .pane-h'))); await br.close();

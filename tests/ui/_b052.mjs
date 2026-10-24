import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(); const br=await chromium.launch();
for (const v of ['side','expanded']) { const c=await br.newContext({viewport:{width:1920,height:1080}}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
await c.addInitScript(v=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.panels',JSON.stringify(v==='side'?{lib:'normal',dev:'normal',exp:null,list:'open',ctl:'collapsed'}:{lib:'normal',dev:'expanded',exp:'dev',list:'open',ctl:'collapsed'}));},v);
const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(3000);
console.log(v, await p.evaluate(()=>[...document.querySelectorAll('.devpanel *')].filter(e=>e.offsetParent&&parseFloat(getComputedStyle(e).borderBottomWidth)>0&&getComputedStyle(e).borderBottomStyle!=='none'&&!/btn|zrow|sp42|card|dc3|zchip|mall|ib|range|input|select/i.test(e.className+e.tagName)&&e.getBoundingClientRect().width>150).map(e=>e.tagName+'.'+e.className+' '+Math.round(e.getBoundingClientRect().top)+' '+getComputedStyle(e).borderBottomColor).slice(0,20).join('\n')));
await c.close(); } await br.close();

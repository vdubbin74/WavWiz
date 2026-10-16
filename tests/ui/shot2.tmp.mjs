import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim();
const br=await chromium.launch();
async function pg(panels,theme){const ctx=await br.newContext({viewport:{width:1920,height:1080}});await ctx.addCookies([{name:'unison_session',value:sess,url:B}]);await ctx.addInitScript(()=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1')});const p=await ctx.newPage();p.on('pageerror',e=>console.log('ERR',e.message));await p.goto(B+'/');await p.evaluate(v=>localStorage.setItem('wavwiz.panels',JSON.stringify(v)),panels);await p.goto(B+'/');await p.waitForTimeout(2500);await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));await p.locator('.phone-unlock').click({timeout:1000}).catch(()=>{});if(theme)await p.evaluate(async id=>{const t=await import('/js/theme.js');t.applyTheme({...t.PRESETS[id],preset:id})},theme);await p.waitForTimeout(500);return p}
for (const th of ['default','pepecoin']){
 let p=await pg({lib:'normal',dev:'normal',exp:null,list:'open',ctl:'open'},th); await p.screenshot({path:`/workspace/screens/wavwiz-038-l46-std-${th}.png`});
 console.log(await p.evaluate(()=>JSON.stringify({grips:document.querySelectorAll('.dgrip').length,rich:document.querySelector('.devbody')?.className,mall:!!document.querySelector('.mall')})));
 p=await pg({lib:'normal',dev:'expanded',exp:'dev',list:'open',ctl:'open'},th); await p.screenshot({path:`/workspace/screens/wavwiz-038-l40-exp-${th}.png`});
}
await br.close();

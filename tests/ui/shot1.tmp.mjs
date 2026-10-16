import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim();
const br=await chromium.launch(); 
async function pg(w,h,panels,theme){const ctx=await br.newContext({viewport:{width:w,height:h}});await ctx.addCookies([{name:'unison_session',value:sess,url:B}]);await ctx.addInitScript(()=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1')});const p=await ctx.newPage();await p.goto(B+'/');await p.evaluate(v=>localStorage.setItem('wavwiz.panels',JSON.stringify(v)),panels);await p.goto(B+'/');await p.waitForTimeout(2500);await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));await p.locator('.phone-unlock').click({timeout:1000}).catch(()=>{});if(theme)await p.evaluate(async id=>{const t=await import('/js/theme.js');t.applyTheme({...t.PRESETS[id],preset:id})},theme);await p.waitForTimeout(500);return p}
for (const th of ['default','pepecoin']){
 let p=await pg(1920,1080,{lib:'expanded',dev:'rail',exp:'lib',list:'open',ctl:'open'},th); await p.screenshot({path:`/workspace/screens/wavwiz-038-l33-${th}.png`});
 console.log(await p.evaluate(()=>{const r=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return [Math.round(b.x),Math.round(b.y),Math.round(b.width),Math.round(b.height)]};return JSON.stringify({desk:document.querySelector('.desk').className,lib:r('.libpanel'),list:r('.listpanel'),mini:r('.minicol'),dev:r('.devpanel')})}));
 p=await pg(1920,1080,{lib:'normal',dev:'rail',exp:null,list:'expanded',ctl:'open'},th); await p.screenshot({path:`/workspace/screens/wavwiz-038-l42-${th}.png`});
 console.log(await p.evaluate(()=>{const r=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return [Math.round(b.x),Math.round(b.y),Math.round(b.width),Math.round(b.height)]};return JSON.stringify({desk:document.querySelector('.desk').className,mini:r('.minicol'),dev:r('.devpanel')})}));
}
await br.close();

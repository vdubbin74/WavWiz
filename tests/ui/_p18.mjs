import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(); const br=await chromium.launch(); const TAG=process.env.TAG||'before';
for (const [z,d] of [['100',1],['200',2]]) for (const [nm,pn] of [['exp',{lib:'rail',dev:'expanded',exp:'dev',list:'normal',ctl:'collapsed'}],['panel',{lib:'rail',dev:'normal',exp:null,list:'normal',ctl:'collapsed'}]]) {
 const ctx=await br.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:d}); await ctx.addCookies([{name:'unison_session',value:sess,url:B}]);
 await ctx.addInitScript(pn=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.panels',JSON.stringify(pn));},pn);
 const p=await ctx.newPage(); await p.goto(B+'/'); await p.waitForTimeout(2600);
 const r=await p.evaluate(()=>{const m={};document.querySelectorAll('.devpanel .dtag').forEach(t=>{if(!t.offsetParent)return;const b=t.getBoundingClientRect(),cs=getComputedStyle(t);const k=t.textContent.trim().replace(/\d+/g,'n').slice(0,14);const v=`${Math.round(b.height*10)/10}h ${cs.fontSize} ${cs.paddingTop}/${cs.paddingLeft} r${cs.borderTopLeftRadius} svg${t.querySelector('svg')?Math.round(t.querySelector('svg').getBoundingClientRect().height):'-'}`;(m[k]=m[k]||new Set()).add(v)});return Object.fromEntries(Object.entries(m).map(([k,v])=>[k,[...v]]))});
 console.log(z,nm,JSON.stringify(r));
 const cap=p.locator('.devpanel .dtag.capped').first(); if(await cap.count()){await cap.scrollIntoViewIfNeeded(); const bb=await cap.boundingBox(); await p.screenshot({path:`/workspace/screens/wavwiz-044-F18-${TAG}-${nm}-${z}.png`,clip:{x:Math.max(0,bb.x-420),y:Math.max(0,bb.y-120),width:840,height:260}});}
 await ctx.close(); }
await br.close();

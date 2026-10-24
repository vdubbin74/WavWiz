// F6/F20 probe: preset lists in the Sound/EQ window, the Playback menu and the speaker page EQ (web speaker joined)
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(), TAG=process.env.TAG||'before';
const br=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
for (const [z,d] of (process.env.ONE?[['100',1]]:[['100',1],['200',2]])) {
 const ctx=await br.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:d}); await ctx.addCookies([{name:'unison_session',value:sess,url:B}]);
 await ctx.addInitScript(()=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','1');localStorage.setItem('wavwiz.webRoom.name','F6 Browser');localStorage.setItem('wavwiz.panels',JSON.stringify({lib:'rail',dev:'expanded',exp:'dev',list:'normal',ctl:'open'}));});
 const p=await ctx.newPage(); await p.goto(B+'/'); await p.waitForTimeout(3500);
 await p.evaluate(async()=>{try{(await import('/js/room.js')).unlockAudio();}catch{} document.querySelectorAll('.phone-unlock').forEach(e=>e.remove());}); await p.waitForTimeout(800);
 // speaker page
 await p.evaluate(()=>{const n=[...document.querySelectorAll('.sp42:not(.gone) .sp42-n')].find(e=>e.textContent.trim()==='F6 Browser');n?.click();}); await p.waitForTimeout(1200);
 const spk=await p.evaluate(()=>{const sp=document.querySelector('.spkset');if(!sp)return null;const sel=sp.querySelector('select.eqall-preset, select[aria-label=Preset]');const chips=[...sp.querySelectorAll('[data-preset], .eqchip, .pchip')].map(c=>c.textContent.trim());return {chips,select:sel?[...sel.querySelectorAll('option,optgroup')].map(o=>o.tagName==='OPTGROUP'?'['+o.label+']':o.textContent):null}});

 console.log(z,'speaker page',JSON.stringify(spk));
 const pr=p.locator('.spkset [data-act=preset-saveas]').first(); if(await pr.count()){await pr.scrollIntoViewIfNeeded();const bb=await pr.boundingBox();await p.screenshot({path:`/workspace/screens/wavwiz-044-F20-${TAG}-${z}.png`,clip:{x:Math.max(0,bb.x-700),y:Math.max(0,bb.y-220),width:1100,height:420}});}
 // Sound/EQ window
 await p.evaluate(async()=>{const zones=await (await fetch('/api/v1/zones')).json();const me=zones.find(z=>z.name==='F6 Browser'&&z.connected);const S={zones,groups:[],me:null};(await import('/js/eq.js')).openEq(S,null,me?.outputs?.[0]?.deviceId);}); await p.waitForTimeout(1500);
 const menu=await p.evaluate(async()=>{const zones=await (await fetch('/api/v1/zones')).json();const sp=await (await import('/js/menusub.js')).eqSpec({zones,groups:[]},{go(){}});return sp.map(x=>x==='hr'?'---':x[0])}); console.log(z,'Playback menu',JSON.stringify(menu));
 const dlg=await p.evaluate(()=>{const s=document.querySelector('dialog[open] select[aria-label=Preset], .eqdialog select[aria-label=Preset]');if(!s)return null;s.size=Math.min(16,s.querySelectorAll('option,optgroup').length+2);s.style.height='auto';return [...s.querySelectorAll('option,optgroup')].map(o=>o.tagName==='OPTGROUP'?'['+o.label+']':o.textContent)});
 console.log(z,'EQ window',JSON.stringify(dlg));
 const s2=p.locator('dialog[open] select[aria-label=Preset]').first(); if(await s2.count()){const bb=await s2.boundingBox();await p.screenshot({path:`/workspace/screens/wavwiz-044-F6-${TAG}-${z}.png`,clip:{x:Math.max(0,bb.x-60),y:Math.max(0,bb.y-60),width:Math.min(700,bb.width+400),height:bb.height+140}});}
 const hl=await p.evaluate(()=>{const s=document.querySelector('dialog[open] select[aria-label=Preset]');if(!s)return null;const o=[...s.options].find(x=>x.selected)||s.options[0];return {colorScheme:getComputedStyle(s).colorScheme,optBg:getComputedStyle(o).backgroundColor,accent:getComputedStyle(s).accentColor}});
 console.log(z,'highlight',JSON.stringify(hl));
 await ctx.close(); }
await br.close();

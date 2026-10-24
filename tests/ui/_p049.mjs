import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(); const br=await chromium.launch(); const c=await br.newContext({viewport:{width:1920,height:1080}}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
await c.addInitScript(()=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.panels',JSON.stringify({lib:'normal',dev:'normal',exp:null,list:'open',ctl:'open'}));});
const p=await c.newPage(); p.on('pageerror',e=>console.log('ERR',e.message)); await p.goto(B+'/'); await p.waitForTimeout(3000); await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(x=>x.close()));
console.log('btns', await p.evaluate(()=>[...document.querySelectorAll('[data-act=mixer]')].filter(b=>b.offsetParent).map(b=>b.closest('.np-volrow,.ns-vol,.npb-vol,.dmaster,.mp-vol')?.className).join(' | ')));
await p.keyboard.press('Alt+v'); await p.waitForTimeout(800);
console.log(await p.evaluate(()=>{const d=document.querySelector('dialog.mixer-dlg'); return d?[d.getBoundingClientRect().width, d.querySelectorAll('.mv-card').length, d.querySelectorAll('.mv-spk').length, d.scrollWidth-d.clientWidth]:null}));
const ch=p.locator('dialog.mixer-dlg .mv-chev:not([disabled])').first(); if (await ch.count()) await ch.click();
await p.screenshot({path:'/workspace/v048/p049.png'}); await br.close();

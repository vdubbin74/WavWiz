import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim();
const br=await chromium.launch(); const ctx=await br.newContext({viewport:{width:960,height:540},deviceScaleFactor:2,userAgent:'X WavWizPlayer/0.4.4'});
await ctx.addCookies([{name:'unison_session',value:sess,url:B}]); await ctx.addInitScript(()=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.panels',JSON.stringify({dev:'normal',ctl:'collapsed',lib:'normal',exp:null,list:'open'}));});
const p=await ctx.newPage(); await p.goto(B+'/'); await p.waitForTimeout(2500);
for (let k=0;k<2;k++){ await p.locator('.libpanel li.item .t').first().click(); await p.waitForTimeout(900); }
console.log(await p.evaluate(()=>[...document.querySelectorAll('.libpanel li.item')].slice(0,4).map(e=>e.className+' | '+e.innerText.replace(/\n/g,' / ').slice(0,60))));
const q=p.locator('.listpanel .qwrap'); console.log(await q.boundingBox(), await p.locator('.libpanel li.item.ldrag').first().boundingBox());
console.log(await p.evaluate(()=>[...document.querySelectorAll('.listpanel .pane-h button, .listpanel .pane-h select, .listpanel .pane-h [role]')].map(e=>e.className+':'+(e.getAttribute('aria-label')||e.textContent.trim()).slice(0,40))));
await br.close();

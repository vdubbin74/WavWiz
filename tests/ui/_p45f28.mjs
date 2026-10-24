import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(), TAG=process.env.TAG||'before'; const br=await chromium.launch();
for (const [z,d] of [['100',1],['200',2]]) { const c=await br.newContext({viewport:{width:1920/d*1,height:1080/d*1},deviceScaleFactor:d}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(()=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.panels',JSON.stringify({lib:'normal',dev:'normal',exp:null,list:'open',ctl:'collapsed'}));});
 const p=await c.newPage(); const reqs=[]; p.on('request',r=>{if(/stream|queue/.test(r.url()))reqs.push(r.url().replace(B,''))}); await p.goto(B+'/'); await p.waitForTimeout(3000);
 const st=()=>p.evaluate(()=>({title:document.querySelector('.listpanel .pane-h')?.innerText.split('\n').slice(0,3).join(' | '),pick:document.querySelector('.qzpick')?.value,opts:[...document.querySelectorAll('.qzpick option')].map(o=>o.value+'='+o.textContent),ctl:document.querySelector('.zs-name')?.textContent,rows:[...document.querySelectorAll('.listpanel tbody tr')].slice(0,3).map(r=>r.innerText.replace(/\s+/g,' ').slice(0,60))}));
 const a=await st(); console.log(z,'A',JSON.stringify(a)); const other=a.opts.map(o=>o.split('=')[0]).find(k=>k!==a.pick); reqs.length=0;
 await p.selectOption('.qzpick',other); await p.waitForTimeout(2500); const b=await st(); console.log(z,'B',JSON.stringify(b)); console.log('reqs',reqs.slice(0,6));
 await p.locator('.listpanel').screenshot({path:`/workspace/screens/wavwiz-045-F28-${TAG}-${z}.png`}); await c.close(); }
await br.close();

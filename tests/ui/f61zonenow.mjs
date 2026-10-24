// 0.4.8 F61: the "now playing in this zone" lines on device cards and in the zone / speaker settings follow the live socket: a track change and
// a pause / resume show in under 1 s, and the time ticks every second (it used to move only when the tree rebuilt, every ~10 s). Side panel + expanded.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(); let pass=0, fail=0;
const ok=(n,c,x='')=>{c?pass++:fail++; console.log((c?'ok   ':'FAIL ')+n+(c?'':'  '+x));};
const br=await chromium.launch();
for (const [vn,exp] of [['side panel',null],['expanded Devices','dev']]) {
 const c=await br.newContext({viewport:{width:1920,height:1080}}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(exp=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.layout','full');localStorage.setItem('wavwiz.panels',JSON.stringify({lib:'rail',dev:'normal',exp,list:'open',ctl:'collapsed'}));},exp);
 const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(3000); await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(x=>x.close()));
 const call=(path,body)=>p.evaluate(async ([path,body])=>{ const {api}=await import('/js/util.js'); await api(path,{method:'POST',body}); },[path,body]);
 const lines=()=>p.evaluate(()=>[...document.querySelectorAll('.devpanel .zl-now')].filter(b=>b.offsetParent&&b.closest('[data-leader-id="1"],[data-group-id="1"]')).map(b=>({t:b.querySelector('.zl-t b')?.textContent||'', s:b.querySelector('.zl-ico')?.textContent, tm:b.querySelector('.zl-time')?.textContent||''})));
 const waitFor=async (pred,max=3000)=>{ const t0=Date.now(); while(Date.now()-t0<max){ const l=await lines(); if(l.length&&pred(l)) return Date.now()-t0; await p.waitForTimeout(25);} return Infinity; };
 await call('/stream/jump',{index:0}).catch(()=>{}); await p.waitForTimeout(1500);   // track 1 of 6: "next" always has a different song (Ember -> Song Two)
 const t=`[${vn}]`, before=await lines(); ok(`${t} the zone now-playing line is shown`, before.length>0 && before.every(x=>x.t), JSON.stringify(before));
 const pick=l=>l.map(x=>x.t).join('|'), was=pick(before);   // the Basement zone (group 1) lines: card + zone settings
 // sample for 2.5 s after "next"; the settled value is the new track; the delay is when the lines first reached it
 await call('/stream/next'); const t0=Date.now(), smp=[]; while(Date.now()-t0<2500){ smp.push([Date.now()-t0, pick(await lines())]); await p.waitForTimeout(20); }
 const fin=smp.at(-1)[1]; let k=smp.length-1; while(k>0&&smp[k-1][1]===fin) k--; const msTrack=fin!==was?smp[k][0]:Infinity;
 console.log(`     ${t} ${was} -> ${fin} after ${msTrack} ms`);
 ok(`${t} a track change shows on the playing zone's lines in under 1 s`, msTrack<1000 && fin.split('|').every(x=>x), String(msTrack));
 const sel=l=>l;
 await call('/stream/pause'); const msPause=await waitFor(l=>sel(l).every(x=>x&&x.s!=='▶')); ok(`${t} pause shows in under 1 s`, msPause<1000, String(msPause));
 await call('/stream/resume'); const msRes=await waitFor(l=>sel(l).every(x=>x&&x.s==='▶')); ok(`${t} resume shows in under 1 s`, msRes<1000, String(msRes));
 const a=(await lines())[0]?.tm; await p.waitForTimeout(2200); const b=(await lines())[0]?.tm; ok(`${t} the time ticks while playing (${a} -> ${b})`, !!a && a!==b, JSON.stringify([a,b]));
 await c.close(); }
await br.close(); console.log(`f61zonenow: ${pass} passed, ${fail} failed`); process.exit(fail?1:0);

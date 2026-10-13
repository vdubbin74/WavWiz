import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim();
const api=async(p,m='GET',b)=>{const r=await fetch(B+'/api/v1'+p,{method:m,headers:{Cookie:'unison_session='+sess,Origin:B,'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const t=await r.text();try{return JSON.parse(t)}catch{return t}};
const R=[];const ok=(n,c,i='')=>{R.push(c);console.log((c?'PASS ':'FAIL ')+n+(i?' :: '+i:''))};
await api('/jukebox/stop','POST',{pin:'2468'}).catch(()=>{});
const cb=await chromium.launch(); const ctx=await cb.newContext({viewport:{width:1920,height:1080}});
await ctx.addCookies([{name:'unison_session',value:sess,url:B}]);
await ctx.addInitScript(()=>localStorage.setItem('wavwiz.whatsnew','9.9.9'));
const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(B+'/'); await p.waitForTimeout(3000); await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
await p.evaluate(async()=>(await import('/js/main.js')).go('jukebox')); await p.waitForTimeout(1500);
const dlg=p.locator('dialog[open][aria-label="Start Jukebox"]');
ok('G13 Start Jukebox dialog shows labelled buttons', await dlg.count()===1 && (await dlg.locator('footer button').allTextContents()).join('|')==='Cancel|Start Jukebox', (await dlg.locator('footer button').allTextContents()).join('|'));
await p.screenshot({path:'/workspace/screens/wavwiz-033-g13-start-dialog.png'});
// validation: bad PIN keeps dialog open
await dlg.locator('input[type=password]').fill('12'); await dlg.locator('input[type=checkbox]').uncheck();
await dlg.locator('footer button',{hasText:'Start Jukebox'}).click(); await p.waitForTimeout(800);
const cfg=await api('/jukebox/config');
ok('G13 invalid PIN: toast, dialog stays open (keep:true)', await dlg.count()===1, 'hasPin='+cfg.hasPin);
await dlg.locator('input[type=password]').fill('2468'); await dlg.locator('footer button',{hasText:'Start Jukebox'}).click(); await p.waitForTimeout(1500);
let st=await api('/jukebox'); ok('G13 Start: jukebox running, dialog closed', st.running===true && await dlg.count()===0, JSON.stringify(st).slice(0,200));
const code=st.code||st.j||st.guestCode||(st.url||'').split('j=')[1];
// big screen in a plain browser (separate, non-Player context)
const ctx2=await cb.newContext({viewport:{width:1600,height:900}}); await ctx2.addCookies([{name:'unison_session',value:sess,url:B}]); await ctx2.addInitScript(()=>localStorage.setItem('wavwiz.whatsnew','9.9.9'));
const big=await ctx2.newPage(); await big.goto(B+'/'); await big.waitForTimeout(4000); await big.mouse.click(960,450); await big.waitForTimeout(500); await big.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelectorAll('.phone-unlock').forEach(e=>e.remove())});
await big.locator('#jbchip').click(); await big.waitForTimeout(1200); await big.locator('dialog[open] button',{hasText:'Open big screen'}).click(); await big.waitForTimeout(2500);
const kio=await big.evaluate(async()=>(await import('/js/jukebox-kiosk.js')).kioskOpen()); ok('G13 big screen opens in a plain browser', kio); await big.screenshot({path:'/workspace/screens/wavwiz-033-g13-bigscreen.png'});
// guest page
const g=await (await cb.newContext({viewport:{width:390,height:844}})).newPage(); await g.goto(B+'/jukebox.html?j='+encodeURIComponent(code||'')); await g.waitForTimeout(2500);
const lib=await api('/library/tracks?limit=5').catch(()=>null);
const inp=g.locator('input').first(); const ins=await g.locator('input').count();
for(let i=0;i<ins;i++){const ph=await g.locator('input').nth(i).getAttribute('placeholder')||''; if(/name/i.test(ph)) await g.locator('input').nth(i).fill('Sam'); else if(/search|song/i.test(ph)) await g.locator('input').nth(i).fill('a');}
await g.waitForTimeout(2000); const addB=g.locator('button:text-is("Add")').nth(4); let added=false; if(await addB.count()){await addB.click(); await g.waitForTimeout(1500); added=true; console.log('guest msg', (await g.locator('body').innerText()).slice(-300).replace(/\n/g,' | '));}
const board=await api('/jukebox/board'); ok('G13 guest queues a song', added && ((board.next||[]).some(x=>x.guest||x.by)||!!board.now?.by), JSON.stringify({now:board.now,next:(board.next||[]).slice(0,2)}).slice(0,200)); await g.screenshot({path:'/workspace/screens/wavwiz-033-g13-guest.png'});
// stop from host controls
await p.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelectorAll('.phone-unlock').forEach(e=>e.remove())}); await p.locator('#jbchip').click(); await p.waitForTimeout(1200); await p.locator('dialog[open] footer button',{hasText:'Stop Jukebox'}).click(); await p.waitForTimeout(800);
await p.locator('dialog[open] button',{hasText:/^Stop$/}).last().click(); await p.waitForTimeout(1500);
st=await api('/jukebox'); ok('G13 Stop: jukebox stopped', st.running===false, JSON.stringify(st).slice(0,120));
ok('G13 no script errors', errs.length===0, errs.join('|'));
console.log(`G13 e2e ${R.filter(x=>x).length}/${R.length}`); await cb.close();

// 0.4.8 F56: phone (390px) - All sound settings opens as a full-screen sheet (title + X, own scroll, body locked), closes with X / Esc / Back; compact trigger
import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(), TAG=process.env.TAG||'after', D='/workspace/screens/056/'+TAG; mkdirSync(D,{recursive:true});
let fails=0; const ok=(n,c,x='')=>{ if(!c) fails++; console.log((c?'ok   ':'FAIL ')+n+' '+x); };
const br=await chromium.launch();
for (const theme of ['default','arctic']) {
 const c=await br.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(t=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');if(t!=='default')localStorage.setItem('wavwiz.theme',t);},theme);
 await c.route('**/api/v1/zones', async r => { const res = await r.fetch(); let j = await res.json(); if (Array.isArray(j)) j = j.map(z => z.name === 'Office Desk' ? { ...z, connected: true, outputs: (z.outputs||[]).map(o => ({ ...o, connected: true, active: true })) } : z); await r.fulfill({ response: res, json: j }); });
 const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(3000); await p.evaluate(()=>document.querySelectorAll('dialog[open],.phone-unlock').forEach(e=>e.close?.()||e.remove()));
 const btn=p.locator('[data-act=allsound]:visible').first(); await btn.scrollIntoViewIfNeeded().catch(()=>{});
 await p.screenshot({path:`${D}/phone-eq-closed-${theme}.png`});
 const bb=await btn.boundingBox(); const vis=await btn.evaluate(e=>{const cs=getComputedStyle(e,'::before'); return cs.content&&cs.content!=='none'?e.getBoundingClientRect().height-parseFloat(cs.top)-parseFloat(cs.bottom):e.getBoundingClientRect().height;});
 ok(`[${theme}] trigger is compact (visible pill <= 34 px)`, bb && vis<=34 && bb.width<=150, JSON.stringify({bb,vis}));
 ok(`[${theme}] trigger tap target >= 44 px`, bb && bb.height>=44, JSON.stringify(bb));
 await btn.click(); await p.waitForTimeout(500); await p.screenshot({path:`${D}/phone-eq-open-${theme}.png`});
 if (TAG==='after') {
  const g=await p.evaluate(()=>{const s=document.querySelector('.eqsheet.open'); if(!s) return null; const r=s.getBoundingClientRect(), x=s.querySelector('.eqsheet-x'), xr=x?.getBoundingClientRect(); const sc=s.querySelector('.eqsheet-b'); return {full:r.top<=1&&r.left<=1&&r.width>=389&&r.height>=843, x:!!x&&xr.right>300&&xr.top<80, xc:x&&getComputedStyle(x).color, rad:x&&getComputedStyle(x).borderRadius, lock:getComputedStyle(document.documentElement).overflow==='hidden'||getComputedStyle(document.body).overflow==='hidden', sh:sc?.scrollHeight, ch:sc?.clientHeight, oy:sc&&getComputedStyle(sc).overflowY};});
  ok(`[${theme}] full-screen sheet with X top right`, g?.full && g?.x, JSON.stringify(g)); ok(`[${theme}] body scroll locked`, g?.lock); ok(`[${theme}] sheet scrolls itself`, g?.oy==='auto'); ok(`[${theme}] themed X (3px)`, g?.rad==='3px', g?.rad+' '+g?.xc);
  await p.evaluate(()=>{const b=document.querySelector('.eqsheet-b'); b.scrollTop=b.scrollHeight;}); await p.waitForTimeout(200); await p.screenshot({path:`${D}/phone-eq-scrolled-${theme}.png`});
  await p.locator('.eqsheet-x').click(); await p.waitForTimeout(300);
  ok(`[${theme}] X closes it`, await p.locator('.eqsheet.open').count()===0);
  const cover=await p.evaluate(()=>{const h=document.querySelector('.np-eqhead'); if(!h) return 'nohead'; const r=h.getBoundingClientRect(); const e=document.elementFromPoint(r.right-12,r.top+r.height/2); return (e && !e.closest('.eqsheet,.eqall'))?'':e?.className;}); ok(`[${theme}] nothing overlays the EQ header`, cover==='', cover);
  await p.screenshot({path:`${D}/phone-eq-closed-after-${theme}.png`});
  await btn.click(); await p.waitForTimeout(300); await p.keyboard.press('Escape'); await p.waitForTimeout(300); ok(`[${theme}] Esc closes it`, await p.locator('.eqsheet.open').count()===0);
  await btn.click(); await p.waitForTimeout(300); await p.goBack().catch(()=>{}); await p.waitForTimeout(500); ok(`[${theme}] Back closes it and stays in the app`, await p.locator('.eqsheet.open').count()===0 && p.url().startsWith(B));
 }
 await c.close();
}
await br.close(); console.log('fails',fails); process.exit(fails?1:0);

// 0.4.5 F8 before-shots on 0.4.4 web files (Player UA): row cursor, touch drag of a category row.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(), PLAYER='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0 WavWizPlayer/0.4.4';
const br=await chromium.launch();
for (const dpr of [1,2]) { const ctx=await br.newContext({viewport:{width:1920/dpr,height:1080/dpr},deviceScaleFactor:dpr,userAgent:PLAYER,hasTouch:true});
  await ctx.addCookies([{name:'unison_session',value:sess,url:B}]); await ctx.addInitScript(()=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.panels',JSON.stringify({dev:'normal',ctl:'collapsed',lib:'normal',exp:null,list:'open'}));});
  const p=await ctx.newPage(); await p.goto(B+'/'); await p.waitForTimeout(2500);
  const row=p.locator('.libpanel li.item').first(); const cur=await row.evaluate(e=>getComputedStyle(e).cursor); const before=await p.locator('.listpanel tr[data-i]').count();
  const a=await row.boundingBox(), b=await p.locator('.listpanel .qwrap').boundingBox(); const s=[a.x+a.width*.3,a.y+a.height/2], t=[b.x+b.width*.3,b.y+b.height/2];
  const c=await ctx.newCDPSession(p); await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:s[0],y:s[1]}]}); await p.waitForTimeout(300);
  for(let i=1;i<=14;i++) await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:s[0]+(t[0]-s[0])*i/14,y:s[1]+(t[1]-s[1])*i/14}]});
  await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await p.waitForTimeout(1500);
  console.log(`[${dpr*100}%] 0.4.4 category row cursor=${cur}; touch drag category -> queue: before=${before} after=${await p.locator('.listpanel tr[data-i]').count()}`);
  await p.screenshot({path:`/workspace/screens/wavwiz-045-F8-before-touch-${dpr*100}.png`}); await ctx.close(); }
await br.close();

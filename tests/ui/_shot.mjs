// generic before-shot helper: PANELS json, CLICK selector (optional), OUT prefix
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(); const br=await chromium.launch();
for (const [z,d] of [['100',1],['200',2]]) { const c=await br.newContext({viewport:{width:+(process.env.W||1920),height:+(process.env.H||1080)},deviceScaleFactor:d}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(pn=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.panels',pn);},process.env.PANELS||'{"lib":"rail","dev":"expanded","exp":"dev","list":"normal","ctl":"collapsed"}');
 const p=await c.newPage(); await p.goto(B+(process.env.PATH_||'/')); await p.waitForTimeout(2600);
 if (process.env.CLICK) { await p.locator(process.env.CLICK).first().click().catch(e=>console.log('click',e.message.slice(0,80))); await p.waitForTimeout(900); }
 if (process.env.EVAL) console.log(z, JSON.stringify(await p.evaluate(process.env.EVAL)));
 await p.screenshot({path:`${process.env.OUT}-${z}.png`}); await c.close(); }
await br.close();

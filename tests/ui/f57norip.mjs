// 0.4.8 F57: no CD-ripper entry on the phone / remote clients; the PC app keeps it
import { chromium, devices } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(), TAG=process.env.TAG||'after', D='/workspace/screens/057/'+TAG; mkdirSync(D,{recursive:true});
let fails=0; const ok=(n,c,x='')=>{ if(!c) fails++; console.log((c?'ok   ':'FAIL ')+n+' '+x); };
const br=await chromium.launch();
async function run(name, opt, pc) {
 const c=await br.newContext(opt); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(()=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.panels',JSON.stringify({lib:'normal',dev:'normal',exp:'lib',list:'open',ctl:'open'}));});
 if (pc) await c.route('**/api/v1/auth/state', async r => { const res = await r.fetch(); const j = await res.json(); await r.fulfill({ response: res, json: { ...j, thisMachine: true } }); });
 const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(3000); await p.evaluate(()=>document.querySelectorAll('dialog[open],.phone-unlock').forEach(e=>e.close?.()||e.remove()));
 const seen=[]; const grab=async()=>seen.push(await p.evaluate(()=>[...document.querySelectorAll('button,a,[role=menuitem],[role=tab],.mitem')].filter(e=>e.getClientRects().length).map(e=>e.textContent).join('|')));
 await grab(); await p.screenshot({path:`${D}/${name}-main.png`});
 const tops=await p.locator('.mtop:visible').count(); for (let i=0;i<tops;i++){ await p.locator('.mtop:visible').nth(i).click(); await p.waitForTimeout(400); await grab(); if (i===0) await p.screenshot({path:`${D}/${name}-menu.png`}); await p.keyboard.press('Escape'); }
 if (opt.viewport.width<700) for (const sec of ['File','Library','Playback','Devices','Help']) { const ham=p.locator('[aria-label*="enu"]:visible').first(); if (!await ham.count()) break; await ham.click().catch(()=>{}); await p.waitForTimeout(400); await p.getByText(sec,{exact:true}).locator('visible=true').first().click({timeout:3000}).catch(()=>{}); await p.waitForTimeout(400); await grab(); if (sec==='Library'||sec==='File') await p.screenshot({path:`${D}/${name}-drawer-${sec}.png`}); await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(e=>e.close())); }
 const has=seen.some(t=>/CD ripper/.test(t)); const api=await p.evaluate(async()=>{const r=await fetch('/api/v1/rip/start',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});return r.status;});
 await c.close(); return { has, api };
}
const ph=await run('phone390', { ...devices['iPhone 13'], viewport:{width:390,height:844} }, false);
ok('no CD ripper entry on the phone (390px, iPhone client)', !ph.has); ok('rip API refuses the phone/remote client', ph.api===403, String(ph.api));
const nar=await run('pc-narrow390', { viewport:{width:390,height:844} }, true); ok('a PC-app client still has it at 390px wide (client type, not width)', nar.has);
const pc=await run('pc1920', { viewport:{width:1920,height:1080} }, true); ok('the PC app keeps the CD ripper', pc.has);
await br.close(); console.log('fails',fails); process.exit(fails?1:0);

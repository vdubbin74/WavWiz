import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim();
const br=await chromium.launch(); const c=await br.newContext({viewport:{width:1920,height:1080}}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
await c.addInitScript(()=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.layout','full');localStorage.setItem('wavwiz.panels',JSON.stringify({lib:'normal',dev:'expanded',exp:'dev',list:'open',ctl:'open'}));});
const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(3000);
console.log(await p.evaluate(()=>{const r=e=>{const b=e.getBoundingClientRect();return `${e.tagName}.${[...e.classList].join('.')} ${b.x|0},${b.y|0} ${b.width|0}x${b.height|0}`}; const d=document.querySelector('.devpanel'); const out=[r(document.querySelector('.desk')),r(d),r(document.querySelector('.npbar')),r(document.querySelector('.minicol'))]; const walk=(e,dep)=>{ if(dep>4) return; for(const k of e.children){ const b=k.getBoundingClientRect(); if(b.width>150&&b.height>150){ out.push('  '.repeat(dep)+r(k)); walk(k,dep+1);} } }; walk(d,1); return out.join('\n');}));
await br.close();

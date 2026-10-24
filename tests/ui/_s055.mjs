import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(), TAG=process.env.TAG||'before', D='/workspace/screens/055/'+TAG; mkdirSync(D,{recursive:true}); const br=await chromium.launch(); const out=[];
for (const [z,dpr] of [['100',1],['150',1.5],['200',2]]) { const W=Math.round(330/ (z==='200'?1:1)); const c=await br.newContext({viewport:{width:W,height:150},deviceScaleFactor:dpr}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(()=>{ window.chrome = window.chrome || {}; window.chrome.webview = { postMessage: m => { (window.__sent ||= []).push(m); }, addEventListener: () => {}, removeEventListener: () => {} }; });
 const p=await c.newPage(); await p.goto(B+'/mini.html?slim=0'); await p.waitForTimeout(2500);
 const r=await p.evaluate(()=>{const vw=innerWidth, R=e=>e?.getBoundingClientRect(); const q=s=>document.querySelector(s); const sel=['.mp-pin','.mp-side button:nth-child(2)','.mp-x','.mp-tr .next','.mp-vol .pct'];
  return {vw, inside: sel.every(s=>{const b=R(q(s)); return b && b.width>0 && b.left>=0 && b.right<=vw-2 && b.top>=0;}), sw:document.documentElement.scrollWidth, rep:window.__miniSize, items:sel.map(s=>{const b=R(q(s)); return b?[s,Math.round(b.left),Math.round(b.right)]:[s,null]})};});
 out.push([z,JSON.stringify(r)]); await p.screenshot({path:`${D}/mini-${z}.png`}); await c.close(); }
console.log(out.map(x=>x.join(' ')).join('\n')); await br.close();

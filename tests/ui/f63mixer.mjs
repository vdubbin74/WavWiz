// 0.4.8 F63: the Master Volume mixer at 100 %, 200 % + Display size 67 % (TV), 200 % and phone, opened from Full, Roomy and the mini player.
// Checks: 2 columns on PC (1 on the phone), no overlapping row parts, nothing outside its row, tags clear of the %, no sideways scroll. Usage: node f63mixer.mjs <shot dir>
import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(), D=process.argv[2]; mkdirSync(D,{recursive:true});
const br=await chromium.launch();
const sizes=[['100',1920,1080,1,'compact'],['200-app67',960,540,2,'tiny'],['200',960,540,2,'compact'],['phone',390,844,3,'compact']];
const views=[['full','/'],['roomy','/'],['mini','/']];
for(const [zt,vw,vh,dpr,u] of sizes) for(const [lay,path] of views){ if(zt==='phone'&&lay!=='full') continue;
 const c=await br.newContext({viewport:{width:vw,height:vh},deviceScaleFactor:dpr,isMobile:zt==='phone'}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(([l,u])=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.uiscale',u);localStorage.setItem('wavwiz.layout',l);},[lay==='mini'?'full':lay,u]);
 const p=await c.newPage(); await p.goto(B+path); await p.waitForTimeout(2500); await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(e=>e.close()));
 if(lay==='mini') await p.evaluate(()=>window.dispatchEvent(new CustomEvent('wavwiz:mini')));
 await p.waitForTimeout(800); await p.evaluate(()=>window.dispatchEvent(new CustomEvent('wavwiz:mixer')));
 await p.waitForTimeout(1200);
 const r=await p.evaluate(()=>{const d=document.querySelector('dialog.mixer-dlg'); if(!d) return {none:1}; const out=[]; const dw=d.getBoundingClientRect();
  const cols=new Set([...d.querySelectorAll('.mv-card')].map(e=>Math.round(e.getBoundingClientRect().x))).size;
  for(const row of d.querySelectorAll('.mv-row')){const k=[...row.children].filter(e=>e.offsetParent); for(let i=0;i<k.length;i++){const a=k[i].getBoundingClientRect(); if(a.right>row.getBoundingClientRect().right+1) out.push('outside:'+k[i].className);
   for(let j=i+1;j<k.length;j++){const b=k[j].getBoundingClientRect(); const ox=Math.min(a.right,b.right)-Math.max(a.left,b.left), oy=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top); if(ox>1&&oy>1) out.push(`${k[i].className}|${k[j].className} ${Math.round(ox)}px (row ${Math.round(row.getBoundingClientRect().width)}w)`);}}
   for(const t of row.querySelectorAll('.mv-tag')){const a=t.getBoundingClientRect(), s=row.querySelector('.mv-pct')?.getBoundingClientRect(); if(s&&a.right>s.left+1) out.push('tag-over-slider '+Math.round(a.right-s.left)+'px');}
   const n=row.querySelector('.n .ell'); if(n&&n.scrollWidth>n.clientWidth+1) out.push('truncated:'+n.textContent);}
  return {dlgW:Math.round(dw.width),cols,sx:d.querySelector('.body').scrollWidth>d.querySelector('.body').clientWidth+1,issues:[...new Set(out)]};});
 const f=`${D}/mixer-${lay}-${zt}.png`; await p.screenshot({path:f}); console.log(f, JSON.stringify(r)); await c.close(); }
await br.close();

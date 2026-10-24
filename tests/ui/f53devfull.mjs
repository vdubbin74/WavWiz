// 0.4.8 F53 (v2): expanded Devices (Full + Roomy) at 100 %, 200 % and 200 % + Display size 67 % (the TV): the Devices panel AND the Scenes column run
// full height, there is NO now-playing player (no bar, no condensed player), and Scenes is as wide as the Devices side panel. Un-expanding brings
// the player bar back. Shots -> /workspace/screens/053/v2
import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(), D='/workspace/screens/053/v2'; mkdirSync(D,{recursive:true});
let pass=0, fail=0; const ok=(n,c,x='')=>{ c?pass++:fail++; console.log((c?'ok   ':'FAIL ')+n+' '+(c?'':x)); };
const br=await chromium.launch();
const pn=exp=>({lib:'normal',dev:exp?'expanded':'normal',exp,list:'open',ctl:'open'});
async function open(vw,vh,dpr,usc,layout,exp){ const c=await br.newContext({viewport:{width:vw,height:vh},deviceScaleFactor:dpr}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(([l,p,u])=>{localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.uiscale',u);localStorage.setItem('wavwiz.layout',l);localStorage.setItem('wavwiz.panels',JSON.stringify(p));},[layout,pn(exp),usc]);
 const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(3000); await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(e=>e.close())); return {c,p}; }
const vis=`e=>{ if(!e) return false; const b=e.getBoundingClientRect(), cs=getComputedStyle(e); return b.width>4&&b.height>4&&cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity)>0.05; }`;
for (const [vw,vh,dpr,usc,zt] of [[1920,1080,1,'compact','100'],[960,540,2,'compact','200'],[960,540,2,'tiny','200-app67']]) for (const layout of ['full','roomy']) {
 const T=`[${layout} ${zt}]`;
 let {c,p}=await open(vw,vh,dpr,usc,'full',null); const sidew=await p.evaluate(()=>{const d=document.querySelector('.devpanel'); return d&&d.offsetParent?d.getBoundingClientRect().width:0;}); await c.close();
 ({c,p}=await open(vw,vh,dpr,usc,layout,'dev'));
 const g=await p.evaluate(vis=>{ const V=eval(vis); const R=s=>{const e=document.querySelector(s); if(!e||!V(e)) return null; const b=e.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height,b:b.bottom};};
  const players=[...document.querySelectorAll('.npbar, .minicol, .minicol .mp')].filter(V).map(e=>e.className);
  return {z:getComputedStyle(document.documentElement).getPropertyValue('--z').trim(), dev:R('.devpanel'), sb:R('.statusbar'), desk:R('.desk'), ss:R('.devpanel .dexp-main.e42>.sscol'), tc:R('.devpanel .dexp-main.e42>.tcol42'), players,
   sx:document.documentElement.scrollWidth>innerWidth+1, inside:[...document.querySelectorAll('.dexp-main.e42>.ecol')].every(e=>e.getBoundingClientRect().bottom<=document.querySelector('.devpanel').getBoundingClientRect().bottom+1)};},vis);
 if (zt==='200-app67') ok(`${T} Display size 67 % is applied`, /^0\.67/.test(g.z), g.z);
 ok(`${T} Devices runs full height to the status bar`, g.dev && g.sb && g.sb.y-g.dev.b<=14 && g.dev.b>=g.desk.b-14, JSON.stringify({dev:g.dev,sb:g.sb}));
 ok(`${T} no now-playing player at all (no bar, no condensed player)`, g.players.length===0, JSON.stringify(g.players));
 ok(`${T} Scenes runs full height (to the bottom of the Devices panel)`, g.ss && g.dev && g.dev.b-g.ss.b<=16 && g.tc && Math.abs(g.ss.b-g.tc.b)<=2, JSON.stringify({ss:g.ss,tc:g.tc,dev:g.dev}));
 ok(`${T} Scenes width = Devices side panel (${Math.round(sidew)} px)`, g.ss && sidew>0 && Math.abs(g.ss.w-sidew)<=4, JSON.stringify({ss:g.ss?.w,sidew}));
 ok(`${T} columns stay inside the panel, no sideways scroll`, g.inside && !g.sx);
 await p.screenshot({path:`${D}/F53-${layout}-${zt}-devexpanded.png`});
 // un-expand with the Devices panel's own expand button: Devices is no longer expanded and the player bar is back
 const btn=p.locator('.devpanel .pane-h .pexp, .devpanel .pane-h [aria-pressed=true]').first(); const had=await btn.count();
 if (had) await btn.click(); await p.waitForTimeout(1200);
 const back=await p.evaluate(vis=>{ const V=eval(vis), d=document.querySelector('.desk'); return {exp:d.classList.contains('devexpanded'), devfull:d.classList.contains('devfull'), np:[...document.querySelectorAll('.npbar, .nowcol, .np-ctlpanel')].some(V)}; },vis);
 ok(`${T} un-expanding: Devices leaves expanded and Now Playing is back`, had>0 && !back.exp && !back.devfull && back.np, JSON.stringify({had,...back}));
 await c.close();
}
await br.close(); console.log(`f53devfull: ${pass} passed, ${fail} failed`); process.exit(fail?1:0);

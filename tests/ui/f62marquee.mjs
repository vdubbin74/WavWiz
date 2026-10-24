// 0.4.8 F62: shared marquee. In every place now-playing info appears, an overflowing line animates (back and forth, holds at the ends) and a
// fitting one stays still; reduced motion = ellipsis, no animation; no side scrolling. 100 % and 200 %. SHOTS=1 -> /workspace/screens/062/.
import { chromium, webkit } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(), SH=!!process.env.SHOTS; let pass=0, fail=0;
const ok=(n,c,x='')=>{c?pass++:fail++; console.log((c?'ok   ':'FAIL ')+n+(c?'':'  '+x));};
const LONG=Array(4).fill('An Extremely Long Song Title That Can Never Fit In This Box Whatever The Zoom Level Is').join(' - ');
const LOC={ 'main Now Playing':'.np-meta .titles > .t1, .np-tabletitles > .t1', 'collapsed Now Playing strip':'.ns-t1', 'queue-area player':'.np-ctlpanel .np-tabletitles > .t1', 'condensed player':'.minicol .mp-t',
  'device cards':'.devpanel .qb42-head .zl-now .zl-t, .devpanel .zp-row .zl-now .zl-t, .devpanel .zl-now .zl-t', 'zone settings':'.zp42-now .zl-now .zl-t', 'phone Now Playing':'.np-meta .titles > .t1, .np-tabletitles > .t1', 'phone Now Playing artist':'.np-meta .titles > .t2, .np-tabletitles > .t2', 'phone bar title':'.ns-t1', 'phone bar artist':'.ns-t2', 'standalone mini (default size)':'.mp-t', 'standalone mini player':'.mp-t' };
const base={lib:'rail',dev:'normal',exp:null,list:'open',ctl:'open',ctlSet:true};
// 0.4.8 F53 v2: with Devices expanded there is no now-playing player at all (no bar, no condensed player); only zone settings are tested there
const PAGES0=[['desk',{...base},['main Now Playing','device cards']],['desk-ctlcollapsed',{...base,ctl:'collapsed'},['collapsed Now Playing strip']],['desk-queuewide-ctlopen',{...base,list:'expanded'},['queue-area player']],
  ['desk-libexpanded',{...base,exp:'lib'},['condensed player']],['desk-devexpanded',{...base,exp:'dev'},['zone settings']],['phone',null,['phone Now Playing','phone Now Playing artist','phone bar title','phone bar artist'],true],['mini-default',null,['standalone mini (default size)'],false,'/mini.html'],['mini',null,['standalone mini player'],false,'/mini.html']];
const PAGES=process.env.ONLY?PAGES0.filter(x=>x[0]===process.env.ONLY):PAGES0;
const br=await chromium.launch(), wk=await webkit.launch(); const covered=new Set();
for (const [vw,vh,d,z] of [[1920,1080,1,'100'],[960,540,2,'200']]) for (const [pg0,pn,locs,phone,url] of [...PAGES, ...PAGES.filter(x=>x[0]==='phone'||x[0]==='mini-default').map(x=>[x[0]+'-webkit',...x.slice(1)])]) for (const rm of ['no-preference','reduce']) {
 const WK=pg0.endsWith('-webkit'), pg=pg0.replace('-webkit',''), B2=WK?wk:br;
 if (rm==='reduce' && !['desk','mini','phone'].includes(pg)) continue;
 // F62b: phone 100 % = Default display size at 1x, 200 % = 2x pixels + Large display size; standalone mini: the 420x200 / 260x140 test sizes and the
 // real default window (330 x 145 CSS px, what the Player window reports at 100-200 % Windows scaling, see f55mini)
 const opt=phone?{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:d,reducedMotion:rm}:pg==='mini-default'?{viewport:{width:330,height:145},deviceScaleFactor:d,reducedMotion:rm}:url?{viewport:{width:d===2?260:420,height:d===2?140:200},deviceScaleFactor:d,reducedMotion:rm}:{viewport:{width:vw,height:vh},deviceScaleFactor:d,reducedMotion:rm};
 const usc=phone&&z==='200'?'large':'compact';
 const c=await B2.newContext(WK?{...opt,userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'}:opt); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(([pn,usc])=>{ localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.uiscale',usc);localStorage.setItem('wavwiz.layout','full'); if(pn) localStorage.setItem('wavwiz.panels',JSON.stringify(pn)); },[pn,usc]);
 const p=await c.newPage(); await p.goto(B+(url||'/')); await p.waitForTimeout(3000); await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(x=>x.close()));
 for (const loc of locs) { const t=`[${z} ${pg}${WK?' WebKit':''} ${rm==='reduce'?'reduced-motion ':''}${loc}]`, sel=LOC[loc];
  // overflow: put a very long title in (kept there against the app's own repaints for the check), then a short one
  const set=txt=>p.evaluate(([sel,txt])=>{ const e=[...document.querySelectorAll(sel)].find(x=>x.offsetParent&&x.getBoundingClientRect().width>20); if(!e) return false; window.__mqT=e; const put=()=>{ const tgt=e.querySelector('.mq-in')||e; if(tgt.textContent!==txt) tgt.textContent=txt; }; window.__mqO?.disconnect(); put(); window.__mqO=new MutationObserver(put); window.__mqO.observe(e,{childList:true,subtree:true,characterData:true}); return true; },[sel,txt]);
  const probe=()=>p.evaluate(()=>{ const e=window.__mqT; if (!e.isConnected) return { gone:true, tx:0 }; const inn=e?.querySelector('.mq-in'), a=inn?.getAnimations?.()||[], cs=getComputedStyle(e), r=e.getBoundingClientRect(), se=document.scrollingElement;
    return { ct:Math.round(e._mqAnim?.currentTime||-1), key:String(e._mqKey).slice(-8), mq:e.classList.contains('mq'), on:e.classList.contains('mq-on'), anims:a.filter(x=>x.playState==='running').length, tx:inn?new DOMMatrix(getComputedStyle(inn).transform).m41:0, ell:cs.textOverflow, ov:cs.overflowX, mask:cs.maskImage||cs.webkitMaskImage, h:Math.round(r.height), sx:se.scrollWidth>innerWidth+1, w:Math.round(r.width) }; });
  if (!await set(LONG)) { ok(`${t} the line is on the page`, false, sel); continue; }
  await p.waitForTimeout(400); const a=await probe(); await p.waitForTimeout(2400); let b=await probe(); if (b.gone) { await set(LONG); await p.waitForTimeout(2800); b=await probe(); }   // the Devices tree rebuilt the card: once more on the new one
   for (let i=0;i<6&&b.tx>-5;i++){ await p.waitForTimeout(150); b=await probe(); }   // past the 2 s hold
  if (rm==='reduce') { ok(`${t} reduced motion: no animation, ellipsis`, !a.anims && !b.anims && a.tx===0 && b.tx===0 && a.ell==='ellipsis' && a.ov==='hidden', JSON.stringify([a,b])); }
  else { covered.add(loc);
   ok(`${t} an overflowing line scrolls (after the 2 s hold)`, a.mq && a.on && a.anims===1 && Math.abs(a.tx)<1 && b.tx<-5, JSON.stringify([a.tx,b.tx,a.on,a.anims,a.ct,b.ct,a.key,b.key]));
   ok(`${t} edge fade mask, clip instead of ellipsis while scrolling`, /gradient/.test(a.mask) && a.ell==='clip', JSON.stringify([a.mask,a.ell]));
   if (SH) await p.screenshot({path:`/workspace/screens/062/F62-${z}-${pg}-${loc.replace(/\W+/g,'-')}.png`});
   const h0=a.h; await set('Hi'); await p.waitForTimeout(500); const s=await probe();
   ok(`${t} a fitting line stays still (no mq-on, no animation)`, !s.on && !s.anims && s.tx===0, JSON.stringify(s));
   ok(`${t} no layout shift (same line height) and no side scrolling`, s.h===h0 && !a.sx && !b.sx && !s.sx, JSON.stringify([h0,s.h,a.sx,b.sx,s.sx])); }
  await p.evaluate(()=>window.__mqO?.disconnect()); }
 if (rm==='no-preference' && pg==='desk' && z==='100') { // a box resize (Display size) re-measures: 200 % zoom makes the real title of the bar overflow / fit again without a reload
  await p.evaluate(()=>{ window.__mqO?.disconnect(); }); }
 await c.close(); }
for (const l of Object.keys(LOC)) ok(`covered: ${l}`, covered.has(l));
await wk.close(); await br.close(); console.log(`f62marquee: ${pass} passed, ${fail} failed`); process.exit(fail?1:0);

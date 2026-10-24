// 0.4.7: the Devices column (Full) / Devices strip (Roomy) runs full height down to the status bar in every layout state (Queue normal / full screen,
// Library collapsed / expanded) and the player bar ends at or before it. F39 (expanded Devices) is not asserted. SH=1 TAG=before|after for shots.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(), TAG=process.env.TAG||'before', SH=!!process.env.SH; let pass=0,fail=0;
const ok=(n,c,x='')=>{c?pass++:fail++; console.log((c?'ok   ':'FAIL ')+n+(c?'':'  '+x));};
const base={lib:'normal',dev:'normal',exp:null,list:'open',ctl:'collapsed'};
const br=await chromium.launch();
for (const [vw,vh,d,z] of [[1920,1080,1,'100'],[960,540,2,'200']]) for (const lay of ['full','roomy']) for (const [sn,pn] of [['queue',base],['queuefull',{...base,list:'expanded'}],['lib-collapsed',{...base,lib:'rail'}],['lib-collapsed-queuefull',{...base,lib:'rail',list:'expanded'}],['lib-expanded',{...base,exp:'lib'}],['dev-expanded',{...base,exp:'dev'}]]) {
 const c=await br.newContext({viewport:{width:vw,height:vh},deviceScaleFactor:d}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(([pn,lay])=>{ if(sessionStorage.getItem('g'))return; sessionStorage.setItem('g','1'); localStorage.setItem('wavwiz.whatsnew','9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown','1'); localStorage.setItem('wavwiz.webRoom.autojoin','0');
  localStorage.setItem('wavwiz.uiscale','compact'); localStorage.setItem('wavwiz.layout',lay); localStorage.setItem('wavwiz.panels',JSON.stringify(pn));},[pn,lay]);
 const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(3000); await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(x=>x.close()));
 const r=await p.evaluate(()=>{const q=s=>document.querySelector(s), R=e=>e&&e.offsetParent&&e.getBoundingClientRect().width>0?[...['left','right','top','bottom'].map(k=>Math.round(e.getBoundingClientRect()[k]*10)/10)]:null;
  const desk=q('.desk'), sib=desk.nextElementSibling; let foot=sib; while(foot && !(foot.offsetParent&&foot.getBoundingClientRect().height>0)) foot=foot.nextElementSibling;
  const dev=q('.desk.tight .devtab')&&q('.desk.tight .devtab').offsetParent?q('.desk.tight .devtab'):q('.desk .devpanel');
  return {cls:desk.className, dev:R(dev), bar:(e=>e&&getComputedStyle(e).visibility!=='hidden'&&+getComputedStyle(e).opacity>0?R(e):null)([q('.npbar'),q('.np-ctlpanel')].find(e=>e&&e.offsetParent&&getComputedStyle(e).visibility!=='hidden'&&+getComputedStyle(e).opacity>0&&e.getBoundingClientRect().width>50)), foot:foot?[foot.className||foot.tagName,...R(foot)]:null, desk:R(desk), vh:innerHeight};});
 const t=`[${z} ${lay} ${sn}]`; console.log('    ',t,JSON.stringify(r));
 if (sn!=='dev-expanded' && r.dev) { const footTop=r.foot?r.foot[3]:r.vh; const pad = r.desk[3]-r.dev[3];
   ok(`${t} Devices panel runs to the bottom of the desk (footer top ${footTop})`, Math.abs(r.dev[3]-(r.desk[3]-pad))<=1 && pad<=11 && Math.abs(r.desk[3]-footTop)<=1, JSON.stringify(r));
   if (r.bar) ok(`${t} the player bar ends at or before the Devices panel`, r.bar[1]<=r.dev[0]+1, JSON.stringify(r)); }
 if (SH) await p.screenshot({path:`/workspace/screens/047/layout-${TAG}-${z}-${lay}-${sn}.png`});
 await c.close(); }
// 0.4.8 F58: Roomy reuses Classic's (Full's) Devices panel bar - same element, classes, computed size / position / style as Full with Devices
// collapsed, and no Roomy-only offsets on the Library / Queue / condensed player. Library collapsed / expanded x Queue normal / full screen, 67/100/200 %.
for (const [vw,vh,d,sc,z] of [[1920,1080,1,'tiny','67'],[1920,1080,1,'compact','100'],[960,540,2,'compact','200']]) for (const lib of ['rail','exp']) for (const list of ['open','expanded']) {
 const get=async lay=>{ const pn={lib:lib==='rail'?'rail':'normal',dev:lay==='full'?'rail':'normal',exp:lib==='exp'?'lib':null,list,ctl:'collapsed'};
  const c=await br.newContext({viewport:{width:vw,height:vh},deviceScaleFactor:d}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
  await c.addInitScript(([pn,lay,sc])=>{ if(sessionStorage.getItem('g'))return; sessionStorage.setItem('g','1'); localStorage.setItem('wavwiz.whatsnew','9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown','1'); localStorage.setItem('wavwiz.webRoom.autojoin','0');
   localStorage.setItem('wavwiz.uiscale',sc); localStorage.setItem('wavwiz.layout',lay); localStorage.setItem('wavwiz.panels',JSON.stringify(pn));},[pn,lay,sc]);
  const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(2800); await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(x=>x.close()));
  const r=await p.evaluate(()=>{ const o={}, K=['width','height','backgroundColor','borderTopWidth','borderTopColor','borderLeftWidth','borderTopLeftRadius','padding','fontSize','color'];
   for (const s of ['.devpanel','.libpanel','.listpanel','.minicol','.npbar']) { const e=document.querySelector(s); if(!e) continue; const b=e.getBoundingClientRect(), cs=getComputedStyle(e);
    o[s]=b.width&&b.height&&cs.visibility!=='hidden'&&cs.display!=='none'?{r:[b.x,b.y,b.width,b.height].map(Math.round),cls:e.className.split(/\s+/).filter(x=>x&&!/^(pulse|hl)/.test(x)).sort().join(' '),st:K.map(k=>cs[k]).join('|'),lbl:(e.querySelector('.pane-h,.railtitle,.rail-label,.prail-t')?.textContent||'').trim()}:null; }
   const dk=document.querySelector('.desk').className.split(/\s+/); o.desk=dk.filter(x=>!['roomy','autorail'].includes(x)).sort().join(' '); o.tight=dk.includes('tight'); o.devtab=!!document.querySelector('.devtab')?.offsetParent; return o; });
  await c.close(); return r; };
 const f=await get('full'), m=await get('roomy'), t=`[F58 ${z} lib-${lib} queue-${list}]`; console.log('    ',t,JSON.stringify({f:f['.devpanel'],m:m['.devpanel']}));
 ok(`${t} Roomy has no .tight overrides and no Roomy-only Devices tab`, !m.tight && !m.devtab, JSON.stringify(m.desk));
 ok(`${t} desk state classes match Full`, f.desk===m.desk, f.desk+' vs '+m.desk);
 ok(`${t} Devices bar shown, same classes / size / position / style as Full`, !!m['.devpanel'] && JSON.stringify(f['.devpanel'])===JSON.stringify(m['.devpanel']), JSON.stringify([f['.devpanel'],m['.devpanel']]));
 for (const s of ['.libpanel','.listpanel','.minicol','.npbar']) ok(`${t} ${s} matches Full (no width / height deltas)`, JSON.stringify(f[s]?.r)===JSON.stringify(m[s]?.r), JSON.stringify([f[s]?.r,m[s]?.r]));
}
// 0.4.8 F59: the collapsed Devices rail count is vertical and mirrors the Library rail's song count (same writing-mode / font / size / spacing /
// COLOR - never the yellow highlight - and bottom offset; transform mirrored for the right edge). Full and Roomy, 67/100/200 %.
for (const [vw,vh,d,sc,z] of [[1920,1080,1,'tiny','67'],[1920,1080,1,'compact','100'],[960,540,2,'compact','200']]) for (const lay of ['full','roomy']) {
 const c=await br.newContext({viewport:{width:vw,height:vh},deviceScaleFactor:d}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(([lay,sc])=>{ if(sessionStorage.getItem('g'))return; sessionStorage.setItem('g','1'); localStorage.setItem('wavwiz.whatsnew','9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown','1'); localStorage.setItem('wavwiz.webRoom.autojoin','0');
  localStorage.setItem('wavwiz.uiscale',sc); localStorage.setItem('wavwiz.layout',lay); localStorage.setItem('wavwiz.panels',JSON.stringify({lib:'rail',dev:'rail',exp:null,list:'open',ctl:'collapsed'}));},[lay,sc]);
 const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(2800); await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(x=>x.close()));
 const r=await p.evaluate(()=>{ const K=['writingMode','fontFamily','fontSize','fontWeight','letterSpacing','color','opacity','borderTopWidth','backgroundColor','paddingTop','textShadow','whiteSpace'];
  const g=s=>{const e=document.querySelector(s); if(!e||!e.offsetParent) return null; const cs=getComputedStyle(e), b=e.getBoundingClientRect(), pr=e.closest('.libpanel,.devpanel').getBoundingClientRect(); return {st:Object.fromEntries(K.map(k=>[k,cs[k]])), tf:cs.transform, bottom:Math.round(pr.bottom-b.bottom), side:Math.round(s.includes('lib')?b.left-pr.left:pr.right-b.right), w:b.width, h:b.height, txt:e.textContent};};
  return {lib:g('.libpanel.israil .prail-n'), dev:g('.devpanel.israil .prail-n')}; });
 const t=`[F59 ${z} ${lay}]`; console.log('    ',t,JSON.stringify(r).slice(0,600));
 ok(`${t} both rail counts shown`, !!r.lib && !!r.dev, JSON.stringify(r));
 if (r.lib && r.dev) {
  ok(`${t} Devices count is vertical (taller than wide)`, r.dev.st.writingMode===r.lib.st.writingMode && r.dev.h>r.dev.w, JSON.stringify([r.dev.w,r.dev.h]));
  ok(`${t} same color as the Library count (not the highlight)`, r.dev.st.color===r.lib.st.color, r.dev.st.color+' vs '+r.lib.st.color);
  ok(`${t} same font / size / spacing / weight / box`, JSON.stringify(r.dev.st)===JSON.stringify(r.lib.st), JSON.stringify([r.dev.st,r.lib.st]));
  ok(`${t} same bottom offset and mirrored edge inset (±1 px)`, Math.abs(r.dev.bottom-r.lib.bottom)<=1 && Math.abs(r.dev.side-r.lib.side)<=1, JSON.stringify([r.dev.bottom,r.lib.bottom,r.dev.side,r.lib.side]));
 }
 if (SH && z!=='67') await p.screenshot({path:`/workspace/screens/059/F59-${z}-${lay}.png`});
 await c.close(); }
await br.close(); console.log(`f47devheight: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

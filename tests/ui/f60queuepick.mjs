// 0.4.8 F60: "Queue: [zone ▾]" in every queue size (wide / standard / collapsed) at 67/100/200 %: picker visible and inside the header, the zone
// named once (no "· ZONE" suffix, no "Editing:", no bar "on <zone>" while it is the same zone), "(playing)" on the playing zone, picking switches
// the queue view; F50: the Up next line never overlaps the pin or any control (hidden -> row pill). Phone: "Queue:" + picker. SHOTS=1 for screenshots.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(), SH=!!process.env.SHOTS; let pass=0, fail=0;
const ok=(n,c,x='')=>{c?pass++:fail++; console.log((c?'ok   ':'FAIL ')+n+(c?'':'  '+x));};
const br=await chromium.launch();
const open=async (vw,vh,d,sc,list,phone=false)=>{ const c=await br.newContext({viewport:{width:vw,height:vh},deviceScaleFactor:d,...(phone?{isMobile:true,hasTouch:true}:{})}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(([l,sc])=>{ if(sessionStorage.getItem('g'))return; sessionStorage.setItem('g','1'); localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.uiscale',sc);localStorage.setItem('wavwiz.layout','full');localStorage.setItem('wavwiz.panels',JSON.stringify({lib:'rail',dev:'rail',exp:null,list:l,ctl:'collapsed'}));},[list,sc]);
 const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(2800); await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(x=>x.close())); return [c,p]; };
const probe=p=>p.evaluate(()=>{ const q=s=>document.querySelector(s), R=e=>e.getBoundingClientRect(), vis=e=>!!e&&!!e.offsetParent&&R(e).width>0&&getComputedStyle(e).visibility!=='hidden';
 const head=q('.listpanel .pane-h'), hr=R(head), sel=q('.listpanel .qtitle .qzpick'), lbl=q('.listpanel .qtitle .qlbl'), nb=head.querySelector('.plnext');
 const ctr=[...head.querySelectorAll('.tpin, .qsend, .plmeta, .plbtns button, .listcolwrap button, .qzpick, .qlbl')].filter(vis).map(e=>[e.className.split(' ').slice(0,2).join('.'),R(e)]);
 const nbr=nb&&vis(nb)&&!nb.hidden?R(nb):null, hit=nbr?ctr.filter(([,r])=>r.left<nbr.right-1&&r.right>nbr.left+1).map(x=>x[0]):[];
 const zname=sel?.selectedOptions[0]?.textContent.replace(' (playing)','');
 const txt=[...document.querySelectorAll('.listpanel .pane-h *, .np-ctlpanel *, .npbar *')].filter(e=>vis(e)&&e.childNodes.length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&e.tagName!=='OPTION'&&!e.closest('select')&&!e.closest('.plnext'));
 const dup=txt.filter(e=>zname&&e.textContent.toUpperCase().includes(zname.toUpperCase())).map(e=>e.className+':'+e.textContent.trim().slice(0,30));
 return { lbl:lbl?.textContent, sel:vis(sel)?[R(sel).left-hr.left,hr.right-R(sel).right,R(sel).width]:null, inHead:vis(sel)&&R(sel).left>=hr.left-0.5&&R(sel).right<=hr.right+0.5&&R(sel).top>=hr.top-1&&R(sel).bottom<=hr.bottom+1,
  opts:sel?[...sel.options].map(o=>o.textContent):[], zname, dup, editing:!!q('.listpanel .qediting')&&vis(q('.listpanel .qediting')), suffix:vis(q('.listpanel .qzone')), nb:!!nbr, hit, pill:[...document.querySelectorAll('.listpanel tr .qnextpill')].some(vis), sx:head.scrollWidth>head.clientWidth+1 }; });
for (const [vw,vh,d,sc,z] of [[1920,1080,1,'tiny','67'],[1920,1080,1,'compact','100'],[960,540,2,'compact','200']]) for (const [sz,list] of [['wide','expanded'],['standard','open'],['collapsed','collapsed']]) {
 const [c,p]=await open(vw,vh,d,sc,list), t=`[${z} ${sz}]`; const s=await probe(p); console.log('    ',t,JSON.stringify(s).slice(0,500));
 ok(`${t} label reads "Queue:"`, s.lbl==='Queue:', s.lbl);
 ok(`${t} the picker is visible inside the header`, !!s.sel && s.inHead && s.sel[2]>=40, JSON.stringify(s.sel));
 ok(`${t} "(playing)" on exactly one zone`, s.opts.filter(o=>o.endsWith(' (playing)')).length===1, JSON.stringify(s.opts));
 ok(`${t} the zone name appears only in the picker (no suffix, no Editing:, no bar "on <zone>")`, !s.dup.length && !s.editing && !s.suffix, JSON.stringify(s.dup));
 ok(`${t} F50 Up next never overlaps the pin or any header control`, !s.hit.length, JSON.stringify(s.hit));
 ok(`${t} no side scrolling in the header`, !s.sx);
 if (sz!=='standard') ok(`${t} F50 Up next shown in the header or as the row pill`, s.nb || s.pill || list==='collapsed', JSON.stringify([s.nb,s.pill]));
 if (z==='100' && sz==='standard') { const o=await p.evaluate(()=>{ const sel=document.querySelector('.listpanel .qtitle .qzpick'), k=[...sel.options].find(o=>!o.textContent.includes('(playing)')).value; sel.value=k; sel.dispatchEvent(new Event('change')); return k; }); await p.waitForTimeout(1200);
   const v=await p.evaluate(()=>[document.querySelector('.listpanel').getAttribute('data-editing'), document.querySelector('.listpanel').classList.contains('qviewing'), !!document.querySelector('.np-ctlpanel .zlink, .npbar .zlink')?.offsetParent]);
   ok(`${t} picking another zone switches the queue view (bar shows the playing zone again)`, v[0]===o && v[1] && v[2], JSON.stringify(v)); }
 if (SH && z!=='67') await p.screenshot({path:`/workspace/screens/060/built/F60-built-${z}-${sz}.png`});
 await c.close(); }
{ const [c,p]=await open(390,844,3,'compact','open',true); await p.evaluate(async()=>{ (await import('/js/main.js')).go('queue'); }); await p.waitForTimeout(1200);
 const s=await p.evaluate(()=>{ const hd=document.querySelector('.pqhead'); return hd?{t:hd.textContent, lbl:hd.querySelector('.pqlbl')?.textContent, sel:!!hd.querySelector('select')?.offsetParent, w:hd.scrollWidth<=hd.clientWidth+1, count:/tracks/.test(hd.parentElement.textContent), opts:[...hd.querySelectorAll('option')].map(o=>o.textContent)}:null; });
 console.log('     [phone]',JSON.stringify(s)); ok('[phone] Queue page reads "Queue:" + the picker, the zone named once', !!s && s.lbl==='Queue:' && s.sel && s.w && s.count && !/·/.test(s.t.split('Queue:')[0]), JSON.stringify(s));
 ok('[phone] "(playing)" on the playing zone', !!s && s.opts.filter(o=>o.endsWith(' (playing)')).length===1, JSON.stringify(s?.opts));
 if (SH) await p.screenshot({path:'/workspace/screens/060/built/F60-built-phone.png'}); await c.close(); }
await br.close(); console.log(`f60queuepick: ${pass} passed, ${fail} failed`); process.exit(fail?1:0);

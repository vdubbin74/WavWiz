// F60 MOCKUP ONLY: "Queue: [zone ▾]" replaces "QUEUE · <ZONE>  Editing: [zone ▾]" (DOM injected, no code change)
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B='http://172.30.0.2:47800', sess=readFileSync('/tmp/ww032/sess','utf8').trim(), D='/workspace/screens/060';
const br=await chromium.launch(); const rep=[];
for (const [vw,vh,d,z] of [[1920,1080,1,'100'],[960,540,2,'200']]) for (const [sz,list] of [['wide','expanded'],['standard','open'],['collapsed','collapsed']]) for (const ph of ['before','after']) {
 const c=await br.newContext({viewport:{width:vw,height:vh},deviceScaleFactor:d,bypassCSP:true}); await c.addCookies([{name:'unison_session',value:sess,url:B}]);
 await c.addInitScript(l=>{ if(sessionStorage.getItem('g'))return; sessionStorage.setItem('g','1'); localStorage.setItem('wavwiz.whatsnew','9.9.9');localStorage.setItem('wavwiz.gettingStarted.shown','1');localStorage.setItem('wavwiz.webRoom.autojoin','0');localStorage.setItem('wavwiz.uiscale','compact');localStorage.setItem('wavwiz.layout','full');localStorage.setItem('wavwiz.panels',JSON.stringify({lib:'rail',dev:'rail',exp:null,list:l,ctl:'collapsed'}));},list);
 const p=await c.newPage(); await p.goto(B+'/'); await p.waitForTimeout(2800); await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(x=>x.close()));
 const measure=()=>p.evaluate(()=>{ const q=s=>document.querySelector(s), w=e=>e&&e.offsetParent?e.getBoundingClientRect().width:0, rg=e=>{if(!e)return 0;const r=document.createRange();r.selectNodeContents(e);return r.getBoundingClientRect().width;};
  const lp=q('.listpanel'), t=lp.querySelector('.qtitle'), wrap=lp.querySelector('.qzwrap'), nb=lp.querySelector('.pane-h .nextblock, .pane-h [class*="next"]');
  const head=lp.querySelector('.pane-h'), kids=[...head.children].filter(e=>e.offsetParent&&!e.classList.contains('qtitle')&&e!==nb);
  const used=rg(t)+kids.reduce((a,e)=>a+e.getBoundingClientRect().width,0);
  return {zone:Math.round(rg(t)+(wrap.querySelector('.qediting')?w(wrap.querySelector('.qediting'))+w(wrap.querySelector('.qzpick'))+16:0)), head:Math.round(head.clientWidth), free:Math.round(head.clientWidth-used), nb:nb?{hidden:nb.hidden||!nb.offsetParent, txt:nb.textContent.slice(0,40), w:Math.round(w(nb))}:null, scrollX:head.scrollWidth>head.clientWidth+1}; });
 if (ph==='after') await p.evaluate(()=>{ const lp=document.querySelector('.listpanel'), t=lp.querySelector('.qtitle'), wrap=lp.querySelector('.qzwrap'), ed=wrap.querySelector('.qediting'), sel=wrap.querySelector('.qzpick');
   const st=document.createElement('style'); st.textContent='.qf60lbl{color:var(--accent-text,var(--accent));font-weight:700;font-size:12px;letter-spacing:.08em;white-space:nowrap;flex:0 0 auto}.listpanel .qzpick.f60{field-sizing:content;border:1px solid var(--accent)!important;flex:0 0 auto;width:auto;border-color:var(--accent);border-radius:3px;font-weight:600;max-width:14em;background:var(--panel2);color:var(--ink);padding:2px 6px;font:inherit;font-size:12px}.listpanel .qtitle.f60 .qzone{display:none!important}.listpanel .qtitle.f60{flex:0 0 auto!important;width:auto}';
   document.head.append(st); t.querySelector('.qlbl').textContent='Queue:'; t.querySelector('.qlbl').className='qlbl qf60lbl'; t.querySelector('.qzone').textContent=''; t.classList.add('f60'); ed.remove(); sel.classList.add('f60'); sel.title='Queue to show and edit'; sel.style.marginLeft='6px'; sel.addEventListener('pointerdown',e=>e.stopPropagation()); t.append(sel); window.dispatchEvent(new Event('resize')); });
 await p.waitForTimeout(500); const m=await measure(); rep.push({z,sz,ph,...m});
 await p.screenshot({path:`${D}/F60-${ph}-${z}-${sz}-closed.png`});
 // open state: mock listbox (native <select> popups are not in page screenshots)
 await p.evaluate(ph=>{ const sel=document.querySelector('.listpanel .qzpick.f60')||document.querySelector('.listpanel .qzpick'), r=sel.getBoundingClientRect(), z=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--z'))||1;
  const box=document.createElement('div'); box.style.cssText=`position:fixed;left:${r.left/z}px;top:${(r.bottom+2)/z}px;min-width:${Math.max(r.width/z,160)}px;z-index:9999;background:var(--panel2);border:1px solid var(--accent);border-radius:3px;box-shadow:0 8px 22px rgba(0,0,0,.5);padding:3px 0;font-size:12px`;
  [...sel.options].forEach(o=>{ const it=document.createElement('div'); const on=o.value===sel.value; it.textContent=(on?'✓ ':'   ')+o.textContent; it.style.cssText=`padding:5px 10px;white-space:pre;color:${on?'var(--accent-text,var(--accent))':'var(--ink)'};${on?'background:color-mix(in srgb,var(--accent) 14%,transparent);font-weight:700':''}`; box.append(it); });
  if (ph==='after') { const hd=document.createElement('div'); hd.textContent='SHOW QUEUE FOR'; hd.style.cssText='padding:3px 10px 4px;font-size:10px;letter-spacing:.12em;color:var(--dim,#889)'; box.prepend(hd); }
  document.body.append(box); },ph);
 await p.screenshot({path:`${D}/F60-${ph}-${z}-${sz}-open.png`}); await c.close(); }
for (const r of rep) console.log(JSON.stringify(r)); await br.close();

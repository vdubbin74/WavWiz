// F250-P3: shipped qreorder/queuemenu/Now/art + verbatim main compact renderer,
// hide/zone/route integration and full CSS. Fake API/music; not a running server,
// WebKit or physical-device/OS lock-screen proof.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {localDom} from './helpers/local-dom.mjs';
const main=readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/main.js',import.meta.url),'utf8');
const queueSource=main.slice(main.indexOf('let qReorder = null'),main.indexOf('\nboot();'));
const refreshSource=main.slice(main.indexOf('async function refreshNow()'),main.indexOf('async function refreshZones()'));
const goSource=main.slice(main.indexOf('export function go('),main.indexOf('const checklistGo')).replace('export ','');
const css=readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css',import.meta.url),'utf8');
const evidence=process.env.F250_P3_EVIDENCE_DIR;if(evidence)mkdirSync(evidence,{recursive:true});
let dom;before(async()=>{dom=await localDom();});after(async()=>{await dom?.close();});
async function fixture({width=390,height=844,n=6,role='admin',zoom=1}={}){
  const p=await dom.page({width,height});p.errors=[];p.on('pageerror',e=>p.errors.push(e.stack));
  await p.emulateMedia({reducedMotion:'reduce'});
  // Same stylesheet set/order as the real index, not app.css alone.
  await p.evaluate(()=>['mini','jukebox-palette','jukebox','ss-premium','eq-premium','panel-rail'].forEach(n=>{const l=document.createElement('link');l.rel='stylesheet';l.href='/'+n+'.css';document.head.append(l);}));
  await p.route(/\/api\/v1\/art\//,r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="#326478"/><circle cx="96" cy="96" r="55" fill="#698eac"/></svg>'}));
  await p.evaluate(async({queueSource,goSource,refreshSource,n,role,zoom})=>{
    window.calls=[];window.msWrites=0;window.audioStarts=0;window.failMove=false;window.favorites=[];
    Object.defineProperty(window,'MediaMetadata',{configurable:true,value:class{constructor(o){Object.assign(this,o);msWrites++;}}});
    Object.defineProperty(navigator,'mediaSession',{configurable:true,value:{metadata:null,playbackState:'none',setActionHandler(){},setPositionState(){}}});
    window.AudioContext=class{constructor(){audioStarts++;throw Error('unexpected audio');}};
    HTMLMediaElement.prototype.play=function(){audioStarts++;return Promise.resolve();};
    localStorage.setItem('wavwiz.viz.v1',JSON.stringify({on:false}));
    document.documentElement.style.setProperty('--z',zoom);
    window.wireQ=Array.from({length:n},(_,i)=>({id:'occ-'+i,kind:i===3?'remote':i===4?'radio':'track',refId:i<2?101:101+i,title:i<2?'P3 duplicate song':i===n-1?'P3 final song with a long title to ellipsize':'P3 song '+i,artist:'API fixture artist',album:'API fixture album',durationMs:180000}));
    window.fetch=async(url,opts={})=>{
      const u=new URL(url,location.href),path=u.pathname.replace('/api/v1',''),method=opts.method||'GET',body=opts.body?JSON.parse(opts.body):null;
      calls.push({path,query:u.search,method,body});let value={};
      if(path==='/queue/move'){
        if(failMove)return new Response(JSON.stringify({error:'fixture move failed'}),{status:500});
        wireQ.splice(body.to,0,...wireQ.splice(body.from,1));
      }
      else if(path==='/favorites'&&method==='PUT'){favorites=body.on?[...favorites,{kind:body.kind,ref:body.ref}]:favorites.filter(x=>x.ref!==body.ref);value={};}
      else if(path==='/favorites')value=favorites;
      else if(path==='/queue/keep')value={enabled:false};
      else if(path==='/stream')value={now:S.now,queue:{items:wireQ}};
      else if(path==='/playlists')value=[];
      else if(path==='/checklist')value={dismissed:true,remaining:0};
      return new Response(JSON.stringify(value),{status:200});
    };
    const {h,api,toast,fmtDur}=await import('/js/util.js'),{icon}=await import('/js/icons.js'),{npCover,artCv}=await import('/js/art.js'),{canControl}=await import('/js/ui.js');
    const {attachReorder,canDragRows}=await import('/js/qreorder.js'),{attachQueueMenu}=await import('/js/queuemenu.js'),{srcPill}=await import('/js/listtable.js');
    const {loadLayout,saveLayout,setLocked}=await import('/js/plcols.js'),{keepControl,openRecentQueues}=await import('/js/queuetools.js'),{clearQueueFlow}=await import('/js/queueclear.js'),{wsel}=await import('/js/wwselect.js');
    const Z=window.Z=await import('/js/zones40.js'),{createNow}=await import('/js/now.js');
    window.S={auth:{role},view:'queue',queue:structuredClone(wireQ),now:{item:wireQ[0]||null,index:0,state:n?'playing':'stopped',positionMs:45000,durationMs:180000,version:1},localPos:45000,localAt:performance.now(),groups:[{id:1,name:'Fixture Den',playbackId:'den',online:true,deviceIds:[]},{id:2,name:'Fixture Patio',playbackId:'patio',online:true,deviceIds:[]}],zones:[],status:{}};
    Z.init(S,{});
    const act=window.act=(path,body,method='POST')=>api(path,{body,method});
    let refreshNow;
    const refreshAll=async()=>{await refreshNow();};
    const showInLibrary=()=>{};
    const nowc=window.nowc=createNow(S,{act,go:k=>window.go(k)});
    const wide=()=>!matchMedia('(max-width:900px)').matches;
    const views=window.views={queue:{el:h('div',{id:'p-list',class:'phone-queue'})},library:{el:h('div',{},'Fixture Library')},devices:{el:h('div',{},'Fixture Devices')}};
    const content=h('main',{class:'view',id:'view'}),desk=window.desk=h('div',{class:'desk',id:'desk','data-view':'queue'},content,nowc.el,nowc.npbar);
    const tabs=h('nav',{class:'tabbar'},[['library','library'],['queue','queue'],['devices','devices'],['settings','gear']].map(([k,ic])=>h('button',{'data-k':k,onclick:()=>window.go(k)},icon(ic),k)));
    document.getElementById('app').replaceChildren(h('header',{class:'topbar'},h('b',{},'P3 API FIXTURE')),desk,nowc.mini,tabs);
    // Exercise the verbatim stream ingest and its transaction read fence too.
    const {reconcileSmoothPosition}=await import('/js/art.js');
    refreshNow=window.refreshQueue=new Function('S','api','reconcileSmoothPosition','whenIdle','nowc','listt','drawStatus','drawQueue','handleErr',refreshSource+';return refreshNow;')(S,api,reconcileSmoothPosition,fn=>fn(),nowc,{draw(){}},()=>{},()=>window.drawQueue(),e=>{window.refreshError=e.message;});
    const bindings={h,api,toast,fmtDur,icon,npCover,artCv,canControl,canDragRows,attachReorder,attachQueueMenu,srcPill,loadLayout,saveLayout,setLocked,keepControl,openRecentQueues,clearQueueFlow,wsel,Z,S,views,wide,act,refreshNow,refreshAll,showInLibrary};
    window.q=new Function(...Object.keys(bindings),'let pKeep=null;'+queueSource+';return {drawQueue,hidePhoneQueue,showPhoneQueue,get engine(){return qReorder;}};')(...Object.values(bindings));
    window.drawQueue=q.drawQueue;views.queue.reload=q.drawQueue;views.queue.hide=q.hidePhoneQueue;views.queue.show=q.showPhoneQueue;
    window.go=new Function('S','views','wide','desk','content','tabs','navButtons','nowc',goSource+';return go;')(S,views,wide,desk,content,tabs,[],nowc);
    window.lockQueue=()=>{saveLayout(setLocked(loadLayout(true),true),true);};
    window.unlockQueue=()=>{saveLayout(setLocked(loadLayout(true),false),true);};
    window.unlockQueue();go('queue');await refreshNow();nowc.draw();
    window.snapshot={now:nowc,mini:nowc.mini,pos:S.localPos,at:S.localAt,writes:msWrites};
  },{queueSource,goSource,refreshSource,n,role,zoom});
  await p.waitForFunction(()=>[...document.querySelectorAll('.mini img')].every(e=>e.complete));
  await p.waitForTimeout(50);
  await p.evaluate(()=>snapshot.writes=msWrites);
  return p;
}
async function clean(p){try{assert.deepEqual(p.errors,[]);}finally{await p.context().close();}}
async function shot(p,name){if(evidence)await p.screenshot({path:evidence+'/'+name+'.png',animations:'disabled'});}
async function point(p,i=0){return p.locator(`.qlist>.item[data-i="${i}"]>.qgrip`).evaluate(el=>{el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});}
async function start(p,i=0){const at=await point(p,i);await p.mouse.move(at.x,at.y);await p.mouse.down();return at;}
async function line(p){return p.locator('.phone-qins').evaluate(e=>({from:+e.dataset.from,to:+e.dataset.to,at:+e.dataset.at,label:e.textContent,top:e.getBoundingClientRect().top}));}
async function touch(p,selector,type='touchstart',dx=0,dy=0){await p.locator(selector).dispatchEvent(type,{touches:type==='touchend'?[]:[{identifier:11,clientX:20+dx,clientY:200+dy}],changedTouches:[{identifier:11,clientX:20+dx,clientY:200+dy}],bubbles:true,cancelable:true});}
async function noWrites(p){assert.deepEqual(await p.evaluate(()=>calls.filter(c=>['/queue/move','/stream/jump'].includes(c.path)||c.method==='DELETE')),[]);}
async function assertCleanDrag(p){assert.equal(await p.evaluate(()=>!!document.querySelector('.phone-qghost,.phone-qins,.item.dragging')||!!q.engine?.active),false);}

test('P3 real compact composition: complete occurrences/art, summary truth, genuine ellipsis, tools/save and mini lifetime',async()=>{
 const p=await fixture();try{
  assert.equal(await p.locator('.qlist>.item').count(),6);assert.equal(await p.locator('.qlist .qrow-art').count(),6);
  assert.equal(await p.locator('.qsummary h2').textContent(),'Now playing');assert.equal(await p.locator('.qsummary [aria-label="Pause"]').count(),1);
  await p.locator('.qsummary [aria-label="Pause"]').click();assert.equal(await p.evaluate(()=>calls.at(-1).path),'/stream/pause');
  await p.evaluate(()=>{S.now.state='paused';drawQueue();nowc.draw();});assert.equal(await p.locator('.qsummary h2').textContent(),'Paused');assert.equal(await p.locator('.qsummary [aria-label="Resume"]').count(),1);
  await p.locator('.qsummary [aria-label="Resume"]').click();assert.equal(await p.evaluate(()=>calls.at(-1).path),'/stream/resume');
  assert.equal(await p.locator('.qlist .qx').count(),0);assert.equal(await p.locator('.qmore').first().textContent(),'⋯');
  await p.locator('.qsave-open').click();await p.locator('.qsave input').fill('Fixture saved queue');await p.locator('.qsave button:text-is("Save")').click();
  assert.ok(await p.evaluate(()=>calls.some(c=>c.path==='/playlists'&&c.body?.fromQueue&&c.body.name==='Fixture saved queue'&&c.query.includes('zoneId=den'))));
  await shot(p,'phone-390-queue-paused');
  assert.equal(await p.evaluate(()=>snapshot.now===nowc&&snapshot.mini===nowc.mini&&snapshot.pos===S.localPos&&snapshot.at===S.localAt&&audioStarts===0),true);
 }finally{await clean(p);}
});

test('P3 grip stationary/click/hold/secondary and slow 4px never play/menu/reorder through 520ms',async()=>{
 const p=await fixture();try{
  const at=await start(p);await touch(p,'.qlist>.item:first-child .qgrip');await p.waitForTimeout(570);assert.equal(await p.locator('.qmenu').count(),0);assert.equal(await p.locator('.phone-qghost').count(),0);
  await p.mouse.move(at.x,at.y+4);await p.waitForTimeout(570);assert.equal(await p.locator('.qmenu').count(),0);assert.equal(await p.locator('.phone-qghost').count(),0);await p.mouse.up();await touch(p,'.qlist>.item:first-child .qgrip','touchend');await noWrites(p);
  await p.waitForTimeout(470);await p.locator('.qgrip').first().click({button:'right'});await p.waitForTimeout(570);assert.equal(await p.locator('.qmenu').count(),0);await noWrites(p);
  await assertCleanDrag(p);
 }finally{await clean(p);}
});

test('P3 5 CSSpx activates without hold, capture/source/count and menu exclusion past 520ms',async()=>{
 const p=await fixture();try{
  const at=await start(p);assert.equal(await p.locator('.qgrip').first().evaluate(e=>e.hasPointerCapture(1)),true);
  await touch(p,'.qlist>.item:first-child .qgrip');await p.mouse.move(at.x,at.y+5);
  assert.equal(await p.locator('.phone-qghost').count(),1);assert.match(await p.locator('.phone-qghost').textContent(),/1 song/);assert.equal(await p.locator('.item.dragging').count(),1);
  await p.waitForTimeout(580);await p.locator('.qgrip').first().dispatchEvent('contextmenu',{clientX:at.x,clientY:at.y});assert.equal(await p.locator('.qmenu').count(),0);
  await p.keyboard.press('Escape');await p.mouse.up();await noWrites(p);await assertCleanDrag(p);
 }finally{await clean(p);}
});

test('P3 actual CDP touch sequence: stationary grip then 6px drag owns capture, body can hold-menu',async()=>{
 const p=await fixture();try{
  const at=await point(p),cdp=await p.context().newCDPSession(p);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:at.x,y:at.y}]});await p.waitForTimeout(560);assert.equal(await p.locator('.qmenu').count(),0);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:at.x,y:at.y+6}]});await p.waitForTimeout(560);
  assert.equal(await p.locator('.phone-qghost').count(),1);assert.equal(await p.locator('.qmenu').count(),0);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await assertCleanDrag(p);await noWrites(p);
  await p.waitForTimeout(470);const body=await p.locator('.qlist>.item:first-child .t').boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:body.x+10,y:body.y+10}]});await p.waitForTimeout(560);assert.equal(await p.locator('.qmenu').count(),1);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await noWrites(p);
 }finally{await clean(p);}
});

test('P3 body tap/right-click/520ms hold and normal swipe, ellipsis opens existing complete/F236 menu',async()=>{
 const p=await fixture();try{
  await p.locator('.qlist>.item:first-child .t').click();assert.equal(await p.evaluate(()=>calls.at(-1).path),'/stream/jump');await p.evaluate(()=>calls=[]);
  await p.locator('.qlist>.item:first-child .t').click({button:'right'});assert.equal(await p.locator('.qmenu [data-qm]').count(),11);await p.keyboard.press('Escape');
  await touch(p,'.qlist>.item:first-child .t');await p.waitForTimeout(550);assert.equal(await p.locator('.qmenu').count(),1);await touch(p,'.qlist>.item:first-child .t','touchend');await p.locator('.qlist>.item:first-child .t').dispatchEvent('click');await noWrites(p);await p.keyboard.press('Escape');
  await touch(p,'.qlist>.item:first-child .t');await touch(p,'.qlist>.item:first-child .t','touchmove',0,20);await p.waitForTimeout(550);assert.equal(await p.locator('.qmenu').count(),0);await touch(p,'.qlist>.item:first-child .t','touchend');
  assert.equal(await p.locator('.qlist>.item:first-child').evaluate(e=>getComputedStyle(e).touchAction),'auto');
  await p.locator('.qmore').first().click();assert.equal(await p.locator('.qmenu [data-qm="remove"]').count(),1);assert.equal(await p.evaluate(()=>calls.filter(c=>c.method==='DELETE').length),0);
  await p.locator('.qmenu [data-qm="favorite"]').click();assert.ok(await p.evaluate(()=>calls.some(c=>c.path==='/favorites'&&c.method==='PUT'&&c.body.on)));
  await p.locator('.qmore').first().click();assert.equal(await p.locator('[data-qm="favorite"]').textContent(),'Remove from Favorites');await p.keyboard.press('Escape');
  for(const i of [3,4]){await p.locator(`.item[data-i="${i}"] .qmore`).click();assert.equal(await p.locator('[data-qm="favorite"]').isDisabled(),true);await p.keyboard.press('Escape');}
 }finally{await clean(p);}
});

test('P3 occurrence order: first/last/up/down/own-slot/duplicates, displayed destination equals committed move',async()=>{
 for(const [from,to] of [[0,5],[5,0],[1,3],[4,2],[1,1],[0,1]]){
  const p=await fixture({height:1300});try{
   const before=await p.evaluate(()=>S.queue.map(q=>q.id));await start(p,from);
   const target=await p.locator(`.item[data-i="${to}"]`).boundingBox();
   const at=await point(p,from);const y=to>from?target.y+target.height-4:target.y+4;
   await p.mouse.move(at.x,y);await p.waitForTimeout(25);
   const prediction=await line(p);assert.equal(prediction.to,to);if(to!==from)assert.match(prediction.label,/Before|After/);else assert.match(prediction.label,/Keep/);
   if(from===0&&to===5)await shot(p,'phone-390-drag-after-last');
   const expected=before.slice();expected.splice(to,0,...expected.splice(from,1));await p.mouse.up();
   if(from!==to)await p.waitForFunction(()=>calls.some(c=>c.path==='/queue/move'));
   assert.deepEqual(await p.evaluate(()=>wireQ.map(q=>q.id)),expected);
   assert.equal(await p.evaluate(()=>calls.filter(c=>c.path==='/queue/move').length),from===to?0:1);await assertCleanDrag(p);
  }finally{await clean(p);}
 }
});

test('P3 exclusive pointer id/primary/button and foreign up/cancel cannot steal a drag',async()=>{
 const p=await fixture();try{
  const at=await point(p);
  for(const init of [{isPrimary:false,button:0},{isPrimary:true,button:2}]){
   await p.locator('.qgrip').first().dispatchEvent('pointerdown',{...init,pointerId:21,clientX:at.x,clientY:at.y});assert.equal(await p.evaluate(()=>q.engine.active),false);
  }
  await start(p);await p.mouse.move(at.x,at.y+10);
  await p.locator('.qgrip').nth(1).dispatchEvent('pointerdown',{isPrimary:true,button:0,pointerId:77,clientX:at.x,clientY:at.y});
  await p.evaluate(()=>{window.dispatchEvent(new PointerEvent('pointerup',{pointerId:77,clientX:20,clientY:800}));window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:77}));});
  assert.equal(await p.evaluate(()=>q.engine.active),true);await p.keyboard.press('Escape');await p.mouse.up();await noWrites(p);await assertCleanDrag(p);
 }finally{await clean(p);}
});

test('P3 cancellation: cancel/lost capture/Esc/outside/resize/view/destroy/refresh/zone/lock/access/empty leaves no stale writes',async()=>{
 for(const mode of ['pointercancel','lostcapture','escape','outside','resize','view','destroy','refresh','zone','lock','access','empty','data']){
  const p=await fixture();try{
   const at=await start(p);await p.mouse.move(at.x,at.y+10);
   if(mode==='pointercancel')await p.evaluate(()=>window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1})));
   if(mode==='lostcapture')await p.locator('.qgrip').first().evaluate(e=>e.releasePointerCapture(1));
   if(mode==='escape')await p.keyboard.press('Escape');
   if(mode==='outside')await p.mouse.move(389,820);
   if(mode==='resize')await p.setViewportSize({width:375,height:700});
   if(mode==='view')await p.evaluate(()=>go('library'));
   if(mode==='destroy')await p.evaluate(()=>q.hidePhoneQueue());
   if(mode==='refresh')await p.evaluate(()=>{S.queue[2].title+=' refreshed';drawQueue();});
   if(mode==='zone')await p.evaluate(()=>Z.select('g:2'));
   if(mode==='lock')await p.evaluate(()=>lockQueue());
   if(mode==='access')await p.evaluate(()=>S.auth.role='view');
   if(mode==='empty')await p.evaluate(()=>{S.queue=[];drawQueue();});
   if(mode==='data')await p.evaluate(()=>{S.queue.reverse();});
   await p.waitForTimeout(40);await p.mouse.up();await assertCleanDrag(p);await p.waitForTimeout(550);await noWrites(p);assert.equal(await p.locator('.qmenu').count(),0);
  }finally{await clean(p);}
 }
});

test('P3 mid-drag occurrence swap cancels even if track refs/titles match; new drag uses resulting current order',async()=>{
 const p=await fixture({height:1300});try{
  const at=await start(p);await p.mouse.move(at.x,at.y+10);
  await p.evaluate(()=>{[S.queue[0],S.queue[1]]=[S.queue[1],S.queue[0]];wireQ=structuredClone(S.queue);});
  await p.waitForTimeout(30);await p.mouse.up();await noWrites(p);await assertCleanDrag(p);
  await p.evaluate(()=>drawQueue());await p.waitForTimeout(470);const before=await p.evaluate(()=>wireQ.map(x=>x.id));
  await start(p);const last=await p.locator('.item[data-i="5"]').boundingBox();await p.mouse.move(at.x,last.y+last.height-3);
  const prediction=await line(p);assert.equal(prediction.to,5);await p.mouse.up();await p.waitForFunction(()=>calls.some(c=>c.path==='/queue/move'));
  assert.deepEqual(await p.evaluate(()=>wireQ.map(x=>x.id)),[...before.slice(1),before[0]]);
 }finally{await clean(p);}
});

test('P3 real ancestor stationary autoscroll + zoom-correct marker and committed order (100/125/80%)',async()=>{
 for(const zoom of [1,1.25,.8]){
  const p=await fixture({n:40,zoom});try{
   // Bring the queue into the desk viewport, then own the first visible occurrence.
   await p.locator('.item[data-i="0"]').scrollIntoViewIfNeeded();
   const at=await start(p);const edge=await p.evaluate(()=>{const r=desk.getBoundingClientRect();return r.bottom-12;});
   await p.mouse.move(at.x,edge);await p.waitForTimeout(35);const first=await line(p),scroll=await p.evaluate(()=>desk.scrollTop);
   await p.waitForTimeout(260);const next=await line(p);
   assert.ok(await p.evaluate(s=>desk.scrollTop>s,scroll),'actual desk scrolls without a pointermove');assert.ok(next.to>first.to,'stationary pointer destination advances');
   assert.equal(await p.locator('.qlist').evaluate(e=>e.scrollTop),0,'not an imaginary list scroller');
   const alignment=await p.evaluate(()=>{const e=document.querySelector('.phone-qins'),g=document.querySelector(`.item[data-i="${e.dataset.at}"]`),r=desk.getBoundingClientRect(),z=Number(getComputedStyle(document.documentElement).getPropertyValue('--z'));return {marker:e.getBoundingClientRect().top,gap:Math.max(r.top+4*z,Math.min(g?.getBoundingClientRect().top??Infinity,r.bottom-4*z)),z};});
   assert.ok(Math.abs(alignment.marker-alignment.gap)<2*zoom,JSON.stringify(alignment));
   // Freeze edge scrolling via pointer reposition; release must use that visible prediction.
   const center=await p.evaluate(()=>{const r=desk.getBoundingClientRect(),z=Number(getComputedStyle(document.documentElement).zoom)||1;return r.bottom-55*z;});await p.mouse.move(at.x,center);const final=await line(p),before=await p.evaluate(()=>wireQ.map(x=>x.id));
   await shot(p,`phone-drag-scroll-z${zoom}`);await p.mouse.up();await p.waitForFunction(()=>calls.some(c=>c.path==='/queue/move'));
   const expected=before.slice();expected.splice(final.to,0,...expected.splice(0,1));assert.deepEqual(await p.evaluate(()=>wireQ.map(x=>x.id)),expected);
  }finally{await clean(p);}
 }
});

test('P3 Alt-Up/Down, menu moves/lock/F236 independence and View permission gates',async()=>{
 const p=await fixture();try{
  await p.locator('.qgrip').nth(1).focus();await p.keyboard.press('Alt+ArrowDown');await p.waitForFunction(()=>document.querySelector('.qresult').textContent.includes('Moved'));
  assert.deepEqual(await p.evaluate(()=>calls.find(c=>c.path==='/queue/move').body),{from:1,to:2});assert.equal(await p.evaluate(()=>document.activeElement.closest('[data-i]').dataset.i),'2');assert.match(await p.locator('.qresult').textContent(),/Moved/);
  await p.locator('.qmore').nth(2).click();await p.locator('[data-qm="up"]').click();assert.deepEqual(await p.evaluate(()=>calls.filter(c=>c.path==='/queue/move').at(-1).body),{from:2,to:1});
  await p.evaluate(()=>{lockQueue();drawQueue();});assert.equal(await p.locator('.qgrip').first().isDisabled(),true);
  await p.locator('.qmore').first().click();assert.equal(await p.locator('[data-qm="remove"]').isDisabled(),true);assert.equal(await p.locator('[data-qm="down"]').isDisabled(),true);assert.equal(await p.locator('[data-qm="favorite"]').isDisabled(),false);
  // Open-menu permission/zone invalidation is checked again at action execution.
  await p.evaluate(()=>S.auth.role='view');await p.locator('[data-qm="favorite"]').click();assert.equal(await p.evaluate(()=>calls.some(c=>c.path==='/favorites'&&c.method==='PUT')),false);
 }finally{await clean(p);}
 const v=await fixture({role:'view'});try{assert.equal(await v.locator('.qmore').count(),0);assert.equal(await v.locator('.qgrip:disabled').count(),6);await v.locator('.item .t').first().click();await noWrites(v);}finally{await clean(v);}
});

test('P3 phone geometry/theme: 44px persistent grips, readable title, last-row reachability and safe chrome at 320..900',async()=>{
 for(const [width,height] of [[320,568],[375,667],[390,844],[430,932],[667,375],[844,390],[760,600],[761,600],[900,600]]){
  const p=await fixture({width,height,n:12});try{
   const geometry=await p.locator('.item').first().evaluate(el=>{const g=el.querySelector('.qgrip'),m=el.querySelector('.qmore'),t=el.querySelector('.t');return {g:g.getBoundingClientRect().toJSON(),m:m.getBoundingClientRect().toJSON(),title:t.getBoundingClientRect().width,opacity:getComputedStyle(g).opacity,overflow:document.documentElement.scrollWidth>innerWidth};});
   assert.ok(geometry.g.width>=44&&geometry.g.height>=44);assert.ok(geometry.m.width>=44&&geometry.m.height>=44);assert.ok(geometry.title>=90);assert.equal(geometry.opacity,'1');assert.equal(geometry.overflow,false);
   await p.locator('.qlist>.item').last().scrollIntoViewIfNeeded();assert.equal(await p.locator('.qlist>.item').last().evaluate(el=>{const r=el.getBoundingClientRect(),mini=document.querySelector('#app>.mini').getBoundingClientRect();return r.bottom<=mini.top+1;}),true);
   await shot(p,`queue-last-${width}x${height}`);
  }finally{await clean(p);}
 }
 const p=await fixture();try{
  await p.evaluate(async()=>{const {applyTheme,loadTheme}=await import('/js/theme.js');applyTheme({bg:'#f8f8ff',ink:'#202020',accent:'#2361b5',accent2:'#365e8e',hl:'#4b5db0'});});
  assert.equal(await p.evaluate(()=>document.documentElement.dataset.scheme),'light');
  const at=await start(p);await p.mouse.move(at.x,at.y+12);await shot(p,'queue-drag-custom-light');assert.equal(await p.locator('.phone-qins').evaluate(e=>getComputedStyle(e).height),'4px');
  await p.keyboard.press('Escape');await p.mouse.up();
 }finally{await clean(p);}
});

test('P3 empty and navigation cleanup keep one Now/mini and no audio/clock lifetime changes',async()=>{
 const p=await fixture({n:0});try{assert.match(await p.locator('.phone-queue').textContent(),/queue is empty/);assert.equal(await p.locator('.qsummary h2').textContent(),'Nothing playing');}finally{await clean(p);}
 const v=await fixture();try{
  await touch(v,'.qlist>.item:first-child .t');await v.evaluate(()=>go('devices'));await v.waitForTimeout(560);assert.equal(await v.locator('.qmenu').count(),0);
  await v.evaluate(()=>{go('queue');go('now');go('library');go('queue');});
  assert.equal(await v.evaluate(()=>snapshot.now===nowc&&snapshot.mini===nowc.mini&&snapshot.pos===S.localPos&&snapshot.at===S.localAt&&snapshot.writes===msWrites&&audioStarts===0),true);
 }finally{await clean(v);}
});


test('P3 CSS movement boundary 0/4/5/6/9/10 and bounded post-cancel click/context guards at scaled display',async()=>{
 for(const zoom of [1,1.25,.8]){
  const p=await fixture({zoom,height:1300});try{
   for(const delta of [0,4,5,6,9,10]){
    await p.waitForTimeout(470);const at=await start(p);await p.mouse.move(at.x,at.y+delta*zoom);
    assert.equal(await p.locator('.phone-qghost').count(),delta>=5?1:0,`zoom=${zoom} movement=${delta}`);
    await p.keyboard.press('Escape');await p.mouse.up();
   }
   // A synthetic trailing click/contextmenu on body is swallowed, then expires.
   await p.locator('.item .t').first().dispatchEvent('click');await p.locator('.item .t').first().dispatchEvent('contextmenu');await noWrites(p);assert.equal(await p.locator('.qmenu').count(),0);
   await p.waitForTimeout(470);await p.locator('.item .t').first().click();assert.equal(await p.evaluate(()=>calls.at(-1).path),'/stream/jump');
  }finally{await clean(p);}
 }
});

test('P3 pending body menu canceled at grip ownership; rejected move reports failure without changing order',async()=>{
 const p=await fixture({height:1300});try{
  await touch(p,'.item:first-child .t');const at=await start(p);await p.waitForTimeout(560);assert.equal(await p.locator('.qmenu').count(),0);
  await p.mouse.move(at.x,at.y+10);await p.keyboard.press('Escape');await p.mouse.up();await noWrites(p);
  await p.waitForTimeout(470);await p.evaluate(()=>{failMove=true;});const before=await p.evaluate(()=>wireQ.map(q=>q.id));
  await start(p);const r=await p.locator('.item[data-i="5"]').boundingBox();await p.mouse.move(at.x,r.y+r.height-2);await p.mouse.up();
  await p.waitForFunction(()=>document.querySelector('.qresult').textContent.includes('Could not reorder'));
  assert.deepEqual(await p.evaluate(()=>wireQ.map(q=>q.id)),before);await assertCleanDrag(p);
 }finally{await clean(p);}
});

test('P3 wide table CSS geometry/paint and default menu engine are unchanged at 901/1280/1600',async()=>{
 for(const width of [901,1280,1600]){
  const p=await fixture();try{
   await p.evaluate(async()=>{
    q.hidePhoneQueue();const savedGroups=S.groups;S.groups=[];Z.sync();const {h}=await import('/js/util.js'),{listTable}=await import('/js/listtable.js');
    const t=window.table=listTable(S,{act,refreshAll(){},showInLibrary(){}});
    document.getElementById('app').replaceChildren(h('div',{class:'desk full',style:'display:block;height:100%;width:100%'},t.el));t.el.style.height='100%';S.groups=savedGroups;Z.sync();t.draw();
   });
   await p.setViewportSize({width,height:800});await p.evaluate(()=>table.relayout());await p.waitForTimeout(50);
   const snapshot=()=>p.evaluate(()=>[...document.querySelectorAll('.listpanel,.listpanel *')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return [e.tagName,e.className,r.x,r.y,r.width,r.height,s.display,s.padding,s.backgroundColor,s.color,s.fontSize,s.border,s.opacity,s.touchAction];}));
   const candidate=await snapshot();await shot(p,`desktop-${width}-queue-candidate`);
   await p.evaluate(old=>{document.querySelector('link[rel=stylesheet]').disabled=true;const st=document.createElement('style');st.id='original-css';st.textContent=old;document.head.append(st);},css.slice(0,css.indexOf('/* F250-P3:')));
   const baseline=await snapshot();assert.deepEqual(candidate,baseline);
   await shot(p,`desktop-${width}-queue-baseline`);
   await p.evaluate(()=>{document.getElementById('original-css').remove();document.querySelector('link[rel=stylesheet]').disabled=false;});
   await p.locator('.qtable tbody tr').first().click({button:'right'});await p.waitForSelector('.qmenu');assert.equal(await p.locator('.qmenu [data-qm]').count(),11);await p.keyboard.press('Escape');
   assert.equal(await p.locator('.phone-qins,.phone-qghost').count(),0);
  }finally{await clean(p);}
 }
});


test('P3 identical stream refresh preserves owned rows through 520ms, then deferred redraw restores fresh row closures',async()=>{
 const p=await fixture({height:1300});try{
  const at=await start(p);await p.mouse.move(at.x,at.y+6);
  await p.evaluate(()=>{window.ownedRow=document.querySelector('.item');S.queue=structuredClone(S.queue);drawQueue();});
  await p.waitForTimeout(560);assert.equal(await p.evaluate(()=>q.engine.active&&document.querySelector('.item')===ownedRow),true);assert.equal(await p.locator('.qmenu').count(),0);
  await p.keyboard.press('Escape');await p.mouse.up();await p.waitForFunction(()=>document.querySelector('.item')!==ownedRow);await assertCleanDrag(p);await noWrites(p);
  await p.waitForTimeout(470);await p.locator('.item .t').first().click();assert.equal(await p.evaluate(()=>calls.at(-1).path),'/stream/jump');
 }finally{await clean(p);}
});

// Runnable independent review probes retained, with only screenshot destination
// localized and the shared fixture upgraded to the verbatim stream ingest.
test('Wiz R1: harmless refresh must not replace pending-commit ownership and allow a stale second occurrence move',async()=>{
 const p=await fixture({height:1300});try{
  await p.evaluate(()=>{
   window.movedOccurrences=[];window.firstHeld=false;const original=fetch;let ordinal=0;
   window.fetch=async(url,opts={})=>{
    const move=new URL(url,location.href).pathname.endsWith('/queue/move');
    const k=move?++ordinal:0;
    if(move){const body=JSON.parse(opts.body);movedOccurrences.push({body,movedId:wireQ[body.from].id});}
    const response=await original(url,opts);
    if(k===1){firstHeld=true;await new Promise(r=>window.releaseFirstMove=r);}
    return response;
   };
  });
  const at=await start(p,0);await p.mouse.move(at.x,at.y+6);
  await p.evaluate(()=>{window.originalEngine=q.engine;S.queue=structuredClone(S.queue);drawQueue();});
  const target=await p.locator('.item[data-i="3"]').boundingBox();await p.mouse.move(at.x,target.y+target.height-3);
  assert.equal((await line(p)).to,3);await p.mouse.up();
  await p.waitForFunction(()=>firstHeld && q.engine!==originalEngine);
  const chosen=await p.evaluate(()=>S.queue[2].id);
  await p.locator('.qgrip').nth(2).focus();await p.keyboard.press('Alt+ArrowDown');
  await p.waitForTimeout(60);
  const evidence=await p.evaluate(()=>({moves:movedOccurrences,visible:S.queue.map(x=>x.id),server:wireQ.map(x=>x.id)}));
  console.log('R1 evidence',JSON.stringify({chosen,...evidence}));
  await p.evaluate(()=>releaseFirstMove());
  assert.equal(evidence.moves.length,1,'must retain transaction ownership until first move response is reconciled, not send a stale second move');
 }finally{await clean(p);}
});
test('Wiz R2: same-item Queue summary must keep already-loaded art during redraw and slow asynchronous decode',async()=>{
 const p=await fixture();try{
  await p.locator('.qsummary-art').waitFor();await p.waitForFunction(()=>document.querySelector('.qsummary-art')?.classList.contains('loaded'));
  await p.evaluate(()=>{
   window.savedSummaryArt=document.querySelector('.qsummary-art');window.savedMiniArt=nowc.mini.querySelector('.npa');
   const original=HTMLImageElement.prototype.decode;
   window.decodeWait=[];HTMLImageElement.prototype.decode=function(){return new Promise(resolve=>decodeWait.push(()=>original.call(this).catch(()=>{}).then(resolve)));};
   drawQueue();nowc.draw();
  });
  await p.waitForTimeout(80);
  const observed=await p.evaluate(()=>({sameItem:S.now.item.id,summaryLoaded:document.querySelector('.qsummary-art').classList.contains('loaded'),replaced:document.querySelector('.qsummary-art')!==savedSummaryArt,miniRetained:nowc.mini.querySelector('.npa')===savedMiniArt,pendingDecode:decodeWait.length}));
  console.log('R2 evidence',JSON.stringify(observed));
  await shot(p,'queue-summary-same-item-decoding-amended');
  await p.evaluate(()=>decodeWait.forEach(fn=>fn()));
  assert.equal(observed.summaryLoaded,true,'same-item refresh removed a known loaded Now-summary cover while new decode is pending');
 }finally{await clean(p);}
});
test('Wiz diagonal threshold is Euclidean CSS movement and no-op release never mutates occurrence order',async()=>{
 const p=await fixture({height:1300,zoom:1.25});try{
  const at=await start(p);await p.mouse.move(at.x+3*1.25,at.y+3*1.25);assert.equal(await p.locator('.phone-qghost').count(),0);
  await p.mouse.move(at.x+3*1.25,at.y+4*1.25);assert.equal(await p.locator('.phone-qghost').count(),1);
  assert.match((await line(p)).label,/Keep/);await p.mouse.up();await noWrites(p);await assertCleanDrag(p);
 }finally{await clean(p);}
});
test('Wiz upward stationary ancestor autoscroll recomputes prediction and occurrence commit at 80% scale',async()=>{
 const p=await fixture({n:40,zoom:.8});try{
  await p.locator('.item[data-i="30"]').scrollIntoViewIfNeeded();
  const at=await start(p,30),edge=await p.evaluate(()=>desk.getBoundingClientRect().top+12);
  await p.mouse.move(at.x,edge);await p.waitForTimeout(25);const first=await line(p),scroll=await p.evaluate(()=>desk.scrollTop);
  await p.waitForTimeout(220);const next=await line(p);assert.ok(await p.evaluate(s=>desk.scrollTop<s,scroll));assert.ok(next.to<first.to);
  const center=await p.evaluate(()=>desk.getBoundingClientRect().top+60);await p.mouse.move(at.x,center);
  const final=await line(p),before=await p.evaluate(()=>wireQ.map(x=>x.id));await p.mouse.up();await p.waitForFunction(()=>calls.some(c=>c.path==='/queue/move'));
  before.splice(final.to,0,...before.splice(30,1));assert.deepEqual(await p.evaluate(()=>wireQ.map(x=>x.id)),before);await assertCleanDrag(p);
 }finally{await clean(p);}
});


// More than the original repro: exercise response and reconciliation latency,
// rejection, navigation, every phone move entry point and stale poll ordering.
for (const entry of ['pointer','keyboard','menu']) for (const fail of [false,true]) {
 test(`R1 transaction ${entry}: delayed ${fail?'failure':'success'} fences redraw/re-entry until fresh read, then retries the chosen occurrence`,async()=>{
  const p=await fixture({height:1300});try{
   const before=await p.evaluate(()=>S.queue.map(x=>x.id));
   await p.evaluate(fail=>{
    failMove=fail;window.movedOccurrences=[];window.readHolds=[];window.holdReconcile=false;window.moveReleased=false;
    const original=fetch;let ordinal=0;
    window.fetch=async(url,opts={})=>{
     const path=new URL(url,location.href).pathname;
     const move=path.endsWith('/queue/move'),k=move?++ordinal:0;
     if(move){const b=JSON.parse(opts.body);movedOccurrences.push({body:b,movedId:wireQ[b.from].id});}
     const response=await original(url,opts);
     if(k===1){window.firstHeld=true;await new Promise(r=>window.releaseFirstMove=r);moveReleased=true;}
     if(path.endsWith('/stream')&&moveReleased&&holdReconcile)await new Promise(r=>readHolds.push(r));
     return response;
    };
   },fail);
   if(entry==='pointer'){
    const at=await start(p);await p.mouse.move(at.x,at.y+6);
    await p.evaluate(()=>{S.queue=structuredClone(S.queue);drawQueue();});
    const target=await p.locator('.item[data-i="3"]').boundingBox();await p.mouse.move(at.x,target.y+target.height-3);await p.mouse.up();
   } else if(entry==='keyboard') {await p.locator('.qgrip').nth(1).focus();await p.keyboard.press('Alt+ArrowDown');}
   else {await p.locator('.qmore').nth(1).click();await p.locator('[data-qm="down"]').click();}
   await p.waitForFunction(()=>window.firstHeld);
   await p.evaluate(async()=>{
    await refreshQueue(); // server already applied, response still pending: must not ingest
    go('library');go('queue');drawQueue();drawQueue();
   });
   assert.deepEqual(await p.evaluate(()=>S.queue.map(x=>x.id)),before);
   assert.equal(await p.evaluate(()=>S._phoneQueueEdit.pending()),true);
   assert.equal(await p.locator('.qgrip:disabled').count(),6);
   await p.waitForTimeout(470);
   await p.locator('.qgrip').nth(2).dispatchEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true});
   const at=await point(p,2);await p.locator('.qgrip').nth(2).dispatchEvent('pointerdown',{isPrimary:true,button:0,pointerId:88,clientX:at.x,clientY:at.y});
   await p.evaluate(()=>window.dispatchEvent(new PointerEvent('pointerup',{pointerId:88})));
   assert.equal(await p.evaluate(()=>q.engine.active),false);
   await p.locator('.qmore').nth(2).click();
   for(const act of ['play','next','remove','up','down','top','bottom'])assert.equal(await p.locator(`[data-qm="${act}"]`).isDisabled(),true,act);
   assert.equal(await p.locator('[data-qm="favorite"]').isDisabled(),false);
   await p.keyboard.press('Escape');
   await p.locator('.item .t').nth(2).click();
   assert.equal(await p.evaluate(()=>calls.filter(x=>x.path==='/stream/jump').length),0);
   assert.equal(await p.evaluate(()=>movedOccurrences.length),1);
   await p.evaluate(()=>{holdReconcile=true;releaseFirstMove();});
   await p.waitForFunction(()=>readHolds.length===1);
   assert.equal(await p.evaluate(()=>S._phoneQueueEdit.pending()),true,'response alone must not unlock stale indices');
   await p.evaluate(()=>{drawQueue();holdReconcile=false;readHolds.shift()();});
   await p.waitForFunction(()=>!S._phoneQueueEdit.pending());
   assert.deepEqual(await p.evaluate(()=>S.queue.map(x=>x.id)),await p.evaluate(()=>wireQ.map(x=>x.id)));
   if(fail)assert.match(await p.locator('.qresult').textContent(),/Could not reorder/);
   else assert.match(await p.locator('.qresult').textContent(),/Moved/);
   const chosen=await p.evaluate(()=>S.queue[2].id);
   await p.evaluate(()=>failMove=false);await p.locator('.qgrip').nth(2).focus();await p.keyboard.press('Alt+ArrowDown');
   await p.waitForFunction(()=>movedOccurrences.length===2&&!S._phoneQueueEdit.pending());
   assert.equal(await p.evaluate(()=>movedOccurrences[1].movedId),chosen);
   assert.equal(await p.evaluate(()=>S.queue[3].id),chosen);
  }finally{await clean(p);}
 });
}

test('R1 reads begun before or during the write cannot overwrite reconciled order when they arrive late',async()=>{
 const p=await fixture();try{
  await p.evaluate(()=>{
   const original=fetch;let streams=0;
   window.fetch=async(url,opts={})=>{
    const response=await original(url,opts);
    if(new URL(url,location.href).pathname.endsWith('/stream')&&++streams===1){window.staleHeld=true;await new Promise(r=>window.releaseStale=r);}
    return response;
   };
   window.oldRead=refreshQueue();
  });
  await p.waitForFunction(()=>window.staleHeld);
  await p.locator('.qgrip').nth(1).focus();await p.keyboard.press('Alt+ArrowDown');
  await p.waitForFunction(()=>calls.some(x=>x.path==='/queue/move')&&!S._phoneQueueEdit.pending());
  const correct=await p.evaluate(()=>S.queue.map(x=>x.id));
  await p.evaluate(async()=>{releaseStale();await oldRead;});
  assert.deepEqual(await p.evaluate(()=>S.queue.map(x=>x.id)),correct);
  assert.deepEqual(correct,await p.evaluate(()=>wireQ.map(x=>x.id)));
 }finally{await clean(p);}
});

test('R1 ambiguous failure plus failed reconciliation stays fenced until a successful ordinary poll',async()=>{
 const p=await fixture();try{
  await p.evaluate(()=>{
   const original=fetch;window.failRead=true;
   window.fetch=async(url,opts={})=>{
    const path=new URL(url,location.href).pathname;
    if(path.endsWith('/stream')&&failRead)throw Error('offline fixture');
    const response=await original(url,opts);
    if(path.endsWith('/queue/move'))return new Response(JSON.stringify({error:'ambiguous response fixture'}),{status:500});
    return response;
   };
  });
  await p.locator('.qgrip').nth(1).focus();await p.keyboard.press('Alt+ArrowDown');
  await p.waitForFunction(()=>window.refreshError);
  assert.equal(await p.evaluate(()=>S._phoneQueueEdit.pending()),true);
  await p.evaluate(()=>{go('library');go('queue');});
  assert.equal(await p.locator('.qgrip:disabled').count(),6);
  assert.notDeepEqual(await p.evaluate(()=>S.queue.map(x=>x.id)),await p.evaluate(()=>wireQ.map(x=>x.id)));
  await p.evaluate(async()=>{failRead=false;await refreshQueue();});
  assert.equal(await p.evaluate(()=>S._phoneQueueEdit.pending()),false);
  assert.deepEqual(await p.evaluate(()=>S.queue.map(x=>x.id)),await p.evaluate(()=>wireQ.map(x=>x.id)));
  assert.match(await p.locator('.qresult').textContent(),/Could not reorder: ambiguous/);
 }finally{await clean(p);}
});

test('R1 pending ownership survives Now/zone navigation and current-song actions use the same fence',async()=>{
 const p=await fixture();try{
  await p.evaluate(()=>{
   const original=fetch;
   window.fetch=async(url,opts={})=>{const r=await original(url,opts);if(new URL(url,location.href).pathname.endsWith('/queue/move')){window.firstHeld=true;await new Promise(resolve=>window.releaseMove=resolve);}return r;};
  });
  await p.locator('.qgrip').nth(1).focus();await p.keyboard.press('Alt+ArrowDown');await p.waitForFunction(()=>window.firstHeld);
  await p.evaluate(async()=>{
   S._nowZoneKey=Z.current().key;go('now');
   const {openNowSongMenu}=await import('/js/npsongmenu.js');
   window.currentMenu=openNowSongMenu(S,{act},nowc.el.querySelector('.np-phone-more'));
  });
  assert.equal(await p.locator('[data-qm="down"]').isDisabled(),true);
  assert.equal(await p.locator('[data-qm="favorite"]').isDisabled(),false);
  await p.keyboard.press('Escape');
  await p.evaluate(()=>{Z.select('g:2');go('devices');releaseMove();});
  await p.waitForFunction(()=>calls.some(x=>x.path==='/stream'));
  await p.evaluate(()=>{Z.select('g:1');go('queue');});
  assert.equal(await p.evaluate(()=>S._phoneQueueEdit.pending()),true,'reading another zone cannot reconcile the edited zone');
  await p.evaluate(()=>refreshQueue());
  assert.equal(await p.evaluate(()=>S._phoneQueueEdit.pending()),false);
  assert.deepEqual(await p.evaluate(()=>S.queue.map(x=>x.id)),await p.evaluate(()=>wireQ.map(x=>x.id)));
 }finally{await clean(p);}
});

test('R2 last-good art survives unchanged/paused/Queue re-entry but real occurrence/source/zone/stop changes replace it',async()=>{
 const p=await fixture();try{
  await p.waitForFunction(()=>document.querySelector('.qsummary-art')?.classList.contains('loaded'));
  await p.evaluate(()=>{
   window.savedArt=document.querySelector('.qsummary-art');
   const original=HTMLImageElement.prototype.decode;window.decodeWait=[];
   HTMLImageElement.prototype.decode=function(){return new Promise(r=>decodeWait.push(()=>original.call(this).catch(()=>{}).then(r)));};
   S.now=structuredClone(S.now);S.now.state='paused';S.queue=structuredClone(S.queue);drawQueue();go('library');go('queue');
  });
  assert.equal(await p.evaluate(()=>document.querySelector('.qsummary-art')===savedArt&&savedArt.classList.contains('loaded')),true);
  for(const change of ['occurrence','source','zone','stop']){
   await p.evaluate(change=>{
    window.previousArt=document.querySelector('.qsummary-art');
    if(change==='occurrence')S.now.item={...S.now.item,id:'different-occurrence'};
    if(change==='source')S.now.item={...S.now.item,kind:'radio',refId:91,artUrl:'/api/v1/art/radio/91?source=new'};
    if(change==='zone')Z.select('g:2');
    if(change==='stop')S.now.state='stopped';
    drawQueue();
   },change);
   assert.equal(await p.evaluate(()=>document.querySelector('.qsummary-art')===previousArt),false,change);
   if(change==='stop'){
    assert.equal(await p.locator('.qsummary-art').count(),0);
    assert.equal(await p.locator('.qsummary h2').textContent(),'Nothing playing');
   } else assert.equal(await p.locator('.qsummary-art.loaded').count(),0,'must not project prior-source loaded cover');
  }
  await p.evaluate(()=>{decodeWait.forEach(fn=>fn());});await p.waitForTimeout(30);
  assert.equal(await p.locator('.qsummary-art').count(),0,'late old decode cannot resurrect stopped art');
  await p.evaluate(()=>{S.now.state='playing';drawQueue();});
  assert.equal(await p.evaluate(()=>document.querySelector('.qsummary-art')===savedArt),false,'resume after stop starts the correct source anew');
 }finally{await clean(p);}
});


test('R1 late poll begun during a held write stays invalid even after the transaction has been reconciled',async()=>{
 const p=await fixture();try{
  await p.evaluate(()=>{
   const original=fetch;window.streams=0;
   window.fetch=async(url,opts={})=>{
    const path=new URL(url,location.href).pathname;
    if(path.endsWith('/queue/move')){
     window.writeHeld=true;await new Promise(r=>window.releaseWrite=r);
    }
    const response=await original(url,opts);
    if(path.endsWith('/stream')&&++streams===1){window.pollHeld=true;await new Promise(r=>window.releasePoll=r);}
    return response;
   };
  });
  await p.locator('.qgrip').nth(1).focus();await p.keyboard.press('Alt+ArrowDown');await p.waitForFunction(()=>window.writeHeld);
  await p.evaluate(()=>{window.oldPoll=refreshQueue();});await p.waitForFunction(()=>window.pollHeld);
  await p.evaluate(()=>releaseWrite());await p.waitForFunction(()=>!S._phoneQueueEdit.pending());
  const correct=await p.evaluate(()=>S.queue.map(x=>x.id));assert.equal(correct[2],'occ-1');
  await p.evaluate(async()=>{releasePoll();await oldPoll;});
  assert.deepEqual(await p.evaluate(()=>S.queue.map(x=>x.id)),correct);
 }finally{await clean(p);}
});

// Incorporated Wiz P5 R1 probe, with the actual Queue show/hide/router wiring.
test('P5 Wiz R1: return to actual Queue must restore live grip and ellipsis bindings after hide teardown',async()=>{
 const p=await fixture({height:1300});try{
  await p.evaluate(()=>{S.now.state='paused';drawQueue();nowc.draw();});
  await p.locator('.qmore').first().click();assert.equal(await p.locator('.qmenu').count(),1);await p.keyboard.press('Escape');
  const before=await p.evaluate(()=>({engine:!!q.engine,root:views.queue.el}));
  await p.locator('.mini-open').click();assert.equal(await p.evaluate(()=>S.view),'now');
  await p.locator('.np-phone-collapse').click();assert.equal(await p.evaluate(()=>S.view),'queue');
  const beforeDrag=await p.evaluate(()=>({engine:!!q.engine,rows:document.querySelectorAll('.qlist>.item').length}));
  const at=await start(p,0);await p.mouse.move(at.x,at.y+8);const active=await p.locator('.phone-qghost').count();await p.mouse.up();
  // The live engine correctly suppresses the 450ms post-drag click tail.
  await p.waitForFunction(()=>!q.engine?.blocked());
  await p.locator('.qmore').first().click();const menu=await p.locator('.qmenu').count();
  console.log('P5 R1 evidence',JSON.stringify({beforeEngine:before.engine,after:beforeDrag,dragGhosts:active,ellipsisMenus:menu}));
  assert.equal(beforeDrag.engine,true,'collapse retained Queue DOM after hide destroyed its engine; must restore functioning bindings');
  assert.equal(active,1);assert.equal(menu,1);
 }finally{await clean(p);}
});


test('P5 R1 retained actual Queue returns exact row/form/focus/scroll but never canceled drag or menu ownership',async()=>{
 const p=await fixture({height:568,n:30});try{
  await p.evaluate(()=>{S.now.state='paused';drawQueue();nowc.draw();});
  const at=await start(p,0);await p.mouse.move(at.x,at.y+8);assert.equal(await p.locator('.phone-qghost').count(),1);
  await p.evaluate(()=>go('now'));await p.mouse.up();await assertCleanDrag(p);
  await p.locator('.np-phone-collapse').click();await assertCleanDrag(p);
  await p.waitForTimeout(470); // complete the canceled gesture's bounded tail guard
  await p.locator('.qmore').first().click();assert.equal(await p.locator('.qmenu').count(),1);
  await p.evaluate(()=>go('now'));assert.equal(await p.locator('.qmenu').count(),0);
  await p.locator('.np-phone-collapse').click();assert.equal(await p.locator('.qmenu').count(),0);
  await p.locator('.qsave-open').click();await p.locator('.qsave input').fill('Unfinished playlist');
  await p.evaluate(()=>{document.querySelector('.qsave input').focus({preventScroll:true});desk.scrollTop=150;window.retained={form:document.querySelector('.qsave'),row:document.querySelector('.qlist>.item'),focus:document.activeElement,top:desk.scrollTop,engine:q.engine,clock:S._smooth,writes:msWrites};});
  for(let i=0;i<3;i++){
   await p.evaluate(()=>go('now'));assert.equal(await p.evaluate(()=>q.engine),null);
   await p.locator('.np-phone-collapse').click();
   assert.equal(await p.evaluate(()=>document.querySelector('.qsave')===retained.form&&document.querySelector('.qlist>.item')===retained.row&&document.activeElement===retained.focus&&desk.scrollTop===retained.top&&S._smooth===retained.clock&&msWrites===retained.writes&&q.engine!==retained.engine&&!!q.engine&&!q.engine.active&&audioStarts===0),true);
   assert.equal(await p.locator('.qsave input').inputValue(),'Unfinished playlist');await assertCleanDrag(p);
  }
  await noWrites(p);
  await p.locator('.qgrip').nth(2).focus();await p.keyboard.press('Alt+ArrowDown');
  await p.waitForFunction(()=>calls.some(c=>c.path==='/queue/move')&&!S._phoneQueueEdit.pending());
  assert.equal(await p.evaluate(()=>calls.filter(c=>c.path==='/queue/move').length),1,'no duplicate restored listeners');
 }finally{await clean(p);}
});

test('P5 R1 retained Queue revalidates data/access/lock changes while full Now is open',async()=>{
 const p=await fixture({height:1300});try{
  await p.evaluate(async()=>{go('now');wireQ=wireQ.slice(1);await refreshQueue();lockQueue();S.auth.role='view';});
  await p.locator('.np-phone-collapse').click();assert.equal(await p.locator('.qlist>.item').count(),5);
  assert.equal(await p.locator('.qgrip:disabled').count(),5);assert.equal(await p.locator('.qmore').count(),0);
  await assertCleanDrag(p);await noWrites(p);
 }finally{await clean(p);}
});

test('P5 R3 linked visual choice cannot evade the retained P3 transaction fence for the same playback queue',async()=>{
 const p=await fixture();try{
  await p.evaluate(()=>{
   S.groups[1].playbackId=S.groups[0].playbackId;Z.sync();
   const original=fetch;window.fetch=async(url,opts={})=>{const r=await original(url,opts);if(new URL(url,location.href).pathname.endsWith('/queue/move')){window.moveHeld=true;await new Promise(resolve=>window.releaseMove=resolve);}return r;};
  });
  await p.locator('.qgrip').nth(1).focus();await p.keyboard.press('Alt+ArrowDown');await p.waitForFunction(()=>window.moveHeld);
  await p.evaluate(()=>{go('now');Z.select('g:2');nowc.draw();});
  assert.equal(await p.evaluate(()=>S._phoneQueueEdit.pending()),true);
  await p.locator('.np-phone-more').click();assert.equal(await p.locator('[data-qm=remove]').isDisabled(),true);assert.equal(await p.locator('[data-qm=favorite]').isDisabled(),false);await p.keyboard.press('Escape');
  await p.locator('.np-phone-collapse').click();assert.equal(await p.locator('.qgrip:disabled').count(),6);
  await p.evaluate(()=>releaseMove());await p.waitForFunction(()=>!S._phoneQueueEdit.pending());
  assert.equal(await p.locator('.qgrip:disabled').count(),0);
  assert.deepEqual(await p.evaluate(()=>S.queue.map(q=>q.id)),await p.evaluate(()=>wireQ.map(q=>q.id)));
 }finally{await clean(p);}
});

// B1/B2: Wiz combined HOLD variants, retaining the real-ingest fixture and all prior cases.
test('Wiz amend variant: enabled locked-Queue Play next keeps its original action policy rather than silently becoming no-op',async()=>{
 const p=await fixture();try{
  await p.evaluate(()=>{lockQueue();drawQueue();});await p.locator('.qmore').nth(2).click();
  const disabled=await p.locator('.qmenu [data-qm=next]').isDisabled();assert.equal(disabled,false,'original Queue policy permits this enabled action');
  await p.locator('.qmenu [data-qm=next]').click();await p.waitForTimeout(70);
  const moves=await p.evaluate(()=>calls.filter(c=>c.path==='/queue/move'));console.log('locked Play next evidence',JSON.stringify({disabled,moves}));
  assert.equal(moves.length,1,'enabled existing Play next must still dispatch the proper move while other lock-restricted moves stay forbidden');
  assert.deepEqual(moves[0].body,{from:2,to:1});
 }finally{await clean(p);}
});
test('Wiz amend variant: a read started wide during a phone edit cannot restore stale indices after returning narrow and settling',async()=>{
 const p=await fixture({height:1300});try{
  await p.evaluate(()=>{
   const original=fetch;window.movedOccurrences=[];window.oldOrder=structuredClone(S.queue);window.oldIds=oldOrder.map(q=>q.id);let first=true;
   window.fetch=async(url,opts={})=>{
    const path=new URL(url,location.href).pathname.replace('/api/v1','');
    if(path==='/queue/move'){const b=JSON.parse(opts.body);movedOccurrences.push({body:b,id:wireQ[b.from].id});}
    if(path==='/queue/move'&&first){first=false;window.moveHeld=true;await new Promise(r=>window.applyMove=r);return original(url,opts);}
    if(path==='/stream'&&window.holdWideRead){window.holdWideRead=false;window.wideReadHeld=true;await new Promise(r=>window.deliverWideRead=r);return new Response(JSON.stringify({now:S.now,queue:{items:oldOrder}}),{status:200});}
    return original(url,opts);
   };
   window.firstEdit=S._phoneQueueEdit.run('/queue/move',{from:0,to:3});
  });await p.waitForFunction(()=>moveHeld);
  await p.setViewportSize({width:1000,height:1300});
  await p.evaluate(()=>{q.hidePhoneQueue();views.queue.el.remove();S.view='library';desk.dataset.view='library';holdWideRead=true;window.oldWideRead=refreshQueue();});
  await p.waitForFunction(()=>wideReadHeld);
  await p.setViewportSize({width:390,height:1300});await p.evaluate(()=>go('queue'));
  await p.evaluate(async()=>{applyMove();await firstEdit;});
  const fresh=await p.evaluate(()=>({ids:S.queue.map(q=>q.id),pending:S._phoneQueueEdit.pending()}));assert.equal(fresh.pending,false);assert.notDeepEqual(fresh.ids,await p.evaluate(()=>oldIds));
  await p.evaluate(async()=>{deliverWideRead();await oldWideRead;});
  const after=await p.evaluate(()=>({ids:S.queue.map(q=>q.id),pending:S._phoneQueueEdit.pending(),server:wireQ.map(q=>q.id)}));
  const chosen=await p.evaluate(()=>S.queue[2].id);await p.locator('.qgrip').nth(2).focus();await p.keyboard.press('Alt+ArrowDown');await p.waitForFunction(()=>movedOccurrences.length===2);
  const moves=await p.evaluate(()=>movedOccurrences);console.log('wide to narrow stale-read evidence',JSON.stringify({fresh,after,chosen,moves}));
  assert.deepEqual(after.ids,after.server,'late wide-started read must not poison the now-phone reconciled occurrence order');
  assert.equal(chosen,'occ-3');assert.equal(moves[1].id,chosen,'second action must move its selected occurrence, not a stale index');
  await p.waitForFunction(()=>!S._phoneQueueEdit.pending());assert.equal(await p.evaluate(()=>wireQ[3].id),chosen);
 }finally{await clean(p);}
});
test('Wiz amend variant: delayed rejected removal, navigation and a concurrent poll keep the fence until fresh evidence, then one retry uses the chosen occurrence',async()=>{
 const p=await fixture();try{
  await p.evaluate(()=>{
   const original=fetch;window.writes=[];let first=true;
   window.fetch=async(url,opts={})=>{
    const path=new URL(url,location.href).pathname.replace('/api/v1','');
    if(opts.method==='DELETE'&&path==='/queue/2'){writes.push({path,id:wireQ[2].id});if(first){first=false;wireQ.splice(2,1);window.removeHeld=true;await new Promise(r=>window.releaseRemove=r);return new Response(JSON.stringify({error:'ambiguous applied removal'}),{status:500});}}
    return original(url,opts);
   };
  });
  await p.locator('.qmore').nth(2).click();await p.locator('.qmenu [data-qm=remove]').click();await p.waitForFunction(()=>removeHeld);
  await p.evaluate(async()=>{go('now');await refreshQueue();go('now:collapse');drawQueue();});
  assert.equal(await p.evaluate(()=>S._phoneQueueEdit.pending()),true);assert.equal(await p.locator('.qgrip').first().isDisabled(),true);
  await p.evaluate(()=>releaseRemove());await p.waitForFunction(()=>!S._phoneQueueEdit.pending());
  assert.deepEqual(await p.evaluate(()=>S.queue.map(q=>q.id)),await p.evaluate(()=>wireQ.map(q=>q.id)));
  const chosen=await p.evaluate(()=>S.queue[2].id);await p.locator('.qgrip').nth(2).focus();await p.keyboard.press('Alt+ArrowDown');
  await p.waitForFunction(()=>calls.some(c=>c.path==='/queue/move'));
  const retry=await p.evaluate(()=>wireQ[3].id);console.log('rejected removal retry evidence',JSON.stringify({chosen,retry}));assert.equal(retry,chosen);
 }finally{await clean(p);}
});
test('Wiz amend variant: slow decode plus paused Now collapse and failed ordinary read never discards same-item summary artwork',async()=>{
 const p=await fixture();try{
  await p.waitForFunction(()=>document.querySelector('.qsummary-art')?.classList.contains('loaded'));
  const result=await p.evaluate(async()=>{
   const art=document.querySelector('.qsummary-art'),originalDecode=HTMLImageElement.prototype.decode;window.decodeWait=[];
   HTMLImageElement.prototype.decode=function(){return new Promise(r=>decodeWait.push(()=>originalDecode.call(this).catch(()=>{}).then(r)));};
   S.now.state='paused';drawQueue();go('now');
   const original=fetch;window.fetch=async(url,o)=>new URL(url,location.href).pathname.endsWith('/stream')?new Response('{}',{status:503}):original(url,o);
   await refreshQueue();go('now:collapse');drawQueue();
   const same=art===document.querySelector('.qsummary-art'),loaded=document.querySelector('.qsummary-art').classList.contains('loaded');
   decodeWait.forEach(f=>f());return {same,loaded,refreshError};
  });console.log('paused slow-art failure evidence',JSON.stringify(result));assert.equal(result.same,true);assert.equal(result.loaded,true);
 }finally{await clean(p);}
});


test('B1 wide-started pre-edit read is generation-fenced on phone after reconciliation and retry moves the chosen occurrence',async()=>{
 const p=await fixture({height:1300});try{
  await p.setViewportSize({width:901,height:1300});
  await p.evaluate(()=>{
   q.hidePhoneQueue();views.queue.el.remove();S.view='library';desk.dataset.view='library';
   const original=fetch;let first=true;window.moves=[];
   window.fetch=async(url,opts={})=>{
    const path=new URL(url,location.href).pathname;
    if(path.endsWith('/queue/move')){const b=JSON.parse(opts.body);moves.push({body:b,id:wireQ[b.from].id});}
    const response=await original(url,opts);
    if(path.endsWith('/stream')&&first){first=false;window.readHeld=true;await new Promise(r=>window.releaseOldRead=r);}
    return response;
   };
   window.oldWideRead=refreshQueue();
  });await p.waitForFunction(()=>window.readHeld);
  await p.setViewportSize({width:900,height:1300});
  await p.evaluate(async()=>{go('queue');await S._phoneQueueEdit.run('/queue/move',{from:0,to:3});});
  assert.equal(await p.evaluate(()=>S._phoneQueueEdit.pending()),false);
  await p.evaluate(async()=>{releaseOldRead();await oldWideRead;});
  assert.deepEqual(await p.evaluate(()=>S.queue.map(q=>q.id)),await p.evaluate(()=>wireQ.map(q=>q.id)));
  const chosen=await p.evaluate(()=>S.queue[2].id);
  await p.locator('.qgrip').nth(2).focus();await p.keyboard.press('Alt+ArrowDown');
  await p.waitForFunction(()=>moves.length===2&&!S._phoneQueueEdit.pending());
  assert.equal(await p.evaluate(()=>moves[1].id),chosen);assert.equal(await p.evaluate(()=>wireQ[3].id),chosen);
 }finally{await clean(p);}
});

for(const fail of [false,true])test(`B1 phone-started read consumed wide remains fenced; ${fail?'failed':'successful'} write completing wide reconciles safely on phone re-entry`,async()=>{
 const p=await fixture({height:1300});try{
  await p.evaluate(fail=>{
   failMove=fail;const original=fetch;let firstRead=true;
   window.fetch=async(url,opts={})=>{
    const path=new URL(url,location.href).pathname;
    if(path.endsWith('/queue/move')){window.writeHeld=true;await new Promise(r=>window.releaseWrite=r);}
    const response=await original(url,opts);
    if(path.endsWith('/stream')&&firstRead){firstRead=false;window.readHeld=true;await new Promise(r=>window.releaseRead=r);}
    return response;
   };
   window.editPromise=S._phoneQueueEdit.run('/queue/move',{from:0,to:3});
   window.oldPhoneRead=refreshQueue();
  },fail);await p.waitForFunction(()=>window.writeHeld&&window.readHeld);
  await p.setViewportSize({width:901,height:1300});
  await p.evaluate(async()=>{
   q.hidePhoneQueue();views.queue.el.remove();S.view='library';desk.dataset.view='library';
   S.queue=[];releaseRead();await oldPhoneRead;
  });
  assert.deepEqual(await p.evaluate(()=>S.queue),[],'narrow-start read still cannot bypass its pending fence by ending wide');
  await p.evaluate(async()=>{releaseWrite();await editPromise;});
  assert.equal(await p.evaluate(()=>S._phoneQueueEdit.pending()),true,'steady-wide ingest does not settle phone transactions');
  await p.setViewportSize({width:900,height:1300});await p.evaluate(()=>go('queue'));
  assert.equal(await p.locator('.qgrip:disabled').count(),6);
  await p.evaluate(()=>refreshQueue());assert.equal(await p.evaluate(()=>S._phoneQueueEdit.pending()),false);
  assert.deepEqual(await p.evaluate(()=>S.queue.map(q=>q.id)),await p.evaluate(()=>wireQ.map(q=>q.id)));
  if(fail)assert.match(await p.locator('.qresult').textContent(),/Could not reorder/);
  await assertCleanDrag(p);
 }finally{await clean(p);}
});

test('B1 steady-wide stream ingest retains desktop policy: phone route/read guards and settlement are not opted in',async()=>{
 const p=await fixture();try{
  await p.setViewportSize({width:901,height:800});
  await p.evaluate(()=>{
   q.hidePhoneQueue();S.view='library';
   const original=fetch;
   window.fetch=async(url,opts={})=>{
    const response=await original(url,opts);
    if(new URL(url,location.href).pathname.endsWith('/stream')){window.readHeld=true;await new Promise(r=>window.releaseRead=r);}
    return response;
   };
   S._phoneQueueEdit.canRead=()=>{throw Error('unexpected desktop phone guard');};
   S._phoneQueueEdit.didRead=()=>{throw Error('unexpected desktop phone settlement');};
   window.oldRoute=S._streamRoute;window.desktopRead=refreshQueue();
  });await p.waitForFunction(()=>window.readHeld);
  await p.evaluate(async()=>{S.queue=[];Z.select('g:2');releaseRead();await desktopRead;});
  assert.equal(await p.evaluate(()=>S.queue.length),6);
  assert.equal(await p.evaluate(()=>S._nowRoute===oldRoute),true);
  assert.equal(await p.evaluate(()=>window.refreshError),undefined);
 }finally{await clean(p);}
});

for(const fail of [false,true])test(`B2 locked Play next delayed ${fail?'failure':'success'} preserves pending/reconciliation guards, then dispatches the selected retry`,async()=>{
 const p=await fixture();try{
  await p.evaluate(fail=>{
   lockQueue();drawQueue();failMove=fail;const original=fetch;let first=true;window.nextMoves=[];
   window.fetch=async(url,opts={})=>{
    const path=new URL(url,location.href).pathname;
    if(path.endsWith('/queue/move')){const b=JSON.parse(opts.body);nextMoves.push({body:b,id:wireQ[b.from].id});if(first){first=false;window.writeHeld=true;await new Promise(r=>window.releaseWrite=r);window.holdReconcile=true;}}
    const response=await original(url,opts);
    if(path.endsWith('/stream')&&window.holdReconcile){holdReconcile=false;window.readHeld=true;await new Promise(r=>window.releaseRead=r);}
    return response;
   };
  },fail);
  await p.locator('.qmore').nth(2).click();await p.locator('[data-qm=next]').click();await p.waitForFunction(()=>window.writeHeld);
  assert.deepEqual(await p.evaluate(()=>nextMoves[0].body),{from:2,to:1});
  await p.evaluate(async()=>{go('now');go('now:collapse');await refreshQueue();});
  assert.equal(await p.evaluate(()=>S._phoneQueueEdit.pending()),true);
  await p.locator('.qmore').nth(2).click();
  for(const act of ['play','next','remove','up','down','top','bottom'])assert.equal(await p.locator(`[data-qm=${act}]`).isDisabled(),true,act);
  assert.equal(await p.locator('[data-qm=favorite]').isDisabled(),false);await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(()=>S._phoneQueueEdit.run('/queue/move',{from:3,to:1},'POST','next')),false);
  assert.equal(await p.evaluate(()=>nextMoves.length),1);
  await p.evaluate(()=>releaseWrite());await p.waitForFunction(()=>window.readHeld);
  assert.equal(await p.evaluate(()=>S._phoneQueueEdit.pending()),true,'write response alone is insufficient');
  await p.evaluate(()=>releaseRead());await p.waitForFunction(()=>!S._phoneQueueEdit.pending());
  assert.deepEqual(await p.evaluate(()=>S.queue.map(q=>q.id)),await p.evaluate(()=>wireQ.map(q=>q.id)));
  if(fail)assert.match(await p.locator('.qresult').textContent(),/Could not reorder/);
  assert.equal(await p.locator('.qgrip:disabled').count(),6,'ordinary moves remain locked');
  const chosen=await p.evaluate(()=>S.queue[2].id);await p.evaluate(()=>failMove=false);
  await p.locator('.qmore').nth(2).click();assert.equal(await p.locator('[data-qm=next]').isDisabled(),false);
  for(const act of ['remove','up','down','top','bottom'])assert.equal(await p.locator(`[data-qm=${act}]`).isDisabled(),true,act);
  await p.locator('[data-qm=next]').click();await p.waitForFunction(()=>nextMoves.length===2&&!S._phoneQueueEdit.pending());
  assert.equal(await p.evaluate(()=>nextMoves[1].id),chosen);assert.equal(await p.evaluate(()=>wireQ[1].id),chosen);
 }finally{await clean(p);}
});

test('B2 lock applied after menu opens blocks ordinary moves/remove, not applicable Play next; access gate still wins',async()=>{
 const p=await fixture();try{
  for(const action of ['remove','up','down','top','bottom']){
   await p.evaluate(()=>{unlockQueue();drawQueue();});await p.locator('.qmore').nth(2).click();await p.evaluate(()=>lockQueue());
   await p.locator(`[data-qm=${action}]`).click();await noWrites(p);
  }
  for(const [path,body,method,action] of [['/queue/move',{from:2,to:1},'POST',null],['/queue/2',null,'DELETE','next']]){
   assert.equal(await p.evaluate(args=>S._phoneQueueEdit.run(...args),[path,body,method,action]),false);
  }
  await p.evaluate(()=>{unlockQueue();drawQueue();});await p.locator('.qmore').nth(2).click();await p.evaluate(()=>{lockQueue();S.auth.role='view';});
  await p.locator('[data-qm=next]').click();await noWrites(p);
  await p.evaluate(()=>{S.auth.role='admin';unlockQueue();drawQueue();});await p.locator('.qmore').nth(2).click();await p.evaluate(()=>lockQueue());
  await p.locator('[data-qm=next]').click();await p.waitForFunction(()=>calls.some(c=>c.path==='/queue/move')&&!S._phoneQueueEdit.pending());
  assert.deepEqual(await p.evaluate(()=>calls.find(c=>c.path==='/queue/move').body),{from:2,to:1});
 }finally{await clean(p);}
});

// F252-amend2: Wiz retained-route resume failures — complete signature on qResume.
test('F252-amend2: retained Now return refreshes non-current remote badge after fresh JSON',async()=>{
 const p=await fixture();try{
  await p.evaluate(async()=>{
   S.now.state='paused';wireQ[3].source='remote';wireQ[3].sourceLabel='Old remote server';
   S.queue=structuredClone(wireQ);drawQueue();await refreshQueue();
  });
  await p.evaluate(()=>{window.oldRow=document.querySelector('.item[data-i="3"]');window.oldImage=oldRow.querySelector('img');go('now');});
  await p.evaluate(async()=>{wireQ[3].sourceLabel='Renamed remote server';await refreshQueue();});
  await p.evaluate(()=>go('now:collapse'));
  const state=await p.evaluate(()=>({view:S.view,model:S.queue[3].sourceLabel,badge:document.querySelector('.item[data-i="3"] .qsrcpill').textContent,sameRow:oldRow===document.querySelector('.item[data-i="3"]'),audioStarts}));
  assert.equal(state.view,'queue');assert.equal(state.model,'Renamed remote server');
  assert.equal(state.badge,'Renamed remote server','qResume must not certify stale badge chrome');
  assert.equal(state.sameRow,false,'changed metadata forces full paint');assert.equal(state.audioStarts,0);
 }finally{await clean(p);}
});
test('F252-amend2: retained Now return refreshes selected-zone name and choices inventory',async()=>{
 const p=await fixture();try{
  await p.evaluate(async()=>{S.now.state='paused';drawQueue();await refreshQueue();});
  await p.evaluate(()=>go('now'));
  await p.evaluate(async()=>{
   S.groups[0].name='Renamed Den';
   S.groups.push({id:3,name:'New Kitchen',playbackId:'kitchen',online:true,deviceIds:[]});
   Z.sync();await refreshQueue();
  });
  await p.evaluate(()=>go('now:collapse'));
  const state=await p.evaluate(()=>({view:S.view,choiceNames:Z.choicesNow().map(c=>c.name),options:[...document.querySelector('.qzpick').options].map(o=>({key:o.value,text:o.textContent})),caption:document.querySelector('.qsummary').textContent,audioStarts}));
  assert.equal(state.view,'queue');
  assert.match(state.caption,/On Renamed Den/);
  assert.ok(state.options.some(o=>o.key==='g:3'&&o.text.includes('New Kitchen')),JSON.stringify(state.options));
  assert.equal(state.audioStarts,0);
 }finally{await clean(p);}
});

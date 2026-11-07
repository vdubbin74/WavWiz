// F250-P6: shipped qreorder/queuemenu/Now/art + verbatim main compact renderer,
// hide/zone/route integration and full CSS. Fake API/music; not a running server,
// WebKit or physical-device/OS lock-screen proof.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync} from 'node:fs';
import {localDom} from './helpers/local-dom.mjs';
const main=readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/main.js',import.meta.url),'utf8');
const queueSource=main.slice(main.indexOf('let qReorder = null'),main.indexOf('\nboot();'));
const refreshSource=main.slice(main.indexOf('async function refreshNow()'),main.indexOf('async function refreshZones()'));
const goSource=main.slice(main.indexOf('export function go('),main.indexOf('const checklistGo')).replace('export ','');
const css=readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css',import.meta.url),'utf8');
const evidence=process.env.F250_P6_EVIDENCE_DIR;if(evidence)mkdirSync(evidence,{recursive:true});
const baseRef=process.env.F250_P6_BASE_REF;
const baseAssets=baseRef?Object.fromEntries(['app.css','js/ui.js','js/queuemenu.js','js/npsongmenu.js','js/library.js'].map(file=>[file,execFileSync('git',['show',baseRef+':src/WavWiz.Server/wwwroot/'+file],{encoding:'utf8'})])):null;
let dom;before(async()=>{dom=await localDom();});after(async()=>{await dom?.close();});
async function fixture({width=390,height=844,n=6,role='admin',zoom=1,parent=false}={}){
  const p=await dom.page({width,height});p.errors=[];p.on('pageerror',e=>p.errors.push(e.stack));
  await p.emulateMedia({reducedMotion:'reduce'});
  if(parent && baseAssets){for(const [file,body] of Object.entries(baseAssets))await p.route('**/'+file,r=>r.fulfill({contentType:file.endsWith('.css')?'text/css':'text/javascript',body}));await p.reload();}
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
      else if(path==='/playlists')value=method==='POST'?{id:8}:[{id:7,name:'Fixture playlist',count:2}];
      else if(/^\/playlists\/\d+\/items$/.test(path))value={added:1};
      else if(/^\/queue\/\d+$/.test(path)&&method==='DELETE')wireQ.splice(+path.split('/').at(-1),1);
      else if(path==='/library/albums')value=[{album:'Fixture album',artist:'Fixture artist',artTrackId:501,tracks:2}];
      else if(path==='/library/tracks')value=[{id:501,title:'Library song',artist:'Library artist',album:'Fixture album',durationMs:180000}];
      else if(path==='/remote/servers')value={servers:[{id:'remote-fixture',label:'Remote fixture'}]};
      else if(path==='/remote/remote-fixture/albums')value=[{id:'remote-album',album:'Remote album',artist:'Remote artist',tracks:1}];
      else if(path==='/remote/remote-fixture/album/remote-album')value={album:{album:'Remote album',artist:'Remote artist'},songs:[{id:'remote-id',title:'Remote song',artist:'Remote artist'}]};
      else if(path==='/checklist')value={dismissed:true,remaining:0};
      return new Response(JSON.stringify(value),{status:200});
    };
    const {h,api,toast,fmtDur}=await import('/js/util.js'),{icon}=await import('/js/icons.js'),{npCover,artCv}=await import('/js/art.js'),{canControl}=await import('/js/ui.js');
    const {attachReorder,canDragRows}=await import('/js/qreorder.js'),{attachQueueMenu,openQueueMenu}=await import('/js/queuemenu.js'),{srcPill}=await import('/js/listtable.js');
    const {loadLayout,saveLayout,setLocked}=await import('/js/plcols.js'),{keepControl,openRecentQueues}=await import('/js/queuetools.js'),{clearQueueFlow}=await import('/js/queueclear.js'),{wsel}=await import('/js/wwselect.js');
    const Z=window.Z=await import('/js/zones40.js'),{createNow}=await import('/js/now.js');
    window.S={auth:{role},view:'queue',queue:structuredClone(wireQ),now:{item:wireQ[0]||null,index:0,state:n?'playing':'stopped',positionMs:45000,durationMs:180000,version:1},localPos:45000,localAt:performance.now(),groups:[{id:1,name:'Fixture Den',playbackId:'den',online:true,deviceIds:[]},{id:2,name:'Fixture Patio',playbackId:'patio',online:true,deviceIds:[]}],zones:[],status:{}};
    Z.init(S,{});
    const act=window.act=(path,body,method='POST')=>api(path,{body,method});
    let refreshNow;
    const refreshAll=async()=>{await refreshNow();};
    const showInLibrary=(title,item)=>{window.libraryCall={title,item};};
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copied=text}});
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
    window.openDesktop=()=>openQueueMenu(S,{showInLibrary,refreshAll},2,{x:180,y:150});
    window.mountLibrary=async()=>{q.hidePhoneQueue();const {libraryView}=await import('/js/library.js');const lib=window.lib=libraryView(S,{phone:true});views.library=lib;go('library');await lib.reload();};
    window.snapshot={now:nowc,mini:nowc.mini,pos:S.localPos,at:S.localAt,writes:msWrites};
  },{queueSource,goSource,refreshSource,n,role,zoom});
  await p.waitForFunction(()=>[...document.querySelectorAll('.mini img')].every(e=>e.complete));
  await p.waitForTimeout(50);
  await p.evaluate(()=>snapshot.writes=msWrites);
  return p;
}
async function clean(p){try{assert.deepEqual(p.errors,[]);}finally{await p.context().close();}}
async function shot(p,name){if(evidence){await p.waitForFunction(()=>[...document.querySelectorAll('.songsheet-art img')].every(e=>e.complete&&e.naturalWidth>0&&e.closest('.cover').classList.contains('loaded')));await p.screenshot({path:evidence+'/'+name+'.png',animations:'disabled'});}}
async function point(p,i=0){return p.locator(`.qlist>.item[data-i="${i}"]>.qgrip`).evaluate(el=>{el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});}
async function start(p,i=0){const at=await point(p,i);await p.mouse.move(at.x,at.y);await p.mouse.down();return at;}
async function line(p){return p.locator('.phone-qins').evaluate(e=>({from:+e.dataset.from,to:+e.dataset.to,at:+e.dataset.at,label:e.textContent,top:e.getBoundingClientRect().top}));}
async function touch(p,selector,type='touchstart',dx=0,dy=0){await p.locator(selector).dispatchEvent(type,{touches:type==='touchend'?[]:[{identifier:11,clientX:20+dx,clientY:200+dy}],changedTouches:[{identifier:11,clientX:20+dx,clientY:200+dy}],bubbles:true,cancelable:true});}
async function noWrites(p){assert.deepEqual(await p.evaluate(()=>calls.filter(c=>['/queue/move','/stream/jump'].includes(c.path)||c.method==='DELETE')),[]);}
async function assertCleanDrag(p){assert.equal(await p.evaluate(()=>!!document.querySelector('.phone-qghost,.phone-qins,.item.dragging')||!!q.engine?.active),false);}


const ids=['play','next','remove','up','down','top','bottom','playlist','favorite','library','copy'];
const menu=p=>p.locator('dialog.songsheet[open]');
async function open(p,i=2){await p.locator(`.qlist>.item[data-i="${i}"] .qmore`).click();await menu(p).waitFor();}
async function action(p,id){await p.locator(`.songsheet-actions [data-qm="${id}"]`).click();}
const writes=p=>p.evaluate(()=>calls.filter(c=>c.method!=='GET'&&/^\/(queue|stream|favorites|playlists)(\/|$)/.test(c.path)));

for(const [id,path,body,method] of [
 ['play','/stream/jump',{index:2},'POST'],['next','/queue/move',{from:2,to:1},'POST'],
 ['remove','/queue/2',null,'DELETE'],['up','/queue/move',{from:2,to:1},'POST'],
 ['down','/queue/move',{from:2,to:3},'POST'],['top','/queue/move',{from:2,to:0},'POST'],
 ['bottom','/queue/move',{from:2,to:5},'POST']])test('P6 complete Queue sheet dispatch/result: '+id,async()=>{
 const p=await fixture();try{
  const before=await p.evaluate(()=>wireQ.map(x=>x.id));await open(p);
  assert.deepEqual(await p.locator('.qmenu [data-qm]').evaluateAll(es=>es.map(e=>e.dataset.qm)),ids);
  assert.equal(await p.locator('.songsheet-meta h2').textContent(),'P3 song 2');
  assert.equal(await p.locator('.songsheet-meta .dim').textContent(),'API fixture artist');
  assert.equal(await p.locator('.songsheet-art img').count(),1);
  await action(p,id);await p.waitForFunction(()=>calls.some(c=>c.method!=='GET'));
  const w=(await writes(p)).at(-1);assert.deepEqual(w,{path,query:'?zoneId=den',method,body});
  if(id==='remove')before.splice(2,1);else if(body?.from!=null)before.splice(body.to,0,...before.splice(body.from,1));
  assert.deepEqual(await p.evaluate(()=>wireQ.map(x=>x.id)),before);
  assert.equal(await menu(p).count(),0);
 }finally{await clean(p);}
});

test('P6 Queue Favorite identity/Add+Remove+rollback, Show in Library, Copy title all real runners',async()=>{
 const p=await fixture();try{
  await open(p,1);await action(p,'favorite');assert.deepEqual((await writes(p)).at(-1),{path:'/favorites',query:'',method:'PUT',body:{kind:'track',ref:'101',on:true}});
  await open(p,0);assert.equal(await p.locator('[data-qm=favorite]').textContent(),'Remove from Favorites');await action(p,'favorite');assert.equal((await writes(p)).at(-1).body.on,false);
  // Existing Favorite controller rolls back a failed server write.
  await p.evaluate(()=>{const f=fetch;window.fetch=async(u,o={})=>String(u).includes('/favorites')&&o.method==='PUT'?new Response(JSON.stringify({error:'fixture failure'}),{status:500}):f(u,o);});
  await open(p,0);await action(p,'favorite');await p.waitForTimeout(50);await open(p,1);assert.equal(await p.locator('[data-qm=favorite]').textContent(),'Add to Favorites');await p.keyboard.press('Escape');
  await open(p,2);await action(p,'library');assert.equal(await p.evaluate(()=>libraryCall.item.id),'occ-2');
  await open(p,2);await action(p,'copy');assert.equal(await p.evaluate(()=>copied),'P3 song 2 - API fixture artist');
 }finally{await clean(p);}
});

test('P6 nested existing playlist picker is inside top layer, owns focus/hit and posts exact ref; Escape/close restores',async()=>{
 const p=await fixture();try{
  await open(p);await action(p,'playlist');await p.waitForSelector('.songsheet-picker');
  assert.equal(await p.locator('.songsheet-picker').evaluate(e=>e.parentElement.matches('dialog.songsheet:modal')),true);
  for(let i=0;i<8;i++){await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>!!document.activeElement.closest('.songsheet-picker')),true);}
  await shot(p,'phone-nested-playlist-picker');const pick=p.locator('.songsheet-picker button').first();assert.equal(await pick.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true);
  await pick.click();await p.waitForFunction(()=>calls.some(c=>c.path==='/playlists/7/items'));await menu(p).waitFor({state:'hidden'});
  assert.deepEqual((await writes(p)).at(-1),{path:'/playlists/7/items',query:'',method:'POST',body:{kind:'tracks',ids:[103]}});assert.equal(await menu(p).count(),0);
  await open(p);await action(p,'playlist');await p.locator('.pl-newbtn').click();await p.locator('.songsheet-picker input').fill('New fixture playlist');await p.keyboard.press('Enter');
  await p.waitForFunction(()=>calls.some(c=>c.path==='/playlists/8/items'));await menu(p).waitFor({state:'hidden'});
  assert.equal((await writes(p)).at(-1).body.ids[0],103);
  await open(p);await action(p,'playlist');await p.waitForSelector('.songsheet-picker');await p.keyboard.press('Escape');assert.equal(await menu(p).count(),0);
  assert.equal(await p.evaluate(()=>document.activeElement===document.querySelector('.item[data-i="2"] .qmore')),true);
 }finally{await clean(p);}
});

test('P6 no stale Queue actions: refresh, permission, lock, route and pending transaction; B2 locked next survives',async()=>{
 for(const change of ['refresh','permission','lock','route','pending']){
  const p=await fixture();try{
   await open(p);const n=(await writes(p)).length;
   await p.evaluate(change=>{
    if(change==='refresh'){S.queue.reverse();drawQueue();}
    if(change==='permission')S.auth.role='view';
    if(change==='lock')lockQueue();
    if(change==='route')Z.select('g:2');
    if(change==='pending')S._phoneQueueEdit.pending=()=>true;
   },change);
   if(await menu(p).count())await p.locator('[data-qm=remove]').evaluate(e=>e.click());
   assert.equal((await writes(p)).length,n,change);
  }finally{await clean(p);}
 }
 const p=await fixture();try{
  await p.evaluate(()=>{lockQueue();drawQueue();});await open(p);assert.equal(await p.locator('[data-qm=next]').isDisabled(),false);assert.equal(await p.locator('[data-qm=remove]').isDisabled(),true);
  await action(p,'next');await p.waitForFunction(()=>calls.some(c=>c.path==='/queue/move'));assert.deepEqual((await writes(p)).at(-1).body,{from:2,to:1});
 }finally{await clean(p);}
});

test('P6 picker rejects delayed close/zone/permission changes at async response and final action time',async()=>{
 for(const change of ['close','zone','permission']){
  const p=await fixture();try{
   await p.evaluate(()=>{window.originalFetch=fetch;window.fetch=async(u,o)=>String(u).endsWith('/playlists')?new Promise(r=>window.releaseLists=()=>r(new Response(JSON.stringify([{id:7,name:'Late playlist'}])))):originalFetch(u,o);});
   await open(p);await action(p,'playlist');await p.waitForFunction(()=>!!window.releaseLists);
   if(change==='close')await p.locator('.songsheet-close').click();
   await p.evaluate(change=>{if(change==='zone')Z.select('g:2');if(change==='permission')S.auth.role='view';releaseLists();},change);
   await p.waitForTimeout(50);assert.equal(await p.locator('.songsheet-picker').count(),0);assert.equal((await writes(p)).length,0);
  }finally{await clean(p);}
 }
 const p=await fixture();try{await open(p);await action(p,'playlist');await p.waitForSelector('.songsheet-picker');await p.evaluate(()=>S.auth.role='view');await p.locator('.songsheet-picker button').first().click();assert.equal((await writes(p)).length,0);}finally{await clean(p);}
});

test('P6 native modal focus/inert hit-testing, scroll lock, Tab/Escape/close/backdrop return and detach/resize cleanup',async()=>{
 const p=await fixture();try{
  await p.locator('.qmore').nth(2).evaluate(e=>e.scrollIntoView());await p.evaluate(()=>{desk.style.overflow='auto';window.savedTop=desk.scrollTop;window.savedNow=nowc;window.savedMini=nowc.mini;});
  for(const how of ['escape','close','backdrop']){
   await open(p);assert.equal(await menu(p).evaluate(e=>e.matches(':modal')),true);assert.equal(await p.evaluate(()=>desk.style.overflow),'hidden');
   assert.equal(await p.evaluate(()=>document.activeElement.matches('.songsheet-close')),true);
   await p.evaluate(()=>document.querySelector('.tabbar button').focus());assert.equal(await p.evaluate(()=>!!document.activeElement.closest('.songsheet')),true);
   for(let i=0;i<16;i++){await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>!!document.activeElement.closest('.songsheet')),true);}
   const n=(await writes(p)).length;assert.equal(await p.locator('.tabbar button').first().evaluate(e=>{const r=e.getBoundingClientRect();return !e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true);assert.equal((await writes(p)).length,n);
   if(how==='escape')await p.keyboard.press('Escape');if(how==='close')await p.locator('.songsheet-close').click();if(how==='backdrop')await p.mouse.click(2,2);
   assert.equal(await menu(p).count(),0);assert.equal(await p.evaluate(()=>desk.style.overflow),'auto');assert.equal(await p.evaluate(()=>desk.scrollTop===savedTop),true);
  }
  await open(p);await p.setViewportSize({width:901,height:800});assert.equal(await menu(p).count(),0);await p.setViewportSize({width:390,height:844});
  await open(p);await p.evaluate(()=>go('library'));await p.waitForTimeout(20);assert.equal(await menu(p).count(),0);
  assert.equal(await p.evaluate(()=>nowc===savedNow&&nowc.mini===savedMini&&audioStarts===0),true);
 }finally{await clean(p);}
});

test('P6 F249 actual grip remains exclusive past hold; row hold and ellipsis open exactly one complete sheet without play',async()=>{
 const p=await fixture();try{
  const at=await start(p);await touch(p,'.item:first-child .qgrip');await p.waitForTimeout(570);assert.equal(await menu(p).count(),0);await p.mouse.move(at.x,at.y+6);await p.waitForTimeout(550);assert.equal(await menu(p).count(),0);await p.keyboard.press('Escape');await p.mouse.up();await touch(p,'.item:first-child .qgrip','touchend');await noWrites(p);
  await p.waitForTimeout(470);await touch(p,'.item:first-child .t');await p.waitForTimeout(550);assert.equal(await menu(p).count(),1);await touch(p,'.item:first-child .t','touchend');await p.locator('.item:first-child .t').dispatchEvent('click');await noWrites(p);await p.keyboard.press('Escape');
  await open(p);assert.equal(await menu(p).count(),1);await noWrites(p);
 }finally{await clean(p);}
});

test('P6 real Library Local/Remote song entries keep ref actions separate, Favorites identity and remote capability hint',async()=>{
 const p=await fixture();try{
  await p.evaluate(()=>mountLibrary());await p.waitForSelector('.phone-library .tile,.phone-library .item');
  await p.locator('.phone-library .tile .t1,.phone-library .item .t1').first().click();await p.waitForSelector('.albpage .item');
  for(const [id,path,body] of [['play','/stream/play',{kind:'tracks',ids:[501]}],['next','/queue/add',{kind:'tracks',ids:[501],next:true}],['add','/queue/add',{kind:'tracks',ids:[501]}]]){
   await p.locator('.albpage .item .more').click();assert.deepEqual(await p.locator('.songsheet-actions [data-qm]').evaluateAll(es=>es.map(e=>e.dataset.qm)),['play','next','add','playlist','favorite']);
   assert.equal(await p.locator('.songsheet-meta h2').textContent(),'Library song');await action(p,id);assert.deepEqual((await writes(p)).at(-1),{path,query:'?zoneId=den',method:'POST',body});
  }
  await p.locator('.albpage .item .more').click();await action(p,'favorite');assert.equal((await writes(p)).at(-1).body.ref,'501');
  await p.locator('.albpage .item .more').click();await action(p,'playlist');await p.locator('.songsheet-picker button').first().click();assert.deepEqual((await writes(p)).at(-1).body,{kind:'tracks',ids:[501]});
  await p.locator('.phone-library [data-src=remote]').click();await p.waitForSelector('.phone-library .tile,.phone-library .item');await p.locator('.phone-library .tile .t1,.phone-library .item .t1').first().click();await p.waitForSelector('.albpage .item');
  await p.locator('.albpage .item .t').click({button:'right'});assert.deepEqual(await p.locator('.songsheet-actions [data-qm]').evaluateAll(es=>es.map(e=>e.dataset.qm)),['play','next','add','playlist']);
  assert.equal(await p.locator('[data-qm=playlist]').isDisabled(),true);assert.match(await p.locator('[data-qm=playlist]').getAttribute('title'),/Remote songs/);await action(p,'next');
  assert.equal((await writes(p)).at(-1).body.kind,'remote');assert.equal((await writes(p)).at(-1).body.server,'remote-fixture');assert.equal((await writes(p)).at(-1).body.songs[0].id,'remote-id');
 }finally{await clean(p);}
});

test('P6 phone geometry themes safe area and large Display: complete scroll to Copy; 760/761/900 boundaries',async()=>{
 const p=await fixture();try{
  for(const [width,height] of [[320,568],[375,667],[390,844],[430,932],[390,320],[667,375],[844,390],[760,600],[761,600],[900,600]]){
   await p.setViewportSize({width,height});await open(p);
   await p.evaluate(()=>{document.documentElement.style.setProperty('--safe-b','24px');document.documentElement.style.setProperty('--safe-t','24px');});
   for(const id of ids){if(await p.locator(`[data-qm=${id}]`).isDisabled())continue;await p.locator(`[data-qm=${id}]`).scrollIntoViewIfNeeded();assert.equal(await p.locator(`[data-qm=${id}]`).evaluate(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth+.5&&r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,`${width} ${height} ${id}`);}
   if([320,390,667,761,900].includes(width))await shot(p,`phone-${width}x${height}-last-action`);await p.keyboard.press('Escape');
  }
  await p.setViewportSize({width:320,height:568});await p.evaluate(async()=>{const {applyScale}=await import('/js/uiscale.js');applyScale('large');document.documentElement.style.fontSize='20px';});await open(p);
  await p.locator('[data-qm=copy]').scrollIntoViewIfNeeded();assert.equal(await p.locator('[data-qm=copy]').evaluate(e=>{const r=e.getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true);await shot(p,'phone-320-large-text-last');await p.keyboard.press('Escape');
  await p.evaluate(async()=>{const {applyScale}=await import('/js/uiscale.js');applyScale('normal');document.documentElement.style.fontSize='';});await p.setViewportSize({width:390,height:844});
  for(const theme of ['default','ocean','light']){await p.evaluate(async t=>{const {applyTheme,PRESETS}=await import('/js/theme.js');applyTheme(t==='light'?{bg:'#f8f8ff',ink:'#202020',accent:'#824bd6',accent2:'#007b70',hl:'#355cad'}:{...PRESETS[t],preset:t});},theme);await open(p);await shot(p,'phone-'+theme+'-sheet');assert.equal(await menu(p).evaluate(e=>(()=>{const b=document.createElement('i');b.style.background='var(--panel)';e.append(b);const ok=getComputedStyle(e).backgroundColor===getComputedStyle(b).backgroundColor;b.remove();return ok;})()),true);await p.keyboard.press('Escape');}
 }finally{await clean(p);}
});

test('P6 desktop default popup is not modal and unchanged in geometry/paint without P6 CSS',async()=>{
 const p=await fixture();try{
  await p.setViewportSize({width:1280,height:800});await p.evaluate(()=>openDesktop());assert.equal(await menu(p).count(),0);assert.equal(await p.locator('.pldrop.qmenu').count(),1);
  const before=await p.locator('.qmenu').screenshot();await shot(p,'desktop-1280-popup-unchanged');
  if(baseAssets){const old=await fixture({parent:true});try{await old.setViewportSize({width:1280,height:800});await old.evaluate(()=>openDesktop());await shot(old,'desktop-1280-parent-popup');assert.deepEqual(await old.locator('.qmenu').screenshot(),before,'exact-parent popup pixels, original default JS + CSS');}finally{await clean(old);}}
  await p.evaluate(css=>{document.querySelector('link[rel=stylesheet]').disabled=true;const st=document.createElement('style');st.id='before-p6';st.textContent=css.split('/* F250-P6:')[0];document.head.append(st);},readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css',import.meta.url),'utf8'));
  assert.deepEqual(await p.locator('.qmenu').screenshot(),before);assert.deepEqual(await p.locator('.qmenu [data-qm]').evaluateAll(es=>es.map(e=>e.dataset.qm)),ids);
  await p.locator('[data-qm=next]').click();assert.deepEqual((await writes(p)).at(-1).body,{from:2,to:1});
 }finally{await clean(p);}
});


test('P6 Now current-song entry opens the same modal, missing occurrence has no fabricated index actions; read-only copy remains',async()=>{
 const p=await fixture();try{
  await p.evaluate(()=>go('now'));await p.locator('.np-phone-more').click();assert.equal(await menu(p).count(),1);assert.deepEqual(await p.locator('.qmenu [data-qm]').evaluateAll(es=>es.map(e=>e.dataset.qm)),ids);await shot(p,'phone-now-current-song-sheet');await p.keyboard.press('Escape');
  await p.evaluate(()=>{S.now.item={...S.now.item,id:'outside-queue'};nowc.draw();});await p.locator('.np-phone-more').click();assert.deepEqual(await p.locator('.qmenu [data-qm]').evaluateAll(es=>es.map(e=>e.dataset.qm)),['playlist','favorite','library','copy']);await p.keyboard.press('Escape');
  await p.evaluate(()=>{S.auth.role='view';nowc.draw();});await p.locator('.np-phone-more').click();assert.equal(await p.locator('[data-qm=favorite]').isDisabled(),true);assert.equal(await p.locator('[data-qm=copy]').isDisabled(),false);await action(p,'copy');assert.equal(await p.evaluate(()=>copied),'P3 duplicate song - API fixture artist');
 }finally{await clean(p);}
});

test('P6 Library delayed source/ref/routing generation changes cannot dispatch a stale ref',async()=>{
 for(const change of ['ref','permission','route','source']){
  const p=await fixture();try{
   await p.evaluate(()=>mountLibrary());await p.waitForSelector('.phone-library .tile,.phone-library .item');await p.locator('.phone-library .tile .t1,.phone-library .item .t1').first().click();await p.waitForSelector('.albpage .item .more');await p.locator('.albpage .item .more').click();const n=(await writes(p)).length;
   await p.evaluate(change=>{window.oldAction=document.querySelector('[data-qm=next]');if(change==='permission')S.auth.role='view';if(change==='route'){Z.select('g:2');Z.select('g:1');}if(change==='ref')document.querySelector('.albpage .item').remove();if(change==='source')lib.setSource('remote');},change);
   await p.evaluate(()=>oldAction.click());await p.waitForTimeout(30);assert.equal((await writes(p)).length,n,change);
  }finally{await clean(p);}
 }
});

test('P6 Queue remote/radio retain disabled source-specific playlist/Favorites hints and live Favorite label updates',async()=>{
 const p=await fixture();try{
  for(const i of [3,4]){await open(p,i);for(const id of ['favorite','playlist']){assert.equal(await p.locator(`[data-qm=${id}]`).isDisabled(),true);assert.ok(await p.locator(`[data-qm=${id}]`).getAttribute('aria-description'));}await p.keyboard.press('Escape');}
  await open(p,0);await p.evaluate(async()=>{const {toggleFav}=await import('/js/fav.js');await toggleFav(S,'track',101);});assert.equal(await p.locator('[data-qm=favorite]').textContent(),'Remove from Favorites');await action(p,'favorite');assert.equal((await writes(p)).at(-1).body.on,false);
 }finally{await clean(p);}
});

async function localSong(p){await p.evaluate(()=>mountLibrary());await p.waitForSelector('.phone-library .tile,.phone-library .item');await p.locator('.phone-library .tile .t1,.phone-library .item .t1').first().click();await p.waitForSelector('.albpage .item .more');await p.locator('.albpage .item .more').click();await menu(p).waitFor();}

test('P6 R1: Library-to-Now retained-DOM navigation releases song modal, focus and desk lock',async()=>{
 const p=await fixture();try{
  await localSong(p);await p.evaluate(()=>{window.sourceRow=document.querySelector('.albpage .item');go('now');});await p.waitForTimeout(60);
  const state=await p.evaluate(()=>({view:S.view,sourceConnected:sourceRow.isConnected,modal:!!document.querySelector('dialog.songsheet:modal'),focus:document.activeElement.className,deskOverflow:desk.style.overflow,openerFocused:document.activeElement===sourceRow.querySelector('.more')}));
  assert.equal(state.view,'now');assert.equal(state.sourceConnected,true);assert.equal(state.modal,false,'navigation must not leave the old Library song modal inerting Now');assert.notEqual(state.deskOverflow,'hidden');assert.equal(state.openerFocused,false,'destination focus must be preserved');
 }finally{await clean(p);}
});

test('P6 R2: Queue song actions require matching accepted stream read-origin before index writes',async()=>{
 const p=await fixture();try{
  await p.evaluate(()=>{
   window.originalFetch=fetch;window.removed=[];let hold=true;
   window.fetch=async(url,o={})=>{const u=new URL(url,location.href),path=u.pathname.replace('/api/v1','');
    if(path==='/queue/2'&&o.method==='DELETE')removed.push({route:u.searchParams.get('zoneId'),actualId:wireQ[2].id});
    const response=await originalFetch(url,o);
    if(path==='/stream'&&u.searchParams.get('zoneId')==='patio'&&hold){hold=false;window.newRouteReadHeld=true;await new Promise(r=>window.releaseNewRouteRead=r);}return response;
   };
   wireQ=wireQ.map(q=>({...q,id:'patio-'+q.id,title:'Patio '+q.title,refId:+q.refId+1000}));Z.select('g:2');window.newRouteRead=refreshQueue();
  });await p.waitForFunction(()=>newRouteReadHeld);
  await p.evaluate(()=>{go('library');go('queue');window.oldVisible=S.queue[2].id;window.matchingRead=S._nowRoute===S._streamRoute;});
  assert.equal(await p.evaluate(()=>matchingRead),false);
  await p.locator('.qmore').nth(2).click();await p.waitForTimeout(50);
  if(await menu(p).count())await p.locator('[data-qm=remove]').evaluate(e=>e.click());
  await p.waitForTimeout(60);const removed=await p.evaluate(()=>window.removed);
  assert.deepEqual(removed,[],'old visible occurrence must not delete a different occurrence on the new route before matching stream evidence');
  // After matching evidence arrives, the new occurrence index actions are enabled.
  await p.evaluate(()=>releaseNewRouteRead());await p.waitForFunction(()=>S._nowRoute===S._streamRoute);
  await p.evaluate(()=>drawQueue());await open(p,2);await action(p,'remove');await p.waitForFunction(()=>removed.length===1);
  assert.deepEqual(await p.evaluate(()=>removed),[{route:'patio',actualId:'patio-occ-2'}]);
 }finally{await clean(p);}
});

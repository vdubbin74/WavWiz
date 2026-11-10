// F250 P5: actual Now/song actions, Devices/Settings + full CSS. Shell
// functions are extracted verbatim from main.js; unrelated boot/services and
// Library/Queue page contents are fixtures. No running server or device claims.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { localDom } from './helpers/local-dom.mjs';
const main = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/main.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css', import.meta.url), 'utf8');
const chromeSource = main.slice(main.indexOf('// F250-P1: phone destinations'), main.indexOf('async function startMain()'));
const goSource = main.slice(main.indexOf('export function go('), main.indexOf('const checklistGo')).replace('export ', '');
const modeSource = main.slice(main.indexOf('const applyMode = () =>'), main.indexOf("window.addEventListener('resize', () => { applyMode();"));
const refreshSource = main.slice(main.indexOf('async function refreshNow()'), main.indexOf('async function refreshZones()'));
const evidence = process.env.F250_P5_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, {recursive:true});
let dom;
before(async () => { dom = await localDom(); });
after(async () => { await dom?.close(); });
async function fixture(viewport = {width:390,height:844}, baseline = false) {
  const p = await dom.page(viewport); p.errors=[]; p.on('pageerror',e=>p.errors.push(e.stack));
  await p.emulateMedia({reducedMotion:'reduce'});
  if (baseline) {
    await p.route('**/app.css', route=>route.fulfill({contentType:'text/css',body:css.split('/* F250-P1: existing full-page')[0]}));
    await p.reload();
  }
  await p.evaluate(async ({chromeSource,goSource,modeSource,refreshSource}) => {
    window.calls=[]; window.apiWrites=[]; window.soundOpens=0; window.reloads={}; window.clock=10000; window.metadataWrites=0; window.audioStarts=0;
    Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
    Object.defineProperty(window,'MediaMetadata',{configurable:true,value:class {constructor(o){Object.assign(this,o);metadataWrites++;}}});
    Object.defineProperty(navigator,'mediaSession',{configurable:true,value:{metadata:null,playbackState:'none',setActionHandler(){},setPositionState(){}}});
    // These must never be reached by chrome navigation (no live transport).
    window.AudioContext=class {constructor(){audioStarts++;throw Error('Unexpected audio context');}};
    HTMLMediaElement.prototype.play=function(){audioStarts++;return Promise.resolve();};
    localStorage.setItem('wavwiz.viz.v1',JSON.stringify({on:false}));
    window.fetch=async(url,opts={})=>{
      const path=new URL(url,location.href).pathname.replace('/api/v1','');
      if(opts.method && opts.method!=='GET'){ calls.push({path,method:opts.method}); apiWrites.push({path,method:opts.method,body:opts.body && JSON.parse(opts.body),search:new URL(url,location.href).search}); }
      let value=[];
      if(path==='/status')value={tls:{enabled:false},library:{scanning:false,tracks:20},devices:{},receivers:{},warnings:[]};
      if(path==='/settings')value={};
      if(path==='/network')value={bind:'fixture',problems:[],fixes:[],adapters:[]};
      if(path==='/library/online-art' || path==='/diagnostics')value=null;
      if(path==='/remote/servers')value={servers:[]};
      if(path==='/library/nas')value={shares:[]};
      if(path==='/airplay/settings')value={firewall:[]};
      if(path==='/checklist')value={dismissed:true,remaining:0};
      if(path==='/cast')value={active:false};
      if(path==='/receivers/zones')value={zones:[]};
      return new Response(JSON.stringify(value),{status:200});
    };
    const {h}=await import('/js/util.js'), {icon}=await import('/js/icons.js');
    const {createNow}=await import('/js/now.js'), {devicesView,devicesPanel}=await import('/js/devices.js');
    const {openSettings}=await import('/js/settings.js'), {viewForMode}=await import('/js/viewmode.js');
    const {reconcileSmoothPosition}=await import('/js/art.js');
    const Z=window.Z=await import('/js/zones40.js');
    const item={kind:'track',id:'occ-a',refId:17,title:'P5 fixture — A song with a long title',artist:'Fixture Artist',album:'Fixture Album'};
    const zones=Array.from({length:8},(_,i)=>({id:i+1,playerId:'p'+i,name:'Speaker '+(i+1),enabled:true,connected:true,volume:50,mine:true,outputs:[]}));
    const S=window.S={view:'library',auth:{role:'admin',appVersion:'fixture'},zones,groups:[{id:1,name:'Living Room',deviceIds:[1,2],linked:[],playbackId:'g1',online:true},{id:2,name:'Den',deviceIds:[],linked:[],playbackId:'g2',online:false}],queue:[item],status:{},now:{item,state:'playing',index:0,durationMs:200000,positionMs:45000,version:7},localPos:45000,localAt:clock};
    const wide=()=>!matchMedia('(max-width:900px)').matches;
    let go;
    const route=(...a)=>go(...a), refreshAll=async()=>{};
    Z.init(S,{refreshNow:refreshAll,manage:()=>route('devices')});
    const nowc=window.nowc=createNow(S,{go:route,openEq:()=>soundOpens++,showInLibrary:(...args)=>calls.push({library:args}),act:(...args)=>calls.push({act:args}),refreshAll});
    const devv=window.devv=devicesView(S,{go:route,act:(...args)=>calls.push({act:args}),refreshAll,openQueue:()=>route('queue')});
    const devp=devicesPanel(S,{go:route,act:(...args)=>calls.push({act:args}),refreshAll});
    const page=k=>h('section',{'data-fixture-page':k},h('h2',null,'P1 '+k+' content fixture (not redesigned)'),
      ...Array.from({length:40},(_,i)=>h('button',{class:'btn',style:'display:block;margin:8px 0;width:100%','data-row':i},k+' row '+(i+1))));
    const views=window.views={library:{el:page('library')},queue:{el:page('queue')},devices:{el:devv.el,reload:()=>devv.draw(),hide:()=>devv.hide()},playlists:{el:page('playlists')}};
    for(const [k,v] of Object.entries(views)){const reload=v.reload;v.reload=()=>{reloads[k]=(reloads[k]||0)+1;reload?.();};}
    const content=window.content=h('main',{class:'view',id:'view',tabindex:-1});
    const desk=window.desk=h('div',{class:'desk',id:'desk','data-view':S.view},h('section',{class:'libpanel'},'Desktop Library fixture'),content,nowc.el,devp.el,h('section',{class:'listpanel'},'Desktop Queue fixture'),nowc.npbar);
    const tabs=window.tabs=new Function('h','icon','S','wide','openSettings','refreshAll','go','handleErr',chromeSource+';return createPhoneTabs();')(h,icon,S,wide,openSettings,refreshAll,route,e=>{throw e;});
    const navButtons=[];
    go=window.go=new Function('S','views','wide','desk','content','tabs','navButtons','nowc',goSource+';return go;')(S,views,wide,desk,content,tabs,navButtons,nowc);
    const applyMode=window.applyMode=new Function('S','views','wide','desk','content','tabs','go','viewForMode',modeSource+';return applyMode;')(S,views,wide,desk,content,tabs,go,viewForMode);
    document.getElementById('app').replaceChildren(h('header',{class:'topbar'},h('b',null,'WavWiz'),h('span',{class:'small dim'},'P1 local fixture')),desk,nowc.mini,tabs);
    content.append(views.library.el); if(!wide())go('library'); else devp.draw();
    // Use real ingest → draw/tick. Stubs affect only unrelated service consumers.
    let snapshot=S.now;
    const refresh=new Function('api','S','whenIdle','nowc','listt','drawStatus','drawQueue','handleErr','reconcileSmoothPosition',refreshSource+';return refreshNow;')(
      async()=>({now:snapshot,queue:{items:[item]}}),S,fn=>fn(),nowc,{draw(){}},()=>{},()=>{},e=>{throw e;},reconcileSmoothPosition);
    window.poll=async(overrides={},gap=1000)=>{clock+=gap;snapshot={item,state:'playing',index:0,durationMs:200000,positionMs:45000,version:7,...overrides};await refresh();};
    await poll({},0);
    window.addEventListener('resize',applyMode);
    window.addRole=async role=>{
      document.querySelectorAll('.remote-banner,.mic-banner').forEach(e=>e.remove());
      if(role==='remote'){const {showRemoteBanner}=await import('/js/room.js');showRemoteBanner();}
      // Mic markup is a geometry-only fixture; no calibration/audio session is started.
      if(role==='mic')document.getElementById('app').insertBefore(h('div',{class:'mic-banner'},h('span',{class:'grow'},'This phone is set as a calibration mic, so it does not play music.'),h('a',{class:'btn primary',href:'#'},'Open calibration mic'),h('button',{class:'btn'},'Play music here')),nowc.mini);
    };
  }, {chromeSource,goSource,modeSource,refreshSource});
  return p;
}
async function clean(p){try{assert.deepEqual(p.errors,[]);}finally{await p.context().close();}}

const full = p => p.locator('.np-phone-full');
async function enter(p){ await p.locator('.mini-open').click(); await full(p).waitFor(); }
async function shot(p,name){if(evidence)await p.screenshot({path:evidence+'/'+name+'.png',animations:'disabled'});}
test('P5 collapse restores actual prior DOM/scroll/focus with no reload, audio or Media Session remount',async()=>{
  const p=await fixture();try{
    for(const view of ['library','queue','devices','playlists']){
      await p.evaluate(view=>{go(view);desk.scrollTop=90;document.querySelector('.mini-open').focus();window.saved={el:content.firstChild,top:desk.scrollTop,reloads:JSON.stringify(reloads),mini:nowc.mini,now:nowc,clock:S._smooth,local:S.localPos,at:S.localAt,metadata:navigator.mediaSession.metadata,writes:metadataWrites};},view);
      await enter(p);
      assert.equal(await p.locator('.mini').isVisible(),false);assert.equal(await p.locator('.tabbar').isVisible(),false);
      assert.equal(await p.evaluate(()=>document.activeElement===document.querySelector('.np-phone-collapse')),true);
      await p.locator('.np-phone-collapse').click();
      assert.equal(await p.evaluate(view=>S.view===view && content.firstChild===saved.el && desk.scrollTop===saved.top && JSON.stringify(reloads)===saved.reloads && nowc.mini===saved.mini && nowc===saved.now && S._smooth===saved.clock && S.localPos===saved.local && S.localAt===saved.at && navigator.mediaSession.metadata===saved.metadata && metadataWrites===saved.writes && audioStarts===0 && document.activeElement===document.querySelector('.mini-open'),view),true);
      assert.equal(await p.locator('.mini').isVisible(),true);assert.equal(await p.locator('.tabbar').isVisible(),true);
    }
    await p.evaluate(()=>{go.phoneNowReturn=null;S.view='now';desk.dataset.view='now';});
    await p.locator('.np-phone-collapse').click();assert.equal(await p.evaluate(()=>S.view),'library','documented direct/startup fallback');
    assert.deepEqual(await p.evaluate(()=>calls.filter(c=>c.act || (c.path && c.path!=='/auth/ws-ticket'))),[]);
  }finally{await clean(p);}
});
test('P5 full controls reflect real play state/access, repeat-one and existing selected stream transport',async()=>{
  const p=await fixture();try{
    await enter(p);
    for(const [state,label,path] of [['playing','Pause','/stream/pause'],['paused','Play','/stream/resume'],['stopped','Play','/stream/jump']]){
      await p.evaluate(state=>poll({state}),state);assert.equal(await p.locator('.np-phone-play').getAttribute('aria-label'),label);
      await p.locator('.np-phone-play').click();assert.equal(await p.evaluate(()=>calls.at(-1).act[0]),path);
    }
    for(const [selector,path] of [['prev','/stream/prev'],['next','/stream/next'],['shuffle','/stream/shuffle'],['repeat','/stream/repeat']]){
      await p.locator('.np-phone-'+selector).click();assert.equal(await p.evaluate(()=>calls.at(-1).act[0]),path);
    }
    await p.locator('.np-phone-repeat').click({modifiers:['Alt']});assert.deepEqual(await p.evaluate(()=>calls.at(-1).act),['/stream/repeat',{mode:'one'}]);
    await p.evaluate(()=>poll({repeat:'one',shuffle:true}));assert.equal(await p.locator('.np-phone-repeat').getAttribute('data-icon'),'repeatOne');assert.equal(await p.locator('.np-phone-shuffle').getAttribute('aria-pressed'),'true');
    const n=await p.evaluate(()=>{S.auth.role='view';return calls.filter(c=>c.act).length;});
    await p.evaluate(()=>{document.querySelector('.np-phone-play').click();document.querySelector('.np-phone-repeat').dispatchEvent(new MouseEvent('click',{altKey:true,bubbles:true}));nowc.draw();});
    assert.equal(await p.evaluate(()=>calls.filter(c=>c.act).length),n);assert.equal(await p.locator('.np-phone-play').isDisabled(),true);
    await p.evaluate(()=>{S.auth.role='admin';nowc.draw();});await p.getByRole('button',{name:'Sound',exact:true}).click();assert.equal(await p.evaluate(()=>soundOpens),1);
    await p.getByRole('button',{name:'Queue',exact:true}).click();assert.equal(await p.evaluate(()=>S.view),'queue');assert.equal(await p.locator('.mini').isVisible(),true);
  }finally{await clean(p);}
});
test('P5 full progress/key seek consumes F248 reconciled clock, never raw zero; unknown/live/no-item is honestly disabled',async()=>{
  const p=await fixture();try{
    await enter(p);await p.evaluate(()=>poll({state:'paused'},0));await p.evaluate(()=>poll({state:'paused',positionMs:0}));
    assert.equal(await p.locator('.np-phone-times span').first().textContent(),'00:45');
    await p.locator('.np-phone-seek').focus();await p.keyboard.press('ArrowRight');assert.deepEqual(await p.evaluate(()=>calls.at(-1).act),['/stream/seek',{ms:50000}]);
    await p.evaluate(()=>{clock+=2000;nowc.tickPos();});assert.equal(await p.locator('.np-phone-times span').first().textContent(),'00:45');
    for(const overrides of [{durationMs:0},{durationMs:Infinity},{durationMs:-1},{item:null},{item:{id:99,kind:'radio',title:'Radio'},durationMs:0}]){
      await p.evaluate(o=>poll(o),overrides);assert.equal(await p.locator('.np-phone-seek').getAttribute('aria-disabled'),'true');
      const n=await p.evaluate(()=>calls.length);await p.locator('.np-phone-seek').click({force:true});await p.evaluate(()=>document.querySelector('.np-phone-seek').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));assert.equal(await p.evaluate(()=>calls.length),n);
    }
    assert.equal(await p.locator('.np-phone-times span').last().textContent(),'LIVE');
  }finally{await clean(p);}
});
test('P5 overflow is complete CURRENT SONG menu, occurrence-safe for duplicates and scoped to selected zone',async()=>{
  const p=await fixture();try{
    await enter(p);await p.evaluate(()=>{const a=S.now.item;S.queue=[{...a,id:'duplicate-first'},a,{...a,id:'last'}];S.now.index=1;nowc.draw();});
    await p.locator('.np-phone-more').click();
    assert.equal(await p.locator('.qmenu').getAttribute('aria-label'),'Current song actions');
    assert.deepEqual(await p.locator('.qmenu [data-qm]').evaluateAll(es=>es.map(e=>e.dataset.qm)),['play','next','remove','up','down','top','bottom','playlist','favorite','library','copy']);
    assert.equal(await p.locator('.qmenu [data-qm=next]').isDisabled(),true);await shot(p,'phone-current-song-menu');
    await p.locator('.qmenu [data-qm=remove]').click();
    assert.deepEqual(await p.evaluate(()=>apiWrites.at(-1)),{path:'/queue/1',method:'DELETE',body:undefined,search:'?zoneId=g1'});
    await p.locator('.np-phone-more').click();await p.locator('.qmenu [data-qm=top]').click();
    assert.deepEqual(await p.evaluate(()=>apiWrites.at(-1)),{path:'/queue/move',method:'POST',body:{from:1,to:0},search:'?zoneId=g1'});
    await p.locator('.np-phone-more').click();await p.locator('.qmenu [data-qm=library]').click();assert.equal(await p.evaluate(()=>calls.at(-1).library[1].id),'occ-a');
    await p.evaluate(()=>{S.now.item={...S.now.item,id:'outside-queue'};nowc.draw();});await p.locator('.np-phone-more').click();
    assert.deepEqual(await p.locator('.qmenu [data-qm]').evaluateAll(es=>es.map(e=>e.dataset.qm)),['playlist','favorite','library','copy']);
    await p.keyboard.press('Escape');await p.evaluate(()=>{S.now.item=null;nowc.draw();});assert.equal(await p.locator('.np-phone-more').isDisabled(),true);
  }finally{await clean(p);}
});
test('P5 open song actions revalidate permission, ordered occurrences, ref and zone; locks/remote restrictions survive',async()=>{
  const p=await fixture();try{
    await enter(p);
    for(const mutation of ['permission','order','ref','zone']){
      await p.evaluate(()=>{S.auth.role='admin';S._nowZoneKey=Z.current().key;nowc.draw();});await p.locator('.np-phone-more').click();const n=await p.evaluate(()=>apiWrites.filter(w=>/^\/(queue|stream)/.test(w.path)).length);
      await p.evaluate(m=>{if(m==='permission')S.auth.role='view';if(m==='order')S.queue.push({...S.queue[0],id:'new'});if(m==='ref')S.now.item={...S.now.item,refId:88};if(m==='zone'){localStorage.setItem('wavwiz.zone','g:2');globalThis.__wavwizZoneKey='g:2';}},mutation);
      await p.locator('.qmenu [data-qm=remove]').click();assert.equal(await p.evaluate(()=>apiWrites.filter(w=>/^\/(queue|stream)/.test(w.path)).length),n,mutation);
      // 0.6.8-#4: a zones refresh no longer closes a still-valid sheet (permission only disables items), so dismiss it like a user would
      await p.evaluate(()=>document.querySelector('dialog.songsheet')?.close());
      await p.evaluate(async()=>{localStorage.removeItem('wavwiz.zone');Z.sync();await poll({},0);});
    }
    await p.evaluate(async()=>{const {loadLayout,saveLayout,setLocked}=await import('/js/plcols.js');saveLayout(setLocked(loadLayout(true),true),true);nowc.draw();});
    await p.locator('.np-phone-more').click();assert.equal(await p.locator('.qmenu [data-qm=remove]').isDisabled(),true);await p.keyboard.press('Escape');
    await p.evaluate(()=>{S.auth.role='view';nowc.draw();});await p.locator('.np-phone-more').click();assert.equal(await p.locator('.qmenu [data-qm=play]').isDisabled(),true);assert.equal(await p.locator('.qmenu [data-qm=copy]').isDisabled(),false);await p.keyboard.press('Escape');
    await p.evaluate(()=>{S.now.item={kind:'remote',id:'remote',refId:123,title:'Remote song'};S.queue=[];S.now.index=-1;nowc.draw();});await p.locator('.np-phone-more').click();assert.equal(await p.locator('.qmenu [data-qm=playlist]').isDisabled(),true);assert.equal(await p.locator('.qmenu [data-qm=favorite]').isDisabled(),true);
  }finally{await clean(p);}
});
test('P5 stale zone response cannot stamp/replace the selected stream context; menu awaits actual new-zone response',async()=>{
  const p=await fixture();try{
    await enter(p);await p.evaluate(()=>Z.select('g:2'));await p.evaluate(()=>nowc.draw());assert.equal(await p.locator('.np-phone-more').isDisabled(),true);
    const result=await p.evaluate(async refreshSource=>{
      let release;const response=new Promise(r=>release=r),old=S.now;
      const refresh=new Function('api','S','whenIdle','nowc','listt','drawStatus','drawQueue','handleErr','reconcileSmoothPosition',refreshSource+';return refreshNow;')(
        ()=>response,S,fn=>fn(),nowc,{draw(){}},()=>{},()=>{},e=>{throw e;},()=>{throw Error('Stale response reached clock');});
      const pending=refresh();Z.select('g:1');release({now:{item:{id:'stale'},state:'playing'},queue:{items:[]}});await pending;
      const same=S.now===old;await poll({},0);return {same,key:S._nowZoneKey};
    },refreshSource);
    assert.deepEqual(result,{same:true,key:'g:1'});assert.equal(await p.locator('.np-phone-more').isDisabled(),false);
  }finally{await clean(p);}
});
test('P5 selected-zone volume keeps max-based proportional/capped API semantics, not device/master; cancels stale writes',async()=>{
  const p=await fixture();try{
    await enter(p);await p.evaluate(()=>{S.zones[0].volume=80;S.zones[1].volume=40;S.zones[1].volCap=45;nowc.draw();});
    assert.equal(await p.locator('.np-zvol').inputValue(),'80');
    await p.evaluate(()=>{const r=document.querySelector('.np-zvol');r.value=100;r.dispatchEvent(new Event('input'));r.dispatchEvent(new Event('change'));});
    await p.waitForFunction(()=>calls.filter(c=>c.act?.[0]?.startsWith('/zones/')).length===2);
    assert.deepEqual(await p.evaluate(()=>calls.filter(c=>c.act).map(c=>c.act)),[['/zones/1',{volume:100},'PATCH'],['/zones/2',{volume:45},'PATCH']]);
    await p.locator('.np-zmute').click();assert.deepEqual(await p.evaluate(()=>apiWrites.at(-1)),{path:'/groups/1/mute',method:'POST',body:{muted:true},search:''});
    for(const cancel of ['zone','permission','navigation','pointercancel','cap']){
      await p.evaluate(()=>{S.auth.role='admin';Z.select('g:1');S.zones[1].volCap=45;S.zones[0].volume=80;S.zones[1].volume=40;go('now');nowc.draw();calls=[];});
      await p.evaluate(cancel=>{const r=document.querySelector('.np-zvol');r.dispatchEvent(new PointerEvent('pointerdown'));r.value=50;r.dispatchEvent(new Event('input'));
        if(cancel==='zone')Z.select('g:2');if(cancel==='permission')S.auth.role='view';if(cancel==='navigation')go('library');if(cancel==='pointercancel')r.dispatchEvent(new PointerEvent('pointercancel'));if(cancel==='cap')S.zones[0].volCap=60;},cancel);
      await p.waitForTimeout(130);assert.equal(await p.evaluate(()=>calls.filter(c=>c.act).length),0,cancel);
    }
    await p.evaluate(()=>{S.auth.role='admin';S.jb={own:true,zoneId:'jukebox'};Z.select('jukebox');go('now');nowc.draw();});assert.equal(await p.locator('.np-zvol').isDisabled(),true,'existing normal-group API has no NP Jukebox adapter; narrow P8 gap, not a fabricated binding');
  }finally{await clean(p);}
});
test('P5 phone geometry/themes/large text: all controls reachable, no mini/nav hit targets; 760/761/900/901',async()=>{
  const p=await fixture();try{
    await enter(p);
    for(const [width,height] of [[320,568],[375,667],[390,844],[430,932],[667,375],[844,390],[760,600],[761,600],[900,600]]){
      await p.setViewportSize({width,height});
      await p.evaluate(()=>{document.documentElement.style.setProperty('--safe-b','24px');desk.scrollTop=0;});
      assert.equal(await full(p).isVisible(),true);assert.equal(await p.locator('.mini').isVisible(),false);assert.equal(await p.locator('.tabbar').isVisible(),false);
      for(const selector of ['.np-phone-collapse','.np-phone-more','.np-phone-play','.np-zvol','.np-phone-actions>button:last-child']){
        await p.locator(selector).scrollIntoViewIfNeeded();
        assert.equal(await p.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect(),d=document.getElementById('desk').getBoundingClientRect();return r.width>=44 && r.height>=44 && r.top>=d.top-1 && r.bottom<=d.bottom+1 && e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,JSON.stringify({width,height,selector}));
      }
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if([390,667,761,900].includes(width)){await p.evaluate(()=>desk.scrollTop=0);await shot(p,`phone-${width}x${height}`);}
    }
    await p.setViewportSize({width:390,height:844});
    const palettes=await p.evaluate(async()=>{const {applyTheme,PRESETS}=await import('/js/theme.js');const rows=[];for(const t of [{...PRESETS.default,preset:'default'},{...PRESETS.ocean,preset:'ocean'},{bg:'#f8f8ff',ink:'#202020',accent:'#824bd6',accent2:'#007b70',hl:'#355cad'}]){applyTheme(t);const b=document.querySelector('.np-phone-play'),probe=document.createElement('i');probe.style.color='var(--accent-text,var(--accent))';document.body.append(probe);rows.push({actual:getComputedStyle(b).color,expected:getComputedStyle(probe).color});probe.remove();}return rows;});
    palettes.forEach(r=>assert.equal(r.actual,r.expected));assert.notEqual(palettes[0].actual,palettes[1].actual);
    await p.evaluate(async()=>{const {applyScale}=await import('/js/uiscale.js');applyScale('large');document.documentElement.style.fontSize='20px';document.querySelector('.np-phone-actions').scrollIntoView({block:'end'});});
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await shot(p,'phone-custom-light-large-text');
    await p.setViewportSize({width:901,height:800});await full(p).waitFor({state:'hidden'});await p.setViewportSize({width:900,height:600});await full(p).waitFor({state:'visible'});
  }finally{await clean(p);}
});
test('P5 wide desktop geometry/paint unchanged by phone CSS at 901/1280/1600',async()=>{
  for(const width of [901,1280,1600]){const p=await fixture({width,height:800});try{
    const pair=await p.evaluate(async base=>{const measure=()=>[...document.querySelectorAll('.desk,.libpanel,.devpanel,.listpanel,.np-vizpanel,.np-ctlpanel')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,w:r.width,h:r.height,display:s.display,bg:s.backgroundColor,grid:s.gridTemplateColumns};});await document.fonts.ready;const candidate=measure();document.querySelector('link[rel=stylesheet]').disabled=true;const style=document.createElement('style');style.textContent=base;document.head.append(style);await new Promise(r=>requestAnimationFrame(r));return {candidate,baseline:measure()};},css.split('/* F250-P5: full phone NP')[0]);
    assert.deepEqual(pair.candidate,pair.baseline);await shot(p,'desktop-'+width);
  }finally{await clean(p);}}
});

test('P5 current-song Favorite, playlist and copy reuse real controllers; hidden chrome excluded from keyboard traversal',async()=>{
  const p=await fixture();try{
    await enter(p);await p.locator('.np-phone-heart .heart').click();
    await p.waitForFunction(()=>apiWrites.some(w=>w.path==='/favorites'));
    assert.deepEqual(await p.evaluate(()=>apiWrites.find(w=>w.path==='/favorites')),{path:'/favorites',method:'PUT',body:{kind:'track',ref:'17',on:true},search:''});
    assert.equal(await p.locator('.np-phone-heart .heart').getAttribute('aria-pressed'),'true');
    await p.locator('.np-phone-more').click();assert.equal(await p.locator('.qmenu [data-qm=favorite]').textContent(),'Remove from Favorites');
    await p.locator('.qmenu [data-qm=favorite]').click();assert.equal(await p.locator('.np-phone-heart .heart').getAttribute('aria-pressed'),'false');
    await p.locator('.np-phone-more').click();await p.locator('.qmenu [data-qm=playlist]').click();await p.locator('.pldrop .pl-newbtn').click();await p.waitForSelector('.pldrop input[placeholder="New playlist name"]');await p.keyboard.press('Escape');
    await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copied=text}}));
    await p.locator('.np-phone-more').click();await p.locator('.qmenu [data-qm=copy]').click();assert.equal(await p.evaluate(()=>copied),'P5 fixture — A song with a long title - Fixture Artist');
    await p.locator('.np-phone-collapse').focus();
    for(let i=0;i<20;i++){await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>!!document.activeElement.closest('.mini,.tabbar')),false);}
    await p.evaluate(()=>{S.auth.role='view';nowc.draw();});assert.equal(await p.locator('.np-phone-heart .heart').isDisabled(),true);
  }finally{await clean(p);}
});

// Incorporated Wiz expanded P5 probes. R2 now asserts refusal before trying
// a disabled entry, rather than timing out on the deliberately absent menu.
test('P5 Wiz R2: same selected group with changed playback routing cannot authorize old-stream occurrence actions',async()=>{
 const p=await fixture();try{
  await enter(p);
  const evidence=await p.evaluate(async refreshSource=>{
   const oldItem=S.now.item,oldNow=S.now;let release;
   const response=new Promise(r=>release=r);
   const {reconcileSmoothPosition}=await import('/js/art.js');
   const refresh=new Function('api','S','whenIdle','nowc','listt','drawStatus','drawQueue','handleErr','reconcileSmoothPosition',refreshSource+';return refreshNow;')(
    ()=>response,S,fn=>fn(),nowc,{draw(){}},()=>{},()=>{},e=>{throw e;},reconcileSmoothPosition);
   const request=refresh();
   // Real zones-data/link update: key g:1 survives but routes to a different playback group.
   S.groups[0].playbackId='new-playback';Z.sync();nowc.draw();
   const beforeOldResponse={key:Z.current().key,pid:Z.current().playbackId,menuDisabled:document.querySelector('.np-phone-more').disabled};
   const stale={...oldNow,positionMs:46000};release({now:stale,queue:{items:[oldItem]}});await request;
   return {beforeOldResponse,oldResponseAccepted:S.now===stale,stamp:S._nowZoneKey};
  },refreshSource);
  console.log('P5 R2 evidence',JSON.stringify(evidence));
  assert.equal(evidence.oldResponseAccepted,false,'stream stamp must include effective playback routing, not only selected visual group key');
  assert.equal(evidence.beforeOldResponse.menuDisabled,true);
  // Fixed behavior deliberately has no menu to click. Exercise its guarded
  // entry directly and prove no old index can reach the new playback queue.
  await p.evaluate(()=>document.querySelector('.np-phone-more').dispatchEvent(new MouseEvent('click')));
  assert.equal(await p.locator('.qmenu').count(),0);assert.deepEqual(await p.evaluate(()=>apiWrites.filter(w=>/^\/(queue|stream)/.test(w.path))),[]);
  await p.evaluate(()=>poll({item:{...S.now.item,id:'new-target'},state:'paused'},0));
  await p.locator('.np-phone-more').click();
  assert.equal(await p.locator('.qmenu [data-qm=remove]').count(),0,'out-of-queue new song cannot inherit old index');
 }finally{await clean(p);}
});
test('P5 Wiz R3: selecting a linked zone while paused retains a usable current-song menu without relying on a future playing tick',async()=>{
 const p=await fixture();try{
  await enter(p);await p.evaluate(()=>poll({state:'paused'},0));
  const evidence=await p.evaluate(async()=>{
   S.groups[1].playbackId=S.groups[0].playbackId;S.groups[0].linked=[2];S.groups[1].linked=[1];Z.sync();
   const initially=!document.querySelector('.np-phone-more').disabled;
   let streamRefreshes=0;Z.init(S,{refreshNow:()=>streamRefreshes++});
   Z.select('g:2');nowc.draw();
   const {currentSongContext}=await import('/js/npsongmenu.js');
   return {initially,selected:Z.current().key,playback:Z.current().playbackId,stamp:S._nowZoneKey,state:S.now.state,streamRefreshes,disabled:document.querySelector('.np-phone-more').disabled,hasContext:!!currentSongContext(S)};
  });
  await p.waitForTimeout(150);console.log('P5 R3 evidence',JSON.stringify(evidence));
  assert.equal(evidence.disabled,false,'same playback linked-zone selection does not trigger refreshNow; menu otherwise stays disabled for paused current song');
 }finally{await clean(p);}
});
test('P5 Wiz preservation: saved presentation choices and same-item hero survive draw/open/collapse; body keyboard focus returns',async()=>{
 const p=await fixture();try{
  const saved=await p.evaluate(async()=>{
   const {saveNpPrefs}=await import('/js/npstyle.js');saveNpPrefs({art:'disc',seek:'eq',buttons:'ring'});const raw=localStorage.getItem('wavwiz.npstyle.v1');
   document.querySelector('[data-row="2"]').focus();window.hero=document.querySelector('.np-phone-art').firstChild;return raw;
  });
  await p.evaluate(()=>go('now'));await p.evaluate(()=>{nowc.draw();nowc.tickPos();});await p.locator('.np-phone-collapse').click();
  const result=await p.evaluate(()=>({preference:localStorage.getItem('wavwiz.npstyle.v1'),sameHero:document.querySelector('.np-phone-art').firstChild===hero,focus:document.activeElement.dataset.row,audioStarts,fullNow:!!nowc.el}));
  console.log('P5 preservation evidence',JSON.stringify(result));assert.equal(result.preference,saved);assert.equal(result.sameHero,true);assert.equal(result.focus,'2');assert.equal(result.audioStarts,0);
 }finally{await clean(p);}
});

test('P5 Wiz all saved NP appearance combinations map to one accessible phone projection without mutating preferences or hero',async()=>{
 const p=await fixture();try{
  await enter(p);
  const result=await p.evaluate(async()=>{
   const {NP_SEEKS,NP_BUTTONS,NP_ARTS,saveNpPrefs}=await import('/js/npstyle.js');
   const art=document.querySelector('.np-phone-art').firstChild;let n=0,fail=[];
   for(const [seek] of NP_SEEKS)for(const [buttons] of NP_BUTTONS)for(const [look] of NP_ARTS){
    saveNpPrefs({seek,buttons,art:look});const raw=localStorage.getItem('wavwiz.npstyle.v1');nowc.draw();nowc.tickPos();
    const hero=document.querySelector('.np-phone-art'),play=document.querySelector('.np-phone-play'),full=document.querySelector('.np-phone-full');
    const a=hero.getBoundingClientRect(),b=play.getBoundingClientRect();
    if(a.width<=0||Math.abs(a.width-a.height)>1||b.width<44||b.height<44||getComputedStyle(full).display==='none'||document.querySelector('.np-phone-art').firstChild!==art||raw!==localStorage.getItem('wavwiz.npstyle.v1'))fail.push({seek,buttons,look});n++;
   }
   return {combinations:n,fail,audioStarts};
  });console.log('P5 all-looks evidence',JSON.stringify(result));assert.deepEqual(result.fail,[]);assert.equal(result.audioStarts,0);
 }finally{await clean(p);}
});

test('P5 Wiz small large-text phone keeps the complete transport hit-testable without horizontal clipping',async()=>{
 const p=await fixture({width:320,height:568});try{
  await enter(p);await p.evaluate(async()=>{const {applyScale}=await import('/js/uiscale.js');applyScale('large');document.documentElement.style.fontSize='20px';});
  await p.locator('.np-phone-transport').scrollIntoViewIfNeeded();
  const evidence=await p.evaluate(()=>{const d=desk.getBoundingClientRect();return {viewport:innerWidth,zoom:getComputedStyle(document.documentElement).zoom,desk:{left:d.left,right:d.right},buttons:[...document.querySelectorAll('.np-phone-transport>button')].map(e=>{const r=e.getBoundingClientRect();return {name:e.getAttribute('aria-label'),left:r.left,right:r.right,width:r.width,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})};});
  console.log('P5 small large-text geometry',JSON.stringify(evidence));
  assert.equal(evidence.buttons.every(b=>b.left>=evidence.desk.left && b.right<=evidence.desk.right && b.hit),true,'complete 5-button transport must remain reachable at supported small phone/large Display size');
 }finally{await clean(p);}
});


// This extra fixture boundary uses the real util.api()/withZone() request,
// unlike poll's snapshot stub. Only fetch/server timing/data are controlled.
async function wireStreams(p){
 await p.evaluate(async refreshSource=>{
  const {api}=await import('/js/util.js'),{reconcileSmoothPosition}=await import('/js/art.js');
  window.streamReads=[];window.heldStreams=[];const original=fetch;
  window.fetch=(url,opts={})=>{
   const u=new URL(url,location.href);
   if(u.pathname==='/api/v1/stream'&&(!opts.method||opts.method==='GET')){
    streamReads.push(u.search);return new Promise(resolve=>heldStreams.push(value=>resolve(new Response(JSON.stringify(value),{status:200}))));
   }
   return original(url,opts);
  };
  window.routeRefresh=new Function('api','S','whenIdle','nowc','listt','drawStatus','drawQueue','handleErr','reconcileSmoothPosition',refreshSource+';return refreshNow;')(
   api,S,fn=>fn(),nowc,{draw(){}},()=>{},()=>{},e=>{throw e;},reconcileSmoothPosition);
 },refreshSource);
}

test('P5 R2 actual HTTP targets: accept new routing evidence, reject old late stream and detached old menu action',async()=>{
 const p=await fixture();try{
  await enter(p);await wireStreams(p);await p.locator('.np-phone-more').click();
  await p.evaluate(()=>{window.oldRemove=document.querySelector('[data-qm=remove]');window.oldNow=S.now;window.oldClock=S._smooth;window.oldRequest=routeRefresh();S.groups[0].playbackId='new-playback';Z.sync();oldRemove.click();window.newRequest=routeRefresh();});
  assert.equal(await p.locator('.np-phone-more').isDisabled(),true,'zonesync invalidates immediately, without draw/tick');
  assert.deepEqual(await p.evaluate(()=>apiWrites.filter(w=>/^\/(queue|stream)/.test(w.path))),[]);
  assert.deepEqual(await p.evaluate(()=>streamReads),['?zoneId=g1','?zoneId=new-playback']);
  await p.evaluate(async()=>{const item={...oldNow.item,id:'new-occurrence',title:'New target song'};heldStreams[1]({now:{...oldNow,item,state:'paused'},queue:{items:[item]}});await newRequest;window.accepted={now:S.now,clock:S._smooth,writes:metadataWrites};heldStreams[0]({now:{...oldNow,positionMs:90000},queue:{items:[oldNow.item]}});await oldRequest;});
  assert.equal(await p.evaluate(()=>S.now===accepted.now&&S._smooth===accepted.clock&&metadataWrites===accepted.writes&&S.now.item.id==='new-occurrence'&&audioStarts===0),true);
  assert.equal(await p.locator('.np-phone-more').isDisabled(),false);await p.locator('.np-phone-more').click();await p.locator('[data-qm=remove]').click();
  const write=await p.evaluate(()=>apiWrites.filter(w=>/^\/(queue|stream)/.test(w.path)).at(-1));
  console.log('P5 R2 real HTTP evidence',JSON.stringify({reads:await p.evaluate(()=>streamReads),write}));
  assert.deepEqual(write,{path:'/queue/0',method:'DELETE',body:undefined,search:'?zoneId=new-playback'});
 }finally{await clean(p);}
});

test('P5 R2 route generation refuses A→B→A late evidence even when final display and request target match',async()=>{
 const p=await fixture();try{
  await enter(p);await wireStreams(p);
  await p.evaluate(()=>{window.before=S.now;window.oldRequest=routeRefresh();S.groups[0].playbackId='other';Z.sync();S.groups[0].playbackId='g1';Z.sync();});
  assert.equal(await p.locator('.np-phone-more').isDisabled(),true);
  await p.evaluate(async()=>{heldStreams[0]({now:{...before,positionMs:190000},queue:{items:[before.item]}});await oldRequest;});
  assert.equal(await p.evaluate(()=>S.now===before),true);assert.equal(await p.locator('.np-phone-more').isDisabled(),true);
  await p.evaluate(async()=>{const request=routeRefresh();heldStreams[1]({now:{...before,state:'paused'},queue:{items:[before.item]}});await request;});
  assert.equal(await p.locator('.np-phone-more').isDisabled(),false);
 }finally{await clean(p);}
});

for(const state of ['paused','stopped'])test(`P5 R3 ${state}: linked same-target choice keeps actions, genuinely different target waits for its own stream`,async()=>{
 const p=await fixture();try{
  await enter(p);await p.evaluate(state=>poll({state},0),state);await wireStreams(p);
  await p.evaluate(()=>{S.groups[1].playbackId='g1';Z.sync();Z.init(S,{refreshNow:()=>window.refreshNeeded=(window.refreshNeeded||0)+1});Z.select('g:2');});
  assert.equal(await p.locator('.np-phone-more').isDisabled(),false);assert.equal(await p.evaluate(()=>window.refreshNeeded||0),0);
  await p.locator('.np-phone-more').click();assert.equal(await p.locator('[data-qm=remove]').isDisabled(),false);await p.keyboard.press('Escape');
  await p.evaluate(()=>{S.groups[1].playbackId='g2';Z.sync();});assert.equal(await p.locator('.np-phone-more').isDisabled(),true);assert.equal(await p.evaluate(()=>window.refreshNeeded),1);
  await p.evaluate(async()=>{const request=routeRefresh(),item={...S.now.item,id:'g2-occurrence'};heldStreams[0]({now:{...S.now,item},queue:{items:[item]}});await request;});
  assert.equal(await p.locator('.np-phone-more').isDisabled(),false);assert.deepEqual(await p.evaluate(()=>streamReads),['?zoneId=g2']);
  assert.equal(await p.evaluate(()=>S.now.state),state);assert.equal(await p.evaluate(()=>audioStarts),0);
 }finally{await clean(p);}
});

test('P5 R2 resolved request identity covers default, overlap keys, and Jukebox rather than raw playbackId/display keys',async()=>{
 const p=await fixture();try{
  await enter(p);await wireStreams(p);
  for(const [shape,query] of [['default',''],['overlap','?zoneId=g%3A1'],['jukebox','?zoneId=jb-stream']]){
   await p.evaluate(shape=>{
    if(shape==='default'){S.groups[0].playbackId='default';S.groups[0].overlapsLarger=false;Z.select('g:1');}
    if(shape==='overlap'){S.groups[0].playbackId='default';S.groups[0].overlapsLarger=true;Z.sync();}
    if(shape==='jukebox'){S.jb={own:true,zoneId:'jb-stream'};Z.select('jukebox');}
   },shape);
   assert.equal(await p.locator('.np-phone-more').isDisabled(),true,shape);
   await p.evaluate(async()=>{const i=heldStreams.length,request=routeRefresh(),item={...S.now.item,id:'route-'+i};heldStreams[i]({now:{...S.now,item,state:'paused'},queue:{items:[item]}});await request;});
   assert.equal(await p.locator('.np-phone-more').isDisabled(),false,shape);assert.equal(await p.evaluate(()=>streamReads.at(-1)),query);
   await p.locator('.np-phone-more').click();await p.locator('[data-qm=remove]').click();assert.equal(await p.evaluate(()=>apiWrites.at(-1).search),query);
  }
 }finally{await clean(p);}
});

test('P5 R4 supported Display and text sizes keep all five full targets in small-phone desk and hit tested',async()=>{
 const p=await fixture();try{
  await enter(p);let combinations=0;
  for(const width of [320,375])for(const scale of ['tiny','small','compact','medium','large'])for(const text of [16,20,24]){
   await p.setViewportSize({width,height:568});
   await p.evaluate(async({scale,text})=>{const {applyScale}=await import('/js/uiscale.js');applyScale(scale);document.documentElement.style.fontSize=text+'px';}, {scale,text});
   await p.locator('.np-phone-transport').scrollIntoViewIfNeeded();
   const geometry=await p.evaluate(()=>{const d=desk.getBoundingClientRect(),z=+getComputedStyle(document.documentElement).zoom;return {zoom:z,buttons:[...document.querySelectorAll('.np-phone-transport>button')].map(e=>{const r=e.getBoundingClientRect();return {name:e.getAttribute('aria-label'),left:r.left,right:r.right,width:r.width,height:r.height,inside:r.left>=d.left-0.5&&r.right<=d.right+0.5&&r.top>=d.top-0.5&&r.bottom<=d.bottom+0.5,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})};});
   assert.equal(geometry.buttons.length,5);assert.equal(geometry.buttons.every(b=>b.inside&&b.hit&&b.width>=44*geometry.zoom-0.5&&b.height>=44*geometry.zoom-0.5),true,JSON.stringify({width,scale,text,geometry}));combinations++;
   if(width===320&&scale==='large'&&text===20){console.log('P5 R4 amended geometry',JSON.stringify(geometry));await shot(p,'phone-320x568-large-20px-transport');}
  }
  console.log('P5 R4 Display/text combinations',combinations);
 }finally{await clean(p);}
});
test('0.6.8-#4 phone Now ⋯ sheet survives a routine zones refresh (zonesync) while its song context is unchanged',async()=>{
  const p=await fixture();try{
    await enter(p);await p.evaluate(()=>{S.auth.role='admin';S._nowZoneKey=Z.current().key;nowc.draw();});
    await p.locator('.np-phone-more').click();assert.equal(await p.locator('dialog.songsheet').count(),1);
    await p.evaluate(()=>{Z.sync();Z.sync();});
    assert.equal(await p.locator('dialog.songsheet').count(),1,'still open after zonesync');
    await p.evaluate(()=>{localStorage.setItem('wavwiz.zone','g:2');Z.sync();});
    assert.equal(await p.locator('dialog.songsheet').count(),0,'a real zone change still closes it');
  }finally{await clean(p);}
});

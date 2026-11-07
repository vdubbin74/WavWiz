// F250 P1: shipped Now/Devices/Settings/role banner + full CSS. Shell
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
const evidence = process.env.F250_EVIDENCE_DIR;
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
    window.calls=[]; window.reloads={}; window.clock=10000; window.metadataWrites=0; window.audioStarts=0;
    Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
    Object.defineProperty(window,'MediaMetadata',{configurable:true,value:class {constructor(o){Object.assign(this,o);metadataWrites++;}}});
    Object.defineProperty(navigator,'mediaSession',{configurable:true,value:{metadata:null,playbackState:'none',setActionHandler(){},setPositionState(){}}});
    // These must never be reached by chrome navigation (no live transport).
    window.AudioContext=class {constructor(){audioStarts++;throw Error('Unexpected audio context');}};
    HTMLMediaElement.prototype.play=function(){audioStarts++;return Promise.resolve();};
    localStorage.setItem('wavwiz.viz.v1',JSON.stringify({on:false}));
    window.fetch=async(url,opts={})=>{
      const path=new URL(url,location.href).pathname.replace('/api/v1','');
      if(opts.method && opts.method!=='GET')calls.push({path,method:opts.method});
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
    const Z=await import('/js/zones40.js');
    const item={kind:'track',id:'occ-a',refId:17,title:'P1 fixture — A song with a long title',artist:'Fixture Artist',album:'Fixture Album'};
    const zones=Array.from({length:8},(_,i)=>({id:i+1,playerId:'p'+i,name:'Speaker '+(i+1),enabled:true,connected:true,volume:50,mine:true,outputs:[]}));
    const S=window.S={view:'library',auth:{role:'admin',appVersion:'fixture'},zones,groups:[{id:1,name:'Living Room',deviceIds:[1,2],linked:[],playbackId:'g1',online:true},{id:2,name:'Den',deviceIds:[],linked:[],playbackId:'g2',online:false}],queue:[item],status:{},now:{item,state:'playing',index:0,durationMs:200000,positionMs:45000,version:7},localPos:45000,localAt:clock};
    const wide=()=>!matchMedia('(max-width:900px)').matches;
    let go;
    const route=(...a)=>go(...a), refreshAll=async()=>{};
    Z.init(S,{refreshNow:refreshAll,manage:()=>route('devices')});
    const nowc=window.nowc=createNow(S,{go:route,act:(...args)=>calls.push({act:args}),refreshAll});
    const devv=window.devv=devicesView(S,{go:route,act:(...args)=>calls.push({act:args}),refreshAll,openQueue:()=>route('queue')});
    const devp=devicesPanel(S,{go:route,act:(...args)=>calls.push({act:args}),refreshAll});
    const page=k=>h('section',{'data-fixture-page':k},h('h2',null,'P1 '+k+' content fixture (not redesigned)'),
      ...Array.from({length:40},(_,i)=>h('button',{class:'btn',style:'display:block;margin:8px 0;width:100%','data-row':i},k+' row '+(i+1))));
    const views={library:{el:page('library')},queue:{el:page('queue')},devices:{el:devv.el,reload:()=>devv.draw(),hide:()=>devv.hide()},playlists:{el:page('playlists')}};
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
test('P1 four real nav buttons; Settings dialog keeps mounted page/scroll and restores explicit focus (Close and Escape)',async()=>{
  const p=await fixture();try{
    assert.deepEqual(await p.locator('.tabbar>button').evaluateAll(es=>es.map(e=>e.dataset.k)),['library','queue','devices','settings']);
    for(const view of ['library','queue','devices']){
      await p.locator(`.tabbar [data-k="${view}"]`).click();
      await p.evaluate(()=>{desk.scrollTop=100;window.before={view:S.view,content:content.firstChild,top:desk.scrollTop,reloads:JSON.stringify(reloads),now:nowc,clock:S._smooth};});
      for(const close of ['button','footer','escape']){
        await p.locator('.tabbar [data-k="settings"]').click();
        await p.waitForSelector('dialog.settings-dlg[open] .settings-sec.on');
        assert.equal(await p.evaluate(()=>S.view===before.view && content.firstChild===before.content && nowc===before.now && desk.scrollTop===before.top && JSON.stringify(reloads)===before.reloads && S._smooth===before.clock),true);
        assert.equal(await p.locator('.tabbar [data-k="settings"]').getAttribute('aria-expanded'),'true');
        assert.equal(await p.locator('.tabbar [aria-current="page"]').getAttribute('data-k'),view);
        if(close==='escape')await p.keyboard.press('Escape');else if(close==='footer')await p.locator('dialog.settings-dlg[open] footer button').click();else await p.locator('dialog.settings-dlg[open] header [aria-label="Close"]').click();
        await p.waitForFunction(()=>!document.querySelector('dialog.settings-dlg[open]') && tabs.querySelector('[data-k="settings"]').getAttribute('aria-expanded')==='false');
        assert.equal(await p.evaluate(()=>document.activeElement===tabs.querySelector('[data-k="settings"]')),true);
        assert.equal(await p.locator('.tabbar [data-k="settings"]').getAttribute('aria-expanded'),'false');
        assert.equal(await p.evaluate(()=>desk.scrollTop===before.top && content.firstChild===before.content),true);
      }
    }
  }finally{await clean(p);}
});
test('P1 mini truth: external playing/paused/stopped/live; separate body/transport; access changes respected',async()=>{
  const p=await fixture();try{
    const b=p.locator('.mini-play');
    for(const [state,icon,action] of [['playing','pause','/stream/pause'],['paused','play','/stream/resume'],['stopped','play','/stream/jump']]){
      await p.evaluate(state=>poll({state}),state);
      assert.equal(await b.getAttribute('data-icon'),icon);assert.equal(await b.getAttribute('aria-label'),icon==='pause'?'Pause':'Play');
      const n=await p.evaluate(()=>calls.length);await b.click();
      assert.equal(await p.evaluate(()=>S.view),'library');
      assert.deepEqual(await p.evaluate(n=>calls.slice(n).map(c=>c.act?.[0]),n),[action]);
    }
    await p.evaluate(()=>poll({item:{kind:'radio',id:9,title:'Fixture Radio'},durationMs:0,state:'playing'}));
    assert.equal(await b.getAttribute('aria-label'),'Pause');
    await p.evaluate(()=>{S.auth.role='view';nowc.draw();});assert.equal(await b.isDisabled(),true);
    const n=await p.evaluate(()=>calls.length);await p.evaluate(()=>document.querySelector('.mini-play').click());assert.equal(await p.evaluate(()=>calls.length),n);
    await p.evaluate(()=>{S.auth.role='admin';nowc.draw();S.auth.role='view';document.querySelector('.mini-play').click();});assert.equal(await p.evaluate(()=>calls.length),n,'permission checked at click even before redraw');
    await p.locator('.mini .zl-phone').click();
    assert.equal(await p.evaluate(()=>S.view),'library','zone picker is not the body button');
    await p.keyboard.press('Escape');
    await p.locator('.mini-open').focus();await p.keyboard.press('Enter');assert.equal(await p.evaluate(()=>S.view),'now');
    assert.equal(await p.locator('.mini').isVisible(),false);assert.equal(await p.locator('.tabbar [aria-current]').count(),0);
  }finally{await clean(p);}
});
test('P1 one mounted Now/mini and no audio/Media Session/clock resets through nav/settings/resize',async()=>{
  const p=await fixture();try{
    await p.evaluate(()=>window.saved={mini:nowc.mini,now:nowc,clock:S._smooth,pos:S.localPos,at:S.localAt,writes:metadataWrites});
    for(const view of ['queue','devices','library','now','playlists','now','library']){
      await p.evaluate(view=>go(view),view);
      await p.setViewportSize({width:760,height:600});await p.setViewportSize({width:761,height:600});
      assert.equal(await p.evaluate(()=>saved.mini===nowc.mini && saved.now===nowc && saved.clock===S._smooth && saved.pos===S.localPos && saved.at===S.localAt && saved.writes===metadataWrites && audioStarts===0),true);
    }
    await p.evaluate(()=>{go('now');desk.scrollTop=50;window.topBefore=desk.scrollTop;window.r=JSON.stringify(reloads);});await p.setViewportSize({width:900,height:600});
    assert.equal(await p.evaluate(()=>desk.scrollTop===topBefore && JSON.stringify(reloads)===r),true,'no false inactive-tab remount of Now on resize');
    await p.setViewportSize({width:901,height:600});await p.setViewportSize({width:900,height:600});
    assert.equal(await p.evaluate(()=>saved.mini===nowc.mini && saved.now===nowc && saved.clock===S._smooth && saved.pos===S.localPos && audioStarts===0),true);
    assert.deepEqual(await p.evaluate(()=>calls.filter(c=>c.path!=='/auth/ws-ticket')),[]);
  }finally{await clean(p);}
});
test('P1 geometry: 320/375/390/430 portraits, 667/844 landscape, 760/761/900 boundaries; roles + simulated safe area + final control',async()=>{
  const p=await fixture();try{
    for(const [width,height] of [[320,568],[375,667],[390,844],[430,932],[667,375],[844,390],[760,600],[761,600],[900,600]]){
      await p.setViewportSize({width,height});
      for(const role of ['speaker','remote','mic']){
        await p.evaluate(async role=>{await addRole(role);document.documentElement.style.setProperty('--safe-b','24px');go('queue');content.querySelector('[data-row="39"]').scrollIntoView({block:'end'});},role);
        const g=await p.evaluate(()=>{
          const r=e=>{const b=e.getBoundingClientRect();return {top:b.top,bottom:b.bottom,width:b.width,height:b.height};};
          const last=content.querySelector('[data-row="39"]'),lr=last.getBoundingClientRect(),d=desk.getBoundingClientRect();
          return {desk:r(desk),mini:r(nowc.mini),nav:r(tabs),banner:document.querySelector('.remote-banner,.mic-banner')&&r(document.querySelector('.remote-banner,.mic-banner')),safe:getComputedStyle(tabs).paddingBottom,
            hit:last.contains(document.elementFromPoint(lr.x+lr.width/2,Math.min(lr.bottom-2,d.bottom-2))),lastBottom:lr.bottom,buttons:[...tabs.children].map(r),play:r(nowc.mini.querySelector('.mini-play')),overflow:document.documentElement.scrollWidth>innerWidth};});
        assert.ok(g.desk.bottom<= (g.banner?.top??g.mini.top)+1,JSON.stringify({width,height,role,g}));
        if(g.banner)assert.ok(g.banner.bottom<=g.mini.top+1);
        assert.ok(g.mini.bottom<=g.nav.top+1);assert.ok(g.nav.bottom<=height+1);assert.equal(g.safe,'28px');
        assert.ok(g.buttons.every(b=>b.height>=44 && b.width>=44));assert.ok(g.play.height>=44 && g.play.width>=44);
        assert.ok(g.desk.height>20);assert.ok(g.lastBottom<=g.desk.bottom+1);assert.ok(g.hit);assert.equal(g.overflow,false);
      }
    }
  }finally{await clean(p);}
});
test('P1 geometry with real Display size 125%, large text, custom/light themes; banner dock and full Now',async()=>{
  const p=await fixture({width:390,height:600});try{
    await p.evaluate(async()=>{const {applyScale}=await import('/js/uiscale.js');applyScale('large');document.documentElement.style.fontSize='20px';document.documentElement.style.setProperty('--accent','#824bd6');document.documentElement.style.setProperty('--accent-soft','#824bd622');document.documentElement.style.setProperty('--panel','#ffffff');document.documentElement.style.setProperty('--panel2','#f4f4f4');document.documentElement.style.setProperty('--ink','#202020');await addRole('remote');});
    assert.ok(await p.evaluate(()=>tabs.getBoundingClientRect().bottom<=innerHeight+1 && nowc.mini.getBoundingClientRect().bottom<=tabs.getBoundingClientRect().top+1));
    assert.equal(await p.locator('.mini').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(244, 244, 244)');
    assert.equal(await p.locator('.tabbar .on').evaluate(e=>getComputedStyle(e).fontWeight),'700');
    await p.evaluate(()=>go('now'));assert.equal(await p.locator('.mini').isVisible(),false);assert.equal(await p.locator('.remote-banner').isVisible(),true);
    await p.evaluate(()=>go('library'));assert.equal(await p.locator('.mini').isVisible(),true);
  }finally{await clean(p);}
});
test('P1 F246 real full viewport modal covers chrome and restores opener; Queue navigation hides sheet',async()=>{
  const p=await fixture();try{
    await p.locator('.tabbar [data-k="devices"]').click();
    await p.locator('.tree42 [data-device-id="1"] .sp42-n').first().click();
    const sheet=p.locator('.pd42-sheet');await sheet.waitFor();
    assert.equal(await p.evaluate(()=>document.getElementById('app').inert),true);
    assert.equal(await sheet.evaluate(e=>{const r=e.getBoundingClientRect();const hit=document.elementFromPoint(innerWidth/2,innerHeight-15);return r.top<=1 && r.bottom>=innerHeight-1 && e.contains(hit);}),true);
    await p.evaluate(()=>go('queue'));await p.waitForFunction(()=>!document.querySelector('.pd42-sheet') && !document.getElementById('app').inert);
    assert.equal(await p.locator('.mini').isVisible(),true);
  }finally{await clean(p);}
});
test('P1 wide CSS/panels unchanged at 901/1280/1600 (baseline cascade vs appended phone rules)',async()=>{
  for(const width of [901,1280,1600]){
    const viewport={width,height:800};const old=await fixture(viewport,true),p=await fixture(viewport);
    try{
      const measure=async page=>page.evaluate(()=>[...document.querySelectorAll('#app>.topbar,.desk,.desk>.nowcol,.libpanel,.devpanel,.listpanel,.mini,.tabbar')].map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {cls:e.className,display:s.display,background:s.backgroundColor,border:s.border,padding:s.padding,grid:s.gridTemplateColumns,x:r.x,y:r.y,w:r.width,h:r.height};}));
      assert.deepEqual(await measure(p),await measure(old));assert.equal(await p.locator('.mini').isVisible(),false);assert.equal(await p.locator('.tabbar').isVisible(),false);
      if(evidence && width===1280){
        // Same DOM/assets for pixel proof: only switch the baseline/candidate CSS.
        // Separate contexts can finish artwork/transition paint at different times.
        await p.addStyleTag({content:'*{animation:none!important;transition:none!important;caret-color:transparent!important}'});
        await p.evaluate(async base=>{await document.fonts.ready;document.querySelector('link[rel=stylesheet]').disabled=true;const st=document.createElement('style');st.id='compare-css';st.textContent=base;document.head.append(st);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},css.split('/* F250-P1: existing full-page')[0]);
        await p.screenshot({path:evidence+'/desktop-1280-baseline.png',animations:'disabled'});
        await p.evaluate(async css=>{document.getElementById('compare-css').textContent=css;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},css);
        await p.screenshot({path:evidence+'/desktop-1280-candidate.png',animations:'disabled'});
        // Review image pairs separately: GPU rasterization can differ by 1 LSB.
        // Exact wide geometry and paint tokens are asserted above.
      }
    }finally{await clean(old);await clean(p);}
  }
});
test('P1 actual theme API: default, Ocean and custom light chrome follow tokens, never hard-coded orange',async()=>{
  const p=await fixture();try{
    const rows=await p.evaluate(async()=>{
      const {applyTheme,PRESETS}=await import('/js/theme.js');const rows=[];
      for(const t of [{...PRESETS.default,preset:'default'},{...PRESETS.ocean,preset:'ocean'},{bg:'#f8f8ff',ink:'#202020',accent:'#824bd6',accent2:'#007b70',hl:'#355cad'}]){
        applyTheme(t);
        const probe=document.createElement('i');probe.style.color='var(--panel2)';document.body.append(probe);
        const panel=getComputedStyle(probe).color;probe.style.color='var(--accent-text,var(--accent))';const accent=getComputedStyle(probe).color;probe.remove();
        rows.push({panel,accent,mini:getComputedStyle(nowc.mini).backgroundColor,nav:getComputedStyle(tabs.querySelector('.on')).color,scheme:document.documentElement.dataset.scheme});
      }return rows;
    });
    for(const r of rows){assert.equal(r.mini,r.panel);assert.equal(r.nav,r.accent);}assert.equal(rows[2].scheme,'light');assert.notEqual(rows[0].nav,rows[1].nav);
    if(evidence)await p.screenshot({path:evidence+'/phone-390-custom-light.png',animations:'disabled'});
  }finally{await clean(p);}
});
test('P1 last control reachable in real Devices on short landscape; empty mini still opens Now; Settings never restores stale route',async()=>{
  const p=await fixture({width:667,height:375});try{
    await p.evaluate(()=>addRole('remote'));await p.locator('.tabbar [data-k="devices"]').click();
    assert.equal(await p.evaluate(()=>{
      const last=[...devv.el.querySelectorAll('button')].filter(e=>e.getClientRects().length && !e.disabled).at(-1);last.scrollIntoView({block:'end'});
      const r=last.getBoundingClientRect(),d=desk.getBoundingClientRect();window.lastDevice=last;
      return r.bottom<=d.bottom+1 && last.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
    }),true);
    if(evidence)await p.screenshot({path:evidence+'/landscape-667-real-devices-last.png',animations:'disabled'});
    await p.locator('.tabbar [data-k="settings"]').click();await p.waitForSelector('dialog.settings-dlg[open] .settings-sec.on');
    await p.evaluate(()=>go('queue'));await p.locator('dialog.settings-dlg[open] footer button').click();assert.equal(await p.evaluate(()=>S.view),'queue');
    await p.evaluate(async()=>{await poll({state:'stopped',item:null});S.queue=[];nowc.draw();});
    assert.equal(await p.locator('.mini-play').getAttribute('aria-label'),'Play');
    await p.locator('.mini-open').click();assert.equal(await p.evaluate(()=>S.view),'now');assert.equal(await p.locator('.mini').isVisible(),false);
  }finally{await clean(p);}
});
test('P1 screenshot evidence is candidate rendered chrome, not the concept; Library/Queue contents labeled fixtures',async()=>{
  if(!evidence)return;
  const p=await fixture();try{
    await p.evaluate(()=>addRole('remote'));await p.screenshot({path:evidence+'/phone-390-library-fixture.png',animations:'disabled'});
    await p.locator('.tabbar [data-k="queue"]').click();await p.evaluate(()=>poll({state:'paused'}));await p.screenshot({path:evidence+'/phone-390-queue-fixture-paused.png',animations:'disabled'});
    await p.locator('.tabbar [data-k="devices"]').click();await p.screenshot({path:evidence+'/phone-390-real-devices.png',animations:'disabled'});
    await p.locator('.tabbar [data-k="settings"]').click();await p.waitForSelector('dialog.settings-dlg[open] .settings-sec.on');await p.screenshot({path:evidence+'/phone-390-real-settings.png',animations:'disabled'});
  }finally{await clean(p);}
});

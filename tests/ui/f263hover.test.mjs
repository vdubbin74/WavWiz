// F262 diagnostic only: shipped modules + all seven index.html styles; mocked APIs, NOT an iPhone reproduction.
// Shell navigation and resize execute the actual main.js function bodies, with unrelated services stubbed.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {localDom} from './helpers/local-dom.mjs';
const repo=new URL('../../',import.meta.url).pathname;
const main = readFileSync(repo + '/src/WavWiz.Server/wwwroot/js/main.js', 'utf8');
assert.match(main, /views\.devices = \{[^;]+hide: \(\) => devv\.hide\(\)/, 'main registers the real Devices hide hook');
const goSource = main.slice(main.indexOf('export function go('), main.indexOf('const checklistGo')).replace('export ', '');
const modeSource = main.slice(main.indexOf('const applyMode = () =>'), main.indexOf("window.addEventListener('resize', () => { applyMode();"));
let dom;
before(async () => { dom = await localDom(); }); after(async () => { await dom?.close(); });
async function fixture(viewport) {
  const context=await dom.browser.newContext({viewport:viewport||{width:1600,height:1000},hasTouch:false});await context.route('**/*',r=>new URL(r.request().url()).origin===dom.url?r.continue():r.abort());const p=await context.newPage();p.setDefaultTimeout(5000);await p.goto(dom.url);
  for(const url of ['/mini.css','/jukebox-palette.css','/jukebox.css','/ss-premium.css','/eq-premium.css','/panel-rail.css']) await p.addStyleTag({url});
  if(process.env.F263_BASELINE)for(const name of ['devices','zones40','tree42','scenesched'])await p.route('**/js/'+name+'.js',route=>route.fulfill({contentType:'text/javascript',body:readFileSync(process.env.F263_BASELINE+'/'+name+'.js','utf8')}));
  p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
  await p.evaluate(async ({goSource, modeSource}) => {
    window.calls = [];window.clockNow='2026-11-07T00:00:00Z';window.timeOffset=0;const realNow=Date.now;Date.now=()=>realNow()+timeOffset; window.hotkeys = []; window.netMode='ok'; window.pendingDelay=[]; window.completeDelay=()=>pendingDelay.splice(0).forEach(f=>f());
    const { flatEq } = await import('/js/eq.js');
    const presets = [{id:1,name:'Flat',source:'builtin',json:{...flatEq(),balance:-77,bass:{gainDb:2},treble:{gainDb:-0.5}}}, {id:2,name:'Late Night',source:'builtin',json:{...flatEq(),graphicDb:[3,2,1,0,0,0,0,0,0,0]}}];
    window.fetch = async (url, opts = {}) => {
      const path = new URL(url, location.href).pathname.replace('/api/v1', ''); const method = opts.method || 'GET';
      if (method !== 'GET') calls.push({path,method,body: opts.body ? JSON.parse(opts.body) : null});
      if (path === '/dsp/preview' && netMode==='preview-hang') return new Promise(()=>{});
      if (path === '/dsp/preview' && netMode==='preview-reject') throw new Error('focused preview failure');
      if (path === '/dsp/presets' && method!=='GET' && netMode==='save-reject') return new Response(JSON.stringify({error:'focused save failure'}),{status:503});
      if(path.includes('/latency')&&method==='PUT'&&netMode==='delay-hang') await new Promise(resolve=>pendingDelay.push(resolve));
      let value = [];
      if (path === '/dsp/presets') value = method==='GET'?presets:{id:9};
      if (path.startsWith('/dsp/assignments/')) value = {presetId:1};
      if (path === '/scenes') value=window.sceneData||[{id:10,name:'Evening',members:[{deviceId:1,enabled:true,volume:41}]}];
      if (path === '/schedules/clock') value={now:clockNow};
      if (path === '/profiles') value = [{id:10,name:'Evening'},{id:11,name:'Morning'}];
      if (path.startsWith('/profiles/for/')) value = {profileId:10,modified:false};
      if (path === '/cast') value = {active:false};
      if (path === '/receivers/zones') value = {zones:[]};
      return new Response(JSON.stringify(value), {status:200});
    };
    const {devicesPanel} = await import('/js/devices.js');localStorage.setItem('wavwiz.devsize','standard');
    const { installHotkeys } = await import('/js/hotkeys.js'); const {installSliderGuard} = await import('/js/slider.js'); installSliderGuard();
    const { viewForMode } = await import('/js/viewmode.js');
    installHotkeys(id => hotkeys.push(id));
    const outputs = [{deviceId:'out-a',endpointDbId:1,name:'Speakers',kind:'analog',active:true,connected:true,latencyMs:600}, {deviceId:'out-b',endpointDbId:2,name:'Headphones',kind:'usb',active:false,connected:true,latencyMs:30}];
    const zones = Array.from({length:12}, (_,i) => ({id:i+1,playerId:'p'+i,name:i===0?'iPhone':'Speaker '+(i+1),enabled:true,connected:true,volume:41,volCap:100,volLocked:true,muted:false,mine:true,outputs:structuredClone(outputs)}));
    const S = window.S = { view:'devices', auth:{role:'admin'}, zones, groups:[{id:1,name:'Kitchen',deviceIds:zones.map(z=>z.id),linked:[],playbackId:'g1',online:true,now:{state:'playing'}},{id:2,name:'Den',deviceIds:[],linked:[],playbackId:'g2',online:false}], now:{state:'paused'},cast:{active:false},jb:{},status:{} };
    const app = document.getElementById('app'); app.innerHTML = '<div class="topbar"><button>Background top</button></div><div class="desk" data-view="devices"><main id="view"></main></div><div class="mini"><button>Mini</button></div><nav class="tabbar"><button data-k="devices">Devices</button></nav>';
    const desk = document.querySelector('.desk'), content = document.getElementById('view'), tabs = document.querySelector('.tabbar'), navButtons = [];
    const wide = () => innerWidth > 900;
    const ctl = {act:(...args)=>calls.push({act:args}),refreshAll:async()=>{},go:k=>calls.push({go:k}),openQueue:()=>go('queue')};await (await import('/js/zones40.js')).init(S);
    const v = window.v = devicesPanel(S,ctl), views = { devices:{el:v.el,reload:()=>v.draw(),hide:()=>v.hide()}, queue:{el:Object.assign(document.createElement('div'),{id:'queue-fixture'})}, library:{el:document.createElement('div')} };
    const go = window.go = new Function('S','views','wide','desk','content','tabs','navButtons','nowc', goSource+'; return go;')(S,views,wide,desk,content,tabs,navButtons,{drawChecklist(){}});
    const applyMode = new Function('S','views','wide','desk','content','tabs','go','viewForMode',modeSource+'; return applyMode;')(S,views,wide,desk,content,tabs,go,viewForMode);
    window.addEventListener('resize',applyMode);
    content.append(v.el);v.setSize('standard');v.draw();
  }, {goSource, modeSource});
  return p;
}



const selectors=['.tree42 [data-device-id="1"] .sp42-n','.tree42 .zname','.tree42 .zl-now','.tree42 .qb42-t','.dss-run'];
async function unchanged(p,sel,tick=false){
 const e=p.locator(sel).first();await e.scrollIntoViewIfNeeded();await e.hover();await p.waitForTimeout(300);assert.ok(await e.evaluate(e=>e.matches(':hover')),'fixture hover '+sel);
 await e.evaluate(e=>{window.kept=e;window.keepTitle=e.title;window.keepCursor=getComputedStyle(e).cursor;window.keepRect=e.getBoundingClientRect().toJSON()});
 await p.evaluate(tick=>{S.zones=structuredClone(S.zones);S.groups=structuredClone(S.groups);if(tick){S.groups[0].now={state:'playing',title:'Song',artist:'A',durationMs:100000,positionMs:33000};S._groupsAt=Date.now()}v.draw()},tick);await p.waitForTimeout(60);
 assert.ok(await e.evaluate(e=>e===kept&&kept.isConnected),'hovered node survives '+sel);
 assert.ok(await e.evaluate(e=>e.matches(':hover')),'hover survives '+sel+' '+JSON.stringify(await e.evaluate(e=>({before:keepRect,after:e.getBoundingClientRect().toJSON(),hit:document.elementFromPoint(keepRect.x+keepRect.width/2,keepRect.y+keepRect.height/2)?.outerHTML.slice(0,150)}))));assert.equal(await e.evaluate(e=>e.title),await p.evaluate(()=>keepTitle));
 assert.equal(await e.evaluate(e=>getComputedStyle(e).cursor),await p.evaluate(()=>keepCursor));
}
test('F263 unchanged desktop polls preserve speaker, zone, scene and now-line hover',async()=>{
 const p=await fixture();try{
 await p.waitForSelector('.dss-run');
 await p.evaluate(()=>{S.groups[0].now={state:'playing',title:'Song',artist:'A',durationMs:100000,positionMs:20000};S._groupsAt=Date.now();v.draw()});
 for(const sel of selectors)await unchanged(p,sel);
 await unchanged(p,'.tree42 .zl-now',true);
 }finally{await p.context().close()}
});
test('F263 expanded unchanged poll preserves Back button and tooltip',async()=>{
 const p=await fixture();try{
 await p.evaluate(()=>v.setSize('expanded'));
 await p.locator('.tree42 .zname').first().click();
 await unchanged(p,'.d42-back');
 }finally{await p.context().close()}
});

test('F263 deferred hovered speaker and zone changes retry; retained controls use current JSON',async()=>{
 const p=await fixture();try{
 const name=p.locator('.tree42 [data-device-id="1"] .sp42-n');await name.hover();await p.waitForTimeout(100);
 await p.evaluate(()=>{S.zones=structuredClone(S.zones);S.groups=structuredClone(S.groups);S.zones[0].name='Renamed iPhone';S.groups[0].name='New Kitchen';v.draw()});
 await p.mouse.move(1500,900);await p.evaluate(()=>v.draw());
 await p.waitForFunction(()=>document.querySelector('.tree42 [data-device-id="1"] .sp42-n')?.textContent==='Renamed iPhone');
 assert.equal(await p.locator('.tree42 .zname').first().textContent(),'New Kitchen');
 // A clone-only poll must not keep mutation closures tied to the discarded speaker objects.
 await p.evaluate(()=>{S.zones=structuredClone(S.zones);S.groups=structuredClone(S.groups);v.draw();window.calls=[]});
 const pill=p.locator('.tree42 .zcard42 .onpill').first();await pill.click();await pill.click();
 const writes=await p.evaluate(()=>calls.filter(c=>c.act?.[0]==='/zones/1').map(c=>c.act[1].enabled));
 assert.deepEqual(writes,[false,true]);
 await p.evaluate(()=>{S.zones=structuredClone(S.zones);S.zones[0].muted=true;v.draw();window.calls=[]});
 await p.locator('.tree42 [data-device-id="1"] .sp42-mute').click();
 assert.ok(await p.evaluate(()=>calls.some(c=>c.act?.[0]==='/zones/1'&&c.act[1].muted===false)));
 assert.deepEqual(p.errors,[]);
 }finally{await p.context().close()}
});
test('F263 now-line updates metadata and clock in place and its retained click selects the valid zone',async()=>{
 const p=await fixture();try{
 const line=p.locator('.tree42 .zl-now').first();await line.hover();await line.evaluate(e=>window.line=e);
 await p.evaluate(()=>{S.groups=structuredClone(S.groups);S.groups[0].now={state:'playing',title:'New Song',artist:'New Artist',durationMs:100000,positionMs:40000};S._groupsAt=Date.now();v.draw()});
 assert.ok(await line.evaluate(e=>e===window.line));assert.match(await line.textContent(),/New Song/);
 assert.ok(await line.evaluate(e=>e._zl.now===S.groups[0].now));await line.click();
 assert.equal(await p.evaluate(()=>localStorage.getItem('wavwiz.zone')),'g:1');
 assert.ok(await p.evaluate(()=>calls.some(c=>c.go==='now')));
 }finally{await p.context().close()}
});
test('F263 scene inventory refreshes and retained unchanged scene handlers still apply by ID',async()=>{
 const p=await fixture();try{
 await p.waitForSelector('.dss-run');await unchanged(p,'.dss-run');await p.locator('.dss-run').click();
 assert.ok(await p.evaluate(()=>calls.some(c=>c.path==='/scenes/10/apply')));
 await p.evaluate(()=>{sceneData=[{id:20,name:'Morning',members:[{deviceId:2,enabled:true,volume:20}]}];timeOffset+=31000;v.draw()});
 await p.waitForSelector('.dss-run[data-scene="20"]');assert.equal(await p.locator('.dss-run[data-scene="10"]').count(),0);
 await p.locator('.dss-run[data-scene="20"]').click();assert.ok(await p.evaluate(()=>calls.some(c=>c.path==='/scenes/20/apply')));
 await p.evaluate(()=>v.setSize('expanded'));await p.waitForSelector('.ssc-scene[data-scene="20"] .ss-play');
 const run=p.locator('.ssc-scene[data-scene="20"] .ss-play');await run.hover();await run.evaluate(e=>window.sceneRun=e);
 await p.evaluate(()=>{clockNow='2026-11-07T00:01:00Z';timeOffset+=16000;v.draw()});
 await p.waitForFunction(()=>document.querySelector('.ssc-clock')?.textContent.includes('00:01')||document.querySelector('.ssc-clock')?.textContent.includes('12:01'));
 assert.ok(await run.evaluate(e=>e===sceneRun),'clock-only poll must not remount scene controls');
 // Inventory includes speaker names for scene tooltips and current scene membership.
 await p.evaluate(()=>{S.zones=structuredClone(S.zones);S.zones[1].name='Patio Renamed';sceneData=[{id:20,name:'Morning Updated',members:[{deviceId:2,enabled:true,volume:55}]}];timeOffset+=16000;v.draw()});
 await p.waitForFunction(()=>document.querySelector('.ssc-scene[data-scene="20"] .ss-play')?.getAttribute('aria-label')==='Run Morning Updated');
 assert.match(await p.locator('.ssc-scene[data-scene="20"] .ss-sub').getAttribute('title'),/Patio Renamed/);
 await p.locator('.ssc-scene[data-scene="20"] .ss-play').click();assert.ok(await p.evaluate(()=>calls.some(c=>c.path==='/scenes/20/apply')));
 assert.deepEqual(p.errors,[]);
 }finally{await p.context().close()}
});

test('F263 retained zone switch mutates current poll objects on repeated clicks',async()=>{
 const p=await fixture();try{
 await p.evaluate(()=>{S.zones=structuredClone(S.zones);S.groups=structuredClone(S.groups);v.draw();calls=[]});
 const pill=p.locator('.tree42 .zcard42 .onpill').first();await pill.click();await pill.click();
 assert.deepEqual(await p.evaluate(()=>calls.filter(c=>c.act?.[0]==='/zones/1').map(c=>c.act[1].enabled)),[false,true]);
 }finally{await p.context().close()}
});
test('F263 speaker/zone membership inventory changes and retained context menus use current IDs',async()=>{
 const p=await fixture();try{
 // Open the existing speaker's menu against fresh JSON before its next render.
 await p.evaluate(()=>{S.zones=structuredClone(S.zones);S.groups=structuredClone(S.groups);S.zones[0].enabled=false;S.groups.push({id:3,name:'New Zone',deviceIds:[],linked:[],playbackId:'g3'})});
 const row=p.locator('.tree42 [data-device-id="1"]');await row.click({button:'right'});
 assert.match(await p.locator('.ctxmenu [data-ctx="off"]').textContent(),/Enable/);
 await p.locator('.ctxmenu [data-ctx="off"]').click();assert.ok(await p.evaluate(()=>calls.some(c=>c.act?.[0]==='/zones/1'&&c.act[1].enabled===true)));
 await p.evaluate(()=>{S.groups[0].deviceIds=[2];S.groups[1].deviceIds=[1];S.zones=S.zones.filter(z=>z.id<3);v.draw()});
 await p.mouse.move(1500,900);await p.evaluate(()=>v.draw());
 assert.equal(await p.locator('.tree42 [data-device-id="1"]').getAttribute('data-in-zone'),'2');
 assert.equal(await p.locator('.tree42 [data-device-id="3"]').count(),0);
 assert.equal(await p.locator('.tree42 [data-group-id="3"] .zname').textContent(),'New Zone');
 assert.deepEqual(p.errors,[]);
 }finally{await p.context().close()}
});

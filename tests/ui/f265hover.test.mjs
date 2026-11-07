// F265 (fixture from F263): shipped modules + all seven index.html styles; mocked APIs, NOT an iPhone reproduction.
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




// F265: every pointer-cursor control inside the ACTIVE (playing) zone keeps its node, :hover, title and cursor over several polls that change live values.
const ZSEL=['.tree42 .qb42 .zmute','.tree42 .qb42 .zl-now','.tree42 .qb42 .qb42-t','.tree42 .qb42 .onpill','.tree42 .dtag.ref','.tree42 [data-device-id="2"] .sp42-n'];
test('F265 active zone: hovered controls survive 5 changing polls (also with (hover: hover) false)',async()=>{
 for(const noHoverMedia of [false,true]){const p=await fixture();try{
  if(noHoverMedia)await p.evaluate(()=>{const mm=window.matchMedia.bind(window);window.matchMedia=q=>/hover/.test(q)?{matches:false,media:q,addEventListener(){},removeEventListener(){}}:mm(q)});
  await p.evaluate(()=>{S.zones[0].reference=true;S.groups[0].now={state:'playing',title:'Song',artist:'A',durationMs:200000,positionMs:20000};S._groupsAt=Date.now();v.draw()});
  for(const sel of ZSEL){const e=p.locator(sel).first();if(!await e.count()){console.log('F265 absent',sel);continue;}await e.scrollIntoViewIfNeeded();await e.hover();await p.waitForTimeout(120);
   await e.evaluate(e=>{window.kept=e;window.kt=e.title;window.kc=getComputedStyle(e).cursor});
   for(let i=1;i<=5;i++){await p.evaluate(i=>{S.zones=structuredClone(S.zones);S.groups=structuredClone(S.groups);S.zones.forEach(z=>{z.volume=40+i;z.room={state:i%2?'ok':'buffering'}});S.groups[0].now={...S.groups[0].now,positionMs:20000+i*11000};S._groupsAt=Date.now();v.draw()},i);await p.waitForTimeout(40);
    assert.ok(await e.evaluate(e=>e===kept&&e.isConnected&&e.matches(':hover')),`${sel} poll ${i} hoverMedia=${!noHoverMedia}`);
    assert.equal(await e.evaluate(e=>e.title),await p.evaluate(()=>kt));assert.equal(await e.evaluate(e=>getComputedStyle(e).cursor),await p.evaluate(()=>kc));}
  }
  await p.mouse.move(1590,990);await p.evaluate(()=>v.draw());await p.waitForTimeout(60);
  assert.match(await p.locator('.tree42 .qb42 .qb42-vol').first().innerHTML(),/45%|45/,'deferred live values land after the pointer leaves');
  assert.deepEqual(p.errors,[]);
 }finally{await p.context().close()}}
});

// F250-P7: real phoneSound + eqArea + soundSettings + wsel/ctxmenu + Now.
// Verbatim main open/close/showEq entry; controlled fake DSP/output API, no app
// boot/server/audio/device/OS safe-area proof. Full shipped CSS, no copied engine.
import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {localDom} from './helpers/local-dom.mjs';
const main=readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/main.js',import.meta.url),'utf8');
const entry=main.slice(main.indexOf('let eqSheet = null'),main.indexOf('// F92:')).replaceAll('export function','function');
const E=process.env.F250_P7_EVIDENCE_DIR;if(E)mkdirSync(E,{recursive:true});
const base=process.env.F250_P7_BASE_REF;
const parentAssets=base?Object.fromEntries(['app.css','js/main.js','js/now.js'].map(f=>[f,execFileSync('git',['show',base+':src/WavWiz.Server/wwwroot/'+f],{encoding:'utf8'})])):null;
let dom;before(async()=>dom=await localDom());after(async()=>await dom?.close());
async function fixture({width=390,height=844,role='admin',mine=false,parent=false}={}){
 const p=await dom.page({width,height});p.errors=[];p.on('pageerror',e=>p.errors.push(e.stack));await p.emulateMedia({reducedMotion:'reduce'});
 if(parent&&parentAssets){for(const [f,body] of Object.entries(parentAssets))await p.route('**/'+f,r=>r.fulfill({contentType:f.endsWith('.css')?'text/css':'text/javascript',body}));await p.reload();}
 await p.evaluate(()=>['mini','jukebox-palette','jukebox','ss-premium','eq-premium','panel-rail'].forEach(n=>{const e=document.createElement('link');e.rel='stylesheet';e.href='/'+n+'.css';document.head.append(e);}));
 await p.route(/\/api\/v1\/art\//,r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#326478"/><circle cx="200" cy="200" r="140" fill="#698eac"/></svg>'}));
 await p.evaluate(async({entry,role,mine})=>{
  window.calls=[];window.msWrites=0;window.audioStarts=0;window.returns=0;
  Object.defineProperty(window,'MediaMetadata',{configurable:true,value:class{constructor(o){Object.assign(this,o);msWrites++;}}});
  Object.defineProperty(navigator,'mediaSession',{configurable:true,value:{metadata:null,playbackState:'none',setActionHandler(){},setPositionState(){}}});
  window.AudioContext=class{constructor(){audioStarts++;throw Error('unexpected audio');}};HTMLMediaElement.prototype.play=()=>{audioStarts++;return Promise.resolve();};
  localStorage.setItem('wavwiz.viz.v1',JSON.stringify({on:false}));localStorage.setItem('wavwiz.eqlock.v1','0');
  const {h,api}=await import('/js/util.js'),{flatEq}=await import('/js/eq.js'),Z=window.Z=await import('/js/zones40.js'),{createNow}=await import('/js/now.js'),{openPhoneSound}=await import('/js/phonesound.js');
  const flat=flatEq();flat.name='Flat';
  window.presets=[{id:1,name:'Flat',source:'builtin',json:flat},{id:2,name:'Bass Boost',source:'builtin',json:{...flat,graphicDb:[5,4,3,2,1,0,0,0,0,0]}}];
  window.assignments={'dac-a':{presetId:1,enabled:true,bypass:false},'dac-b':{presetId:1,enabled:true,bypass:false},'dac-c':{presetId:1,enabled:true,bypass:false}};
  window.preview={};window.nextId=20;window.delayPath=null;window.release=null;window.failPath=null;
  window.S={auth:{role},view:'now',now:{item:{id:'occ-0',kind:'track',refId:101,title:'Sound fixture song',artist:'API fixture artist',album:'Fixture'},index:0,state:'playing',positionMs:45000,durationMs:180000,version:1},queue:[],localPos:45000,localAt:performance.now(),groups:[{id:1,name:'Fixture Den',playbackId:'den',online:true,deviceIds:[11]},{id:2,name:'Fixture Patio',playbackId:'patio',online:true,deviceIds:[22]}],zones:[
   {id:11,name:'Den speaker',mine,connected:true,enabled:true,volume:50,outputs:[{deviceId:'dac-a',name:'Main DAC',endpointDbId:101,active:true,connected:true},{deviceId:'dac-b',name:'Headphones',endpointDbId:102,active:false,connected:true}]},
   {id:22,name:'Patio speaker',connected:true,enabled:true,volume:50,outputs:[{deviceId:'dac-c',name:'Patio DAC',endpointDbId:201,active:true,connected:true}]}],status:{}};
  window.fetch=async(url,opts={})=>{
   const u=new URL(url,location.href),path=u.pathname.replace('/api/v1',''),method=opts.method||'GET',body=opts.body?JSON.parse(opts.body):null;
   calls.push({path,query:u.search,method,body});
   if(delayPath===path){await new Promise(r=>window.release=r);delayPath=null;}
   if(failPath===path)return new Response(JSON.stringify({error:'Fixture API failed'}),{status:500});
   let v={};
   if(path==='/dsp/presets'&&method==='GET')v=presets;
   else if(path==='/dsp/presets'&&method==='POST'){const id=nextId++;presets.push({id,name:body.name,source:'user',json:body.preset});v={id};}
   else if(/^\/dsp\/presets\//.test(path)){const id=+path.split('/').at(-1),p=presets.find(x=>x.id===id);Object.assign(p,{name:body.name,json:body.preset});}
   else if(path.startsWith('/dsp/assignments/')){const id=decodeURIComponent(path.split('/').at(-1));if(method==='PUT')assignments[id]=body;v=assignments[id];}
   else if(path==='/dsp/preview')preview[body.deviceId]=body.preset;
   else if(path==='/dsp/revert')delete preview[body.deviceId];
   else if(path==='/dsp/response')v={hz:[20,100,1000,20000],db:[0,0,0,0]};
   else if(/^\/zones\/\d+\/output$/.test(path)){const z=S.zones.find(z=>z.id===+path.split('/')[2]);z.outputs.forEach(o=>o.active=o.endpointDbId===body.endpointId);}
   else if(path==='/checklist')v={dismissed:true,remaining:0};
   return new Response(JSON.stringify(v));
  };
  Z.init(S,{});const act=(path,body,method='POST')=>api(path,{body,method});
  const refreshAll=async()=>window.dispatchEvent(new CustomEvent('wavwiz:zonesdata'));
  const nowc=window.nowc=createNow(S,{act,go:k=>window.go(k),openEq:()=>window.soundEntry.showEq()});
  const desk=window.desk=h('div',{class:'desk',id:'desk','data-view':'now'},h('main',{class:'view'},'Fixture prior Library'),nowc.el,nowc.npbar);
  const nav=h('nav',{class:'tabbar'},h('button',{},'Library'),h('button',{},'Queue'),h('button',{},'Devices'),h('button',{},'Settings'));
  document.getElementById('app').replaceChildren(h('header',{class:'topbar'},'P7 API FIXTURE'),desk,nowc.mini,nav);document.body.append(h('div',{id:'toasts'}));
  window.go=k=>{S.view=k;desk.dataset.view=k;};
  window.soundEntry=new Function('S','nowc','openPhoneSound','refreshAll','wide','go',entry+';return {openPhoneEqSheet,closePhoneEqSheet,showEq};')(S,nowc,openPhoneSound,refreshAll,()=>!matchMedia('(max-width:900px)').matches,go);
  nowc.draw();window.snapshot={now:nowc,el:nowc.el,mini:nowc.mini,pos:S.localPos,at:S.localAt};
 },{entry,role,mine});
 await p.waitForTimeout(100);return p;
}
const sheet=p=>p.locator('dialog.npeqsheet[open]');
async function open(p){await p.locator('.np-phone-sound').click();await p.waitForSelector('.npeqsheet .eqall');}
async function close(p){await p.locator('.npeqsheet .eqsheet-x').click();}
async function clean(p){try{assert.deepEqual(p.errors,[]);}finally{await p.context().close();}}
const dspWrites=p=>p.evaluate(()=>calls.filter(c=>c.method!=='GET'&&c.path!=='/dsp/response'&&/^\/(dsp|zones)\//.test(c.path)));
async function input(p,label,value){await p.locator(`.npeqsheet input[aria-label="${label}"]`).evaluate((e,v)=>{if(e.type==='checkbox')e.checked=v;else e.value=String(v);e.dispatchEvent(new Event(e.type==='checkbox'?'change':'input',{bubbles:true}));},value);}
async function pick(p,label,option){await p.getByRole('button',{name:label,exact:true}).click();assert.equal(await p.locator('.ctxmenu').evaluate(e=>!!e.closest('dialog.npeqsheet:modal')),true);await p.locator('.ctxmenu').getByRole('menuitem',{name:option,exact:true}).click();}
async function shot(p,name){if(E)await p.screenshot({path:E+'/'+name+'.png',animations:'disabled'});}

async function dirtyAndHoldOutput(p){await open(p);await input(p,'Bass',4);await p.waitForFunction(()=>preview['dac-a']?.bass.gainDb===4);await p.evaluate(()=>delayPath='/dsp/revert');await pick(p,'Physical output for Den speaker','Headphones');await p.waitForFunction(()=>!!release);}
async function distinctPatio(p){await p.evaluate(()=>{const j=structuredClone(presets[0].json);j.bass.gainDb=-4;presets.push({id:3,name:'Patio saved',source:'user',json:j});assignments['dac-c']={presetId:3,enabled:true,bypass:false};});}

test('P7 main Sound entry composes real controls, single modal over full NP; focus/inert/scroll/return/session continuity',async()=>{
 const p=await fixture();try{
  await shot(p,'phone-full-np-before-sound');const before=await p.evaluate(()=>({ms:msWrites,audio:audioStarts}));await open(p);await p.evaluate(()=>soundEntry.openPhoneEqSheet());assert.equal(await sheet(p).count(),1);
  assert.match(await p.locator('.sound-identity').textContent(),/Controlling zone speaker: Den speaker — Main DAC \(active output\)/);
  for(const l of ['Bass','Treble','Trim','Balance','Auto pre-gain','Loudness','Limiter','Bypass'])assert.equal(await p.locator(`.npeqsheet input[aria-label="${l}"]`).count(),1,l);
  assert.equal(await p.locator('.npeqsheet .eqb[role=slider]').count(),10);
  assert.equal(await sheet(p).evaluate(e=>e.matches(':modal')),true);
  assert.equal(await p.locator('.np-phone-sound').evaluate(e=>{e.focus();return document.activeElement===e;}),false);
  for(let i=0;i<35;i++){await p.keyboard.press(i<25?'Tab':'Shift+Tab');assert.equal(await p.evaluate(()=>!!document.activeElement.closest('dialog.npeqsheet')),true);}
  assert.equal(await p.locator('#desk').evaluate(e=>getComputedStyle(e).overflow), 'hidden');
  for(const c of ['.mini','.tabbar'])assert.equal(await p.locator(c).evaluate(e=>e.getClientRects().length===0),true);
  await p.locator('.eqsheet-b').evaluate(e=>e.scrollTop=0);await shot(p,'phone-default-sound-over-np');await p.locator('.eqsws').evaluate(e=>e.scrollIntoView({block:'center'}));await shot(p,'phone-sound-loudness-limiter-output');await close(p);
  assert.equal(await sheet(p).count(),0);assert.equal(await p.evaluate(()=>document.activeElement.matches('.np-phone-sound')),true);
  assert.equal(await p.locator('#desk').evaluate(e=>e.style.overflow),'');
  assert.deepEqual(await p.evaluate(()=>({same:nowc===snapshot.now&&nowc.el===snapshot.el&&nowc.mini===snapshot.mini,pos:S.localPos,at:S.localAt,ms:msWrites,audio:audioStarts})),{same:true,pos:45000,at:await p.evaluate(()=>snapshot.at),...before});
 }finally{await clean(p);}
});

test('P7 same-target bands/preset/knobs/switches preview and Save & use exact requests/result; no invented DSP params',async()=>{
 const p=await fixture();try{
  await open(p);await p.locator('.npeqsheet .eqb').first().focus();await p.keyboard.press('ArrowUp');
  await input(p,'Bass',3);await input(p,'Treble',-2);await input(p,'Trim',-4);await input(p,'Balance',20);
  await input(p,'Auto pre-gain',false);await input(p,'Loudness',true);await input(p,'Limiter',false);await input(p,'Bypass',true);
  await p.waitForFunction(()=>preview['dac-a']?.loudness.enabled);const prev=await p.evaluate(()=>preview['dac-a']);
  assert.equal(prev.graphicDb[0],.5);assert.equal(prev.bass.gainDb,3);assert.equal(prev.treble.gainDb,-2);assert.equal(prev.trimDb,-4);assert.equal(prev.balance,20);assert.equal(prev.autoPreamp,false);assert.equal(prev.bypass,true);
  assert.deepEqual(prev.loudness,{enabled:true,refVolume:80});assert.deepEqual(prev.limiter,{enabled:false,ceilingDb:-.3,releaseMs:120,lookaheadMs:0});
  await p.locator('.sound-save').click();await p.waitForFunction(()=>assignments['dac-a'].presetId>=20);assert.equal(await p.locator('.sound-save').isDisabled(),true);
  const writes=await dspWrites(p);assert.equal(writes.find(c=>c.path==='/dsp/presets').body.name,'Den speaker EQ');assert.deepEqual(writes.find(c=>c.path==='/dsp/assignments/dac-a').body,{presetId:20,enabled:true,bypass:true});
  await close(p);await p.waitForTimeout(160);assert.equal((await dspWrites(p)).filter(c=>c.path==='/dsp/revert').length,0);assert.equal(await p.evaluate(()=>assignments['dac-c'].presetId),1);
  await open(p);await pick(p,'Preset','Bass Boost');await p.waitForFunction(()=>preview['dac-a']?.graphicDb[0]===5);assert.equal(await p.evaluate(()=>preview['dac-a'].bypass),true);
 }finally{await clean(p);}
});

test('P7 Save as, Flat/reset, Revert, reload and unsaved close use existing endpoints on same target',async()=>{
 const p=await fixture();try{
  await open(p);await input(p,'Bass',4);await p.locator('.eqall-name').fill('My P7 sound');await p.locator('[data-act=saveas]').click();await p.waitForFunction(()=>assignments['dac-a'].presetId===20);
  await p.locator('.eqfoot button').filter({hasText:'Flat'}).click();await p.waitForFunction(()=>preview['dac-a']?.bass.gainDb===0);
  await p.locator('.eqfoot button').filter({hasText:'Revert'}).click();await p.waitForFunction(()=>!preview['dac-a']);await p.waitForSelector('.eqall');assert.equal(await p.locator('input[aria-label=Bass]').inputValue(),'4');
  await input(p,'Bass',6);await p.waitForFunction(()=>preview['dac-a']?.bass.gainDb===6);await p.locator('.sound-reload').click();await p.waitForFunction(()=>!preview['dac-a']);await p.waitForSelector('.eqall');assert.equal(await p.locator('input[aria-label=Bass]').inputValue(),'4');
  await input(p,'Bass',7);await p.waitForFunction(()=>preview['dac-a']?.bass.gainDb===7);await close(p);await p.waitForFunction(()=>!preview['dac-a']);
  assert.equal(await p.evaluate(()=>presets.find(p=>p.id===1).json.bass.gainDb),0);assert.equal(await p.evaluate(()=>presets.find(p=>p.id===20).name),'My P7 sound');
 }finally{await clean(p);}
});

test('P7 EQ target picker is not physical Output; actual switch uses numeric speaker/endpoint and correct active EQ',async()=>{
 const p=await fixture();try{
  await open(p);await pick(p,'EQ target (does not switch playback)','Patio speaker — Patio DAC');await p.waitForFunction(()=>document.querySelector('.sound-identity').textContent.includes('Selected EQ target: Patio'));
  await p.waitForSelector('.eqall');await input(p,'Loudness',true);await p.waitForFunction(()=>preview['dac-c']?.loudness.enabled);assert.equal((await dspWrites(p)).filter(c=>c.path.includes('/output')).length,0);
  await pick(p,'EQ target (does not switch playback)','Den speaker — Main DAC');await p.waitForFunction(()=>!preview['dac-c']);await p.waitForSelector('.eqall');
  await pick(p,'Physical output for Den speaker','Headphones');await p.waitForFunction(()=>S.zones[0].outputs[1].active&&document.querySelector('.sound-identity').textContent.includes('Headphones (active output)')&&!!document.querySelector('.eqall'));
  assert.deepEqual((await dspWrites(p)).find(c=>c.path==='/zones/11/output'),{path:'/zones/11/output',query:'',method:'POST',body:{endpointId:102}});
  assert.match(await p.locator('.sound-identity').textContent(),/Headphones \(active output\)/);await input(p,'Limiter',false);await p.waitForFunction(()=>preview['dac-b']?.limiter.enabled===false);
  await p.getByRole('button',{name:'Physical output for Den speaker'}).click();await shot(p,'phone-nested-output-picker');await p.keyboard.press('Escape');assert.equal(await sheet(p).count(),1);await p.keyboard.press('Escape');assert.equal(await sheet(p).count(),0);
 }finally{await clean(p);}
});

for(const [role,mine,allowed] of [['view',false,false],['control',false,false],['control',true,true]])test(`P7 permissions ${role}/mine=${mine}: canTune plus separate flag/admin target picker`,async()=>{
 const p=await fixture({role,mine});try{
  await open(p);assert.equal(await p.getByRole('button',{name:'EQ target (does not switch playback)'}).count(),0);
  assert.equal(await p.locator('input[aria-label=Loudness]').isDisabled(),!allowed);assert.equal(await p.getByRole('button',{name:'Physical output for Den speaker'}).isDisabled(),!allowed);
  await input(p,'Loudness',true);await p.waitForTimeout(170);assert.equal((await dspWrites(p)).some(c=>c.path==='/dsp/preview'),allowed);
 }finally{await clean(p);}
});

test('P7 lock all EQ/detailed controls; live permission/flag loss checks at dispatch and delayed write',async()=>{
 const p=await fixture();try{
  await open(p);await p.locator('[data-eqlock]').check();assert.equal(await p.locator('input[aria-label=Loudness]').isDisabled(),true);await input(p,'Loudness',true);await p.waitForTimeout(160);assert.deepEqual(await dspWrites(p),[]);
  await p.locator('[data-eqlock]').uncheck();await input(p,'Loudness',true);await p.evaluate(()=>S.auth.role='view');await p.waitForTimeout(180);assert.deepEqual(await dspWrites(p),[]);
  await p.evaluate(()=>window.dispatchEvent(new Event('wavwiz:zonesdata')));assert.equal(await p.locator('input[aria-label=Loudness]').isDisabled(),true);
 }finally{await clean(p);}
});

for(const change of ['close','zone','remove','reload'])test('P7 delayed preview fencing/cleanup on '+change,async()=>{
 const p=await fixture();try{
  await open(p);await p.evaluate(()=>delayPath='/dsp/preview');await input(p,'Bass',5);await p.waitForFunction(()=>!!release);
  await p.evaluate(change=>{if(change==='close')soundEntry.closePhoneEqSheet();if(change==='zone')Z.select('g:2');if(change==='remove'){S.zones[0].outputs=[];window.dispatchEvent(new Event('wavwiz:zonesdata'));}if(change==='reload')document.querySelector('.sound-reload').click();},change);
  await p.evaluate(()=>release());await p.waitForFunction(()=>!preview['dac-a']);await p.waitForTimeout(160);
  const w=await dspWrites(p);assert.equal(w.filter(c=>c.path==='/dsp/preview').length,1);assert.equal(w.find(c=>c.path==='/dsp/preview').body.deviceId,'dac-a');assert.equal(w.filter(c=>c.path.includes('/assignments/')).length,0);
  if(change==='zone'||change==='remove'){await p.waitForSelector('.eqall');await input(p,'Bass',2);await p.waitForFunction(()=>preview['dac-c']?.bass.gainDb===2);}
 }finally{await clean(p);}
});

test('P7 close/reopen same target + A→B→A serialize old cleanup before new preview',async()=>{
 const p=await fixture();try{
  await open(p);await p.evaluate(()=>delayPath='/dsp/preview');await input(p,'Bass',5);await p.waitForFunction(()=>!!release);await close(p);await open(p);await input(p,'Bass',2);await p.evaluate(()=>release());await p.waitForFunction(()=>preview['dac-a']?.bass.gainDb===2);
  const writes=await dspWrites(p);assert.deepEqual(writes.map(c=>c.path),['/dsp/preview','/dsp/revert','/dsp/preview']);
  await p.evaluate(()=>Z.select('g:2'));await p.waitForFunction(()=>document.querySelector('.sound-identity').textContent.includes('Patio'));await p.evaluate(()=>Z.select('g:1'));await p.waitForFunction(()=>document.querySelector('.sound-identity').textContent.includes('Den'));await p.waitForSelector('.eqall');await input(p,'Bass',3);await p.waitForFunction(()=>preview['dac-a']?.bass.gainDb===3);assert.equal(await p.evaluate(()=>!!preview['dac-c']),false);
 }finally{await clean(p);}
});

test('P7 late assignment load and late save cannot bind to a new/removed target',async()=>{
 const p=await fixture();try{
  await p.evaluate(()=>delayPath='/dsp/assignments/dac-a');await p.locator('.np-phone-sound').click();await p.waitForFunction(()=>!!release);await p.evaluate(()=>Z.select('g:2'));await p.waitForSelector('.eqall');await p.evaluate(()=>release());await p.waitForTimeout(80);assert.match(await p.locator('.sound-identity').textContent(),/Patio/);
  await input(p,'Bass',4);await p.evaluate(()=>{release=null;delayPath='/dsp/presets';});await p.locator('.sound-save').click();await p.waitForFunction(()=>!!release);await p.evaluate(()=>Z.select('g:1'));await p.evaluate(()=>release());await p.waitForSelector('.eqall');await p.waitForTimeout(160);
  assert.equal((await dspWrites(p)).filter(c=>c.path.includes('/assignments/')).length,0);assert.equal(await p.evaluate(()=>assignments['dac-a'].presetId),1);assert.equal(await p.evaluate(()=>assignments['dac-c'].presetId),1);
 }finally{await clean(p);}
});

test('P7 no-output/read error and removed explicit target stay honest, no edit fallback leak',async()=>{
 const p=await fixture();try{
  await p.evaluate(()=>S.zones=[]);await p.locator('.np-phone-sound').click();assert.match(await p.locator('.sound-status').textContent(),/Connect a speaker/);assert.equal(await p.locator('.eqall').count(),0);await close(p);
 }finally{await clean(p);}
 const q=await fixture();try{
  await q.evaluate(()=>failPath='/dsp/assignments/dac-a');await q.locator('.np-phone-sound').click();await q.waitForFunction(()=>document.querySelector('.sound-status').textContent.includes('Could not read'));assert.equal(await q.locator('.eqall').count(),0);assert.deepEqual(await dspWrites(q),[]);
 }finally{await clean(q);}
 const r=await fixture();try{
  await open(r);await pick(r,'EQ target (does not switch playback)','Den speaker — Headphones');await r.waitForSelector('.eqall');await r.evaluate(()=>{S.zones[0].outputs.pop();window.dispatchEvent(new Event('wavwiz:zonesdata'));});await r.waitForFunction(()=>document.querySelector('.sound-identity').textContent.includes('unavailable'));assert.equal(await r.locator('.eqall').count(),0);assert.deepEqual(await dspWrites(r),[]);
 }finally{await clean(r);}
});

test('P7 route/resize/detach destruction, Escape and backdrop restore locks without orphaning/reopening F246',async()=>{
 for(const change of ['route','resize','detach','escape','backdrop']){const p=await fixture();try{
  await open(p);if(change==='route')await p.evaluate(()=>go('queue'));if(change==='resize')await p.setViewportSize({width:901,height:700});if(change==='detach')await p.locator('.npeqsheet').evaluate(e=>e.remove());if(change==='escape')await p.keyboard.press('Escape');if(change==='backdrop')await p.mouse.click(2,2);
  await sheet(p).waitFor({state:'hidden'});assert.equal(await p.locator('.pd42-sheet').count(),0);assert.equal(await p.locator('html').evaluate(e=>e.classList.contains('eqsheet-lock')),false);assert.equal(await p.locator('#desk').evaluate(e=>e.style.overflow),'');await p.setViewportSize({width:390,height:844});assert.equal(await sheet(p).count(),0);
 }finally{await clean(p);}}
});

test('P7 geometry themes/safe area/keyboard/large text final control reachable, modal owns nested focus/hit',async()=>{
 for(const [width,height] of [[320,568],[375,667],[390,844],[430,932],[667,375],[844,390],[760,600],[761,600],[900,600],[390,320]]){const p=await fixture({width,height});try{
  if(width===320)await p.evaluate(()=>{document.documentElement.style.setProperty('--z',1.25);document.documentElement.style.fontSize='20px';});await open(p);
  await p.locator('.sound-save').evaluate(e=>e.scrollIntoView({block:'end'}));const hit=await p.locator('.sound-save').evaluate(e=>{const r=e.getBoundingClientRect(),b=e.closest('dialog').getBoundingClientRect();return {in:r.bottom<=b.bottom&&r.top>=b.top&&r.left>=0&&r.right<=innerWidth,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),scroll:document.querySelector('.eqsheet-b').scrollHeight>document.querySelector('.eqsheet-b').clientHeight};});assert.deepEqual(hit,{in:true,hit:true,scroll:true},width+'x'+height);
  assert.equal(await sheet(p).evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);await shot(p,`phone-${width}x${height}-last-control`);
 }finally{await clean(p);}}
 const p=await fixture();try{await open(p);for(const [name,preset] of [['light','daylight'],['ocean','ocean'],['custom','custom']]){const colors=await p.evaluate(async preset=>{const {applyTheme,PRESETS}=await import('/js/theme.js');const t=preset==='custom'?{preset,bg:'#F1F3E8',ink:'#172527',accent:'#265F78',accent2:'#5B6F27',hl:'#774728'}:{...PRESETS[preset],preset};applyTheme(t);const cs=getComputedStyle(document.querySelector('dialog.npeqsheet'));return {bg:cs.backgroundColor,ink:cs.color,scheme:document.documentElement.dataset.scheme};},preset);assert.equal(colors.scheme,preset==='ocean'?'dark':'light');assert.notEqual(colors.bg,colors.ink);assert.notEqual(colors.bg,'rgb(27, 32, 36)');await p.locator('.eqsheet-b').evaluate(e=>e.scrollTop=0);await shot(p,'phone-'+name+'-sound');}await p.getByRole('button',{name:'Preset',exact:true}).click();for(let i=0;i<10;i++){await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>!!document.activeElement.closest('.ctxmenu')),true);}await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Preset');}finally{await clean(p);}
});

test('P7 flag restriction/revocation, enabled=false assignment, harmless refresh preserves live editor and nested picker',async()=>{
 const p=await fixture();try{
  await p.evaluate(()=>{__wavwizFlags={'ui.eqOutputPicker':false};assignments['dac-a'].enabled=false;});await open(p);
  assert.equal(await p.getByRole('button',{name:'EQ target (does not switch playback)'}).count(),0);assert.equal(await p.locator('input[aria-label=Bypass]').isChecked(),true);
  await p.locator('.eqall-name').fill('Keep input');await p.evaluate(()=>{window.kept=document.querySelector('.eqall-name');window.dispatchEvent(new Event('wavwiz:zonesdata'));});assert.equal(await p.evaluate(()=>kept===document.querySelector('.eqall-name')),true);assert.equal(await p.locator('.eqall-name').inputValue(),'Keep input');
  await p.getByRole('button',{name:'Physical output for Den speaker'}).click();await p.evaluate(()=>window.dispatchEvent(new Event('wavwiz:zonesdata')));assert.equal(await p.locator('.ctxmenu').count(),1);await p.keyboard.press('Escape');assert.equal(await sheet(p).count(),1);await close(p);
  await p.evaluate(()=>__wavwizFlags={'ui.eqOutputPicker':true});await open(p);await pick(p,'EQ target (does not switch playback)','Patio speaker — Patio DAC');await p.waitForSelector('.eqall');
  await input(p,'Bass',4);await p.evaluate(()=>__wavwizFlags={'ui.eqOutputPicker':false});await p.waitForTimeout(180);assert.deepEqual(await dspWrites(p),[]);await p.evaluate(()=>window.dispatchEvent(new Event('wavwiz:zonesdata')));await p.waitForSelector('.eqall');assert.match(await p.locator('.sound-identity').textContent(),/Controlling zone speaker: Den/);
 }finally{await clean(p);}
});

test('P7 late save/output permission revocation or close cannot issue new target writes',async()=>{
 for(const change of ['close','permission','remove']){const p=await fixture();try{
  await open(p);await input(p,'Bass',3);await p.evaluate(()=>delayPath='/dsp/presets');await p.locator('.sound-save').click();await p.waitForFunction(()=>!!release);
  await p.evaluate(change=>{if(change==='close')soundEntry.closePhoneEqSheet();if(change==='permission')S.auth.role='view';if(change==='remove'){S.zones=[];window.dispatchEvent(new Event('wavwiz:zonesdata'));}},change);await p.evaluate(()=>release());await p.waitForTimeout(160);
  assert.equal((await dspWrites(p)).some(c=>c.path.includes('/assignments/')),false);
 }finally{await clean(p);}}
 const p=await fixture();try{await open(p);await p.getByRole('button',{name:'Physical output for Den speaker'}).click();await p.evaluate(()=>S.auth.role='view');await p.getByRole('menuitem',{name:'Headphones',exact:true}).click();assert.equal((await dspWrites(p)).some(c=>c.path.includes('/output')),false);}finally{await clean(p);}
});

test('P7 all EQ styles reuse same bands/lock and meter subscription cleans up after repeated open/close',async()=>{
 const p=await fixture();try{
  for(const style of ['led','faders','curve']){await p.evaluate(style=>localStorage.setItem('wavwiz.eqstyle.v1',JSON.stringify({style,glow:50})),style);await open(p);assert.equal(await p.locator('.npeqsheet .eqarea').getAttribute('data-eqstyle'),style);assert.equal(await p.locator('.npeqsheet .eqa-live').isVisible(),true);await close(p);}
  const n=(await dspWrites(p)).length;await p.evaluate(()=>{window.dispatchEvent(new Event('wavwiz:zonesdata'));window.dispatchEvent(new Event('wavwiz:eqlock'));window.dispatchEvent(new Event('wavwiz:eqstyle'));});await p.waitForTimeout(160);assert.equal((await dspWrites(p)).length,n);assert.equal(await sheet(p).count(),0);
 }finally{await clean(p);}
});

test('P7 large-display nested preset is genuinely hit-testable and read-only keyboard Tab does not dead-end',async()=>{
 const p=await fixture({width:320,height:568});try{await p.evaluate(()=>{document.documentElement.style.setProperty('--z',1.25);document.documentElement.style.fontSize='20px';});await open(p);await p.getByRole('button',{name:'Preset',exact:true}).click();const b=p.locator('.ctxmenu').getByRole('menuitem',{name:'Bass Boost',exact:true});const box=await b.evaluate(e=>{const r=e.getBoundingClientRect(),m=e.closest('.ctxmenu'),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,vw:innerWidth,vh:innerHeight,hit:e.contains(hit),at:hit?.outerHTML.slice(0,180),style:m.getAttribute('style'),z:getComputedStyle(document.documentElement).zoom};});console.log('P7 large picker',JSON.stringify(box));assert.ok(box.left>=0&&box.right<=box.vw&&box.top>=0&&box.bottom<=box.vh&&box.hit);await b.click();await p.waitForFunction(()=>preview['dac-a']?.graphicDb[0]===5);}finally{await clean(p);}
 const q=await fixture({role:'view'});try{await open(q);await q.locator('.npeqsheet .eqb').first().focus();await q.keyboard.press('Tab');assert.equal(await q.locator('.npeqsheet .eqb').nth(1).evaluate(e=>document.activeElement===e),true);}finally{await clean(q);}
});

test('P7 external saved EQ refresh stays on target, dirty preview survives and API/output errors remain visible',async()=>{
 const p=await fixture();try{
  await open(p);await p.evaluate(()=>{assignments['dac-a'].presetId=2;window.dispatchEvent(new CustomEvent('wavwiz:eqchanged',{detail:{deviceId:'dac-a'}}));});await p.waitForFunction(()=>document.querySelector('.eqall-preset')?.value==='2');
  await input(p,'Bass',3);await p.evaluate(()=>window.dispatchEvent(new CustomEvent('wavwiz:eqchanged',{detail:{deviceId:'dac-a'}})));assert.equal(await p.locator('input[aria-label=Bass]').inputValue(),'3');assert.match(await p.locator('.sound-status').textContent(),/changed elsewhere/);
  await p.evaluate(()=>failPath='/zones/11/output');await pick(p,'Physical output for Den speaker','Headphones');await p.waitForFunction(()=>document.querySelector('.sound-status').textContent.includes('Fixture API failed'));assert.equal(await p.evaluate(()=>S.zones[0].outputs[0].active),true);await p.waitForSelector('.eqall');assert.match(await p.locator('.sound-identity').textContent(),/Main DAC/);
 }finally{await clean(p);}
});

test('P7 opening another modal closes/cleans Sound instead of stacking or stealing F246 ownership',async()=>{
 const p=await fixture();try{await open(p);await input(p,'Bass',2);await p.waitForFunction(()=>preview['dac-a']?.bass.gainDb===2);await p.evaluate(()=>{const d=document.createElement('dialog');d.id='other';document.body.append(d);d.showModal();});await sheet(p).waitFor({state:'hidden'});await p.waitForFunction(()=>!preview['dac-a']);assert.equal(await p.locator('#other').evaluate(e=>e.matches(':modal')),true);}finally{await clean(p);}
});

test('P7 wide desktop Now geometry/computed paint remains identical to P6 parent and Sound modal refuses wide',async()=>{
 for(const width of [901,1280,1600]){const parent=await fixture({width,height:800,parent:true}),p=await fixture({width,height:800});try{
  await parent.screenshot({path:E?E+`/desktop-${width}-parent.png`:undefined,animations:'disabled'}).then(b=>parent.png=b);
  const png=await p.screenshot({path:E?E+`/desktop-${width}-unchanged.png`:undefined,animations:'disabled'});if(parentAssets){const measure=()=>[...document.querySelectorAll('#app *')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {tag:e.tagName,x:r.x,y:r.y,w:r.width,h:r.height,display:s.display,bg:s.backgroundColor,color:s.color,font:s.font,grid:s.gridTemplateColumns};});const a=await p.evaluate(measure),b=await parent.evaluate(measure);assert.equal(a.length,b.length);for(let i=0;i<a.length;i++){for(const k of ['x','y','w','h'])assert.ok(Math.abs(a[i][k]-b[i][k])<=.1,JSON.stringify({i,k,candidate:a[i],parent:b[i]}));for(const k of ['tag','display','bg','color','font','grid'])assert.equal(a[i][k],b[i][k]);}}
  await p.evaluate(()=>soundEntry.openPhoneEqSheet());assert.equal(await sheet(p).count(),0);
 }finally{await clean(parent);await clean(p);}}
});


test('P7 Save snapshots never mutate a globally shared friendly-name preset or another output assignment',async()=>{
 const p=await fixture();try{
  await p.evaluate(()=>{const json={...presets[0].json,bass:{...presets[0].json.bass,gainDb:9}};presets.push({id:7,name:'Den speaker EQ',source:'user',json});for(const a of Object.values(assignments))a.presetId=7;});
  await open(p);await input(p,'Bass',3);await p.locator('.sound-save').click();await p.waitForFunction(()=>assignments['dac-a'].presetId===20);
  assert.equal(await p.evaluate(()=>presets.find(p=>p.id===7).json.bass.gainDb),9);assert.equal(await p.evaluate(()=>presets.find(p=>p.id===20).name),'Den speaker EQ (2)');
  await input(p,'Bass',4);await p.locator('.sound-save').click();await p.waitForFunction(()=>assignments['dac-a'].presetId===21);
  assert.equal(await p.evaluate(()=>presets.find(p=>p.id===20).json.bass.gainDb),3);
  await pick(p,'Physical output for Den speaker','Headphones');await p.waitForFunction(()=>S.zones[0].outputs[1].active&&document.querySelector('.sound-identity').textContent.includes('Headphones (active output)')&&!!document.querySelector('.eqall'));assert.equal(await p.locator('input[aria-label=Bass]').inputValue(),'9');await input(p,'Loudness',true);await p.locator('.sound-save').click();await p.waitForFunction(()=>assignments['dac-b'].presetId===22);
  const result=await p.evaluate(()=>({a:assignments['dac-a'].presetId,b:assignments['dac-b'].presetId,c:assignments['dac-c'].presetId,shared:presets.find(p=>p.id===7).json.bass.gainDb,old:presets.find(p=>p.id===21).json.bass.gainDb,bass:presets.find(p=>p.id===22).json.bass.gainDb,loud:presets.find(p=>p.id===22).json.loudness.enabled}));
  assert.deepEqual(result,{a:21,b:22,c:7,shared:9,old:4,bass:9,loud:true});assert.equal((await dspWrites(p)).some(c=>/^\/dsp\/presets\//.test(c.path)),false);
 }finally{await clean(p);}
});


test('P7 R1: harmless live zone refresh during dirty-output cleanup must not silently cancel physical Output selection',async()=>{
 const p=await fixture();try{
  await open(p);await input(p,'Bass',4);await p.waitForFunction(()=>preview['dac-a']?.bass.gainDb===4);
  await p.evaluate(()=>{delayPath='/dsp/revert';});await pick(p,'Physical output for Den speaker','Headphones');await p.waitForFunction(()=>!!release);
  await p.evaluate(()=>{Z.sync();window.dispatchEvent(new Event('wavwiz:zonesdata'));});await p.waitForTimeout(70);await p.evaluate(()=>release());await p.waitForTimeout(200);
  const actual=await p.evaluate(()=>({outputs:calls.filter(c=>/^\/zones\/\d+\/output$/.test(c.path)),identity:document.querySelector('.sound-identity').textContent,status:document.querySelector('.sound-status').textContent,active:S.zones[0].outputs.find(o=>o.active)?.deviceId}));
  assert.equal(actual.outputs.length,1,'the unchanged live target must not erase an already chosen output action while its preview cleanup awaits');assert.equal(actual.active,'dac-b');
  assert.match(actual.identity,/Headphones/);
 }finally{await clean(p);}
});

test('P7 R2: reopen while assignment save is already in flight must not retain stale saved controls after it commits',async()=>{
 const p=await fixture();try{
  await open(p);await input(p,'Bass',5);await p.waitForFunction(()=>preview['dac-a']?.bass.gainDb===5);
  await p.evaluate(()=>{const f=fetch;let once=true;window.fetch=async(u,o={})=>{if(new URL(u,location.href).pathname.endsWith('/dsp/assignments/dac-a')&&o.method==='PUT'&&once){once=false;window.assignmentHeld=true;await new Promise(r=>window.releaseAssignment=r);}return f(u,o);};});
  await p.locator('.sound-save').click();await p.waitForFunction(()=>window.assignmentHeld);await close(p);await open(p);assert.equal(await p.locator('input[aria-label=Bass]').inputValue(),'0');
  await p.evaluate(()=>releaseAssignment());await p.waitForFunction(()=>assignments['dac-a'].presetId===20);await p.waitForTimeout(100);
  await p.evaluate(()=>{S.zones[0].outputs[0].dspPresetId=20;Z.sync();window.dispatchEvent(new Event('wavwiz:zonesdata'));});await p.waitForTimeout(100);
  const actual=await p.evaluate(()=>({savedPresetId:assignments['dac-a'].presetId,savedBass:presets.find(p=>p.id===assignments['dac-a'].presetId).json.bass.gainDb,visibleBass:document.querySelector('input[aria-label=Bass]').value,status:document.querySelector('.sound-status').textContent,saveDisabled:document.querySelector('.sound-save').disabled}));
  assert.equal(actual.visibleBass,String(actual.savedBass),'fresh editor must converge to the assignment that committed on this same output, rather than display the old saved sound indefinitely');
  await input(p,'Treble',-2);await p.locator('.sound-save').click();await p.waitForFunction(()=>assignments['dac-a'].presetId===21);
  const revised=await p.evaluate(()=>({assignment:assignments['dac-a'].presetId,bass:presets.find(p=>p.id===21).json.bass.gainDb,treble:presets.find(p=>p.id===21).json.treble.gainDb}));
  assert.equal(revised.bass,5,'editing Treble in the reopened editor must not silently replace the newly saved Bass=5 with stale Bass=0');assert.equal(revised.treble,-2);
 }finally{await clean(p);}
});

test('P7 A1: held Output cleanup then A→B→A must load Den saved sound, not leave Patio Bass under Den identity',async()=>{
 const p=await fixture();try{
  await distinctPatio(p);await dirtyAndHoldOutput(p);
  await p.evaluate(()=>Z.select('g:2'));
  await p.waitForFunction(()=>document.querySelector('.sound-identity')?.textContent.includes('Patio')&&document.querySelector('input[aria-label=Bass]')?.value==='-4');
  await p.evaluate(()=>Z.select('g:1'));
  await p.waitForFunction(()=>document.querySelector('.sound-identity')?.textContent.includes('Den')&&document.querySelector('input[aria-label=Bass]')?.value==='0');
  await p.evaluate(()=>release());await p.waitForTimeout(180);
  const a=await p.evaluate(()=>({identity:document.querySelector('.sound-identity').textContent,bass:document.querySelector('input[aria-label=Bass]')?.value,physical:document.querySelector('.sound-output').textContent,physicalSelect:document.querySelector('.sound-output .wwsel')?.getAttribute('aria-label'),outputPosts:calls.filter(c=>/\/zones\/\d+\/output$/.test(c.path))}));
  assert.equal(a.outputPosts.length,0,'genuine target change must cancel the older physical Output action');
  assert.match(a.identity,/Den speaker/);
  assert.equal(a.bass,'0','returned Den identity must bind Den saved sound rather than retain Patio Bass=-4');
  assert.doesNotMatch(a.physical,/Patio speaker/);
  assert.match(a.physicalSelect||'',/Den speaker/);
 }finally{await clean(p);}
});

test('P7 A1: same selected-zone disconnect/recovery during held cleanup must not retain fallback speaker controls',async()=>{
 const p=await fixture();try{
  await distinctPatio(p);await p.evaluate(()=>{S.groups[0].deviceIds=[11,22];S.groups[1].deviceIds=[];Z.sync();});
  await dirtyAndHoldOutput(p);
  await p.evaluate(()=>{S.zones[0].connected=false;S.zones[0].outputs.forEach(o=>{o.connected=false;o.active=false;});Z.sync();window.dispatchEvent(new Event('wavwiz:zonesdata'));});
  await p.waitForFunction(()=>document.querySelector('input[aria-label=Bass]')?.value==='-4');
  await p.evaluate(()=>{S.zones[0].connected=true;S.zones[0].outputs.forEach((o,i)=>{o.connected=true;o.active=i===0;});Z.sync();window.dispatchEvent(new Event('wavwiz:zonesdata'));});
  await p.waitForFunction(()=>document.querySelector('.sound-identity')?.textContent.includes('Den')&&document.querySelector('input[aria-label=Bass]')?.value==='0');
  const held=await p.evaluate(()=>({selected:Z.current().key,identity:document.querySelector('.sound-identity').textContent,bass:document.querySelector('input[aria-label=Bass]')?.value,physical:document.querySelector('.sound-output').textContent}));
  await p.evaluate(()=>release());await p.waitForTimeout(100);
  const settled=await p.evaluate(()=>({bass:document.querySelector('input[aria-label=Bass]')?.value,physical:document.querySelector('.sound-output').textContent,outputPosts:calls.filter(c=>/\/zones\/\d+\/output$/.test(c.path))}));
  assert.equal(settled.outputPosts.length,0);
  assert.equal(held.selected,'g:1');
  assert.match(held.identity,/Den speaker/);
  assert.equal(held.bass,'0','recovered selected speaker must load its own saved sound during old cleanup');
  assert.doesNotMatch(held.physical,/Patio speaker/);
  assert.equal(settled.bass,'0');
  assert.doesNotMatch(settled.physical,/Patio speaker/);
 }finally{await clean(p);}
});

// Real devices.js/tree42.js/spkset.js/wwselect.js/ctxmenu.js + shipped CSS.
// Shell navigation and resize execute the actual main.js function bodies, with unrelated services stubbed.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localDom } from './helpers/local-dom.mjs';
const main = readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/main.js', import.meta.url), 'utf8');
assert.match(main, /views\.devices = \{[^;]+hide: \(\) => devv\.hide\(\)/, 'main registers the real Devices hide hook');
const goSource = main.slice(main.indexOf('export function go('), main.indexOf('const checklistGo')).replace('export ', '');
const modeSource = main.slice(main.indexOf('const applyMode = () =>'), main.indexOf("window.addEventListener('resize', () => { applyMode();"));
let dom;
before(async () => { dom = await localDom(); }); after(async () => { await dom?.close(); });
async function fixture(viewport) {
  const p = await dom.page(viewport); p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
  await p.evaluate(async ({goSource, modeSource}) => {
    window.calls = []; window.hotkeys = [];
    const { flatEq } = await import('/js/eq.js');
    const presets = [{id:1,name:'Flat',source:'builtin',json:flatEq()}, {id:2,name:'Late Night',source:'builtin',json:{...flatEq(),graphicDb:[3,2,1,0,0,0,0,0,0,0]}}];
    window.fetch = async (url, opts = {}) => {
      const path = new URL(url, location.href).pathname.replace('/api/v1', ''); const method = opts.method || 'GET';
      if (method !== 'GET') calls.push({path,method,body: opts.body ? JSON.parse(opts.body) : null});
      let value = [];
      if (path === '/dsp/presets') value = presets;
      if (path.startsWith('/dsp/assignments/')) value = {presetId:1};
      if (path === '/profiles') value = [{id:10,name:'Evening'},{id:11,name:'Morning'}];
      if (path.startsWith('/profiles/for/')) value = {profileId:10,modified:false};
      if (path === '/cast') value = {active:false};
      if (path === '/receivers/zones') value = {zones:[]};
      return new Response(JSON.stringify(value), {status:200});
    };
    const { devicesView } = await import('/js/devices.js');
    const { installHotkeys } = await import('/js/hotkeys.js');
    const { viewForMode } = await import('/js/viewmode.js');
    installHotkeys(id => hotkeys.push(id));
    const outputs = [{deviceId:'out-a',endpointDbId:1,name:'Speakers',kind:'analog',active:true,connected:true,latencyMs:20}, {deviceId:'out-b',endpointDbId:2,name:'Headphones',kind:'usb',active:false,connected:true,latencyMs:30}];
    const zones = Array.from({length:12}, (_,i) => ({id:i+1,playerId:'p'+i,name:'Speaker '+(i+1),enabled:true,connected:true,volume:50,volCap:70,volLocked:true,muted:false,mine:true,outputs:structuredClone(outputs)}));
    const S = window.S = { view:'devices', auth:{role:'admin'}, zones, groups:[{id:1,name:'Kitchen',deviceIds:zones.map(z=>z.id),linked:[],playbackId:'g1',online:true},{id:2,name:'Den',deviceIds:[],linked:[],playbackId:'g2',online:false}], now:{state:'paused'},cast:{active:false},jb:{},status:{} };
    const app = document.getElementById('app'); app.innerHTML = '<div class="topbar"><button>Background top</button></div><div class="desk" data-view="devices"><main id="view"></main></div><div class="mini"><button>Mini</button></div><nav class="tabbar"><button data-k="devices">Devices</button></nav>';
    const desk = document.querySelector('.desk'), content = document.getElementById('view'), tabs = document.querySelector('.tabbar'), navButtons = [];
    const wide = () => innerWidth > 900;
    const ctl = {act:(...args)=>calls.push({act:args}),refreshAll:async()=>{},openQueue:()=>go('queue')};
    const v = window.v = devicesView(S,ctl), views = { devices:{el:v.el,reload:()=>v.draw(),hide:()=>v.hide()}, queue:{el:Object.assign(document.createElement('div'),{id:'queue-fixture'})}, library:{el:document.createElement('div')} };
    const go = window.go = new Function('S','views','wide','desk','content','tabs','navButtons','nowc', goSource+'; return go;')(S,views,wide,desk,content,tabs,navButtons,{drawChecklist(){}});
    const applyMode = new Function('S','views','wide','desk','content','tabs','go','viewForMode',modeSource+'; return applyMode;')(S,views,wide,desk,content,tabs,go,viewForMode);
    window.addEventListener('resize',applyMode);
    content.append(v.el); v.draw();
  }, {goSource, modeSource});
  return p;
}
const opener = '.tree42 [data-device-id="1"] .sp42-n';
async function open(p, zone=false) {
  await p.locator(zone ? '.tree42 .zname' : opener).first().click();
  await p.waitForSelector('.pd42-sheet');
  if (!zone) await p.waitForFunction(() => document.querySelector('.spk-prof')?.options.length >= 3 && document.querySelector('.spk-presel')?.options.length >= 3).catch(async e => { console.log('FIXTURE', await p.evaluate(()=>({prof:document.querySelector('.spk-prof')?.options.map(o=>o.textContent),preset:document.querySelector('.spk-presel')?.options.map(o=>o.textContent),html:document.querySelector('.spk-eq')?.textContent})),p.errors); throw e; });
}
async function clean(p) {
  await p.waitForFunction(() => !document.querySelector('.pd42-sheet') && !document.documentElement.classList.contains('pd42-open') && !document.getElementById('app').inert);
  assert.equal(await p.locator('#app').evaluate(e=>getComputedStyle(e).pointerEvents),'auto');
}
async function choose(p, trigger, value) {
  await p.locator(trigger).click(); const item = p.locator(`.ctxmenu [data-ctx="dd:${value}"]`);
  assert.equal(await item.evaluate(e=>{const r=e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'alternative hit-tests above sheet');
  assert.equal(await item.evaluate(e=>!!e.closest('.pd42-sheet')),true,'popover belongs to sheet');
  await item.click(); await p.waitForFunction(sel=>document.querySelector(sel).getAttribute('aria-expanded')==='false',trigger);
}
test('F246 R1: real alternative Output, Move to zone, Profile and EQ Preset selections', async () => {
  const p=await fixture(); try {
    await open(p); await choose(p,'.spkset .dsel','2'); await choose(p,'.spk-zsel','2'); await choose(p,'.spk-prof','11'); await choose(p,'.spk-presel','2');
    await p.waitForFunction(()=>calls.some(c=>c.path==='/dsp/preview'));
    const calls=await p.evaluate(()=>window.calls);
    assert.ok(calls.some(c=>c.path==='/zones/1/output' && c.body.endpointId===2));
    assert.ok(calls.some(c=>c.path==='/groups/2' && c.body.deviceIds.includes(1)));
    assert.ok(calls.some(c=>c.path==='/profiles/11/apply' && c.body.zoneId===1));
    assert.ok(calls.some(c=>c.path==='/dsp/preview' && c.body.preset.graphicDb[0]===3));
    assert.deepEqual(p.errors,[]);
  } finally {await p.context().close();}
});
test('F246 R1/R3: owned submenu keyboard + dialog and desktop menu hosts remain usable', async()=>{
  const p=await fixture(); try {
    await open(p);
    await p.evaluate(async()=>{ const {openCtx}=await import('/js/ctxmenu.js'); const b=document.querySelector('.pd42-done'); openCtx(10,60,[{id:'sub',label:'Sub',sub:[{id:'pick',label:'Alternative',onclick:()=>calls.push({submenu:true})}]}],{from:b}); });
    await p.keyboard.press('ArrowRight'); const item=p.locator('.ctx-sub [data-ctx="pick"]');
    assert.ok(await item.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+20,r.y+20));}));
    await p.keyboard.press('Enter'); assert.ok(await p.evaluate(()=>calls.some(c=>c.submenu)));
    await p.evaluate(async()=>{const {h,dialog}=await import('/js/util.js');const {wwSelect}=await import('/js/wwselect.js'); window.d=dialog('Nested',wwSelect({label:'Nested picker',value:'a',options:[{value:'a',label:'A'},{value:'b',label:'B'}],onChange:v=>calls.push({nested:v})}));});
    await p.getByLabel('Nested picker').click(); await p.locator('dialog .ctxmenu [data-ctx="dd:b"]').click();
    assert.ok(await p.evaluate(()=>calls.some(c=>c.nested==='b'))); await p.evaluate(()=>d.close());
    await p.evaluate(()=>v.hide()); await clean(p);
    await p.evaluate(async()=>{const {openCtx}=await import('/js/ctxmenu.js');openCtx(10,60,[{label:'Desktop',onclick:()=>calls.push({desktop:true})}],{from:document.querySelector('.topbar button')});});
    assert.equal(await p.locator('.ctxmenu').evaluate(e=>e.parentElement.tagName),'BODY'); await p.locator('.ctx-item').click();
    assert.ok(await p.evaluate(()=>calls.some(c=>c.desktop)));
  } finally {await p.context().close();}
});
test('F246 R2: actual zone Open queue callback executes main.go hide lifecycle; background redraw cannot reopen',async()=>{
  const p=await fixture(); try {await open(p,true); await p.locator('[data-act="zone-open-queue"]').click(); await clean(p);
    assert.equal(await p.locator('#queue-fixture').count(),1); await p.evaluate(()=>v.draw()); await clean(p);
    await p.evaluate(()=>go('devices')); await open(p); await p.evaluate(()=>go('library')); await clean(p);
  } finally {await p.context().close();}
});
test('F246 R2: real >900px resize lifecycle, detached redraw, observer-only detach, close/reopen',async()=>{
  const p=await fixture(); try {
    await open(p); await p.setViewportSize({width:1200,height:700}); await clean(p);
    assert.equal(await p.evaluate(()=>v.el.isConnected),false); await p.evaluate(()=>v.draw()); await clean(p);
    await p.setViewportSize({width:390,height:600}); await p.evaluate(()=>go('devices')); await open(p);
    await p.evaluate(()=>v.el.remove()); await clean(p); await p.evaluate(()=>v.draw()); await clean(p);
    await p.evaluate(()=>go('devices')); await open(p); await p.locator('.pd42-done').click(); await clean(p);
    await open(p); await p.keyboard.press('Escape'); await clean(p);
    assert.deepEqual(p.errors,[]);
  } finally {await p.context().close();}
});
test('F246 R3: initial focus, forward/reverse Tab wrap, background mute/PageDown lock and opener/tree-scroll restore',async()=>{
  const p=await fixture(); try {
    await p.evaluate(()=>{const s=document.querySelector('.desk');s.scrollTop=245;});
    // Focus without scrolling, then user-like keyboard activation of the actual tree opener.
    await p.locator(opener).first().evaluate(e=>e.focus({preventScroll:true}));
    const top=await p.locator('.desk').evaluate(e=>e.scrollTop); await p.keyboard.press('Enter'); await p.waitForSelector('.pd42-sheet');
    assert.equal(await p.evaluate(()=>document.activeElement.classList.contains('pd42-close')),true);
    await p.keyboard.press('PageDown'); await p.waitForTimeout(200); assert.equal(await p.locator('.desk').evaluate(e=>e.scrollTop),top);
    await p.keyboard.press('Shift+Tab'); assert.ok(await p.evaluate(()=>!!document.activeElement.closest('.pd42-sheet')));
    await p.keyboard.press('Tab'); assert.equal(await p.evaluate(()=>document.activeElement.classList.contains('pd42-close')),true);
    await p.keyboard.press('m'); assert.deepEqual(await p.evaluate(()=>hotkeys),[]);
    // The original report's Tab,Tab,Enter must not reach the background tree mute.
    await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Enter');
    assert.ok(await p.evaluate(()=>!calls.some(c=>c.act?.[1]?.muted)));
    assert.ok(await p.evaluate(()=>!!document.activeElement.closest('.pd42-sheet,dialog[open]')));
    await p.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>{d.close();d.remove();}));
    await p.locator('.pd42-done').click(); await clean(p);
    await p.waitForFunction(()=>document.activeElement.matches('.tree42 [data-device-id="1"] .sp42-n'));
    assert.equal(await p.locator('.desk').evaluate(e=>e.scrollTop),top);
    assert.deepEqual(p.errors,[]);
  } finally {await p.context().close();}
});
test('F246 preservation: focused typed delay + panel node + sheet scroll survive redraw; capped tag stays in sheet',async()=>{
  const p=await fixture({width:700,height:360}); try {
    await open(p); await p.locator('.spk-num').fill('123');
    const kept=await p.evaluate(()=>{window.input=document.querySelector('.spk-num');const s=document.querySelector('.pd42-sheet>.pd42');s.scrollTop=100;v.draw();return {same:input===document.querySelector('.spk-num'),focus:document.activeElement===input,value:input.value,top:s.scrollTop};});
    assert.deepEqual(kept,{same:true,focus:true,value:'123',top:100});
    await p.locator('.pd42-sheet [data-tag-act="capped"]').first().click();
    await p.waitForFunction(()=>document.activeElement.getAttribute('aria-label')==='Max volume');
    assert.deepEqual(p.errors,[]);
  } finally {await p.context().close();}
});

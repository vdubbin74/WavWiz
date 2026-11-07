// Exact refreshNow body + real createNow.draw/tickPos + art.js in a headless DOM.
// Fake HTTP snapshots/Media Session/clock only; no live service or iPhone claims.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localDom} from './helpers/local-dom.mjs';
const main=readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/main.js',import.meta.url),'utf8');
const refreshSource=main.slice(main.indexOf('async function refreshNow()'),main.indexOf('async function refreshZones()'));
let dom;before(async()=>{dom=await localDom();});after(async()=>{await dom?.close();});
async function fixture(){
  const p=await dom.page();p.errors=[];p.on('pageerror',e=>p.errors.push(e.message));
  await p.evaluate(async refreshSource=>{
    window.clock=10000;window.positions=[];window.metadataWrites=0;window.images=[];window.flowErrors=[];window.actions={};
    Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
    Object.defineProperty(window,'MediaMetadata',{configurable:true,value:class{constructor(o){Object.assign(this,o);metadataWrites++;}}});
    window.Image=class{constructor(){images.push(this);}};
    window.ms={metadata:null,playbackState:'none',setActionHandler(k,v){actions[k]=v;},setPositionState(p){positions.push(p);}};
    Object.defineProperty(navigator,'mediaSession',{configurable:true,value:ms});
    localStorage.setItem('wavwiz.viz.v1',JSON.stringify({on:false}));
    window.fetch=async()=>new Response('[]',{status:200});
    const {createNow}=await import('/js/now.js');const {reconcileSmoothPosition}=await import('/js/art.js');
    window.a={kind:'track',id:'queue-a',refId:17,title:'Song A',artist:'Artist',album:'Album'};
    const S=window.S={auth:{role:'admin'},view:'now',zones:[],groups:[],status:{},now:{state:'stopped',item:null},queue:[]};
    const nowc=window.nowc=createNow(S,{act:(...args)=>flowErrors.push('unexpected action '+JSON.stringify(args)),refreshAll:async()=>{}});
    document.getElementById('app').append(nowc.el,nowc.mini,nowc.npbar);
    let snapshot;
    const refresh=new Function('api','S','whenIdle','nowc','listt','drawStatus','drawQueue','handleErr','reconcileSmoothPosition',refreshSource+';return refreshNow;')(
      async()=>({now:snapshot,queue:{items:[a]}}),S,fn=>fn(),nowc,{draw(){}},()=>{},()=>{},e=>flowErrors.push(e.message),reconcileSmoothPosition);
    window.poll=async(overrides={},gap=1000)=>{clock+=gap;snapshot={item:a,state:'playing',positionMs:45000,durationMs:200000,version:7,index:0,repeat:'off',...overrides};await refresh();};
    window.loadArt=()=>{for(const image of images.splice(0))image.onload?.();};
    window.tick=(gap=250)=>{clock+=gap;nowc.tickPos();};
    window.state=()=>({pos:S.localPos,pending:S._smooth?.pending,label:nowc.el.querySelector('.np-elv').textContent,last:positions.at(-1),positions:positions.slice(),art:ms.metadata?.artwork,writes:metadataWrites,errors:flowErrors.slice()});
  },refreshSource);
  return p;
}
test('F248 R1 real paused poll/draw/tick: one zero never confirms, including repeated redraws and 250ms ticks',async()=>{
  const p=await fixture();try{
    const r=await p.evaluate(async()=>{await poll({state:'paused'},0);loadArt();await poll({state:'paused',positionMs:0});
      const first=state();for(let i=0;i<24;i++){tick();nowc.draw();}const later=state();
      await poll({state:'paused',positionMs:45000});return {first,later,recovered:state()};});
    for(const s of [r.first,r.later,r.recovered]){assert.equal(s.pos,45000);assert.equal(s.label,'00:45');assert.equal(s.last.position,45);assert.deepEqual(s.errors,[]);}
    assert.ok(r.later.positions.every(x=>x && x.position===45));assert.equal(r.later.writes,r.first.writes);assert.deepEqual(p.errors,[]);
  }finally{await p.context().close();}
});
test('F248 R1 real missing-item non-stop poll and zero recovery retain the clock and cover',async()=>{
  const p=await fixture();try{
    const r=await p.evaluate(async()=>{await poll({},0);loadArt();const art=state().art;
      await poll({item:null,positionMs:0,durationMs:0});const missing=state();
      await poll({positionMs:0});const zero=state();await poll({positionMs:48000});return {art,missing,zero,good:state()};});
    assert.equal(r.missing.pos,46000);assert.equal(r.missing.last.position,46);
    assert.equal(r.zero.pos,47000);assert.equal(r.zero.label,'00:47');assert.equal(r.zero.last.position,47);
    assert.equal(r.good.pos,48000);assert.deepEqual(r.good.art,r.art);assert.deepEqual(r.good.errors,[]);assert.deepEqual(p.errors,[]);
  }finally{await p.context().close();}
});
test('F248 R2 real versioned incomplete pause/resume/mutation matrix; complete remote seeks and stop/reconnect',async()=>{
  const p=await fixture();try{
    const rows=await p.evaluate(async()=>{const rows=[];
      for(const durationMs of [0,null,undefined,NaN,Infinity,-1]){
        await poll({state:'stopped',item:null});await poll({},0);loadArt();const art=state().art;
        await poll({state:'paused',positionMs:0,durationMs,version:8});const pause=state();tick(5000);const frozen=state();
        await poll({state:'playing',positionMs:0,durationMs,version:9},0);tick(1000);const resume=state();
        await poll({state:'playing',positionMs:0,durationMs,version:10},0);const mutation=state();
        await poll({state:'paused',positionMs:0,version:10},0);const zero=state();
        await poll({state:'paused',positionMs:16000,version:11});const backward=state();
        await poll({state:'playing',positionMs:16000,version:12});tick(1000);const playing=state();
        await poll({state:'stopped',item:null});const stop=state();await poll({positionMs:12000,version:13});const reconnect=state();
        rows.push({art,pause,frozen,resume,mutation,zero,backward,playing,stop,reconnect});
      }return rows;});
    for(const r of rows){assert.equal(r.pause.pos,46000);assert.equal(r.pause.last.position,46);assert.equal(r.pause.label,'00:46');
      assert.equal(r.frozen.last.position,46);assert.equal(r.resume.last.position,47);assert.equal(r.mutation.pos,47000);
      for(const s of [r.pause,r.frozen,r.resume,r.mutation]){assert.equal(s.last.duration,200);assert.deepEqual(s.art,r.art);}
      assert.equal(r.zero.label,'00:00');assert.equal(r.zero.last.position,0);
      assert.equal(r.backward.last.position,16);assert.equal(r.playing.last.position,17);
      assert.equal(r.stop.last,undefined);assert.equal(r.reconnect.last.position,12);assert.deepEqual(r.reconnect.errors,[]);
    }assert.deepEqual(p.errors,[]);
  }finally{await p.context().close();}
});
test('F248 R3 real natural Repeat One/one-item All: same index/version, 3000ms polls, second poll catches wrap',async()=>{
  const p=await fixture();try{
    const rows=await p.evaluate(async()=>{const rows=[];for(const repeat of ['one','all']){
      await poll({state:'stopped',item:null});await poll({positionMs:199000,repeat},0);loadArt();const art=state().art, samples=[];
      for(let i=1;i<=12;i++){await poll({positionMs:i*3000-1000,repeat},3000);samples.push(state());}rows.push({art,samples});}return rows;});
    for(const r of rows){assert.equal(r.samples[0].pos,202000);for(let i=1;i<12;i++){const s=r.samples[i];assert.equal(s.pos,(i+1)*3000-1000);assert.equal(s.last.position,((i+1)*3000-1000)/1000);assert.deepEqual(s.art,r.art);assert.deepEqual(s.errors,[]);}}
    assert.deepEqual(p.errors,[]);
  }finally{await p.context().close();}
});
test('F248 preservation: 4-minute playing alternation, slow oscillation, complete versioned seek and artwork stability',async()=>{
  const p=await fixture();try{
    const r=await p.evaluate(async()=>{await poll({durationMs:900000},0);loadArt();const art=state().art,writes=metadataWrites;let bad=0;
      for(let i=1;i<=240;i++){await poll({positionMs:i%2?0:45000+i*1000,durationMs:900000});tick(0);if(S.localPos<45000)bad++;}
      const fast=state();for(let i=1;i<=120;i++){await poll({positionMs:i%2?16:285000+i*3000,durationMs:900000},3000);if(S.localPos<285000)bad++;}
      const slow=state();await poll({positionMs:0,durationMs:900000,version:8});const seek=state();return{art,writes,bad,fast,slow,seek};});
    assert.equal(r.bad,0);assert.equal(r.fast.pos,285000);assert.ok(r.fast.positions.every(p=>p && p.position>=45));
    assert.ok(r.slow.positions.every(p=>p && p.position>=45));assert.equal(r.slow.writes,r.writes);assert.deepEqual(r.slow.art,r.art);
    assert.equal(r.seek.last.position,0);assert.deepEqual(r.seek.errors,[]);assert.deepEqual(p.errors,[]);
  }finally{await p.context().close();}
});

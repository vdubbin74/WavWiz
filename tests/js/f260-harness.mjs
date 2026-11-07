// F260-A: Wiz's F260 harness (wavwiz-specs/F260-wiz-evidence/harness.mjs) importing the real calmic.js from JS_DIR. Not a test file itself; f260a.test.mjs spawns it.
// F260 Wiz harness: imports ACTUAL calmic.js (exported from 479a14e) with DOM/net stubs. Scenario via env SC.
import { pathToFileURL } from 'node:url'; const require_url = p => pathToFileURL(p).href;
const SC = process.env.SC; const log = []; const L = m => log.push(m);
class El { constructor(t){this.tag=t;this.kids=[];this.attrs={};this.ls={};this.textContent='';this.hidden=false;this.className='';this.nodeType=1;this.style={};}
  addEventListener(k,f){(this.ls[k]??=[]).push(f);} removeEventListener(){} setAttribute(k,v){this.attrs[k]=v;} append(...k){this.kids.push(...k);} after(){} remove(){}
  replaceChildren(...k){this.kids=k;} querySelector(){return new El('x');} querySelectorAll(){return [];} get onclick(){return this._oc;} set onclick(f){this._oc=f;}
  click(){ (this.ls.click||[]).forEach(f=>f({target:this})); this._oc?.(); } text(){ return [this.textContent, ...this.kids.map(k=>k&&k.text?k.text():(k&&k.data)||'')].join(' '); }
  find(pred){ if(pred(this)) return this; for(const k of this.kids){ if(k&&k.find){const r=k.find(pred); if(r) return r;} } return null; } }
const els = { loading:new El('div'), view:new El('div'), calx:new El('button') };
globalThis.document = { createElement:t=>new El(t), createTextNode:d=>({data:d,nodeType:3}), getElementById:id=>els[id]??null, querySelector:()=>null, addEventListener(){}, removeEventListener(){}, visibilityState:'visible', referrer: process.env.REF ?? '' };
const wls = {};
globalThis.window = globalThis; globalThis.addEventListener=(k,f)=>{(wls[k]??=[]).push(f);}; globalThis.isSecureContext = true;
globalThis.location = { search:'?cal=ABC123', protocol:'https:', host:'h', origin:'https://h', replace:u=>L('location.replace '+u), reload:()=>L('reload') };
globalThis.history = { length: +(process.env.HLEN ?? 2), back:()=>L('history.back'), replaceState(){} };
globalThis.localStorage = { getItem:()=>null, setItem(){} };
let tracksStopped = 0; const mkStream = () => { const t={stop(){tracksStopped++; L('track.stop');}, label:'mic', getSettings:()=>({}), getConstraints:()=>({})}; return { getTracks:()=>[t], getAudioTracks:()=>[t] }; };
let gumResolve; const gumP = new Promise(r=>gumResolve=r);
Object.defineProperty(globalThis,'navigator',{value:{ userAgent:'Mozilla/5.0 (iPhone)', maxTouchPoints:5, mediaDevices:{ getUserMedia:()=> process.env.GUM==='pending'? gumP : Promise.resolve(mkStream()) }, wakeLock:{ request:async()=>{L('wake.request'); return {release(){L('wake.release')}}} } }, configurable:true});
class AC { constructor(){ this.state='running'; this.sampleRate=48000; this.currentTime=0; this.destination={}; L('AudioContext.new'); } createMediaStreamSource(){return {connect(){}}} createScriptProcessor(){return {connect(){}}} createGain(){return {gain:{},connect(){}}} close(){L('ctx.close'); return Promise.resolve();} resume(){} }
globalThis.AudioContext = AC; globalThis.webkitAudioContext = AC;
globalThis.WebSocket = class { constructor(){ setTimeout(()=>this.onopen?.(),1);} send(s){ const m=JSON.parse(s); setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'clock.pong',seq:m.seq,t0:m.t0,t1:m.t0+1,t2:m.t0+2})}),1);} close(){} };
let endMode = process.env.END || 'ok'; let sessResolve = null;
globalThis.fetch = (url, o={}) => { const u=String(url); const body=o.body; L(`fetch ${o.method||'GET'} ${u.replace('/api/v1','')}${o.keepalive?' [keepalive]':''}${body&&u.includes('hello')?' '+body:''}`);
  const ok = j => Promise.resolve({ ok:true, status:200, json:async()=>j });
  if (u.endsWith('/plan')) return ok({ https:true, reference:{id:'r',name:'Ref'}, speakers:[{id:'r',name:'Ref'},{id:'z',name:'Z'}], groups:[] });
  if (u.includes('/hello')) return ok({});
  if (u.endsWith('/calibration/sessions')) { if (process.env.SESS==='pending') return new Promise(r=>{sessResolve=()=>r({ok:true,status:200,json:async()=>({id:'S1'})});}); return ok({id:'S1'}); }
  if (u.includes('/end')) { if (endMode==='stall') return new Promise(()=>{}); if (endMode==='reject') return Promise.reject(new TypeError('network')); return ok({ canResume: endMode==='resume' }); }
  return ok({});
};
const tick = ms => new Promise(r=>setTimeout(r,ms));
const m = await import(require_url(process.env.JS_DIR + '/calmic.js'));
await tick(20);
const view = () => els.view.text().replace(/\s+/g,' ').slice(0,160);
const btn = re => els.view.find(e=>e.tag==='button' && re.test(e.text()));
L('VIEW0: '+view());
async function startRun(){ const s = btn(/Allow microphone/); if(!s){L('no start btn'); return;} s.click(); }
async function waitView(re, max=4000){ for(let i=0;i<max/20;i++){ if(re.test(view())) return true; await tick(20);} return false; }
if (SC==='initial') { await m.exitCal(); await tick(20); }
if (SC==='active-ok' || SC==='active-stall' || SC==='active-reject' || SC==='active-resume') {
  await startRun(); const r = await waitView(/Ready/); L('reached guided: '+r); await (SC==='active-stall'? (m.exitCal(), tick(300)) : m.exitCal()); await tick(50); L('VIEW: '+view());
  if (SC==='active-resume') { await tick(50); L('autoresume fetch? '+log.some(x=>/resume/.test(x)&&x.startsWith('fetch'))); }
  if (SC==='active-stall') { L('second exit click'); els.calx.click(); await tick(50); }
}
if (SC==='pending-gum') { await startRun(); await tick(10); await m.exitCal(); L('-- gUM resolves after exit'); gumResolve(mkStream()); await tick(1500); L('VIEW: '+view()); }
if (SC==='session-race') { await startRun(); for(let i=0;i<200 && !sessResolve;i++) await tick(20); L('session POST in flight: '+!!sessResolve); await m.exitCal(); L('-- page would unload here; late session response:'); sessResolve?.(); await tick(50); }
if (SC==='pagehide') { await startRun(); await waitView(/Ready/); wls.pagehide.forEach(f=>f({persisted:true})); await tick(20); L('-- bfcache restore (pageshow persisted): retry flow'); L('VIEW after restore: '+view()); }
if (SC==='stall-bounded') { await startRun(); await waitView(/Ready/); const t0=Date.now(); await m.exitCal(); L('exit returned after ms<=4000: '+(Date.now()-t0<=4000)); }
if (SC==='bfcache') { await m.exitCal(); (wls.pageshow||[]).forEach(f=>f({persisted:true})); }
if (SC==='late-gum-l1') { await startRun(); await tick(10); await m.exitCal(); gumResolve(mkStream()); await tick(1500); L('wake after exit: '+(log.lastIndexOf('wake.request')>log.indexOf('location.replace /'))); }
if (SC==='error') { delete navigator.mediaDevices.getUserMedia; navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'),{name:'NotAllowedError'})); await startRun(); await tick(100); L('VIEW: '+view()); const b=btn(/Back to player/); L('back btn on error: '+!!b); b?.click(); await tick(20); }
console.log(`== ${SC} REF=${process.env.REF??''} HLEN=${process.env.HLEN??2}\n`+log.join('\n')+`\ntracksStopped=${tracksStopped}`);
process.exit(0);

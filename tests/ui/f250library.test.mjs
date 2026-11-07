// F250-P2: real shipped Library/Radio/Playlists/Now modules + full CSS.
// Composition and route functions are extracted verbatim from main.js; boot,
// network, music/art and zones are local fixtures. No running-service/device proof.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync} from 'node:fs';
import {localDom} from './helpers/local-dom.mjs';
const main=readFileSync(new URL('../../src/WavWiz.Server/wwwroot/js/main.js',import.meta.url),'utf8');
const composition=main.slice(main.indexOf('// F250-P2: full-page phone'),main.indexOf('async function startMain()'));
const goSource=main.slice(main.indexOf('export function go('),main.indexOf('const checklistGo')).replace('export ','');
const css=readFileSync(new URL('../../src/WavWiz.Server/wwwroot/app.css',import.meta.url),'utf8');
const evidence=process.env.F250_P2_EVIDENCE_DIR;
if(evidence)mkdirSync(evidence,{recursive:true});
let dom;
before(async()=>{dom=await localDom();});
after(async()=>{await dom?.close();});
async function fixture({width=390,height=844,servers=2,role='admin',grid=true,source='local'}={}){
  assert.match(main,/views\.library = createPhoneLibrary\(\)/,'boot must actually use tested composition');
  const p=await dom.page({width,height});p.errors=[];p.on('pageerror',e=>p.errors.push(e.stack));
  await p.emulateMedia({reducedMotion:'reduce'});
  const art='<svg xmlns="http://www.w3.org/2000/svg" width="384" height="384"><rect width="384" height="384" fill="#425c76"/><circle cx="192" cy="160" r="90" fill="#8ba5ad"/><text x="192" y="325" text-anchor="middle" fill="white" font-size="24">API FIXTURE ART</text></svg>';
  await p.route(/\/api\/v1\/(art|artist-art|radio\/\d+\/art)(\/|\?)/,r=>r.fulfill({contentType:'image/svg+xml',body:art}));
  await p.route('**/fixture-art.svg',r=>r.fulfill({contentType:'image/svg+xml',body:art}));
  await p.evaluate(async({composition,goSource,servers,role,grid,source})=>{
    window.calls=[];window.failFav=false;window.remoteOffline=false;window.audioStarts=0;window.msWrites=0;
    Object.defineProperty(window,'MediaMetadata',{configurable:true,value:class{constructor(o){Object.assign(this,o);msWrites++;}}});
    Object.defineProperty(navigator,'mediaSession',{configurable:true,value:{metadata:null,playbackState:'none',setActionHandler(){},setPositionState(){}}});
    window.AudioContext=class{constructor(){audioStarts++;throw Error('unexpected audio');}};
    HTMLMediaElement.prototype.play=function(){audioStarts++;return Promise.resolve();};
    localStorage.setItem('wavwiz.viz.v1',JSON.stringify({on:false}));
    localStorage.setItem('wavwiz.libSource',source);
    localStorage.setItem('wavwiz.libprefs.v1',JSON.stringify({compactView:grid?'grid':'list',sort:{albums:'name'},flip:{},remember:true,views:{radio:'grid'}}));
    const albums=window.albums=Array.from({length:12},(_,i)=>({album:`P2 API fixture album ${String(i+1).padStart(2,'0')}${i===11?' — final album with a very long title':''}`,artist:'P2 API fixture artist',year:2020+i,artTrackId:101+i,tracks:2}));
    const tracks=window.tracks=[{id:101,title:'P2 API fixture song one',artist:albums[0].artist,album:albums[0].album,trackNo:1,durationMs:180000},{id:102,title:'P2 API fixture song two',artist:albums[0].artist,album:albums[0].album,trackNo:2,durationMs:200000}];
    const remoteAlbums=[{id:'ra1',album:'P2 API remote album',artist:'P2 remote artist',artUrl:'/fixture-art.svg',tracks:2,year:2023}];
    window.servers=Array.from({length:servers},(_,i)=>({id:'s'+(i+1),label:'P2 remote '+(i+1),lastError:i===1?'Offline fixture':null}));
    window.stations=[{id:9,name:'P2 API station',genre:'Fixture genre',url:'https://fixture.invalid/radio',favorite:false}];
    window.playlists=[{id:7,name:'P2 API playlist',count:2}];
    let favorites=[];
    window.fetch=async(url,opts={})=>{
      const u=new URL(url,location.href),path=u.pathname.replace('/api/v1',''),method=opts.method||'GET',body=opts.body?JSON.parse(opts.body):null;
      calls.push({path,query:u.search,method,body});let value=[];
      if(path==='/remote/servers')value={servers:window.servers};
      else if(path==='/favorites' && method==='PUT'){
        if(failFav)return new Response(JSON.stringify({error:'fixture failure'}),{status:500});
        if(body.on)favorites.push({kind:body.kind,ref:body.ref});else favorites=favorites.filter(x=>x.kind!==body.kind||x.ref!==body.ref);value={};
      }
      else if(path==='/favorites')value=favorites;
      else if(path==='/favorites/items')value={albums:albums.filter(a=>favorites.some(x=>x.kind==='album'&&x.ref===a.artist+'\u001f'+a.album)),tracks:tracks.filter(t=>favorites.some(x=>x.kind==='track'&&x.ref===String(t.id)))};
      else if(path==='/library/albums')value=albums;
      else if(path==='/library/recent')value=albums.slice(0,3);
      else if(path==='/library/artists')value=[{name:albums[0].artist,albums:12,tracks:24,artTrackIds:[101]}];
      else if(path==='/library/genres')value=[{name:'P2 fixture genre',tracks:24,albums:12}];
      else if(path==='/library/years')value=[{name:'2026',tracks:24,albums:12}];
      else if(path==='/library/folders')value={folders:[{name:'P2 fixture folder',path:'/fixture',tracks:2,artTrackIds:[101]}],tracks:[]};
      else if(path==='/library/tracks')value=tracks;
      else if(path==='/library/find')value={artists:[],albums:[albums[0]],tracks};
      else if(/^\/remote\/s\d\/(albums|artists|search|album\/ra1)/.test(path)){
        if(remoteOffline)return new Response(JSON.stringify({error:'Remote offline fixture'}),{status:503});
        if(path.endsWith('/artists'))value=[{id:'ar1',name:'P2 remote artist',albums:1,artUrl:'/fixture-art.svg'}];
        else if(path.endsWith('/search'))value={artists:[],albums:remoteAlbums,tracks:tracks.map(t=>({...t,id:'r'+t.id}))};
        else if(path.includes('/album/'))value={album:remoteAlbums[0],songs:tracks.map(t=>({...t,id:'r'+t.id}))};
        else value=remoteAlbums;
      }
      else if(path==='/radio' && method==='GET')value=stations;
      else if(path==='/radio/finder/search')value=[{name:'P2 finder result',stationuuid:'station-fixture',url:'https://fixture.invalid/found'}];
      else if(path==='/podcasts')value=[{id:5,title:'P2 API podcast'}];
      else if(path==='/podcasts/5/episodes')value=[{title:'P2 API episode',url:'https://fixture.invalid/episode'}];
      else if(path==='/playlists' && method==='GET')value=playlists;
      else if(path==='/playlists/7')value={name:playlists[0].name,items:tracks.map(t=>({...t,kind:'track',refId:t.id}))};
      else if(path==='/playlists' && method==='POST'){playlists.push({id:8,name:body.name,count:0});value={id:8};}
      else if(path==='/radio/finder/save')value={id:9};
      else if(path==='/checklist')value={dismissed:true,remaining:0};
      else if(path==='/cast')value={active:false};
      return new Response(JSON.stringify(value),{status:200});
    };
    const {h,api}=await import('/js/util.js'),{icon}=await import('/js/icons.js'),Z=await import('/js/zones40.js');
    const {libraryView}=await import('/js/library.js'),{playlistsView}=await import('/js/playlists.js'),{radioTab}=await import('/js/radiotab.js'),{createNow}=await import('/js/now.js');
    const S=window.S={auth:{role},view:'library',groups:[{id:1,name:'P2 selected Den',playbackId:'den',online:true,deviceIds:[]},{id:2,name:'P2 Patio',playbackId:'patio',online:true,deviceIds:[]}],zones:[],queue:[],status:{},now:{item:{kind:'track',id:'occ1',refId:101,title:tracks[0].title,artist:tracks[0].artist,album:tracks[0].album},state:'playing',positionMs:45000,durationMs:180000,version:1},localPos:45000,localAt:performance.now()};
    Z.init(S,{refreshNow(){}});
    const act=window.act=(path,body,method='POST')=>api(path,{method,body});
    const createPhoneLibrary=new Function('h','S','Z','libraryView','radioTab','playlistsView','act',composition+';return createPhoneLibrary;')(h,S,Z,libraryView,radioTab,playlistsView,act);
    const lib=window.lib=createPhoneLibrary();
    // These are intentionally independent just as in the shipped boot composition.
    const directRadio=window.directRadio=radioTab(S,act),directPlaylists=window.directPlaylists=playlistsView(S);
    const nowc=window.nowc=createNow(S,{go:k=>go(k),act});
    const content=window.content=h('main',{class:'view',id:'view',tabindex:-1}),desk=window.desk=h('div',{class:'desk',id:'desk','data-view':'library'},content,nowc.el,nowc.npbar);
    const tabs=h('nav',{class:'tabbar'},[['library','library'],['queue','queue'],['devices','devices'],['settings','gear']].map(([k,ic])=>h('button',{'data-k':k,onclick:()=>go(k)},icon(ic),k)));
    const views={library:lib,radio:directRadio,playlists:directPlaylists,queue:{el:h('div',null,'P3 Queue NOT IMPLEMENTED')},devices:{el:h('div',null,'P1 real Devices in retained suite')}};
    const wide=()=>!matchMedia('(max-width:900px)').matches;
    const go=window.go=new Function('S','views','wide','desk','content','tabs','navButtons','nowc',goSource+';return go;')(S,views,wide,desk,content,tabs,[],nowc);
    window.Z=Z;window.libraryView=libraryView;
    document.getElementById('app').replaceChildren(h('header',{class:'topbar'},h('b',null,'WavWiz'),h('span',{class:'small dim'},'P2 local API fixtures')),desk,nowc.mini,tabs);
    if(wide()){desk.style.display='block';content.style.display='block';content.append(lib.el);lib.reload();}else go('library');
    nowc.draw();
  },{composition,goSource,servers,role,grid,source});
  await p.waitForFunction(()=>!document.querySelector('.phone-library .libcontent')?.textContent.includes('Loading…'));
  return p;
}
async function clean(p){try{assert.deepEqual(p.errors,[]);}finally{await p.context().close();}}
async function source(p,s){await p.locator(`.phone-library [data-src="${s}"]`).click();await p.waitForFunction(s=>lib.source===s&&!lib.el.querySelector('.libcontent').textContent.includes('Loading…'),s);}
async function category(p,k){await p.locator(`.phone-library [data-tab="${k}"]`).click();await p.waitForFunction(k=>lib.tab===k&&!lib.el.querySelector('.libcontent').textContent.includes('Loading…'),k);}
async function shot(p,name){if(evidence)await p.screenshot({path:evidence+'/'+name+'.png',animations:'disabled'});}
test('P2 actual four sources: owned Radio finder/stations/podcasts + functional playlist create/open/play/add',async()=>{
  const p=await fixture();try{
    await p.waitForSelector('.phone-library .tg-albums .tile');
    assert.equal(await p.locator('.phone-library .libpage-heading h1').textContent(),'Library');
    assert.equal(await p.locator('.phone-library .libzone').getAttribute('aria-label'),'Controlling P2 selected Den');
    await source(p,'remote');await p.waitForSelector('.phone-library .tg-albums .tile');assert.equal(await p.locator('.phone-library .tg-albums .tile').count(),1);
    await source(p,'radio');await p.waitForSelector('.phone-library [data-station="9"]');
    assert.equal(await p.locator('.phone-library .libsearch').isVisible(),false);assert.equal(await p.locator('.phone-library .libhead').isVisible(),false);
    assert.equal(await p.locator('.phone-library .libtools button').count(),0,'no nonfunctional wrapper tools');
    await p.evaluate(()=>desk.scrollTop=0);await shot(p,'phone-390-radio-top');
    assert.equal(await p.locator('.phone-library .libcontent').innerText().then(s=>s.includes('Not available here')),false);
    await p.locator('.phone-library [aria-label="Play P2 API station"]').click();
    assert.deepEqual(await p.evaluate(()=>calls.filter(c=>c.path==='/stream/play').at(-1).body),{kind:'radio',id:9});
    await p.locator('.phone-library input[type="search"][placeholder="Station name"]').fill('Fixture query');
    await p.locator('.phone-library input[type="search"][placeholder="Station name"]').press('Enter');
    await p.waitForSelector('.phone-library .radcol:last-child .card button:text("Save")');
    await p.locator('.phone-library .radcol:last-child .card button:text-is("Save")').click();
    await p.locator('.phone-library button:text-is("Episodes")').click();
    await p.waitForSelector('.phone-library .podep');await p.locator('.phone-library .podep').click();
    assert.ok(await p.evaluate(()=>calls.some(c=>c.path==='/radio/finder/search'&&c.query.includes('Fixture%20query'))));
    await shot(p,'phone-390-radio');
    await source(p,'playlists');await p.waitForSelector('.phone-library [aria-label="Open P2 API playlist"]');
    await p.waitForFunction(()=>[...lib.el.querySelectorAll('h2,h3')].filter(e=>e.textContent==='Smart playlists').length===1);
    assert.equal(await p.locator('.phone-library button:text-is("New smart playlist…")').count(),1);
    await p.evaluate(()=>desk.scrollTop=0);await shot(p,'phone-390-playlists-top');
    await p.locator('.phone-library [aria-label="New playlist name"]').fill('P2 created fixture');
    await p.locator('.phone-library button:text-is("Create empty")').click();
    await p.waitForSelector('.phone-library [aria-label="Open P2 created fixture"]');
    assert.deepEqual(await p.evaluate(()=>calls.filter(c=>c.path==='/playlists'&&c.method==='POST').at(-1).body),{name:'P2 created fixture',fromQueue:false});
    const card=p.locator('.phone-library .item').filter({has:p.locator('[aria-label="Open P2 API playlist"]')});
    await card.locator('button:text-is("＋")').click();
    assert.deepEqual(await p.evaluate(()=>calls.filter(c=>c.path==='/queue/add').at(-1).body),{kind:'playlist',id:7});
    await card.locator('[aria-label="Open P2 API playlist"]').click();await p.waitForSelector('.phone-library [aria-label="Songs in P2 API playlist"]');
    await p.locator('.phone-library button:text-is("▶ Play")').click();
    assert.deepEqual(await p.evaluate(()=>calls.filter(c=>c.path==='/stream/play').at(-1).body),{kind:'playlist',id:7});
    await shot(p,'phone-390-playlist-detail');
    await source(p,'local');assert.equal(await p.locator('.phone-library .libsearch').isVisible(),true);await p.waitForSelector('.phone-library .tg-albums .tile');
  }finally{await clean(p);}
});
test('P2 adapter identity survives source switches, direct routes, detach/return and reload without DOM theft',async()=>{
  const p=await fixture();try{
    for(const s of ['radio','playlists']){
      await source(p,s);await p.waitForSelector(s==='radio'?'.phone-library .radiotab2':'.phone-library [aria-label="Open P2 API playlist"]');
      await p.evaluate(s=>{window.adapter=lib.el.querySelector('.libextra').firstChild;window.direct=s==='radio'?directRadio.el:directPlaylists.el;window.saved={mini:nowc.mini,now:nowc,pos:S.localPos,at:S.localAt,writes:msWrites};go(s);},s);
      assert.equal(await p.evaluate(()=>content.firstChild===direct&&adapter!==direct),true);
      await p.evaluate(()=>go('library'));await p.waitForFunction(()=>lib.el.querySelector('.libextra')?.firstChild===adapter);
      await source(p,'local');await source(p,s);
      assert.equal(await p.evaluate(()=>lib.el.querySelector('.libextra').firstChild===adapter),true);
      assert.equal(await p.evaluate(()=>saved.mini===nowc.mini&&saved.now===nowc&&saved.pos===S.localPos&&saved.at===S.localAt&&saved.writes===msWrites&&audioStarts===0),true);
      await p.evaluate(()=>lib.reload());await p.waitForFunction(()=>lib.el.querySelector('.libextra')?.firstChild===adapter);
      assert.equal(await p.locator('.phone-library .libextra').count(),1);
      if(s==='playlists'){await p.waitForSelector('.phone-library button:text-is("New smart playlist…")');assert.equal(await p.locator('.phone-library button:text-is("New smart playlist…")').count(),1);}
    }
    await p.evaluate(()=>{Z.select('g:2');});assert.equal(await p.locator('.libzone').textContent(),'P2 Patio');
    await p.evaluate(()=>{go('queue');S.groups[1].name='P2 Patio renamed';Z.sync();go('library');});assert.equal(await p.locator('.libzone').textContent(),'P2 Patio renamed');
  }finally{await clean(p);}
});
test('P2 saved Playlists source and concurrent Library refresh coalesce one real adapter draw',async()=>{
  const p=await fixture({source:'playlists'});try{
    await p.waitForSelector('.phone-library button:text-is("New smart playlist…")');
    assert.equal(await p.locator('.phone-library button:text-is("New smart playlist…")').count(),1);
    await p.evaluate(()=>Promise.all([lib.reload(),lib.reload(),lib.reload()]));
    await p.waitForSelector('.phone-library button:text-is("New smart playlist…")');
    assert.equal(await p.locator('.phone-library button:text-is("New smart playlist…")').count(),1);
    await p.locator('.phone-library [aria-label="Open P2 API playlist"]').click();
    await p.waitForSelector('.phone-library [aria-label="Songs in P2 API playlist"]');
    await p.evaluate(()=>Promise.all([lib.reload(),lib.reload()]));
    await p.waitForSelector('.phone-library [aria-label="Songs in P2 API playlist"]');
    assert.equal(await p.locator('.phone-library .libextra').count(),1);
  }finally{await clean(p);}
});
test('P2 Remote 0/1/2+ servers: remembered themed selector, real search, offline and source return',async()=>{
  for(const n of [0,1,2]){
    const p=await fixture({servers:n});try{
      await source(p,'remote');
      assert.equal(await p.locator('.phone-library .libsrv').count(),n>=2?1:0);
      if(!n){assert.match(await p.locator('.libcontent').innerText(),/No remote libraries yet/);await shot(p,'phone-390-remote-empty');continue;}
      if(n===2){await p.locator('.phone-library .libsrv').click();await p.locator('.ctxmenu button').filter({hasText:'P2 remote 2'}).click();await p.waitForFunction(()=>localStorage.getItem('wavwiz.libRsid')==='s2');await p.waitForSelector('.phone-library .libsrv.rsoff');}
      await category(p,'albums');await p.waitForSelector('.phone-library .tg-albums .tile');
      assert.equal(await p.locator('.phone-library .libcount').textContent(),'1 result');
      await p.evaluate(()=>desk.scrollTop=0);await shot(p,`phone-390-remote-${n}-top`);
      const search=p.locator('.phone-library .libsearch input');await search.fill('remote query');
      await p.waitForFunction(()=>calls.some(c=>c.path.endsWith('/search')&&new URLSearchParams(c.query).get('q')==='remote query'));
      await p.waitForFunction(()=>!lib.el.querySelector('.libcontent').textContent.includes('Loading…'));
      assert.equal(await search.evaluate(e=>document.activeElement===e&&e.selectionStart===e.value.length),true);
      await search.fill('');await p.waitForSelector('.phone-library .tg-albums');
      await p.evaluate(()=>{remoteOffline=true;lib.reload();});await p.waitForSelector('.phone-library .roffline');
      assert.match(await p.locator('.roffline').innerText(),/local library is not affected/);
      await shot(p,`phone-390-remote-${n}-offline`);
      await source(p,'local');await p.waitForSelector('.phone-library .tg-albums');
    }finally{await clean(p);}
  }
});
test('P2 local/remote album list/detail parity, Play/Add payloads and F175 drag refs are unchanged',async()=>{
  const p=await fixture({grid:false});try{
    const local=p.locator('.phone-library .libcontent>.list>.item').first();
    const ref=await local.evaluate(el=>{const dt=new DataTransfer();el.dispatchEvent(new DragEvent('dragstart',{dataTransfer:dt,bubbles:true}));el.dispatchEvent(new DragEvent('dragend',{dataTransfer:dt,bubbles:true}));return JSON.parse(dt.getData('application/x-wavwiz-ref'));});
    assert.deepEqual(ref,{kind:'node',node:'album:P2 API fixture artist\u001fP2 API fixture album 01'});
    await local.locator('.t').click();await p.waitForSelector('.phone-library .albhead');
    assert.equal(await p.locator('.phone-library .albcover').evaluate(e=>{const r=e.getBoundingClientRect();return Math.abs(r.width-r.height)<1&&r.width<=220;}),true);
    await p.locator('.phone-library .albplay').click();await p.locator('.phone-library .albacts button:text-is("Add to queue")').click();
    assert.deepEqual(await p.evaluate(()=>calls.filter(c=>c.path==='/stream/play').at(-1).body),ref);
    assert.deepEqual(await p.evaluate(()=>calls.filter(c=>c.path==='/queue/add').at(-1).body),ref);
    await shot(p,'phone-390-local-album-detail');
    await p.locator('.phone-library .crumbs button').click();await p.waitForSelector('.phone-library .libcontent>.list');
    await source(p,'remote');await category(p,'albums');const remote=p.locator('.phone-library .libcontent>.list>.item').first();
    assert.deepEqual(await remote.evaluate(el=>{const dt=new DataTransfer();el.dispatchEvent(new DragEvent('dragstart',{dataTransfer:dt,bubbles:true}));el.dispatchEvent(new DragEvent('dragend',{dataTransfer:dt,bubbles:true}));return JSON.parse(dt.getData('application/x-wavwiz-ref'));}),{kind:'remote',server:'s1',album:'ra1'});
    await remote.locator('.t').click();await p.waitForSelector('.phone-library .albhead');
    assert.equal(await p.locator('.phone-library .albcover').evaluate(e=>{const r=e.getBoundingClientRect();return Math.abs(r.width-r.height)<1&&r.width<=220;}),true);
    assert.equal(await p.locator('.phone-library .albhead .heart').count(),0,'no remote Favorites expansion');
    await p.locator('.phone-library .albplay').click();
    const body=await p.evaluate(()=>calls.filter(c=>c.path==='/stream/play').at(-1).body);
    assert.equal(body.kind,'remote');assert.equal(body.server,'s1');assert.equal(body.index,0);assert.equal(body.songs.length,2);
    await shot(p,'phone-390-remote-album-detail');
  }finally{await clean(p);}
});
test('P2 categories, persistent search/caret/back, sort/flip/view preferences and count',async()=>{
  const p=await fixture();try{
    assert.equal(await p.locator('.phone-library .libcount').textContent(),'12 albums');
    await p.locator('.phone-library [aria-label="List"]').click();await p.waitForSelector('.phone-library .libcontent>.list');
    assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('wavwiz.libprefs.v1')).compactView),'list');
    await p.locator('.phone-library .libsort').click();await p.locator('.ctxmenu button').filter({hasText:'Year (newest)'}).click();await p.waitForFunction(()=>!lib.el.querySelector('.libcontent').textContent.includes('Loading…'));
    await p.locator('.phone-library .libflip').click();
    assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('wavwiz.libprefs.v1')).flip.albums),true);
    assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('wavwiz.libprefs.v1')).sort.albums),'year');
    const search=p.locator('.phone-library .libsearch input');await p.evaluate(()=>window.searchNode=lib.el.querySelector('.libsearch input'));
    await search.fill('fixture');await p.waitForFunction(()=>calls.some(c=>c.path==='/library/find'));
    await p.waitForFunction(()=>!lib.el.querySelector('.libcontent').textContent.includes('Loading…'));
    assert.equal(await search.evaluate(e=>e===searchNode&&document.activeElement===e&&e.selectionStart===7),true);
    await p.evaluate(()=>lib.reload());await p.waitForFunction(()=>!lib.el.querySelector('.libcontent').textContent.includes('Loading…'));
    assert.equal(await search.evaluate(e=>e===searchNode&&document.activeElement===e&&e.selectionStart===7),true);
    for(const k of ['artists','albums','genres','years','recent','folders','favorites']){await category(p,k);assert.equal(await search.evaluate(e=>e===searchNode),true);}
    assert.equal(await p.locator('.phone-library [data-tab="songs"]').count(),0);
    assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('wavwiz.libprefs.v1')).sort.albums),'year');
  }finally{await clean(p);}
});
test('P2 F236 local album heart/Favorites refresh/rollback and view-only adapters',async()=>{
  const p=await fixture();try{
    await p.locator('.phone-library .tile .heart').first().click();await p.waitForFunction(()=>calls.some(c=>c.path==='/favorites'&&c.method==='PUT'));
    await category(p,'favorites');await p.waitForSelector('.phone-library .tg-favorites .tile');
    await p.evaluate(()=>window.failFav=true);const heart=p.locator('.phone-library .tg-favorites .heart').first();await heart.click();
    await p.waitForFunction(()=>document.querySelector('.phone-library .heart')?.classList.contains('on'));
    assert.equal(await heart.getAttribute('aria-pressed'),'true');
    await p.evaluate(()=>{failFav=false;});await heart.click();await p.waitForFunction(()=>lib.el.querySelector('.libcontent').textContent.includes('No favorites yet'));
  }finally{await clean(p);}
  const view=await fixture({role:'view'});try{
    assert.equal(await view.locator('.phone-library .tileplay').count(),0);
    assert.equal(await view.locator('.phone-library .heart').first().isDisabled(),true);
    await source(view,'radio');await view.waitForSelector('.phone-library [data-station="9"]');assert.equal(await view.locator('.phone-library [aria-label="Play P2 API station"]').count(),0);
    await source(view,'playlists');await view.waitForSelector('.phone-library [aria-label="Open P2 API playlist"]');assert.equal(await view.locator('.phone-library [aria-label="New playlist name"]').count(),0);
    await view.locator('.phone-library [aria-label="Open P2 API playlist"]').click();await view.waitForSelector('.phone-library [aria-label="Songs in P2 API playlist"]');assert.equal(await view.locator('.phone-library [aria-label="Move up"]').count(),0);
  }finally{await clean(view);}
});
test('P2 hierarchy, two columns, wrapped reachable tools/final rows and P1 footer at phone boundaries/landscape',async()=>{
  const p=await fixture();try{
    for(const [width,height] of [[320,568],[375,667],[390,844],[430,932],[667,375],[844,390],[760,600],[761,600],[900,600]]){
      await p.setViewportSize({width,height});await category(p,'albums');
      const g=await p.evaluate(()=>{
        const r=e=>{const b=e.getBoundingClientRect();return {x:b.x,top:b.top,bottom:b.bottom,width:b.width,height:b.height};};
        const els=['.libpage-heading','.libsrcslot','.libsearch','.libhead','.libtools','.libcount','.libscroll'].map(s=>lib.el.querySelector(s));
        desk.scrollTop=0;const hierarchy=els.map(r),cols=getComputedStyle(lib.el.querySelector('.tilegrid')).gridTemplateColumns.split(' ').length;
        const last=lib.el.querySelector('.tilegrid').lastElementChild;last.scrollIntoView({block:'end'});const lr=last.getBoundingClientRect(),d=desk.getBoundingClientRect();
        return {cols,hierarchy,desk:r(desk),last:r(last),mini:r(nowc.mini),nav:r(document.querySelector('.tabbar')),overflow:document.documentElement.scrollWidth>innerWidth,
          hit:last.contains(document.elementFromPoint(lr.x+lr.width/2,Math.min(lr.bottom-2,d.bottom-2))),padding:getComputedStyle(lib.el).paddingBottom,
          tools:[...lib.el.querySelectorAll('.libtools button')].map(r)};
      });
      assert.equal(g.cols,2);assert.equal(g.padding,'12px');assert.equal(g.overflow,false,JSON.stringify({width,height,g}));
      for(let i=1;i<g.hierarchy.length;i++)assert.ok(g.hierarchy[i].top>=g.hierarchy[i-1].bottom-1,JSON.stringify({width,height,g}));
      assert.ok(g.last.bottom<=g.desk.bottom+1);assert.ok(g.desk.bottom<=g.mini.top+1);assert.ok(g.mini.bottom<=g.nav.top+1);assert.ok(g.hit);
      assert.ok(g.tools.every(t=>t.x>=0&&t.x+t.width<=width+1&&t.height>=44),JSON.stringify({width,height,g}));
      if([320,390,761].includes(width)||height===375)await shot(p,`library-${width}x${height}-last-row`);
    }
    await p.setViewportSize({width:390,height:844});await p.evaluate(()=>desk.scrollTop=0);await shot(p,'phone-390-local-tiles');
    await p.locator('.phone-library [aria-label="List"]').click();await p.waitForSelector('.phone-library .libcontent>.list');await shot(p,'phone-390-local-list');
  }finally{await clean(p);}
});
test('P2 theme API and large Display size: no fixed orange, focused categories reachable',async()=>{
  const p=await fixture({width:320,height:568});try{
    const paint=await p.evaluate(async()=>{
      const {applyTheme,PRESETS}=await import('/js/theme.js');const values=[];
      for(const t of [{...PRESETS.default,preset:'default'},{...PRESETS.ocean,preset:'ocean'},{bg:'#f8f8ff',ink:'#202020',accent:'#824bd6',accent2:'#007b70',hl:'#355cad'}]){
        applyTheme(t);const probe=document.createElement('i');probe.style.color='var(--hl,var(--accent))';document.body.append(probe);
        values.push({selected:getComputedStyle(lib.el.querySelector('.libsrc-tabs .on')).borderBottomColor,token:getComputedStyle(probe).color});probe.remove();
      }return values;
    });
    for(const v of paint)assert.equal(v.selected,v.token);assert.notEqual(paint[0].selected,paint[1].selected);
    await p.evaluate(async()=>{const {applyScale}=await import('/js/uiscale.js');applyScale('large');document.documentElement.style.fontSize='20px';});
    const last=p.locator('.phone-library [data-tab="favorites"]');await last.focus();
    assert.equal(await last.evaluate(e=>{const r=e.getBoundingClientRect();return document.activeElement===e&&r.left>=0&&r.right<=innerWidth;}),true);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await shot(p,'phone-320-large-custom-light');
  }finally{await clean(p);}
});
test('P2 desktop compact + expanded Library geometry/paint equals P1 cascade at 901/1280/1600',async()=>{
  for(const width of [901,1280,1600]){
    const p=await fixture({width,height:800});try{
      await p.evaluate(()=>{document.getElementById('app').replaceChildren();const host=document.createElement('section');host.className='libpanel';host.style.cssText='width:540px;height:760px;overflow:auto';const lib=libraryView(S,{compact:true});window.desktopLib=lib;host.append(lib.el);document.getElementById('app').append(host);lib.reload();});
      await p.waitForSelector('.lib.compact .libcontent>.tilegrid');
      await p.evaluate(css=>{document.querySelector('link[rel=stylesheet]').disabled=true;const st=document.createElement('style');st.id='compare-css';st.textContent=css;document.head.append(st);},css);
      await p.addStyleTag({content:'*{transition:none!important;animation:none!important}'});
      for(const expanded of [false,true]){
        await p.evaluate(v=>desktopLib.setExpanded(v),expanded);await p.waitForFunction(()=>!desktopLib.el.querySelector('.libcontent').textContent.includes('Loading…'));
        const measure=()=>p.evaluate(()=>[...desktopLib.el.querySelectorAll('.libsrcslot,.libsearch,.libhead,.libtools,.tilegrid,.tile,.item')].map(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {cls:e.className,x:r.x,y:r.y,w:r.width,h:r.height,display:s.display,padding:s.padding,bg:s.backgroundColor,color:s.color,border:s.border};}));
        const current=await measure();
        await p.evaluate(base=>{document.getElementById('compare-css').textContent=base;},css.split('/* F250-P2: opt-in full-page Library')[0]);
        assert.deepEqual(await measure(),current);
        if(width===1280&&expanded)await shot(p,'desktop-1280-expanded-baseline');
        await p.evaluate(css=>{document.getElementById('compare-css').textContent=css;},css);
        if(width===1280&&expanded)await shot(p,'desktop-1280-expanded-candidate');
      }
    }finally{await clean(p);}
  }
});

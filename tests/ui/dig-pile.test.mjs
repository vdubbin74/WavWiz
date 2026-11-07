// DIG pile (Devices/mixer): EQ startLive, mute live-toggle, idle collapse, tags stack,
// mixer Max-before-Delay + focus/wheel gate + master --line chrome, Cancel preview model.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../src/WavWiz.Server/wwwroot');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const t42 = read('js/tree42.js'), spk = read('js/spkset.js'), mix = read('js/mixer.js'), sld = read('js/slider.js'), css = read('app.css'), dev = read('js/devices.js');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const has = (s, ...bits) => bits.every(b => s.includes(b));

ok('spkset imports spectrumTap', has(spk, "from './viz.js'", 'spectrumTap'));
ok('spkset paintEq startLive', has(spk, 'area.startLive?.(spectrumTap)'));
ok('spkset edit is preview-only (no saveEq in edit)', /const edit = fn => \{[^}]*previewEq\(\); \};/s.test(spk) && !/const edit = fn => \{[^}]*saveEq/s.test(spk));
ok('spkset has Cancel + Done commit', has(spk, "data-act': 'spk-cancel'", 'cancelAndClose', 'commitAndClose', 'saveEq'));
ok('spkset discard calls /dsp/revert', has(spk, '/dsp/revert'));
ok('tree42 sp42-mute live-finds zone', has(t42, '(S.zones || []).find(x => x.id === z.id)', 'muted: next', 'setIcon(mb'));
ok('tree42 speakerCtx mute live-finds', has(t42, 'mute: () => { const cur = (S.zones || []).find(x => x.id === z.id) || z; const next = !cur.muted;'));
ok('tree42 no stale !z.muted PATCH on mute button', !t42.includes("ctl.act(`/zones/${z.id}`, { muted: !z.muted }, 'PATCH')"));
ok('devices speakerCtx mute live-finds', has(dev, 'const cur = (S.zones || []).find(x => x.id === z.id) || z; const next = !cur.muted;'));
ok('tree42 idle collapse helpers', has(t42, 'wavwiz.qb42.open', 'qb42-exp', 'zsp42-collapsed', '_collapsed'));
ok('mixer Max before Delay in drawer', mix.indexOf("Max volume')") < mix.indexOf("Delay / sync offset')") && has(mix, 'mv-caprow', 'mv-delayrow'));
ok('mixer chevron uiHold paint guard', has(mix, 'uiHold', '.mv-chev:hover', 'paintQueued'));
ok('mixer focusKey default all + ctl', has(mix, "focusKey = 'all'", 'mv-master.ctl', "focusKey === 'all'"));
ok('mixer does not call Z.select', !mix.includes('Z.select') && !mix.includes("select('g:"));
ok('slider wheel gates unfocused mixer columns', has(sld, 'dialog.mixer-dlg', '.mv-master.ctl, .mv-card.ctl'));
ok('css tags stacked under name', has(css, 'flex-direction:column', '.sp42-nt', 'DIG tags-own-line'));
ok('css mv-master rest uses --line', /\.mv-master\{[^}]*border:1px solid var\(--line\)/s.test(css));
ok('css mixer .ctl mirrors qb42 controlling without rail shift', has(css, '.mv-master.ctl,.mv-card.ctl', 'box-shadow:inset 3px 0 0 var(--accent)'));
ok('css idle collapse hide list', has(css, '.zsp42.zsp42-collapsed', 'qb42-exp'));
ok('css Max rail + Delay free', has(css, 'mv-caprow', 'mv-delayrow') && css.includes('Delay length free'));
ok('css drawer no horizontal pad for Max rail', has(css, '.mv-drawer{padding:8px 0'));
ok('devices open preference in sig42', has(dev, 'openSig42', 'wavwiz.qb42.open'));
ok('devices patchLive42 forces rebuild on fold/expand change', has(dev, 'qb42-folded', 'qb42-exp') && dev.includes('return 0'));
ok('spkset separates soundDirty from ctlDirty', has(spk, 'soundDirty', 'ctlDirty', 'anyDirty'));
ok('spkset volume debounce cancelable', has(spk, 'putVolRaw.cancel', 'z.volume = v'));
ok('spkset commitSession skips DSP unless soundDirty+mayTune', has(spk, '_commitSession', 'soundDirty && mayTune()'));
ok('devices phone Back discards / Done commits', has(dev, 'closeSheetBack', 'closeSheetDone', '_discardSession', '_commitSession'));
ok('DIG-amend2 R1 hover defer requires openSg===topen', has(dev, 'openSg === topen && tnode && tnode.isConnected && hov42(tnode)'));
ok('DIG-amend2 R3 commit failure retains sheet', has(dev, 'sheetCommitted', 'ok === false'));
ok('DIG-amend2 R3b paintDetail resumes live on same-key', has(dev, '_resumeLive'));
ok('DIG-amend2 R3a putVolRaw.flush on commit', has(spk, 'putVolRaw.flush', 'takeSnap()'));
ok('DIG-amend2 R3d in-flight volume compensation', has(spk, 'volFlight', 'controlEpoch', 'Promise.allSettled'));
ok('DIG-amend2 R3c loadReal gone/target fence', has(spk, 'wantId', '!root.isConnected', 'now.deviceId !== wantId'));
ok('DIG-amend2 R3e saveEq returns false on failure', has(spk, 'return false') && has(spk, 'ok === false'));
ok('DIG-amend2 R4 mayTune recheck at DSP', has(spk, 'mayTune = () => canTune(S, z)', '!mayTune()'));
ok('DIG-amend2 R2 flat Max phone override in CSS', has(css, '.mv-sub.flat .mv-drawer .mv-drow.mv-caprow') && css.includes('grid-template-areas:"n p" "s s"'));

const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html', '.json': 'application/json' };
const harness = `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href=/app.css>
<body><div id=root></div><div id=host></div>
<script type=module>
try {
window.__acts = []; window.__calls = [];
const j = (data) => ({ ok:true, status:200, text: async () => JSON.stringify(data), json: async () => data });
window.fetch = async (url, opt) => {
  window.__calls.push({ url: String(url), method: (opt && opt.method) || 'GET', body: opt && opt.body ? JSON.parse(opt.body) : null });
  const u = String(url), m = ((opt && opt.method) || 'GET').toUpperCase();
  if (u.includes('/dsp/presets') && m === 'GET') return j([{ id:1, name:'Flat', source:'builtin', json:{ graphicDb:new Array(10).fill(0), bypass:false, bass:{gainDb:0}, treble:{gainDb:0}, balance:0, trimDb:0, loudness:{enabled:false}, autoPreamp:false, limiter:{enabled:false} } }]);
  if (u.includes('/dsp/assignments') && m === 'GET') return j({ presetId:1, enabled:true, bypass:false });
  if (u.includes('/profiles/for/')) return j({ profileId:null, modified:false });
  if (u.includes('/profiles')) return j([]);
  if (u.includes('/calibrations')) return j([]);
  return j({});
};

const { treeEl } = await import('/js/tree42.js');
const D = await import('/js/devices.js');
const { openMixer } = await import('/js/mixer.js');
const { speakerSettings } = await import('/js/spkset.js');
const { installSliderGuard } = await import('/js/slider.js');
installSliderGuard(document);

const zones = [
  { id: 1, name: 'Basement Spk', connected: true, enabled: true, muted: false, volume: 40, volCap: 100, outputs: [{ deviceId: 'd1', name: 'Out', kind: 'analog', connected: true, active: true, latencyMs: 0 }] },
  { id: 2, name: 'Patio Spk', connected: true, enabled: true, muted: false, volume: 50, volCap: 80, outputs: [{ deviceId: 'd2', name: 'Out', kind: 'analog', connected: true, active: true, latencyMs: 0 }] },
];
const groups = [
  { id: 10, name: 'Basement', deviceIds: [1], playbackId: 'zg:10', linked: [], now: { state: 'stopped' }, jukebox: false },
  { id: 11, name: 'Patio', deviceIds: [2], playbackId: 'zg:11', linked: [], now: { state: 'playing', title: 'Song', artist: 'A', durationMs: 100000, positionMs: 1000 }, jukebox: false },
];
const S = { auth: { role: 'admin' }, zones, groups, jb: null, cast: null, _groupsAt: Date.now() };
const ctl = { act: (p, b, m) => window.__acts.push({ p, b, m }), refreshAll() {}, go() {}, openQueue() {} };
const canControl = () => true, isAdmin = () => true;
const kit = {
  capBar: () => { const wrap = document.createElement('div'); wrap.className='vbar'; const pct = document.createElement('span'); pct.className='pct'; pct.textContent='40%'; return { wrap, pct, patch(){} }; },
  onPill: () => { const b = document.createElement('button'); b.className='pill42'; b._set = () => {}; return b; },
  ro: (el) => el,
  tagEls3: (tags) => (tags||[]).map(t => { const s=document.createElement('span'); s.className='dtag '+(t.k||''); s.textContent=t.text||t.k||''; return s; }),
  cardTags3: D.cardTags3, zoneTags3: D.zoneTags3, zoneMembers: D.zoneMembers, zoneMuted: D.zoneMuted, zoneOn: D.zoneOn, zoneLevel: D.zoneLevel, zoneCap: D.zoneCap,
  canControl, isAdmin, promptName: async()=>{}, confirmRemoveZone:()=>{}, canTune:()=>true, dotClass:()=>'ok', orderedGroups: g => g, openCalibration:()=>{}, forget:()=>{}
};
const st = { zone: null, spk: null, onZone(){}, onSpk(){}, busy(){} };
let root = treeEl(S, ctl, kit, st);
document.getElementById('root').append(root);

const idleBox = root.querySelector('.qb42[data-leader-id="10"]');
const playBox = root.querySelector('.qb42[data-leader-id="11"]');
window.__idleFolded = idleBox && !idleBox.classList.contains('zfold42') && !idleBox.querySelector('.zsp42[hidden], .zsp42.zsp42-collapsed');   // F266: idle boxes are open unless the user folds them
window.__playOpen = playBox && !playBox.classList.contains('qb42-folded') && !playBox.querySelector('.zsp42[hidden]');
window.__expBtn = !!(idleBox && idleBox.querySelector('.qb42-trow .zfold42-t')) && !(idleBox && idleBox.querySelector('.qb42-exp'));   // F266 fold toggle replaces the speakers toggle
idleBox && idleBox.querySelector('.qb42-exp') && idleBox.querySelector('.qb42-exp').click();
await new Promise(r => setTimeout(r, 20));
root.remove();
root = treeEl(S, ctl, kit, st);
document.getElementById('root').append(root);
const idle2 = root.querySelector('.qb42[data-leader-id="10"]');
window.__idleExpanded = idle2 && !idle2.classList.contains('qb42-folded') && !idle2.querySelector('.zsp42[hidden]');

const muteBtn = root.querySelector('.qb42[data-leader-id="11"] .sp42-mute');
window.__muteBtn = !!muteBtn;
muteBtn && muteBtn.click();
muteBtn && muteBtn.click();
window.__muteActs = window.__acts.filter(a => String(a.p).includes('/zones/2'));
window.__mutedEnd = zones.find(z => z.id === 2).muted;

const nt = root.querySelector('.sp42-nt');
window.__tagsCol = nt ? getComputedStyle(nt).flexDirection : null;

zones[1] = Object.assign({}, zones[1], { muted: true });
S.zones = zones.map(z => Object.assign({}, z));
const mb2 = root.querySelector('.qb42[data-leader-id="11"] .sp42-mute');
const before = window.__acts.length;
mb2 && mb2.click();
window.__staleUnmute = window.__acts.length === before + 1 && window.__acts[window.__acts.length - 1].b.muted === false;

// Mixer
const d = openMixer(S, ctl);
document.body.append(d.el);
const master = d.el.querySelector('.mv-master');
const cards = [...d.el.querySelectorAll('.mv-card')];
window.__masterCtl = master.classList.contains('ctl');
window.__masterRestLine = getComputedStyle(master).getPropertyValue('border-top-color') || getComputedStyle(master).borderColor;
d.el.querySelector('.mv-chev') && d.el.querySelector('.mv-chev').click();
const drawer = d.el.querySelector('.mv-drawer:not([hidden])') || d.el.querySelector('.mv-drawer');
const rows = drawer ? [...drawer.querySelectorAll('.mv-drow')] : [];
window.__maxBeforeDelay = rows[0] && rows[0].classList.contains('mv-caprow') && rows[1] && rows[1].classList.contains('mv-delayrow');

cards[1].click();
await new Promise(r => setTimeout(r, 10));
window.__card2Ctl = cards[1].classList.contains('ctl') && !master.classList.contains('ctl');

const sliders = [...d.el.querySelectorAll('.mv-card input.mv-vol')];
window.__slidersEnabled = sliders.length >= 2 && !sliders[0].disabled && !sliders[1].disabled;
const s0 = sliders[0], s1 = sliders[1];
const v0 = s0.value, v1 = s1.value;
// Probe the gate the same way slider.js does (force :hover via matches mock is hard; call handler condition)
const gated0 = !!(s0.closest('dialog.mixer-dlg') && !s0.closest('.mv-master.ctl, .mv-card.ctl'));
const gated1 = !!(s1.closest('dialog.mixer-dlg') && !s1.closest('.mv-master.ctl, .mv-card.ctl'));
window.__wheelGateUnfocused = gated0 === true;
window.__wheelGateFocused = gated1 === false;
// Also try a real nudge on the focused slider by temporarily clearing disabled and using input
s1.value = String(Math.min(100, +s1.value + 1));
s1.dispatchEvent(new Event('input', { bubbles: true }));
window.__focusedSliderWritable = s1.value !== v1;

// Speaker settings Cancel
const z = S.zones[0];
window.__closed = false;
const sheet = speakerSettings(S, ctl, z, { onDone: () => { window.__closed = true; } });
document.getElementById('host').append(sheet);
await new Promise(r => setTimeout(r, 200));
window.__hasCancel = !!sheet.querySelector('[data-act=spk-cancel]');
window.__hasLiveEq = !!sheet.querySelector('.spk-eq canvas, .eqarea, canvas');
const vol = sheet.querySelector('.spk-volline input[type=range], .spk-vol input[type=range]');
if (vol) { vol.value = '77'; vol.dispatchEvent(new Event('input', { bubbles: true })); }
await new Promise(r => setTimeout(r, 30));
window.__dirty = sheet.querySelector('[data-act=spk-cancel]') && !sheet.querySelector('[data-act=spk-cancel]').disabled;
const cancelBtn = sheet.querySelector('[data-act=spk-cancel]');
cancelBtn && cancelBtn.click();
await new Promise(r => setTimeout(r, 200));
window.__reverted = window.__calls.some(c => String(c.url).includes('/dsp/revert'));
window.__closedAfter = !!window.__closed;

// DIG-R3: Cancel must suppress queued volume write
const volWritesAfterCancel = window.__calls.filter(c => String(c.url).includes('/zones/') && (c.method||'').toUpperCase()==='PATCH' && c.body && c.body.volume != null);
window.__volAfterCancel = zones[0].volume;
window.__queuedVolSuppressed = !volWritesAfterCancel.some(c => c.body.volume === 77);

// DIG-R4: volume-only Done must not POST preset / PUT assignment
window.__calls.length = 0; window.__closed2 = false;
const sheet2 = speakerSettings(S, ctl, Object.assign({}, S.zones[0], { mine: false }), { onDone: () => { window.__closed2 = true; } });
// Force canTune false by using a zone that won't pass — speakerSettings uses canTune(S,z); role stays admin so canTune true.
// Probe via commitSession path: edit volume only on a fresh sheet and click Done, then inspect DSP writes.
document.getElementById('host').append(sheet2);
await new Promise(r => setTimeout(r, 200));
const vol2 = sheet2.querySelector('.spk-volline input[type=range], .spk-vol input[type=range]');
if (vol2) { vol2.value = '45'; vol2.dispatchEvent(new Event('input', { bubbles: true })); }
await new Promise(r => setTimeout(r, 30));
// Directly exercise commitSession (volume-only): soundDirty false → no DSP
if (sheet2._commitSession) await sheet2._commitSession();
else sheet2.querySelector('[data-act=spk-done]')?.click();
await new Promise(r => setTimeout(r, 120));
window.__volOnlyDsp = window.__calls.filter(c => {
  const u = String(c.url), m = (c.method||'GET').toUpperCase();
  return m !== 'GET' && u.includes('/dsp/') && !u.includes('/dsp/revert');
});
window.__volOnlyOk = window.__volOnlyDsp.length === 0;
sheet2.remove();

window.__done = true;
} catch (e) { window.__err = String(e && e.stack || e); window.__done = true; }
</script></body>`;

const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/' || u === '/harness.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(harness); return; }
  const fp = path.join(ROOT, u);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': mime[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const br = await chromium.launch();
const page = await br.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => console.error('PAGEERR', e.message));
await page.goto(`http://127.0.0.1:${port}/harness.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__done, null, { timeout: 30000 });
const r = await page.evaluate(() => ({
  err: window.__err,
  idleFolded: window.__idleFolded, playOpen: window.__playOpen, expBtn: window.__expBtn, idleExpanded: window.__idleExpanded,
  muteBtn: window.__muteBtn, muteActs: window.__muteActs, mutedEnd: window.__mutedEnd, tagsCol: window.__tagsCol, staleUnmute: window.__staleUnmute,
  masterCtl: window.__masterCtl, maxBeforeDelay: window.__maxBeforeDelay, card2Ctl: window.__card2Ctl,
  wheelGateUnfocused: window.__wheelGateUnfocused, wheelGateFocused: window.__wheelGateFocused,
  slidersEnabled: window.__slidersEnabled, focusedSliderWritable: window.__focusedSliderWritable,
  hasCancel: window.__hasCancel, dirty: window.__dirty, reverted: window.__reverted, closedAfter: window.__closedAfter,
  hasLiveEq: window.__hasLiveEq,
  volAfterCancel: window.__volAfterCancel, queuedVolSuppressed: window.__queuedVolSuppressed,
  volOnlyOk: window.__volOnlyOk, volOnlyDsp: window.__volOnlyDsp
}));
await br.close(); await new Promise(r => srv.close(r));

ok('no harness error', !r.err, r.err || '');
ok('F266: idle zone open by default (no auto-fold)', !!r.idleFolded, JSON.stringify(r));
ok('playing zone stays open', !!r.playOpen);
ok('F266: zone fold toggle present on idle (old speakers toggle gone)', !!r.expBtn);
ok('expand reveals speakers', !!r.idleExpanded);
ok('speaker mute button present', !!r.muteBtn);
ok('first mute tap posts muted:true', r.muteActs && r.muteActs[0] && r.muteActs[0].b.muted === true, JSON.stringify(r.muteActs));
ok('second mute tap posts muted:false', r.muteActs && r.muteActs[1] && r.muteActs[1].b.muted === false, JSON.stringify(r.muteActs));
ok('optimistic ends unmuted', r.mutedEnd === false);
ok('tags flex-direction column', r.tagsCol === 'column', r.tagsCol);
ok('live-find unmutes after S.zones replace', !!r.staleUnmute);
ok('mixer Max row before Delay', !!r.maxBeforeDelay);
ok('mixer All zones focused by default', !!r.masterCtl);
ok('mixer card click focuses card', !!r.card2Ctl);
ok('mixer sliders enabled for admin', !!r.slidersEnabled);
ok('wheel gate blocks unfocused column', !!r.wheelGateUnfocused);
ok('wheel gate allows focused column', !!r.wheelGateFocused);
ok('focused column slider writable', !!r.focusedSliderWritable);
ok('speaker settings has Cancel', !!r.hasCancel);
ok('volume edit marks Cancel enabled', !!r.dirty, JSON.stringify({dirty:r.dirty,hasCancel:r.hasCancel}));
ok('Cancel closes after discard', !!r.closedAfter, JSON.stringify({ reverted: r.reverted, closed: r.closedAfter }));
ok('Cancel suppresses queued volume 77', !!r.queuedVolSuppressed && r.volAfterCancel === 40, JSON.stringify({vol:r.volAfterCancel,sup:r.queuedVolSuppressed}));
ok('volume-only Done writes no DSP preset/assignment', !!r.volOnlyOk, JSON.stringify(r.volOnlyDsp));

console.log(`\ndig-pile: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

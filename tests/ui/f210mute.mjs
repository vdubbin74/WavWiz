// F210: Queue-box zone mute re-reads live muted state so a second tap unmutes (no stale render-time closure).
// Phone-sized viewport; static harness (no live server). Asserts second POST body muted:false.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('/workspace/pw-ui/package.json');
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../src/WavWiz.Server/wwwroot');
const t42 = fs.readFileSync(path.join(ROOT, 'js/tree42.js'), 'utf8');
const dev = fs.readFileSync(path.join(ROOT, 'js/devices.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const has = (s, ...bits) => bits.every(b => s.includes(b));

ok('tree42 queueBox mute recomputes live members', has(t42, 'all.flatMap(g => zoneMembers(S.zones, g))', 'cur.every(z => z.muted)', 'for (const z of cur) z.muted = m', 'ctl.act(`/groups/${g.id}/mute`, { muted: m })'));
ok('tree42 queueBox mute has no stale !muted act', !t42.includes('ctl.act(`/groups/${g.id}/mute`, { muted: !muted })') && !t42.includes("muted: !muted }"));
ok('tree42 zoneCtx mute live-reads zoneMuted', has(t42, 'mute: () => { const m = !zoneMuted(S.zones, g); for (const z of zoneMembers(S.zones, g)) z.muted = m; ctl.act(`/groups/${g.id}/mute`, { muted: m }); }'));
ok('tree42 zonePane mute live-reads zoneMuted', has(t42, 'onclick: () => { const m = !zoneMuted(S.zones, g); for (const z of zoneMembers(S.zones, g)) z.muted = m; ctl.act(`/groups/${g.id}/mute`, { muted: m });'));
ok('tree42 jukebox mute live-reads jb members', has(t42, '(S.zones || []).filter(z => jbIds.has(z.id))', "api('/jukebox/zone/mute', { method: 'POST', body: { muted: m } })"));
ok('devices zoneCtx mute live-reads zoneMuted', has(dev, 'mute: () => { const m = !zoneMuted(S.zones, g); for (const z of zoneMembers(S.zones, g)) z.muted = m; ctl.act(`/groups/${g.id}/mute`, { muted: m }); }'));
ok('devices jukebox mute live-reads members', has(dev, '(S.zones || []).filter(z => ids.has(z.id))', "api('/jukebox/zone/mute', { method: 'POST', body: { muted: m } })"));
ok('devices hov42 requires real hover media', has(dev, "matchMedia('(hover: hover)').matches"));
ok('devices leave-alone paths still live-read zoneMuted', (dev.split('const m = !zoneMuted(S.zones, g); for (const z of ms) z.muted = m; ctl.act(`/groups/${g.id}/mute`, { muted: m });').length - 1) >= 2);

const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html', '.json': 'application/json' };
const harness = `<!doctype html><meta charset=utf-8><body><div id=root></div>
<script type=module>
try {
window.__acts = [];
const { treeEl } = await import('/js/tree42.js');
const D = await import('/js/devices.js');
const zones = [
  { id: 1, name: 'Basement Spk', connected: true, enabled: true, muted: false, volume: 40, outputs: [{ deviceId: 'd1', name: 'Out', kind: 'analog', connected: true, active: true }] },
];
const groups = [ { id: 10, name: 'Basement', deviceIds: [1], playbackId: 'zg:10', linked: [], now: { state: 'playing', title: 'Song', artist: 'A', durationMs: 100000, positionMs: 1000 } } ];
const S = { zones, groups, jb: null, cast: null, _groupsAt: Date.now() };
const ctl = { act: (p, b, m) => window.__acts.push({ p, b, m }), refreshAll() {}, go() {}, openQueue() {} };
const canControl = () => true, isAdmin = () => true;
const kit = {
  capBar: () => { const wrap = document.createElement('div'); wrap.className='vbar'; const pct = document.createElement('span'); pct.className='pct'; pct.textContent='40%'; return { wrap, pct, patch(){} }; },
  onPill: () => { const b = document.createElement('button'); b.className='pill42'; b._set = () => {}; return b; },
  ro: (el) => el,
  tagEls3: (tags) => (tags||[]).map(t => { const s=document.createElement('span'); s.className='dtag'; s.textContent=t.text||''; return s; }),
  cardTags3: D.cardTags3, zoneTags3: D.zoneTags3, zoneMembers: D.zoneMembers, zoneMuted: D.zoneMuted, zoneOn: D.zoneOn, zoneLevel: D.zoneLevel, zoneCap: D.zoneCap,
  canControl, isAdmin, promptName: async()=>{}, confirmRemoveZone:()=>{}, canTune:()=>false, dotClass:()=>'ok', orderedGroups: g => g, openCalibration:()=>{}, forget:()=>{}
};
const st = { zone: null, spk: null, onZone(){}, onSpk(){}, busy(){} };
const root = treeEl(S, ctl, kit, st);
document.getElementById('root').append(root);
const btn = root.querySelector('.qb42 .zmute');
window.__btn = !!btn;
btn?.click();
btn?.click();
window.__muted = zones.map(z => z.muted);
window.__aria = btn?.getAttribute('aria-pressed');
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
const page = await br.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.goto(`http://127.0.0.1:${port}/harness.html`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__done, null, { timeout: 10000 });
const r = await page.evaluate(() => ({ acts: window.__acts, btn: window.__btn, muted: window.__muted, aria: window.__aria, err: window.__err }));
await br.close(); srv.close();

ok('queue-box mute button rendered', !!r.btn, r.err || '');
ok('first tap posts muted:true', r.acts?.[0]?.b?.muted === true, JSON.stringify(r.acts));
ok('second tap posts muted:false', r.acts?.[1]?.b?.muted === false, JSON.stringify(r.acts));
ok('optimistic state ends unmuted', r.muted?.[0] === false && r.aria === 'false', JSON.stringify({ muted: r.muted, aria: r.aria }));
ok('no harness error', !r.err, r.err || '');

console.log(`\nf210mute: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

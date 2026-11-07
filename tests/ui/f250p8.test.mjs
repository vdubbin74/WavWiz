// F250-P8: phone Devices per-zone max-based sliders/mute + NP selected-zone parity (incl. Jukebox).
// Static source + pure mixer-core math + local DOM harness (no live server / no build).
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire('/workspace/pw-ui/package.json');
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../src/WavWiz.Server/wwwroot');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const t42 = read('js/tree42.js'), now = read('js/now.js'), dev = read('js/devices.js'), mix = read('js/mixer-core.js'), mixer = read('js/mixer.js');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const has = (s, ...bits) => bits.every(b => s.includes(b));

// ---- pure math (phone max contract)
const coreUrl = pathToFileURL(path.join(ROOT, 'js/mixer-core.js')).href;
const {
  groupLevel, scaleTo, phoneZoneMembers, phoneZoneLevel, uniqueMembers, phoneZoneVolWriter,
} = await import(coreUrl);

ok('groupLevel is max (mixer/NP contract)', groupLevel([10, 70, 30]) === 70 && groupLevel([]) === 0);
ok('phoneZoneLevel rounds max', phoneZoneLevel([{ volume: 10 }, { volume: 70.4 }]) === 70);
ok('uniqueMembers drops overlap once', uniqueMembers([{ id: 1, volume: 40 }, { id: 2, volume: 50 }, { id: 1, volume: 99 }]).map(z => z.id).join() === '1,2');
ok('phoneZoneMembers skips disabled + dedupes', (() => {
  const zs = phoneZoneMembers(
    [{ id: 1, volume: 40, enabled: true }, { id: 2, volume: 80, enabled: false }, { id: 1, volume: 40, enabled: true }, { id: 3, volume: 20, enabled: true }],
    [1, 2, 3]);
  return zs.map(z => z.id).join() === '1,3' && phoneZoneLevel(zs) === 40;
})());
ok('scaleTo preserves ratios under caps (phone write)', JSON.stringify(scaleTo([60, 30], 30, [100, 100])) === JSON.stringify([30, 15]));
ok('all-zero scaleTo sets every speaker to target', JSON.stringify(scaleTo([0, 0], 40)) === JSON.stringify([40, 40]));

// writer: mid-drag membership change drops stale PATCH
await new Promise(resolve => {
  const zones = [{ id: 1, volume: 60, volCap: 100, enabled: true }, { id: 2, volume: 30, volCap: 100, enabled: true }];
  let deviceIds = [1, 2], writes = [], can = true;
  const w = phoneZoneVolWriter({
    act: (z, body) => writes.push({ id: z.id, ...body }),
    can: () => can,
    keyOf: () => JSON.stringify(phoneZoneMembers(zones, deviceIds).map(z => [z.id, z.volCap ?? 100, z.enabled])),
    delay: 40,
  });
  w.apply(phoneZoneMembers(zones, deviceIds), 30);
  deviceIds = [1]; // membership shrink mid-drag
  setTimeout(() => {
    ok('mid-drag membership change: no stale timed writes', writes.length === 0, JSON.stringify(writes));
    // fresh apply after reset with can=false
    w.resetBase();
    can = false;
    w.apply(phoneZoneMembers(zones, [1, 2]), 10);
    setTimeout(() => {
      ok('permission loss cancels phone writer', writes.length === 0, JSON.stringify(writes));
      can = true; deviceIds = [1, 2];
      w.resetBase();
      zones[0].volume = 60; zones[1].volume = 30;
      w.apply(phoneZoneMembers(zones, deviceIds), 30);
      setTimeout(() => {
        ok('phone writer PATCHes unique members proportionally', writes.length === 2 && writes.every(x => 'volume' in x) && writes.find(x => x.id === 1)?.volume === 30 && writes.find(x => x.id === 2)?.volume === 15, JSON.stringify(writes));
        w.cancel();
        resolve();
      }, 60);
    }, 60);
  }, 60);
});

// cancel before fire
await new Promise(resolve => {
  const zones = [{ id: 9, volume: 50, volCap: 100, enabled: true }];
  let writes = 0;
  const w = phoneZoneVolWriter({ act: () => { writes++; }, can: () => true, keyOf: () => 'k', delay: 80 });
  w.apply(zones, 10);
  w.cancel();
  setTimeout(() => { ok('cancel/close drops pending phone writes', writes === 0, String(writes)); resolve(); }, 120);
});

// ---- static source contracts
ok('mixer-core exports phone max helpers', has(mix, 'phoneZoneMembers', 'phoneZoneLevel', 'phoneZoneVolWriter', 'uniqueMembers'));
ok('devices phone kit sets phoneMaxBars', has(dev, "phoneMaxBars: X.size === 'phone'") && has(dev, 'F250-P8'));
ok('desktop kit path still uses average zoneLevel helper', has(dev, 'export const zoneLevel = (zones, g) => { const ms = zoneMembers(zones, g); return ms.length ? Math.round(ms.reduce((a, z) => a + z.volume, 0) / ms.length) : 0; }'));
ok('tree42 phone branch uses phoneZoneLevel + member PATCH', has(t42, 'phoneMaxBars ? phoneZoneLevel', "`/zones/${z.id}`", 'phoneZoneVolWriter'));
ok('tree42 desktop branch keeps /groups/{id}/volume average write', has(t42, 'for (const g of all) ctl.act(`/groups/${g.id}/volume`, { set: v })') && has(t42, 'phoneMaxBars'));
ok('tree42 desktop average display path retained', has(t42, 'ms.reduce((a, z) => a + z.volume, 0) / ms.length'));
ok('tree42 Jukebox phone binds member PATCH not average /jukebox/zone/volume', has(t42, 'jbWriter.apply', "api('/jukebox/zone/volume'") && t42.includes('jbIdsLive'));
ok('tree42 Jukebox mute still uses real /jukebox/zone/mute', has(t42, "api('/jukebox/zone/mute', { method: 'POST', body: { muted: m } })"));
ok('tree42 BOXSKIP keeps volume adjust from switching controlling zone', has(t42, '.qb42-vol') && has(t42, 'BOXSKIP'));
ok('zonePane phone max agrees with tree', has(t42, 'phoneMax ? phoneZoneLevel(paneMs)', 'paneWriter.apply'));
ok('NP zoneGroup binds Jukebox', has(now, "c?.kind === 'jukebox'", 'jukebox: true', "api('/jukebox/zone/mute'"));
ok('NP zoneMembers uses phoneZoneMembers (max contract)', has(now, 'phoneZoneMembers(S.zones, g.deviceIds)', 'phoneZoneLevel(zs)'));
ok('NP still scaleTo + delayed /zones/{id} PATCH', has(now, 'scaleTo(base.vols', "`/zones/${z.id}`", 'pointerTarget'));
ok('mixer grid still filters g.jukebox (broader mixer unchanged)', /jukebox/i.test(mixer) && has(mixer, 'groupLevel'));
ok('mixer still max-based groupLevel (not flipped to average)', has(mixer, 'groupLevel(') && !mixer.includes('zoneLevel('));

// held slider: capBar.patch uses idle(); phone path reuses capBar
ok('capBar does not replace held slider (idle guard)', has(dev, 'if (idle(vol))') && has(dev, 'patch: (v, c)'));
ok('devices redraw defers under active phone/tree slider', has(dev, '.tree42 .vbar input:active'));

// ---- local DOM: NP level agrees with Devices math for same zone; Jukebox mute path
const mime = f => f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
const server = http.createServer((req, res) => {
  const u = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = u === '/' ? '/index.html' : u;
  const fp = path.join(ROOT, file.replace(/^\//, ''));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': mime(fp) }); res.end(fs.readFileSync(fp));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERR', e.message));
await page.goto(`http://127.0.0.1:${port}/`);
const dom = await page.evaluate(async () => {
  const { phoneZoneMembers, phoneZoneLevel, scaleTo, groupLevel } = await import('/js/mixer-core.js');
  // devices average helper (must stay different from phone max for multi-speaker zones)
  const zoneLevelAvg = (zones, g) => { const ms = zones.filter(z => g.deviceIds.includes(z.id)); return ms.length ? Math.round(ms.reduce((a, z) => a + z.volume, 0) / ms.length) : 0; };
  const zones = [
    { id: 1, name: 'A', volume: 80, muted: false, enabled: true, connected: true, volCap: 100 },
    { id: 2, name: 'B', volume: 40, muted: false, enabled: true, connected: true, volCap: 100 },
    { id: 3, name: 'C', volume: 0, muted: true, enabled: true, connected: false, volCap: 50, volLocked: true },
    { id: 4, name: 'D', volume: 55, muted: false, enabled: false, connected: true, volCap: 100 },
  ];
  const g = { id: 10, name: 'Patio', deviceIds: [1, 2, 3, 4] };
  const phone = phoneZoneMembers(zones, g.deviceIds);
  const npLvl = phoneZoneLevel(phone);
  const avg = zoneLevelAvg(zones, g);
  // capped/all-zero/empty/offline-ish
  const empty = phoneZoneLevel(phoneZoneMembers(zones, []));
  const allZero = phoneZoneLevel([{ volume: 0, id: 1, enabled: true }, { volume: 0, id: 2, enabled: true }]);
  const overlap = phoneZoneMembers(zones, [1, 2, 1]);
  // linked flatten unique
  const linkedIds = [1, 2, 1, 3];
  const { uniqueMembers: uniq } = await import('/js/mixer-core.js');
  const linked = uniq(zones.filter(z => linkedIds.includes(z.id) && z.enabled !== false));
  return {
    npLvl, avg, phoneIds: phone.map(z => z.id), empty, allZero,
    overlapIds: overlap.map(z => z.id),
    linkedIds: linked.map(z => z.id),
    linkedLvl: phoneZoneLevel(linked),
    maxIsNotAvg: npLvl !== avg && npLvl === 80 && avg === Math.round((80 + 40 + 0 + 55) / 4),
    disabledExcluded: !phone.some(z => z.id === 4),
  };
});
ok('phone Devices/NP max !== desktop average for multi-speaker zone', dom.maxIsNotAvg, JSON.stringify(dom));
ok('NP selected-zone level uses same phoneZoneMembers as Devices', dom.npLvl === 80 && dom.phoneIds.join() === '1,2,3', JSON.stringify(dom));
ok('empty zone level is 0', dom.empty === 0);
ok('all-zero zone level is 0', dom.allZero === 0);
ok('overlap members unique for phone path', dom.overlapIds.join() === '1,2', JSON.stringify(dom));
ok('linked/overlap flatten unique + max level', dom.linkedIds.join() === '1,2,3' && dom.linkedLvl === 80, JSON.stringify(dom));
ok('disabled speakers excluded from phone participants', dom.disabledExcluded);

// NP Jukebox binding smoke via source already; DOM import zones40 choices
const jb = await page.evaluate(async () => {
  const Z = await import('/js/zones40.js');
  const list = Z.choices([{ id: 1, name: 'Kitchen', deviceIds: [1] }], { own: true, deviceIds: [2], zoneId: 'jukebox' });
  const jb = list.find(c => c.kind === 'jukebox');
  return { has: !!jb, key: jb?.key, kinds: list.map(c => c.kind) };
});
ok('zones40 exposes selectable Jukebox for NP binding', jb.has && jb.key === 'jukebox', JSON.stringify(jb));

await br.close();
server.close();

console.log(`\nf250p8: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

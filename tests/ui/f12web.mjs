// 0.4.4 F12 (web): a browser speaker moved into a PLAYING zone must get audio within ~2 s, same song.
// Usage: TAG=before|after node f12web.mjs   (server on 172.30.0.2:47800)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim(), TAG = process.env.TAG || 'after';
const api = async (p, m = 'GET', body) => { const r = await fetch(B + '/api/v1' + p, { method: m, headers: { cookie: 'unison_session=' + sess, 'content-type': 'application/json', origin: B }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const br = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let fail = 0;
for (const [tag, dpr] of [['100', 1], ['200', 2]]) {
  const ctx = await br.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr });
  await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '1'); localStorage.setItem('wavwiz.webRoom.name', 'F12 Browser'); localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'rail', dev: 'expanded', exp: 'dev', list: 'normal', ctl: 'collapsed' })); });
  const p = await ctx.newPage();
  await p.addInitScript(() => { window.__st = null; window.addEventListener('wavwiz:phone', e => { window.__st = e.detail; }); });
  await p.goto(B + '/'); await p.waitForTimeout(3500);
  await p.evaluate(async () => { try { (await import('/js/room.js')).unlockAudio(); } catch {} document.querySelectorAll('.phone-unlock').forEach(e => e.remove()); });
  await p.waitForTimeout(800);
  const pid = await p.evaluate(() => localStorage.getItem('wavwiz.webRoom.id'));
  const zones = await api('/zones'); const me = zones.find(z => z.playerId === pid);
  if (!me) { console.log('no web zone for', pid); fail++; await ctx.close(); continue; }
  const groups = await api('/groups'); const base = groups.find(g => g.name === 'Basement');
  // the browser speaker starts OUT of Basement; Basement plays
  for (const g of groups) if (g.deviceIds.includes(me.id)) await api('/groups/' + g.id, 'PATCH', { deviceIds: g.deviceIds.filter(d => d !== me.id) });
  // FROM_PLAYING=1: the speaker starts in Patio, which is also playing (both groups have a live epoch)
  const pat = groups.find(g => g.name === 'Patio');
  if (process.env.FROM_PLAYING) { await api('/groups/' + pat.id, 'PATCH', { deviceIds: [...pat.deviceIds.filter(d => d !== me.id), me.id] }); await api('/queue/add?zoneId=' + pat.playbackId, 'POST', { kind: 'tracks', ids: [2] }); await api('/stream/jump?zoneId=' + pat.playbackId, 'POST', { index: 0 }); await api('/stream/resume?zoneId=' + pat.playbackId, 'POST', {}); }
  await api('/stream/jump?zoneId=' + base.playbackId, 'POST', { index: 0 }); await api('/stream/resume?zoneId=' + base.playbackId, 'POST', {});
  await p.waitForTimeout(2500);
  const title0 = (await api('/stream?zoneId=' + base.playbackId)).now?.item?.title;
  const f0 = await p.evaluate(() => window.__st?.stats?.frames ?? 0);
  await api('/groups/' + base.id, 'PATCH', { deviceIds: [...base.deviceIds.filter(d => d !== me.id), me.id] });
  const t0 = Date.now(); let f1 = f0, st = null;
  while (Date.now() - t0 < 2500) { await p.waitForTimeout(150); ({ f1, st } = await p.evaluate(() => ({ f1: window.__st?.stats?.frames ?? 0, st: window.__st?.state }))); if (f1 > f0 + 10) break; }
  const ms = Date.now() - t0, title1 = (await api('/stream?zoneId=' + base.playbackId)).now?.item?.title;
  const ok = f1 > f0 + 10 && title0 === title1;
  console.log(`${TAG} [${tag}] ${ok ? 'PASS' : 'FAIL'} frames ${f0}->${f1} in ${ms} ms state=${st} title ${title0}->${title1}`);
  if (!ok) fail++;
  await p.screenshot({ path: `/workspace/screens/wavwiz-044-F12-${TAG}${process.env.FROM_PLAYING ? '-fromplaying' : ''}-${tag}.png` });
  await api('/stream/stop?zoneId=' + base.playbackId, 'POST', {}); if (pat) await api('/stream/stop?zoneId=' + pat.playbackId, 'POST', {});
  await ctx.close();
}
await br.close(); process.exit(fail ? 1 : 0);

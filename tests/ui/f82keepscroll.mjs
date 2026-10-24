// 0.4.9 F82: Devices (Classic, Roomy, Full, expanded, phone) and the Library keep their scroll position for 20 s of normal periodic
// server events while a speaker flaps online / offline and its level drifts (each change rebuilds the zone tree).
import { chromium, devices } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(); let ok = 0, bad = 0;
const t = (c, m) => { c ? ok++ : bad++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const br = await chromium.launch();
// random mix per refresh: AirPlay session (cast on, song / artist / progress / art changing, the phone's volume) + a speaker flapping
const rnd = n => Math.floor(Math.random() * n);
async function open(lay, phone, flap = true) {
  const c = await br.newContext(phone ? { ...devices['iPhone 13'] } : { viewport: { width: 1400, height: 760 } });
  await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(l => { for (const [k, v] of [['wavwiz.whatsnew', '9.9.9'], ['wavwiz.gettingStarted.shown', '1'], ['wavwiz.webRoom.autojoin', '0'], ['wavwiz.layout', l]]) localStorage.setItem(k, v); }, lay);
  let song = 0, pos = 0, gid = null;
  await c.route(/\/api\/v1\/zones(\?|$)/, async r => { try { const res = await r.fetch(), j = await res.json(); j.forEach((z, i) => { z.connected = i < j.length - 1 || !flap || rnd(2) === 0; }); if (j[0] && rnd(2)) j[0].volume = 20 + rnd(60); await r.fulfill({ response: res, json: j }); } catch { } });
  await c.route(/\/api\/v1\/groups(\?|$)/, async r => { try { const res = await r.fetch(), j = await res.json(); if (rnd(3) === 0) song++; pos += 1000 + rnd(9000);
    if (j[0]) { gid = j[0].id; j[0].now = { state: rnd(6) ? 'playing' : 'paused', kind: 'airplay', title: 'AirPlay song ' + song, artist: 'Phone artist ' + (song % 3), durationMs: 240000, positionMs: pos % 240000, artUrl: '/api/v1/cast/art?v=' + song }; }
    await r.fulfill({ response: res, json: j }); } catch { } });
  await c.route(/\/api\/v1\/cast(\?|$)/, r => r.fulfill({ json: { active: true, kind: 'airplay', name: 'WavWiz', sender: "Dana's iPhone", title: 'AirPlay song ' + song, artist: 'Phone artist ' + (song % 3), zones: gid != null ? [gid] : [] } }));
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2500); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(e => e.close()));
  return { c, p };
}
// scroll every scroller inside sel to the middle (padding a short one so it can scroll), return their positions
const arm = (p, sel) => p.evaluate(sel => { const out = [];
  for (const root of document.querySelectorAll(sel)) for (const e of [root, ...root.querySelectorAll('*')]) {
    if (!e.offsetParent && e !== document.querySelector('.desk')) continue; if (!/auto|scroll/.test(getComputedStyle(e).overflowY) || e.clientHeight < 120) continue;
    if (e.scrollHeight < e.clientHeight + 60 && !e.closest('.devpanel')) { const x = document.createElement('div'); x.className = 'pad82'; x.style.height = '900px'; e.append(x); }
    if (e.scrollHeight <= e.clientHeight + 50) continue; e.scrollTop = Math.round((e.scrollHeight - e.clientHeight) / 2); e.dataset.f82 = out.length; out.push(e.scrollTop); }
  return out; }, sel);
const read = (p) => p.evaluate(() => { const r = []; document.querySelectorAll('[data-f82]').forEach(e => r[+e.dataset.f82] = e.isConnected ? e.scrollTop : -1); return r; });
const lost = (p, sel) => p.evaluate(sel => [...document.querySelectorAll(sel + ' [data-f82]')].length, sel);
async function hold(name, p, sel, ms = 20000) {
  const a = await arm(p, sel); if (!a.length) { t(false, `${name}: no scroller found in ${sel}`); return; }
  const ticks = await p.evaluate(() => (window.__f82 = 0, 0)); void ticks;
  await p.waitForTimeout(ms);
  // a rebuilt scroller is a new node: compare by the same class in the same panel
  const b = await p.evaluate(sel => [...document.querySelectorAll(sel)].flatMap(root => [root, ...root.querySelectorAll('*')]).filter(e => e.dataset.f82 != null).reduce((o, e) => { const i = +e.dataset.f82; o[i] = Math.max(o[i] ?? 0, e.scrollTop); return o; }, []), sel);
  const now = await p.evaluate(sel => [...document.querySelectorAll(sel)].flatMap(root => [root, ...root.querySelectorAll('*')]).filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 50 && e.clientHeight >= 120).map(e => e.scrollTop), sel);
  t(a.every((v, i) => Math.abs((b[i] ?? -99) - v) <= 40) || (b.length < a.length && a.every(v => now.some(x => Math.abs(x - v) <= 40))), `${name}: scroll kept (no jump; ±40 px for a flapping card above) (${a.join(',')} -> ${b.join(',')})`);
}
{ // AirPlay events alone (no speaker change) patch the tree in place: the same tree node for 15 s, its song line updated
  const { c, p } = await open('classic', false, false); await p.waitForTimeout(1500);
  await p.evaluate(() => { window.__t = document.querySelector('.devpanel .tree42'); });
  const s0 = await p.evaluate(() => document.querySelector('.devpanel .zl-now')?.textContent); await p.waitForTimeout(15000);
  const r = await p.evaluate(() => ({ same: document.querySelector('.devpanel .tree42') === window.__t, now: document.querySelector('.devpanel .zl-now')?.textContent, cast: !!document.querySelector('.devpanel .cast42'), tag: !!document.querySelector('.devpanel .zcast') }));
  t(r.same, 'AirPlay session events: zone tree not rebuilt (updated in place)'); t(r.now !== s0 && /AirPlay song/.test(r.now || ''), `now-playing line patched (${s0} -> ${r.now})`); t(r.cast && r.tag, 'cast bar and AIRPLAY tag shown');
  await c.close(); }
for (const lay of (process.env.F82L || 'classic,roomy,full').split(',')) {
  const { c, p } = await open(lay);
  if (lay === 'roomy') { await p.click('.desk.devcollapsed .devpanel .prail').catch(() => {}); await p.waitForTimeout(800); }
  await p.evaluate(() => document.querySelector('.devpanel .tree42 .sp42-n, .devpanel .tree42 button')?.focus({ preventScroll: true }));
  await hold(`${lay} Devices panel`, p, '.devpanel');
  t(await p.evaluate(() => !!document.activeElement?.closest('.devpanel')), `${lay}: focus stays in Devices`);
  if (lay === 'full') {
    await p.click('.devpanel .devexp'); await p.waitForTimeout(1500); await hold('expanded Devices (all columns)', p, '.devpanel');
    await p.click('.devpanel .devexp'); await p.waitForTimeout(1200); await hold('Library panel', p, '.libpanel', 12000);
  }
  await c.close();
}
{ const { c, p } = await open('full', true);
  for (const pg of ['Devices & Zones', 'Library']) { await p.click('.hamburger'); await p.waitForTimeout(400); await p.click(`.drawer.open nav >> text=${pg}`); await p.waitForTimeout(1500);
    await p.evaluate(() => document.querySelectorAll('[data-f82]').forEach(e => delete e.dataset.f82)); await hold(`phone ${pg}`, p, '.desk', pg === 'Library' ? 10000 : 20000); }
  await c.close(); }
await br.close(); console.log(`f82keepscroll: ${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);

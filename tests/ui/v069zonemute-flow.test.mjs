// 0.6.9 t1894 + t1897 - the REAL flow against a running WavWiz server (not a fixture DOM), pointer kept on the zone card as a user's is:
//   zone mute -> every speaker's indicator shows; zone unmute -> they clear; each speaker's own toggle; zone mute again; zone unmute again (a speaker
//   muted on its own stays muted, like the master mute); master mute / unmute regression; t1897: the zone ON/OFF pill greys its speakers out
//   (and back) within 1 s with the pointer still on it (it used to wait until the pointer left). Before the fix the speaker indicators did not appear
//   (or kept a stale state) while the pointer / focus stayed on the zone card.
// Needs: a server with a zone card that has at least two speakers (admin session); mute states are put back at the end.
//   WW_URL=http://127.0.0.1:47960 WW_SESSION=<wavwiz_session cookie> node tests/ui/v069zonemute-flow.test.mjs   (playwright on NODE_PATH)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const B = process.env.WW_URL || 'http://127.0.0.1:47960', SESS = process.env.WW_SESSION;
if (!SESS) { console.log('SKIP: set WW_SESSION (and WW_URL)'); process.exit(0); }
let fail = 0; const ok = (n, c, x = '') => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const api = (p, m = 'GET', body) => fetch(B + '/api/v1' + p, { method: m, headers: { cookie: 'wavwiz_session=' + SESS, origin: B, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(r => r.ok ? r.json().catch(() => ({})) : Promise.reject(new Error(p + ' ' + r.status)));
const zones0 = await api('/zones'), saved = zones0.map(z => [z.id, z.muted, z.enabled]);
const br = await chromium.launch({ headless: true });
const ctx = await br.newContext({ viewport: { width: 1600, height: 1800 } });
await ctx.addCookies([{ name: 'wavwiz_session', value: SESS, url: B }]);
await ctx.addInitScript(() => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.checklist.dismissed', '1');
  localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null })); localStorage.setItem('wavwiz.layout', 'full'); localStorage.setItem('wavwiz.zfold', '[]'); });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
try {
  for (const z of zones0) if (z.muted) await api(`/zones/${z.id}`, 'PATCH', { muted: false });
  await p.goto(B + '/'); await p.waitForSelector('.tree42 section.qb42'); await p.waitForTimeout(1500);
  const lead = await p.evaluate(() => [...document.querySelectorAll('.tree42 section.qb42')].find(s => s.querySelectorAll('.sp42-mute').length >= 2)?.dataset.leaderId);
  if (!lead) { console.log('SKIP: needs a zone card with two speakers'); process.exit(0); }
  const BOX = `.tree42 section.qb42[data-leader-id="${lead}"]`;
  const ids = await p.evaluate(B => [...document.querySelectorAll(B + ' [data-device-id]')].filter(r => r.querySelector('.sp42-mute')).map(r => +r.dataset.deviceId), BOX);
  const [a, b] = ids;
  const ui = () => p.evaluate(B => { const s = document.querySelector(B); return s ? { zone: s.querySelector('.zmute')?.classList.contains('on'), sp: Object.fromEntries([...s.querySelectorAll('[data-device-id]')].filter(r => r.querySelector('.sp42-mute')).map(r => [r.dataset.deviceId, r.querySelector('.sp42-mute').classList.contains('on')])) } : null; }, BOX);
  const srv = async () => Object.fromEntries((await api('/zones')).filter(z => ids.includes(z.id)).map(z => [z.id, z.muted]));
  const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await p.waitForTimeout(100); } return false; };
  const want = async (name, zone, m) => { const good = async () => { const u = await ui(), s = await srv(); return u && u.zone === zone && ids.every(i => u.sp[i] === m(i) && s[i] === m(i)); };
    ok(name, await until(good), JSON.stringify({ ui: await ui(), server: await srv() })); };
  const zm = () => p.locator(`${BOX} .zmute`).click(), sm = id => p.locator(`${BOX} [data-device-id="${id}"] .sp42-mute`).click();   // the pointer stays where it clicked
  await zm(); await want('zone mute: every speaker indicator shows, pointer still on the card', true, () => true);
  await p.waitForTimeout(600); await want('...and stays (no flip back)', true, () => true);
  await zm(); await want('zone unmute: every indicator clears', false, () => false);
  await sm(a); await want('speaker A on its own', false, i => i === a);
  await sm(b); await want('speaker B on its own: all muted -> the zone shows muted', true, i => i === a || i === b);
  await sm(a); await want('speaker A unmuted on its own (mixed: zone shows not muted)', false, i => i === b);
  ok('mixed zone button says some are muted', /some speakers are muted/.test(await p.locator(`${BOX} .zmute`).getAttribute('title') || ''));
  await zm(); await want('zone mute again: mutes the rest', true, () => true);
  await zm(); await want('zone unmute again: B (muted on its own before) stays muted', false, i => i === b);
  await sm(b); await want('B unmuted on its own', false, () => false);
  // t1897: zone OFF / ON, pointer kept on the pill; time from click to every speaker row greyed out (and back)
  const W = await p.evaluate(([B, a]) => document.querySelector(`${B} [data-device-id="${a}"]`)?.closest('.zwrap42')?.dataset.zone, [BOX, a]);
  const ZW = `.tree42 .zwrap42[data-zone="${W}"]`;
  const offIds = await p.evaluate(Z => [...document.querySelectorAll(Z + ' .sp42[data-device-id]')].map(r => +r.dataset.deviceId), ZW);
  const rows = v => p.evaluate(([Z, v]) => { const r = [...document.querySelectorAll(Z + ' .sp42')]; return r.length > 0 && r.every(x => x.classList.contains('off') === v); }, [ZW, v]);
  for (const v of [true, false]) {
    const t0 = Date.now(); await p.locator(`${ZW} .zcard42 .onpill`).click();
    const seen = await until(() => rows(v), 1000), ms = Date.now() - t0;
    ok(`zone ${v ? 'OFF: its speakers grey out' : 'ON: they are back'} within 1 s, pointer still on the pill (${ms} ms)`, seen, JSON.stringify(await p.evaluate(Z => [...document.querySelectorAll(Z + ' .sp42')].map(x => x.className), ZW)));
    ok(`...and the server agrees (${v ? 'off' : 'on'})`, await until(async () => (await api('/zones')).filter(z => offIds.includes(z.id)).every(z => z.enabled === !v)));
  }
  await p.mouse.move(800, 1790);
  await p.locator('.mastermute').first().click(); await want('master mute (regression)', true, () => true);
  await p.locator('.mastermute').first().click(); await want('master unmute (regression)', false, () => false);
  ok('no page errors', !errs.length, errs.join(' | '));
} finally {
  for (const [id, m, e] of saved) await api(`/zones/${id}`, 'PATCH', { muted: m, enabled: e }).catch(() => {});
  await br.close();
}
console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0);

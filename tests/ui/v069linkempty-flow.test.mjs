// 0.6.9 #31 (t1888 / t1889) - the REAL event flow against a running WavWiz server (not a fixture DOM):
//   a real pointer drag of the empty zone Rooftop (its grip) onto the middle of the empty zone Upstairs -> POST /groups/{id}/link -> server "zones" ->
//   the Devices tree must show ONE 'Rooftop + Upstairs' card while the pointer is STILL on it; then a real click on that card's Split off must show two
//   separate cards again, pointer still there. Before the fix both stayed stale until the pointer left the tree / a speaker moved / the card was folded.
// Needs: a server with two empty, unlinked zones named Upstairs and Rooftop (admin session).
//   WW_URL=http://127.0.0.1:47960 WW_SESSION=<wavwiz_session cookie> node tests/ui/v069linkempty-flow.test.mjs   (playwright on NODE_PATH)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const B = process.env.WW_URL || 'http://127.0.0.1:47960', SESS = process.env.WW_SESSION;
if (!SESS) { console.log('SKIP: set WW_SESSION (and WW_URL)'); process.exit(0); }
let fail = 0; const ok = (n, c, x = '') => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const api = (p, m = 'GET', body) => fetch(B + '/api/v1' + p, { method: m, headers: { cookie: 'wavwiz_session=' + SESS, origin: B, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(r => r.ok ? r.json().catch(() => ({})) : Promise.reject(new Error(p + ' ' + r.status)));
const gs = await api('/groups'), up = gs.find(g => g.name === 'Upstairs'), rt = gs.find(g => g.name === 'Rooftop');
if (!up || !rt || up.deviceIds.length || rt.deviceIds.length) { console.log('SKIP: needs empty zones Upstairs and Rooftop'); process.exit(0); }
if (rt.playbackId === up.playbackId) await api(`/groups/${rt.id}/split`, 'POST');

const br = await chromium.launch({ headless: true });
const ctx = await br.newContext({ viewport: { width: 1600, height: 1800 } });
await ctx.addCookies([{ name: 'wavwiz_session', value: SESS, url: B }]);
await ctx.addInitScript(() => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.checklist.dismissed', '1');
  localStorage.setItem('wavwiz.panels', JSON.stringify({ lib: 'normal', dev: 'normal', exp: null })); localStorage.setItem('wavwiz.layout', 'full'); localStorage.setItem('wavwiz.zfold', '[]'); });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
await p.goto(B + '/'); await p.waitForSelector(`.tree42 > [data-card="g:${rt.id}"]`); await p.waitForTimeout(1500);
const card = id => `.tree42 > [data-card="g:${id}"]`;
const names = () => p.evaluate(() => [...document.querySelectorAll('.tree42 > [data-card] .zwrap42[data-zone]')].map(e => e.closest('[data-card]').dataset.card + '=' + e.dataset.zone));
const until = async (fn, ms = 2500) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await p.waitForTimeout(100); } return false; };
const linkedCard = () => p.evaluate(([a, b]) => [...document.querySelectorAll('.tree42 > section.zlink42')].some(s => { const z = [...s.querySelectorAll('.zlink42-m')].map(e => e.dataset.zone).sort().join(); return z === [a, b].sort().join(); }), ['Upstairs', 'Rooftop']);

// 1) the drag (grip -> middle of Upstairs's row, measured after the drag starts: empty zones show their 'Drop speakers here' note while dragging)
const g = await p.locator(`${card(rt.id)} .cgrip69`).boundingBox();
await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await p.mouse.down(); await p.mouse.move(g.x + 30, g.y + 30, { steps: 4 }); await p.waitForTimeout(150);
const t = await p.locator(`${card(up.id)} .zwrap42`).boundingBox(), tx = t.x + t.width / 2, ty = t.y + t.height / 2;
await p.mouse.move(tx, ty, { steps: 12 }); await p.waitForTimeout(200);
ok('the drop target says link', await p.evaluate(() => !!document.querySelector('.droplink42')));
await p.mouse.up();   // the pointer stays on the card, as a user's does
ok('linked on the server', await until(async () => { const x = await api('/groups'); return x.find(g => g.id === rt.id).playbackId === x.find(g => g.id === up.id).playbackId; }));
ok('ONE Rooftop + Upstairs card while the pointer is still on it', await until(linkedCard), JSON.stringify(await names()));
ok('the card title names both', await p.evaluate(() => [...document.querySelectorAll('.tree42 > section.zlink42')].some(s => /Rooftop \+ Upstairs|Upstairs \+ Rooftop/.test(s.textContent))));

// 2) Split off (real click), the pointer stays on the card
const clicked = await p.locator('.tree42 .zlink42-m[data-zone="Rooftop"] [data-act="split"]').click({ timeout: 3000 }).then(() => true, () => false);
ok('Split off is on the card', clicked); if (!clicked) await api(`/groups/${rt.id}/split`, 'POST').catch(() => {});
ok('split on the server', await until(async () => { const x = await api('/groups'); return x.find(g => g.id === rt.id).playbackId !== x.find(g => g.id === up.id).playbackId; }));
ok('two separate cards again while the pointer is still on it', await until(async () => !(await linkedCard()) && (await p.locator(card(rt.id) + ':not(.zlink42)').count()) === 1 && (await p.locator(card(up.id)).count()) === 1), JSON.stringify(await names()));
ok('no page errors', !errs.length, errs.join(' | '));
await br.close();
console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0);

// 0.4.9 F68: phone Now Playing is a full-screen remote. No vertical scroll at 390x844 and 375x667, play >= 72px,
// zone volume slider >= 85% of the viewport width, for EVERY Now Playing theme (pn-<style>); phone Settings shows the theme picker; desktop unchanged. The track is mocked in THIS TEST ONLY (route on
// /api/v1/stream and /api/v1/groups) because the test speakers are offline.  SH=1 TAG=after -> /workspace/screens/049-remote/
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = process.env.BASE || 'http://172.30.0.2:47800', sess = readFileSync(process.env.SESS || '/tmp/ww032/sess', 'utf8').trim(), TAG = process.env.TAG || 'after';
let pass = 0, fail = 0; const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${c ? '' : '  ' + d}`); };
const art = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d3b6e"/><stop offset=".55" stop-color="#3b8f8a"/><stop offset="1" stop-color="#f0a85a"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/><circle cx="420" cy="170" r="70" fill="#fff3"/><path d="M0 470 L160 330 L300 430 L430 300 L600 450 L600 600 L0 600Z" fill="#0b1a2e"/></svg>');
const item = { id: 1, kind: 'track', title: 'Online', artist: 'Northern Lights', album: 'Aurora', durationMs: 214000, refId: 10, genre: 'Rock', artUrl: art, trackNo: 1 };
const br = await chromium.launch();
async function open(vp, mobile, style = 'classic') {
  const c = await br.newContext({ viewport: vp, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
  await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(st => { for (const [k, v] of [['wavwiz.whatsnew', '9.9.9'], ['wavwiz.gettingStarted.shown', '1'], ['wavwiz.webRoom.autojoin', '0'], ['wavwiz.a2hs.dismissed', '1']]) localStorage.setItem(k, v); if (!sessionStorage.getItem('f68')) { sessionStorage.setItem('f68', '1'); localStorage.setItem('wavwiz.npstyle.v1', JSON.stringify({ style: st })); } }, style);
  await c.route(/\/api\/v1\/stream(\?|$)/, async r => { try { const res = await r.fetch(), j = await res.json(); j.now = { ...j.now, state: 'playing', positionMs: 83000, durationMs: 214000, notice: null, item }; await r.fulfill({ response: res, json: j }); } catch { /* context closed */ } });
  await c.route(/\/api\/v1\/groups(\?|$)/, async r => { try { const res = await r.fetch(), j = await res.json(); for (const g of j) g.now = { state: 'playing', title: item.title, artist: item.artist, album: item.album, kind: 'track', refId: 10, artUrl: art, positionMs: 83000, durationMs: 214000, live: false }; await r.fulfill({ response: res, json: j }); } catch { /* context closed */ } });
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(3000);
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close())); await p.waitForTimeout(400); return [c, p];
}
const STYLES = ['classic', 'center', 'stack', 'horizon'];   // npstyle.js NP_STYLES
const remote = p => p.evaluate(() => { const d = document.querySelector('.desk'), r = s => document.querySelector(s)?.getBoundingClientRect(), vis = s => !!document.querySelector(s)?.getClientRects().length;
  const play = r('.nowcol .np-tablexport .tbtn.play'), vol = r('.nowcol .np-zvol'), art = r('.nowcol .pn-art'), panel = document.querySelector('.nowcol .np-ctlpanel');
  return { scroll: Math.max(d.scrollHeight - d.clientHeight, document.documentElement.scrollHeight - innerHeight), play: play && Math.min(play.width, play.height), vol: vol?.width, art: art?.width, cls: panel.className, hscroll: document.documentElement.scrollWidth - innerWidth, over: [...document.querySelectorAll('.nowcol *')].filter(e => { const b = e.getBoundingClientRect(); return b.width && (b.right > innerWidth + 1 || b.left < -1); }).map(e => e.className?.baseVal ?? e.className).slice(0, 5), dbg: ['.pn-art','.pn-disc'].map(s => { const b = document.querySelector('.nowcol '+s).getBoundingClientRect(); return s + ' ' + (b.left|0) + '-' + (b.right|0); }),
    title: document.querySelector('.nowcol .np-tabletitles>.t1')?.textContent, album: document.querySelector('.nowcol .np-album')?.textContent, pill: vis('.nowcol .zl-ov'), row: vis('.nowcol .vbtns .ov-full'), up: vis('.nowcol>.np-upnext'), collapsed: panel.classList.contains('collapsed') }; });
const sizes = [[390, 844, STYLES], [375, 667, ['classic']]];
for (const [w, hh, styles] of sizes) for (const st of styles) {
  const [c, p] = await open({ width: w, height: hh }, true, st);
  const m = await remote(p), k = `${w}x${hh} ${st}`;
  ok(`${k}: theme class pn-${st} applied`, m.cls.includes('pn-' + st), m.cls);
  ok(`${k}: nothing overflows the viewport horizontally`, m.hscroll <= 0 && !m.over.length, JSON.stringify({ h: m.hscroll, over: m.over, d: m.dbg }));
  ok(`${k}: no vertical scroll`, m.scroll <= 1, JSON.stringify(m));
  ok(`${k}: play button >= 72px`, m.play >= 72, String(m.play));
  ok(`${k}: zone volume slider >= 85% of the width`, m.vol >= 0.85 * w, `${m.vol} of ${w}`);
  ok(`${k}: remote view (expanded, zone pill, button row, big art, title + album, Up next)`, !m.collapsed && m.pill && m.row && m.art >= 100 && m.title === 'Online' && m.album === 'Aurora' && m.up, JSON.stringify(m));
  if (process.env.SH) await p.screenshot({ path: `/workspace/screens/049-remote/themes/phone-${TAG}-${st}-${w}x${hh}.png` });
  await c.close();
}
// phone Settings shows the Now Playing theme picker (one card per row) and picking one restyles the remote live
{ const [c, p] = await open({ width: 390, height: 844 }, true, 'classic');
  await p.click('.hamburger'); await p.waitForTimeout(500); await p.click('.drawer.open nav >> text=Settings'); await p.waitForTimeout(1200);
  await p.evaluate(() => { const t = [...document.querySelectorAll('button,a,[role=tab]')].find(b => b.getClientRects().length && b.textContent.trim() === 'Appearance'); t?.click(); }); await p.waitForTimeout(1000);
  await p.evaluate(() => { const t = [...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.trim() === 'Now Playing'); t?.scrollIntoView({ inline: 'center' }); t?.click(); }); await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('#sec-npstyle')?.scrollIntoView({ block: 'start' })); await p.waitForTimeout(800);
  const s = await p.evaluate(() => { const cards = [...document.querySelectorAll('#sec-npstyle [data-npstyle]')].filter(e => e.getClientRects().length), r = cards.map(e => e.getBoundingClientRect());
    return { n: cards.length, ids: cards.map(e => e.dataset.npstyle), oneRow: r.every((x, i) => !i || x.top >= r[i - 1].bottom - 1), fits: r.every(x => x.left >= 0 && x.right <= innerWidth + 1) }; });
  ok('phone Settings shows the Now Playing theme picker, one card per row', s.n === STYLES.length && s.oneRow && s.fits, JSON.stringify(s));
  if (process.env.SH) await p.screenshot({ path: `/workspace/screens/049-remote/themes/phone-${TAG}-settings-nowplaying.png` });
  await p.click('#sec-npstyle [data-npstyle="stack"]'); await p.waitForTimeout(500);
  const cls = await p.evaluate(() => document.querySelector('.nowcol .np-ctlpanel').className);
  ok('picking a theme in phone Settings restyles the remote live', cls.includes('pn-stack') && !cls.includes('pn-classic'), cls);
  await c.close(); }
// the remote also follows the color theme (Settings > Appearance > Theme): pick Daylight and the remote repaints
{ const [c, p] = await open({ width: 390, height: 844 }, true, 'classic');
  const bg = () => p.evaluate(() => getComputedStyle(document.querySelector('.nowcol .np-tablexport .tbtn.play')).backgroundColor + ' / ' + getComputedStyle(document.body).backgroundColor);
  const before = await bg();
  await p.click('.hamburger'); await p.waitForTimeout(500); await p.click('.drawer.open nav >> text=Settings'); await p.waitForTimeout(1200);
  await p.evaluate(() => { const t = [...document.querySelectorAll('button,a,[role=tab]')].find(b => b.getClientRects().length && b.textContent.trim() === 'Appearance'); t?.click(); }); await p.waitForTimeout(900);
  await p.getByText('Daylight', { exact: true }).first().click(); await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close())); await p.waitForTimeout(800);
  const after = await bg();
  ok('the remote follows the color theme (Daylight repaints it)', before !== after, before + ' -> ' + after);
  if (process.env.SH) await p.screenshot({ path: `/workspace/screens/049-remote/themes/phone-${TAG}-classic-daylight-390x844.png` });
  await c.close(); }
{ const [c, p] = await open({ width: 1440, height: 900 }, false);
  const d = await p.evaluate(() => ({ eq: !!document.querySelector('.np-eqview, .np-eqhost'), head: !!document.querySelector('.np-ctlpanel>.pane-h')?.getClientRects().length, phvol: !!document.querySelector('.np-phvol')?.getClientRects().length, album: !!document.querySelector('.np-album')?.getClientRects().length, grid: getComputedStyle(document.querySelector('.np-tablemain')).gridTemplateAreas }));
  ok('desktop Now Playing unchanged (header, EQ, no phone volume / album line / remote grid)', d.eq && d.head && !d.phvol && !d.album && !/sh pr pl/.test(d.grid), JSON.stringify(d));
  if (process.env.SH) await p.screenshot({ path: `/workspace/screens/049-remote/themes/desktop-${TAG}.png` });
  await c.close(); }
await br.close(); console.log(`f68phoneremote: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

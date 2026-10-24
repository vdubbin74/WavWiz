// 0.4.9 F67: phone PWA - the hamburger menu is exactly 7 plain items (Now Playing, Queue, Volume Mixer, Library, Devices & Zones, Scenes & Alarms, Settings),
// no File / Playback / Mini player / shortcut labels / submenus; phone Now Playing has no EQ ("Adjusting") panel and no visualizer; the desktop
// menu bar is unchanged. SH=1 TAG=before|after for screenshots.
import { chromium } from 'playwright'; import { readFileSync, mkdirSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), SH = !!process.env.SH, TAG = process.env.TAG || 'after', OUT = '/workspace/screens/049-phonemenu'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
if (SH) mkdirSync(OUT, { recursive: true });
const WANT = ['Now Playing', 'Queue', 'Volume Mixer', 'Library', 'Devices & Zones', 'Scenes & Alarms', 'Settings'];
const br = await chromium.launch();
const open = async (vw, vh, dpr, mob) => { const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, isMobile: mob, hasTouch: mob }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); localStorage.setItem('wavwiz.a2hs.dismissed', '1'); });
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2500); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close())); return [c, p]; };
{ const [c, p] = await open(390, 844, 3, true);
  const vis = sel => p.evaluate(s => [...document.querySelectorAll(s)].filter(e => e.offsetParent && e.getBoundingClientRect().height > 0).length, sel);
  if (SH) await p.screenshot({ path: `${OUT}/phone-${TAG}-nowplaying.png` });
  const eq = await vis('.np-eqview, .eqview, .eqband, .eqgraph'), viz = await vis('canvas.viz, .viz, .vizhost, .stage canvas');
  ok('phone Now Playing: no EQ / Adjusting panel', eq === 0, String(eq)); ok('phone Now Playing: no visualizer', viz === 0, String(viz));
  ok('phone Now Playing: the Now Playing card, its controls and Up next stay', await vis('.np-ctlpanel .np-strip, .np-ctlpanel .transport, .np-ctlpanel .transport .tbtn.play') > 0 && await vis('.np-upnext') > 0);
  ok('phone Now Playing: card starts expanded; button row is borderless with no frame', await p.evaluate(() => { const c = document.querySelector('.np-ctlpanel'), v = document.querySelector('.np-vizpanel'), b = document.querySelector('.np-vizpanel .vbtns'); return !c.classList.contains('collapsed') && getComputedStyle(v).borderTopWidth === '0px' && getComputedStyle(b).borderTopWidth === '0px' && v.offsetHeight < 60; }));
  await p.click('.hamburger'); await p.waitForTimeout(500);
  const items = await p.evaluate(() => [...document.querySelectorAll('.drawer.open nav > button:not(.drawer-close):not(.a2hs-entry), .drawer.open nav > .macc > button')].filter(e => e.offsetParent).map(e => e.textContent.trim()));
  ok(`phone menu: exactly 7 items in order (${items.join(' | ')})`, JSON.stringify(items) === JSON.stringify(WANT), JSON.stringify(items));
  const bad = await p.evaluate(() => { const n = document.querySelector('.drawer.open nav'); return n ? { sub: n.querySelectorAll('.macc, .msub, .mpanel').length, kbd: n.querySelectorAll('.kbd').length, txt: /\b(File|Playback|Mini player|Alt\+M)\b/.test(n.textContent) } : null; });
  ok('phone menu: no submenus, no shortcut labels, no File / Playback / Mini player', bad && !bad.sub && !bad.kbd && !bad.txt, JSON.stringify(bad));
  if (SH) await p.screenshot({ path: `${OUT}/phone-${TAG}-menu.png` });
  if (items.includes('Queue')) { await p.click('.drawer.open nav >> text=Queue'); await p.waitForTimeout(900);
    const q = await p.evaluate(() => { const v = [...document.querySelectorAll('body *')].filter(e => e.getClientRects().length && e.getBoundingClientRect().top < 200); return { lbl: v.some(e => e.childElementCount === 0 && /^Queue:?$/.test(e.textContent.trim())), pick: v.some(e => e.matches('select, .zsel')), drawer: !!document.querySelector('.drawer.open') }; });
    ok('Queue opens the queue editor (Queue: + picker)', q.lbl && q.pick && !q.drawer, JSON.stringify(q));
    if (SH) await p.screenshot({ path: `${OUT}/phone-${TAG}-queue.png` });
    await p.keyboard.press('Escape'); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close())); await p.waitForTimeout(400); await p.click('.hamburger'); await p.waitForTimeout(500); }
  if (items.includes('Volume Mixer')) { await p.click('.drawer.open nav >> text=Volume Mixer'); await p.waitForTimeout(900); ok('Volume Mixer opens the Master volume mixer', await p.evaluate(() => !!document.querySelector('dialog.mixer-dlg[open]')));
    if (SH) await p.screenshot({ path: `${OUT}/phone-${TAG}-mixer.png` }); }
  await c.close(); }
{ const [c, p] = await open(1920, 1080, 1, false);
  const top = await p.evaluate(() => [...document.querySelectorAll('.menubar > * > button, .menubar > button')].filter(e => e.offsetParent).map(e => e.textContent.trim()));
  ok(`desktop menu bar unchanged (${top.join(' | ')})`, JSON.stringify(top) === JSON.stringify(['File', 'Library', 'Playback', 'Devices', 'Help']), JSON.stringify(top));
  ok('desktop Now Playing still has the EQ / Sound panel', await p.evaluate(() => !!document.querySelector('.np-eqview')?.offsetParent));
  await c.close(); }
await br.close(); console.log(`f67phonemenu: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

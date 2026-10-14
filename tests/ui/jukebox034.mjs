// WavWiz 0.3.4: Jukebox end to end in BOTH styles (Modern, Retro CD) the way a guest uses it:
// start (host dialog) -> big screen in a plain browser -> phone guest page: type a multi-word search with real keystrokes, focus kept the whole time
// -> add a single song AND a song from an album result -> both on the big screen -> stop. Screenshots for every view.
import { chromium, webkit, devices } from 'playwright';
import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync(process.env.WW_SESS || '/tmp/ww032/sess', 'utf8').trim();
const api = async (p, m = 'GET', b) => { const r = await fetch(B + '/api/v1' + p, { method: m, headers: { Cookie: 'unison_session=' + sess, Origin: B, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const R = []; const ok = (n, c, i = '') => { R.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? ' :: ' + i : '')); };
const shot = (p, n) => p.screenshot({ path: `/workspace/screens/wavwiz-034-${n}.png` });
const STYLES = (process.argv[2] || 'modern,retro').split(',');
// WW_GUEST=webkit runs the phone guest page in real WebKit (iPhone Safari engine)
const GB = process.env.WW_GUEST === 'webkit' ? await webkit.launch() : null;
const cb = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
// a speaker so the music actually plays
const spx = await cb.newContext({ viewport: { width: 800, height: 600 } }); await spx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
const sp = await spx.newPage(); await sp.goto(B + '/'); await sp.waitForTimeout(2500); await sp.mouse.click(400, 300); await sp.waitForTimeout(800);
for (const style of STYLES) {
  const tag = style === 'retro' ? 'retro' : 'modern';
  await api('/jukebox/stop', 'POST', { pin: '2468' }).catch(() => {});
  await api('/queue/clear', 'POST', {});
  const lib = await api('/library/tracks?limit=50'); await api('/queue/add', 'POST', { kind: 'tracks', ids: lib.slice(0, 2).map(t => t.id) }); await api('/stream/jump', 'POST', { index: 0 });
  ok(`[${tag}] style saved`, (await api('/jukebox/config', 'PUT', { style, perGuest: 3 })).style === style);
  const ctx = await cb.newContext({ viewport: { width: 1920, height: 1080 } }); await ctx.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(B + '/'); await p.waitForTimeout(3000); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await p.evaluate(async () => (await import('/js/main.js')).go('jukebox')); await p.waitForTimeout(1200);
  const dlg = p.locator('dialog[open][aria-label="Start Jukebox"]');
  ok(`[${tag}] Start dialog names the style`, (await dlg.innerText()).includes(style === 'retro' ? 'Retro CD style' : 'Modern style'));
  await dlg.locator('input[type=password]').fill('2468'); await dlg.locator('input[type=checkbox]').uncheck();
  await dlg.locator('footer button', { hasText: 'Start Jukebox' }).click(); await p.waitForTimeout(1500);
  let st = await api('/jukebox'); ok(`[${tag}] Jukebox running with style ${style}`, st.running === true && st.style === style, JSON.stringify(st));
  // big screen in a plain browser
  const ctx2 = await cb.newContext({ viewport: { width: 1920, height: 1080 } }); await ctx2.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await ctx2.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); });
  const big = await ctx2.newPage(); const berrs = []; big.on('pageerror', e => berrs.push(e.message));
  await big.goto(B + '/'); await big.waitForTimeout(3500); await big.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); document.querySelectorAll('.phone-unlock').forEach(e => e.remove()); });
  await big.locator('#jbchip').click(); await big.waitForTimeout(1000); await big.locator('.jbpanel button', { hasText: 'Open big screen' })   /* 0.3.5 J9 #13: host controls are a dropdown */.click(); await big.waitForTimeout(3000);
  const look = await big.evaluate(() => { const j = document.querySelector('.jb'); const vis = s => { const e = j.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; };
    return { retro: j.classList.contains('retro'), modern: j.classList.contains('modern'), svg: vis('.jbr-svg'), disc: vis('.jbr-disc'), rack: j.querySelectorAll('.jbr-col.a .jbr-strip').length, more: j.querySelectorAll('.jbr-col.b .jbr-strip').length, select: vis('.jbr-select'), cover: vis('.jbm .jb-cover'), logoPos: getComputedStyle(j.querySelector('.jb-logo')).position, chipsPos: getComputedStyle(j.querySelector('.jb-chips')).position,
      font: getComputedStyle(j.querySelector('.jbr-title')).fontFamily, fontsOk: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family) }; });
  if (style === 'retro') ok('[retro] big screen shows the Retro CD cabinet (svg, disc, A1-A5 + B1-B5 strips, SELECT), not Modern', look.retro && !look.modern && look.svg && look.disc && look.rack === 5 && look.more === 5 && look.select && !look.cover, JSON.stringify(look));
  else ok('[modern] big screen shows Modern (cover, up next, QR), no cabinet; logo + chips stay absolutely positioned', look.modern && !look.retro && look.cover && !look.svg && look.logoPos === 'absolute' && look.chipsPos === 'absolute', JSON.stringify(look));
  await shot(big, `jb-${tag}-bigscreen-before`);
  // phone guest page (iPhone emulation)
  const gctx = await (GB || cb).newContext({ ...devices['iPhone 13'] }); const g = await gctx.newPage(); const gerrs = []; g.on('pageerror', e => gerrs.push(e.message));
  await g.goto(B + '/jukebox.html?j=' + encodeURIComponent(st.code)); await g.waitForTimeout(2500);
  ok(`[${tag}] guest page uses the ${style} look`, (await g.evaluate(() => document.body.classList.contains('retro'))) === (style === 'retro'));
  await g.locator('input.jb-name').fill('Sam');
  const s = g.locator('input.jb-search'); await s.click();
  const words = 'atlas drift'; let lost = 0;
  for (const ch of words) { await g.keyboard.type(ch); await g.waitForTimeout(330); if (!(await g.evaluate(() => document.activeElement?.classList.contains('jb-search')))) lost++; }
  await g.waitForTimeout(5600);   // across a 5 s board refresh too
  const typed = await s.inputValue(), stillFocused = await g.evaluate(() => document.activeElement?.classList.contains('jb-search')), caret = await g.evaluate(() => document.activeElement?.selectionStart);
  ok(`[${tag}] guest types "${words}" with real keys, focus never lost (incl. a board refresh), caret at the end`, typed === words && lost === 0 && stillFocused && caret === words.length, JSON.stringify({ typed, lost, stillFocused, caret }));
  await shot(g, `jb-${tag}-guest-search`);
  const counts = await g.evaluate(() => [...document.querySelectorAll('.jb-gh')].map(e => e.textContent));
  ok(`[${tag}] grouped results (artists / albums / songs)`, counts.some(t => /^Albums/.test(t)) && counts.some(t => /^Songs/.test(t)), counts.join(', '));
  const albumLabel = await g.locator('.jb-link', { hasText: 'Album' }).first().innerText().catch(() => '');
  ok(`[${tag}] album result shows its name (no "undefined")`, albumLabel && !/undefined/.test(albumLabel), albumLabel.replace(/\n/g, ' | '));
  // add a single song from the results
  const firstSong = g.locator('.jb-res .jb-row:not(.jb-link)').first(); const songTitle = (await firstSong.locator('b').innerText()).trim();
  await firstSong.locator('button.jb-add').click(); await g.waitForTimeout(1500);
  const inBtn = await firstSong.locator('button.jb-add').evaluate(b => ({ t: b.textContent, cls: b.className, bg: getComputedStyle(b).backgroundColor, bc: getComputedStyle(b).borderColor }));
  ok(`[${tag}] single song added, its button shows "In" in the In style (not the primary fill)`, /in/i.test(inBtn.t) && inBtn.cls.includes('in') && (style === 'retro' ? inBtn.bg === 'rgb(20, 60, 58)' : inBtn.bg === 'rgba(0, 0, 0, 0)'), JSON.stringify(inBtn));
  // open the album result and add a song from it
  await g.locator('.jb-link', { hasText: 'Album' }).first().click(); await g.waitForTimeout(1200);
  const albumRows = g.locator('.jbg-body .jb-row:not(.jb-link)'); const nAlbum = await albumRows.count();
  let albumTitle = ''; for (let i = 0; i < nAlbum; i++) { const t = (await albumRows.nth(i).locator('b').innerText()).trim(); if (t.toUpperCase() !== songTitle.toUpperCase()) { albumTitle = t; await albumRows.nth(i).locator('button.jb-add').click(); break; } }
  await g.waitForTimeout(1500);
  ok(`[${tag}] album result opens its songs and one is added`, nAlbum > 0 && !!albumTitle, `${nAlbum} songs, added ${albumTitle}`);
  const mine = await g.locator('.jb-mine').innerText();
  ok(`[${tag}] footer counts my picks (J18: "N available plays", 2 picks of 3 -> 1 left)`, /^1 available play$/.test(mine.trim()), mine);
  const mf = await g.evaluate(() => { const m = document.querySelector('.jb-mine'); const r = m.getBoundingClientRect(); return { h: Math.round(r.height), sw: m.scrollWidth, cw: m.clientWidth, lh: parseFloat(getComputedStyle(m).lineHeight) || 20, right: Math.round(r.right), iw: innerWidth }; });
  ok(`[${tag}] footer pick count on one line and fully visible on the phone`, mf.sw <= mf.cw + 1 && mf.right <= mf.iw && mf.h < 2 * mf.lh + 20, JSON.stringify(mf));
  await shot(g, `jb-${tag}-guest-added`);
  const board = await api('/jukebox/board');
  ok(`[${tag}] both songs are in the Jukebox queue with the guest name`, [songTitle, albumTitle].every(t => (board.next || []).some(x => x.title.toUpperCase() === t.toUpperCase() && x.by === 'Sam')), JSON.stringify(board.next.map(x => [x.title, x.by])));
  await big.waitForTimeout(2500);
  const onBig = await big.evaluate(() => document.querySelector('.jb').innerText);
  ok(`[${tag}] both songs visible on the big screen`, onBig.toUpperCase().includes(songTitle.toUpperCase()) && onBig.toUpperCase().includes(albumTitle.toUpperCase()) && onBig.includes('Sam'), onBig.slice(0, 300).replace(/\n/g, ' | '));
  await shot(big, `jb-${tag}-bigscreen`);
  await big.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {}); await big.waitForTimeout(300);
  for (const [w, hgt] of [[1440, 900], [1280, 720]]) { await big.setViewportSize({ width: w, height: hgt }); await big.waitForTimeout(800); await shot(big, `jb-${tag}-bigscreen-${w}`); }
  // big-screen Search & add (SELECT on Retro)
  await big.setViewportSize({ width: 1920, height: 1080 }); await big.waitForTimeout(600);
  await big.locator(style === 'retro' ? '.jbr-select' : '.jb-big').click(); await big.waitForTimeout(600);
  await big.keyboard.type('song 1', { delay: 300 }); await big.waitForTimeout(1200);
  ok(`[${tag}] big-screen Search & add opens and searches`, await big.locator('.jb-search-pane .jb-row').count() > 0);
  await shot(big, `jb-${tag}-bigscreen-search`);
  await big.locator('.jb-search-pane button', { hasText: 'Close' }).click();
  // stop from the host controls
  await p.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); document.querySelectorAll('.phone-unlock').forEach(e => e.remove()); });
  await p.locator('#jbchip').click(); await p.waitForTimeout(1000); await p.locator('.jbpanel button', { hasText: 'Stop Jukebox' }).click(); await p.waitForTimeout(700);
  await p.locator('dialog[open] button', { hasText: /^Stop$/ }).last().click(); await p.waitForTimeout(2500);
  st = await api('/jukebox'); ok(`[${tag}] Stop: jukebox stopped and the big screen closed`, st.running === false && !(await big.evaluate(() => !!document.querySelector('.jb'))), JSON.stringify(st));
  ok(`[${tag}] no script errors (host, big screen, phone)`, !errs.length && !berrs.length && !gerrs.length, [...errs, ...berrs, ...gerrs].join(' | '));
  await ctx.close(); await ctx2.close(); await gctx.close();
}
await api('/jukebox/config', 'PUT', { style: 'modern' });
console.log(`Jukebox 0.3.4 e2e ${R.filter(x => x).length}/${R.length}`); await cb.close();

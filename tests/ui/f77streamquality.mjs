// 0.4.9 F77: Settings > Playback > Streaming quality. Studio (24-bit / 48 kHz) is the default, Studio Max (24-bit / 96 kHz) saves
// playback.streamRate=96000 (real PUT /settings, restored at the end), the bandwidth note sits under Studio Max, 3px corners and the accent on the pick.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(), OUT = '/workspace/screens/049-quality'; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const call = (m, u, b) => fetch(B + '/api/v1' + u, { method: m, headers: { 'content-type': 'application/json', origin: B, cookie: 'unison_session=' + sess }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json().catch(() => ({})));
const rate = async () => String((await call('GET', '/settings'))['playback.streamRate'] ?? '48000');
await call('PUT', '/settings', { 'playback.streamRate': '48000' });
const bad = await fetch(B + '/api/v1/settings', { method: 'PUT', headers: { 'content-type': 'application/json', origin: B, cookie: 'unison_session=' + sess }, body: JSON.stringify({ 'playback.streamRate': '192000' }) });
ok('the server refuses a rate other than 48000/96000', bad.status === 400, bad.status);
const br = await chromium.launch();
try {
  for (const [vw, vh, dpr, nm] of [[1920, 1080, 1, 'desktop-100'], [960, 540, 2, 'desktop-200'], [390, 844, 3, 'phone']]) { const tg = `[${nm}]`;
    const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, isMobile: vw < 700, hasTouch: vw < 700 }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
    await c.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); });
    const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2500); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
    await p.evaluate(async () => { const m = await import('/js/main.js'); m.go('settings:playback'); }); await p.waitForTimeout(1500);
    const card = p.locator('#sec-streamquality >> visible=true').first(); await card.scrollIntoViewIfNeeded().catch(() => {});
    ok(`${tg} Playback has a Streaming quality card`, await card.count() > 0);
    const txt = await card.innerText();
    ok(`${tg} both options in US English`, /Studio \(24-bit \/ 48 kHz\)/.test(txt) && /Studio Max \(24-bit \/ 96 kHz\)/.test(txt), txt);
    ok(`${tg} Studio is the default`, await card.locator('input[value="48000"]').isChecked() && await card.locator('.sq77-opt.on').getAttribute('data-rate') === '48000');
    ok(`${tg} the bandwidth note sits under Studio Max`, /Uses about twice the network bandwidth\. Best on wired or strong Wi-Fi\./.test(await card.locator('.sq77-opt[data-rate="96000"] .sq77-note').innerText()));
    const st = await card.locator('.sq77-opt').first().evaluate(e => getComputedStyle(e).borderTopLeftRadius); ok(`${tg} 3px corners`, st === '3px', st);
    if (nm !== 'phone') await card.screenshot({ path: `${OUT}/${nm}-studio.png` });
    await card.locator('.sq77-opt[data-rate="96000"]').click(); await p.waitForTimeout(900);
    ok(`${tg} picking Studio Max saves 96000`, (await rate()) === '96000', await rate());
    const acc = await p.evaluate(() => { const o = document.querySelector('#sec-streamquality .sq77-opt.on'), a = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); return { rate: o?.dataset.rate, border: getComputedStyle(o).borderTopColor, a }; });
    ok(`${tg} the picked option uses the theme accent`, acc.rate === '96000' && acc.border !== '' , JSON.stringify(acc));
    await card.screenshot({ path: `${OUT}/${nm}-studio-max.png` });
    await p.reload(); await p.waitForTimeout(2000); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
    await p.evaluate(async () => { const m = await import('/js/main.js'); m.go('settings:playback'); }); await p.waitForTimeout(1500);
    ok(`${tg} Studio Max is still picked after a reload`, await p.locator('#sec-streamquality input[value="96000"] >> visible=true').first().isChecked());
    await p.locator('#sec-streamquality .sq77-opt[data-rate="48000"] >> visible=true').first().click(); await p.waitForTimeout(900);
    ok(`${tg} back to Studio saves 48000`, (await rate()) === '48000');
    await c.close();
  }
} finally { await call('PUT', '/settings', { 'playback.streamRate': '48000' }); await br.close(); }
console.log(`f77streamquality: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

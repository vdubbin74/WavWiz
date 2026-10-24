// 0.4.6: every rendered version label equals Directory.Build.props <WavWizVersion> (top-bar badge, status bar, window title, About, phone drawer),
// all painted from one value (data-wwv), and the installer's fallback define matches too.
import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800', sess = readFileSync('/tmp/ww032/sess', 'utf8').trim(); let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const root = new URL('../../', import.meta.url).pathname, V = readFileSync(root + 'Directory.Build.props', 'utf8').match(/<WavWizVersion>([^<]+)</)[1];
ok(`installer fallback AppVersion = ${V}`, readFileSync(root + 'installer/WavWiz.iss', 'utf8').includes(`#define AppVersion "${V}"`));
const br = await chromium.launch();
for (const [vw, vh, d, tag] of [[1920, 1080, 1, '100'], [960, 540, 2, '200'], [390, 844, 3, 'phone']]) {
  const c = await br.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: d }); await c.addCookies([{ name: 'unison_session', value: sess, url: B }]);
  await c.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.webRoom.autojoin', '0'); });
  const p = await c.newPage(); await p.goto(B + '/'); await p.waitForTimeout(2500); await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(x => x.close()));
  const api = await p.evaluate(async () => (await (await fetch('/api/v1/auth/state')).json()).appVersion); ok(`[${tag}] the server reports ${V}`, api === V, api);
  if (tag === 'phone') { await p.locator('.hamb, [aria-label*="menu" i]').first().click().catch(() => {}); await p.waitForTimeout(500); }
  const labels = await p.evaluate(() => [...document.querySelectorAll('[data-wwv]')].filter(e => e.offsetParent || e.closest('nav,.drawer')).map(e => e.textContent.trim()));
  const any = await p.evaluate(() => [...document.querySelectorAll('body *')].filter(e => !e.children.length && /\bBETA\s+\d+\.\d+\.\d+/.test(e.textContent)).map(e => e.textContent.trim()));
  ok(`[${tag}] at least one version label shown`, labels.length > 0, JSON.stringify(labels));
  ok(`[${tag}] every data-wwv label says ${V}`, labels.every(l => l.endsWith(V)), JSON.stringify(labels));
  ok(`[${tag}] no other "BETA x.y.z" text on the page`, any.every(l => l.endsWith(V)), JSON.stringify(any));
  ok(`[${tag}] window title`, (await p.title()) === `WavWiz BETA ${V}` || (await p.title()).endsWith(' - WavWiz'), await p.title());
  if (tag === '100') { await p.evaluate(() => [...document.querySelectorAll('[data-wwv]')].find(e => e.tagName === 'BUTTON')?.click()); await p.waitForTimeout(800);
    const ab = await p.evaluate(() => [...document.querySelectorAll('.aboutHead [data-wwv]')].map(e => e.textContent.trim())); ok(`[${tag}] About says BETA ${V}`, ab.length && ab.every(l => l === `BETA ${V}`), JSON.stringify(ab));
    // a server upgraded under an open page: the WebSocket hello repaints every label at once
    const after = await p.evaluate(async () => { const m = await import('/js/main.js'); m.S.auth.appVersion = '9.9.9'; m.paintVersion(); return [...document.querySelectorAll('[data-wwv]')].map(e => e.textContent.trim()); });
    ok(`[${tag}] paintVersion repaints every label from the one value`, after.every(l => l.endsWith('9.9.9')), JSON.stringify(after)); }
  await c.close();
}
await br.close(); console.log(`ver046: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

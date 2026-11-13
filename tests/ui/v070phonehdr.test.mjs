// 0.7.0 (t1892) - the phone header fits: at 360 and 390 px (iPhone, @3x), with the Jukebox OFF and ON, nothing in the header runs past the right edge,
// the header does not scroll sideways, and the connection status is fully on screen. The Parallel Flow logo is only scaled down (emblem + wordmark both shown).
// Also: a desktop browser at 390 px (no phone user agent = a narrow PC window) keeps the full-size logo - the phone sizes are for real phones only.
// Needs a running server (admin session). It starts the Jukebox for the ON case and stops it again afterwards.
//   WW_URL=http://127.0.0.1:47960 WW_SESSION=<wavwiz_session cookie> node tests/ui/v070phonehdr.test.mjs   (playwright on NODE_PATH)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const B = process.env.WW_URL || 'http://127.0.0.1:47960', SESS = process.env.WW_SESSION;
if (!SESS) { console.log('SKIP: set WW_SESSION (and WW_URL)'); process.exit(0); }
let fail = 0; const ok = (n, c, x = '') => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const api = (p, m = 'GET', body) => fetch(B + '/api/v1' + p, { method: m, headers: { cookie: 'wavwiz_session=' + SESS, origin: B, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(r => r.ok ? r.json().catch(() => ({})) : Promise.reject(new Error(p + ' ' + r.status)));
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const br = await chromium.launch({ headless: true });
const measure = async (w, ua) => {
  const ctx = await br.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: ua ? 3 : 1, ...(ua ? { userAgent: ua, isMobile: true, hasTouch: true } : {}) });
  await ctx.addCookies([{ name: 'wavwiz_session', value: SESS, url: B }]);
  await ctx.addInitScript(() => { localStorage.setItem('wavwiz.whatsnew', '9.9.9'); localStorage.setItem('wavwiz.gettingStarted.shown', '1'); localStorage.setItem('wavwiz.checklist.dismissed', '1');
    localStorage.setItem('wavwiz.webRoom.id', 'web-v070phonehdr'); localStorage.setItem('wavwiz.webRoom.name', 'Header test'); });
  const p = await ctx.newPage(); await p.goto(B + '/'); await p.waitForSelector('.topbar .conn'); await p.waitForTimeout(2500);
  const m = await p.evaluate(() => { const tb = document.querySelector('.topbar'), tr = tb.getBoundingClientRect(), conn = tb.querySelector('.conn').getBoundingClientRect();
    const parts = [...tb.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]') && getComputedStyle(e).position !== 'absolute'; });
    return { over: tb.scrollWidth - tb.clientWidth, maxRight: Math.max(...parts.map(e => e.getBoundingClientRect().right)), right: tr.right, connL: conn.left, connR: conn.right, connW: conn.width,
      emblem: tb.querySelector('.brand-emblem')?.getBoundingClientRect().height || 0, word: parseFloat(getComputedStyle(tb.querySelector('.wordmark')).fontSize), handset: document.documentElement.classList.contains('handset'), jb: !!document.getElementById('jbchip') }; });
  await ctx.close(); return m;
};
const jbWas = await api('/jukebox/zone').then(z => !!z?.running, () => false);
try {
  for (const jb of [false, true]) {
    await api(jb ? '/jukebox/start' : '/jukebox/stop', 'POST', jb ? { deviceIds: [] } : { pin: '' }).catch(() => {}); await new Promise(r => setTimeout(r, 800));
    for (const w of [360, 390]) {
      const m = await measure(w, IPHONE), n = `phone ${w} px, Jukebox ${jb ? 'on' : 'off'}`;
      ok(`${n}: a real phone (html.handset)${jb ? ', Jukebox buttons shown' : ''}`, m.handset && m.jb === jb, JSON.stringify(m));
      ok(`${n}: no sideways overflow`, m.over <= 0, 'scroll ' + m.over);
      ok(`${n}: nothing past the right edge`, m.maxRight <= m.right + 0.5, `${m.maxRight} > ${m.right}`);
      ok(`${n}: connection status fully visible`, m.connW > 0 && m.connL >= 0 && m.connR <= m.right - 4, `${m.connL}-${m.connR} of ${m.right}`);
      ok(`${n}: the logo is scaled, not removed (emblem ${m.emblem} px, wordmark ${m.word} px)`, m.emblem >= 16 && m.emblem < 30 && m.word >= 14 && m.word < 22);
    }
  }
  const pc = await measure(390, null);
  ok('a narrow desktop browser (no phone user agent) keeps the full-size logo', !pc.handset && pc.emblem === 30 && pc.word === 22, JSON.stringify(pc));
} finally { await api(jbWas ? '/jukebox/start' : '/jukebox/stop', 'POST', jbWas ? { deviceIds: [] } : { pin: '' }).catch(() => {}); await br.close(); }
console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0);

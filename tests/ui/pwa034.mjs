// WavWiz 0.3.4 H1: manifest + icons + iOS meta, and the service worker: installs, network-first for the app shell, never caches the API,
// and a version change installs a new worker and deletes the old cache.
import { chromium, devices } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const B = 'http://172.30.0.2:47800';
const BIN = process.env.WW_WEB || '/workspace/wavwiz-public/src/WavWiz.Server/bin/Release/net10.0/wwwroot';
const R = []; const ok = (n, c, i = '') => { R.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (i ? ' :: ' + i : '')); };
const man = await (await fetch(B + '/manifest.webmanifest')).json();
ok('manifest: name WavWiz (no BETA), id + scope "/", description, standalone', man.name === 'WavWiz' && man.short_name === 'WavWiz' && man.id === '/' && man.scope === '/' && !!man.description && man.display === 'standalone', JSON.stringify({ name: man.name, id: man.id, scope: man.scope }));
const sizes = p => man.icons.filter(i => i.purpose === p).map(i => i.sizes);
ok('manifest: 192 + 512 "any" icons and 192 + 512 maskable icons', ['192x192', '512x512'].every(s => sizes('any').includes(s) && sizes('maskable').includes(s)), JSON.stringify(man.icons.map(i => i.sizes + ' ' + i.purpose)));
for (const ic of man.icons) { const r = await fetch(B + ic.src); const b = Buffer.from(await r.arrayBuffer()); const w = b.readUInt32BE(16), hh = b.readUInt32BE(20); ok(`icon ${ic.src} is a ${ic.sizes} PNG`, r.ok && b.slice(1, 4).toString() === 'PNG' && `${w}x${hh}` === ic.sizes, `${w}x${hh}`); }
const html = await (await fetch(B + '/')).text();
for (const [k, re] of [['apple-touch-icon', /<link rel="apple-touch-icon" href="\/assets\/logo-180.png">/], ['apple-mobile-web-app-capable', /name="apple-mobile-web-app-capable" content="yes"/], ['mobile-web-app-capable', /name="mobile-web-app-capable" content="yes"/], ['apple-mobile-web-app-title', /name="apple-mobile-web-app-title" content="WavWiz"/], ['status-bar-style', /name="apple-mobile-web-app-status-bar-style" content="black-translucent"/]]) ok('index.html has ' + k, re.test(html));
const t180 = Buffer.from(await (await fetch(B + '/assets/logo-180.png')).arrayBuffer()); ok('apple-touch-icon is 180x180 and opaque (RGB, no alpha)', t180.readUInt32BE(16) === 180 && t180[25] === 2, 'color type ' + t180[25]);
const L = process.env.WW_SECURE || 'http://localhost:47801'; const cb = await chromium.launch();
const ctx = await cb.newContext({ ...devices['iPhone 13'] }); const p = await ctx.newPage();
await p.goto(L + '/'); await p.waitForTimeout(4000);
let sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); await navigator.serviceWorker.ready; return { url: r?.active?.scriptURL, scope: r?.scope, keys: await caches.keys() }; });
const st = await (await fetch(B + '/api/v1/auth/state')).json();
ok('service worker registered at scope / with the app version', sw.url?.endsWith('/sw.js?v=' + st.appVersion) && sw.scope === L + '/', JSON.stringify(sw));
ok('cache is named after the version', sw.keys.includes('wavwiz-shell-' + st.appVersion), sw.keys.join(','));
await p.reload(); await p.waitForTimeout(3000);
const ctl = await p.evaluate(() => !!navigator.serviceWorker.controller); ok('page is controlled by the worker after reload', ctl);
const apiCached = await p.evaluate(async () => { await fetch('/api/v1/auth/state'); const c = await caches.open((await caches.keys())[0]); return (await c.keys()).map(r => new URL(r.url).pathname).filter(x => x.startsWith('/api')); });
ok('API responses are never cached', apiCached.length === 0, apiCached.join(','));
// network-first: change a shell file on the server; the controlled page must get the new bytes, not the cache
const cssPath = BIN + '/app.css', orig = readFileSync(cssPath, 'utf8'); const mark = '/* sw-test ' + Date.now() + ' */';
try { writeFileSync(cssPath, orig + '\n' + mark); const got = await p.evaluate(async () => (await (await fetch('/app.css')).text()).slice(-60)); ok('app shell is network-first (a changed file is served fresh, not from the cache)', got.includes(mark), got); }
finally { writeFileSync(cssPath, orig); }
// offline fallback: shell answered from the cache when the server is unreachable
await ctx.setOffline(true); const off = await p.evaluate(async () => { try { const r = await fetch('/app.css'); return r.ok; } catch { return false; } }); await ctx.setOffline(false);
ok('offline: the shell falls back to the cache', off);
// version change: a new registration URL installs a new worker and drops the old cache
sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.register('/sw.js?v=9.9.9-test', { scope: '/', updateViaCache: 'none' }); await new Promise(res => { const w = r.installing || r.waiting; if (!w) return res(); w.addEventListener('statechange', () => { if (w.state === 'activated') res(); }); setTimeout(res, 8000); }); await new Promise(r2 => setTimeout(r2, 800)); const r3 = await navigator.serviceWorker.getRegistration('/'); return { url: r3.active?.scriptURL, keys: await caches.keys() }; });
ok('version change: new worker active, only the new cache is left', sw.url?.endsWith('v=9.9.9-test') && sw.keys.length === 1 && sw.keys[0] === 'wavwiz-shell-9.9.9-test', JSON.stringify(sw));
// and back to the real version (as the next page load of the real build does)
await p.reload(); await p.waitForTimeout(4000);
sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); return { url: r?.active?.scriptURL || r?.waiting?.scriptURL || r?.installing?.scriptURL, keys: await caches.keys() }; });
ok('the app re-registers its own version on load', sw.url?.endsWith('v=' + st.appVersion), JSON.stringify(sw));
await cb.close();
console.log(`PWA 0.3.4 ${R.filter(x => x).length}/${R.length}`);

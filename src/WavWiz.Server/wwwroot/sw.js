// WavWiz 0.3.4 H1: minimal service worker so phones can install WavWiz as a home-screen app.
// Never serves a stale app after an upgrade: the cache is named after the app version (registered as /sw.js?v=<version>, so a new
// version installs a new worker and the old cache is deleted), and the app shell is NETWORK-FIRST - the cache is only a fallback when
// the server can't be reached. The API (/api/...), WebSockets, audio, art and the jukebox/calibration/TLS pages are never cached.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = 'wavwiz-shell-' + VERSION;
const SHELL = ['/', '/index.html', '/app.css', '/jukebox-palette.css', '/jukebox.css', '/manifest.webmanifest', '/assets/logo-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('wavwiz-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
/** Pure: may this request be answered from / stored in the shell cache? */
function cacheable(req) {
  if (req.method !== 'GET') return false;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return false;
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/ws') || u.pathname.startsWith('/tls') || u.pathname === '/sw.js') return false;
  if (/^\/(jukebox|calmic|viz|mini)\.html$/.test(u.pathname)) return false;
  if (req.headers.get('range') || req.headers.get('upgrade')) return false;
  return true;
}
self.addEventListener('fetch', e => {
  const req = e.request; if (!cacheable(req)) return;   // the browser handles it as if there were no service worker
  e.respondWith(fetch(req).then(res => { if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); } return res; })
    .catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('/') : undefined)).then(hit => hit || Response.error())));
});

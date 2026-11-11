// WavWiz 0.4.1: "Add to Home Screen" for iPhone Safari, and what this phone remembers.
// iOS Home Screen web apps have their OWN storage (not shared with Safari): cookies and localStorage from Safari are not there. So the things this phone should keep are
// (1) stored on the SERVER under the device's id (the speaker name, the calibration delay and the calibration mic choices all live on the server keyed by that id), and
// (2) the id itself travels in the Home Screen icon's start address (?wr=<id>, from a per-device manifest), so the Home Screen app comes up as the SAME device.
// The sign-in session is the one thing iOS cannot carry over: the Home Screen app asks for the sign-in once.
function h(tag, attrs, ...kids) {   // local, so the calibration page needs nothing else
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else e.setAttribute(k, v === true ? '' : v); }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

const ROOM_KEY = 'wavwiz.webRoom.id', DISMISS_KEY = 'wavwiz.a2hs.dismissed';
/** Pure: iPhone / iPad Safari (not Chrome / Firefox / Edge for iOS, which cannot add to the Home Screen the same way, and not an in-app browser). */
export const isIosSafari = (ua = globalThis.navigator?.userAgent || '', touchPoints = globalThis.navigator?.maxTouchPoints || 0) => {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  return ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\//.test(ua);
};
/** Pure: running as an installed Home Screen app. */
export const isStandalone = (win = globalThis) => { try { return !!(win.navigator?.standalone === true || win.matchMedia?.('(display-mode: standalone)')?.matches); } catch { return false; } };
/** Pure: show the prompt? iPhone Safari, not installed yet, and not dismissed by the user (a dismissal is per browser; the card stays in the menu). */
export const shouldOffer = ({ ua, standalone, dismissed = false, touchPoints } = {}) => isIosSafari(ua, touchPoints) && !(standalone ?? isStandalone()) && !dismissed;
/** Pure: a valid device id from the Home Screen start address (?wr=...), or null. */
export const roomFromSearch = search => { try { const v = new URLSearchParams(search).get('wr') || ''; return /^[A-Za-z0-9._-]{6,80}$/.test(v) ? v : null; } catch { return null; } };
/** Pure: what this phone remembers. { calibrated, named, mic } -> every part saved? */
export const rememberedAll = r => !!(r && r.calibrated && r.named && r.mic);

const SVG = {
  share: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M12 8v8M8 12h8"/></svg>',
};
const svg = k => { const s = document.createElement('span'); s.className = 'a2hs-ic'; s.innerHTML = SVG[k]; return s; };
/** The card: a short picture guide - 1 Share, 2 Add to Home Screen. */
export function a2hsCard({ onDismiss = null } = {}) {
  const step = (n, ic, title, text) => h('li', { class: 'a2hs-step' }, h('span', { class: 'a2hs-n' }, String(n)), svg(ic), h('div', null, h('b', null, title), h('div', { class: 'small dim' }, text)));
  return h('section', { class: 'card a2hs-card', 'aria-label': 'Add WavWiz to your Home Screen', 'data-a2hs': '1' },
    h('h3', null, 'Add WavWiz to your Home Screen'),
    h('p', { class: 'small' }, 'It then opens full screen like an app, with the WavWiz icon.'),
    h('ol', { class: 'a2hs-steps' },
      step(1, 'share', 'Tap Share', 'The square with the arrow, at the bottom of Safari.'),
      step(2, 'plus', 'Add to Home Screen', 'Scroll the list, tap Add to Home Screen, then Add.')),
    onDismiss ? h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn sm', onclick: onDismiss }, 'Not now')) : null);
}
const dismissed = () => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } };
/** Put the card into `host` when it applies (iPhone Safari, not installed). Returns the card or null. `always` ignores the earlier "Not now" (menu entry). */
export function mountA2hs(host, { always = false } = {}) {
  if (!host || !shouldOffer({ dismissed: always ? false : dismissed() })) return null;
  const card = a2hsCard({ onDismiss: always ? null : () => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ } card.remove(); } });
  host.prepend(card); return card;
}
/** "Remembered on this phone" - shown once the calibration, the name and the mic settings are saved for this device. */
export function rememberedNote(r) {
  if (!rememberedAll(r)) return null;
  const inApp = isStandalone();
  return h('p', { class: 'small remembered', role: 'status', 'data-remembered': '1' }, h('b', null, 'Remembered on this phone. '), 'Calibration, name and mic settings are saved for this device' + (inApp ? '.' : '; the Home Screen app opens as this same device.'));
}

/** Boot: point the manifest at this device's own start address, and adopt the device id when the Home Screen app starts with ?wr=. Safe to call more than once. */
export function boot(win = globalThis) {
  try {
    const doc = win.document; if (!doc) return;
    const st = win.localStorage, fromUrl = roomFromSearch(win.location?.search || '');
    if (fromUrl && st.getItem(ROOM_KEY) !== fromUrl && isStandalone(win)) st.setItem(ROOM_KEY, fromUrl);   // the Home Screen app becomes the same device as the Safari tab
    const ios = isIosSafari(win.navigator?.userAgent, win.navigator?.maxTouchPoints);
    if (ios && !isStandalone(win) && !st.getItem(ROOM_KEY) && win.crypto?.getRandomValues) st.setItem(ROOM_KEY, 'web-' + [...win.crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, '0')).join(''));   // same form as room.js roomId()
    const id = st.getItem(ROOM_KEY); const link = doc.querySelector('link[rel=manifest]');
    // 0.6.8-#11e: iOS Safari can build the Home Screen icon from the page address instead of the (swapped) manifest, so the Safari tab keeps
    // ?wr=<this device> in its address; the Home Screen app adopts it above and then drops it from its own address.
    const keepWr = !isStandalone(win) && ios && id && /^[A-Za-z0-9._-]{6,80}$/.test(id);
    if (keepWr ? fromUrl !== id : fromUrl) { const u = new URL(win.location.href); if (keepWr) u.searchParams.set('wr', id); else u.searchParams.delete('wr'); win.history?.replaceState?.(null, '', u.pathname + (u.search || '') + u.hash); }
    if (link && id && /^[A-Za-z0-9._-]{6,80}$/.test(id) && !isStandalone(win)) link.setAttribute('href', '/api/v1/phone/manifest?wr=' + encodeURIComponent(id));
    // F237: keep apple-touch-icon at 180 + cache-bust so iOS does not fall back to a “W” monogram
    const ICON = '/assets/logo-180.png?v=pf070';
    for (const rel of ['apple-touch-icon', 'apple-touch-icon-precomposed']) {
      let ic = doc.querySelector(`link[rel="${rel}"]`);
      if (!ic && rel === 'apple-touch-icon') { ic = doc.createElement('link'); ic.setAttribute('rel', rel); doc.head?.append(ic); }
      if (!ic) continue;
      ic.setAttribute('sizes', '180x180');
      if (!String(ic.getAttribute('href') || '').includes('logo-180.png?v=pf070')) ic.setAttribute('href', ICON);
    }
    inlineTouchIcon(win, doc, ICON);
  } catch { /* never block the app */ }
}
/** F272: iOS fetches the Home Screen icon outside the page. Over https with a WavWiz certificate the phone accepted only for the page (or a CA
 *  without full trust), that fetch fails and iOS draws a letter "W" tile. The page itself CAN read the icon, so hand iOS the bytes as a data: URL. */
export function inlineTouchIcon(win, doc, url) {
  if (!win?.fetch || !win.FileReader || !/iPhone|iPad|iPod|Macintosh/.test(win.navigator?.userAgent || '')) return Promise.resolve(false);
  return win.fetch(url, { cache: 'force-cache' }).then(r => (r.ok ? r.blob() : null)).then(b => b && /^image\/png/.test(b.type || '') ? new Promise(res => {
    const fr = new win.FileReader(); fr.onload = () => res(String(fr.result || '')); fr.onerror = () => res(''); fr.readAsDataURL(b); }) : '')
    .then(data => { if (!data.startsWith('data:image/png')) return false;
      for (const rel of ['apple-touch-icon', 'apple-touch-icon-precomposed']) doc.querySelectorAll(`link[rel="${rel}"]`).forEach(l => { if (/logo-180|\/apple-touch-icon/.test(l.getAttribute('href') || '') || l.dataset.inline) { l.dataset.inline = '1'; l.setAttribute('href', data); } });
      return true; }).catch(() => false);
}
if (typeof document !== 'undefined') boot();

// 0.0.7: pure helpers for the auto-join (kept DOM-free so they are unit tested). 0.2.0: EVERY browser (desktop, phone, TV) joins as a speaker.
export const isPhoneUa = (ua = globalThis.navigator?.userAgent || '', touchPoints = globalThis.navigator?.maxTouchPoints || 0) => !isTvUa(ua) && (/iPhone|iPad|iPod|Android/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1));
/** 0.2.0 item 1: smart-TV / streaming-stick browsers (Samsung Tizen, LG webOS, Android TV / BRAVIA, Fire TV, Chromecast, HbbTV, NetCast, Hisense VIDAA). */
export const isTvUa = (ua = globalThis.navigator?.userAgent || '') => /Tizen|Web0S|webOS|SMART-TV|SmartTV|Android TV|AndroidTV|BRAVIA|\bAFT[A-Z0-9]|CrKey|HbbTV|NetCast|VIDAA|GoogleTV|Roku|PhilipsTV|Viera|AQUOS/i.test(ua);
/** The WavWiz Player window (WebView2) plays through its own Windows audio connection: its page must never ALSO join as a web speaker. */
export const isPlayerUa = (ua = globalThis.navigator?.userAgent || '') => /WavWizPlayer\//.test(ua);
/** Auto-join default (0.2.0): ON for every browser unless the user switched it off ('0'); never in the Player window. */
export function wantsAutoJoin(stored, _phone = true, ua = globalThis.navigator?.userAgent || '') { if (isPlayerUa(ua)) return false; return stored !== '0'; }

/** 0.2.0: a readable default speaker name from the browser, e.g. "LG TV browser", "iPhone", "Chrome on Windows". Renamable later in Devices (admin). */
export function deviceName(ua = globalThis.navigator?.userAgent || '', touchPoints = globalThis.navigator?.maxTouchPoints || 0) {
  if (isTvUa(ua)) {
    const brand = /Web0S|webOS|NetCast|\bLG\b/i.test(ua) ? 'LG' : /Tizen|Samsung/i.test(ua) ? 'Samsung' : /BRAVIA|Sony/i.test(ua) ? 'Sony' : /\bAFT[A-Z0-9]/.test(ua) ? 'Fire TV' : /CrKey|GoogleTV/i.test(ua) ? 'Google TV' : /VIDAA|Hisense/i.test(ua) ? 'Hisense' : /PhilipsTV/i.test(ua) ? 'Philips' : /Roku/i.test(ua) ? 'Roku' : '';
    return brand === 'Fire TV' || brand === 'Google TV' || brand === 'Roku' ? `${brand} browser` : `${brand ? brand + ' ' : ''}TV browser`;
  }
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

/** 0.2.0 item 12: one-time move of the old "unison.*" localStorage keys to "wavwiz.*" (the old value wins only when the new key is unset). */
export function migrateKey(store, oldKey, newKey) {
  try { const nv = store.getItem(newKey); if (nv != null) return nv; const ov = store.getItem(oldKey); if (ov != null) { store.setItem(newKey, ov); store.removeItem(oldKey); } return ov; } catch { return null; }
}

// F274: the pure parts of the phone set-up page (unit-tested; no DOM).
export const AUTO_CONTINUE_MS = 2000;   // D3: Secure ✓ -> the secure address after 2 s
export const NOT_TRUSTED_TITLE = 'Not secure yet';
export const NOT_YET_TEXT = 'WavWiz already works on this phone. A secure connection is only needed for the microphone (calibrating speakers, Announce, Check with phone). It takes about 2 minutes and only works for your WavWiz server.';
/** A plain label the PC shows ("iPhone: Secure ✓"): never the full user agent. */
export function deviceName(ua = '') {
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  return 'Phone';
}
/** 100.64.0.0/10 (Tailscale). */
export const isTailscaleHost = h => { const m = /^100\.(\d+)\./.exec(h || ''); return !!m && +m[1] >= 64 && +m[1] <= 127; };
/** Add to Home Screen: from the secure page the icon opens https; skipped security = the icon opens the regular address. */
export const a2hsNote = (trusted, onHttps) => trusted && onHttps ? 'Your icon will open the secure address.'
  : trusted ? 'Tip: tap Open WavWiz (secure) first, then add it from there, so the icon opens the secure address.'
  : 'Your icon will open the regular (not secure) address. That is fine for music.';

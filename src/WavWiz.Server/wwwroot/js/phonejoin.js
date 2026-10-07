// 0.0.7: pure helpers for the phone auto-join (kept DOM-free so they are unit tested).
export const isPhoneUa = (ua = globalThis.navigator?.userAgent || '', touchPoints = globalThis.navigator?.maxTouchPoints || 0) => /iPhone|iPad|iPod|Android/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
/** Auto-join default: ON for phones unless the user pressed Stop ('0'); OFF for desktops unless they opted in ('1'). */
export function wantsAutoJoin(stored, phone) { return stored === '1' || (stored == null && phone); }

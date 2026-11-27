// 0.7.3 t2248u: what happens right after Pair / Administrator succeeded.
// Before: location.reload(). On an iPhone whose page was opened by a cross-site navigation (the Camera's QR code, a link in Messages or Mail,
// a Home Screen icon) Safari kept withholding the SameSite=Strict session cookie from that page - its own fetches and the reload too - so the
// reload came back to the sign-in page, again and again (Docker first: phones open the plain-http QR link directly). The server cookie is Lax
// now (Api/Common.cs SetSession); here the page also (1) moves on with a same-origin navigation instead of a reload, (2) drops the used
// ?pair= code, and (3) marks the move, so a browser that still does not keep the sign-in sees why instead of the same form again.
export const SIGNIN_MARK = 'signedin';
export const SIGNIN_LOST = 'You were signed in, but this browser did not keep the sign-in. Open the WavWiz address in Safari itself (not inside another app), turn off Private Browsing, and check that Settings > Apps > Safari > Block All Cookies is off. Then sign in again.';

/** The address to continue to after a successful sign-in: the same page, without the one-time ?pair= code, plus the marker. */
export function afterSignInUrl(loc) {
  const q = new URLSearchParams(loc.search || ''); q.delete('pair'); q.set(SIGNIN_MARK, '1');
  return (loc.pathname || '/') + '?' + q.toString();
}
export const signInMarked = loc => new URLSearchParams(loc.search || '').get(SIGNIN_MARK) === '1';
/** The current address without the marker (boot puts it back with history.replaceState so a later reload is a plain one). */
export function withoutMark(loc) {
  const q = new URLSearchParams(loc.search || ''); q.delete(SIGNIN_MARK); const s = q.toString();
  return (loc.pathname || '/') + (s ? '?' + s : '') + (loc.hash || '');
}
/** Pair / Administrator succeeded: continue with a same-origin navigation (never a bare reload). */
export function finishSignIn(loc = globalThis.location) { loc.replace(afterSignInUrl(loc)); }
/** Boot: the message for the sign-in page - set only when we just signed in and the server still does not see this browser as signed in. */
export const lostSignInMessage = (loc, authenticated) => (!authenticated && signInMarked(loc) ? SIGNIN_LOST : '');

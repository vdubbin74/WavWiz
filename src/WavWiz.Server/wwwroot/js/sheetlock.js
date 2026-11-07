// F262-fix-B: a REAL body scroll lock for the phone Speaker Settings sheet.
// Root cause of the iPhone hit offset: the sheet's lock was only `overflow:hidden` on html/body (app.css,
// html.pd42-open), which iOS Safari does not honour for document scrolling. Rotating to landscape (short
// viewport) lets WebKit scroll the window/visual viewport under the position:fixed sheet; after returning to
// portrait the fixed sheet is painted at the viewport top but WebKit hit-tests it with the stale scroll offset,
// so taps land BELOW where the controls are drawn (user must tap above). Pinning the body with
// position:fixed; top:-Ypx keeps window scroll at 0 for the sheet's whole life, and relock() re-asserts it.
let saved = null;
const W = () => globalThis.window, D = () => globalThis.document;

export const bodyLocked = () => !!saved;
export const lockedY = () => (saved ? saved.y : 0);

export function lockBody(win = W(), doc = D()) {
  if (saved || !doc?.body) return;
  const y = Math.max(0, Math.round(win.scrollY ?? win.pageYOffset ?? doc.documentElement?.scrollTop ?? 0)) || 0;
  const b = doc.body.style;
  saved = { y, position: b.position, top: b.top, left: b.left, right: b.right, width: b.width };
  b.position = 'fixed'; b.top = -y + 'px'; b.left = '0'; b.right = '0'; b.width = '100%';
  doc.documentElement?.classList?.add('ww-bodylock');
}

/** Re-assert the lock (after rotation): body pinned at -Y and the window itself back at 0. */
export function relockBody(win = W(), doc = D()) {
  if (!saved || !doc?.body) return false;
  const b = doc.body.style;
  b.position = 'fixed'; b.top = -saved.y + 'px'; b.left = '0'; b.right = '0'; b.width = '100%';
  try { win.scrollTo(0, 0); } catch {}
  return true;
}

export function unlockBody(win = W(), doc = D()) {
  if (!saved || !doc?.body) { saved = null; return; }
  const s = saved; saved = null;
  const b = doc.body.style;
  b.position = s.position; b.top = s.top; b.left = s.left; b.right = s.right; b.width = s.width;
  doc.documentElement?.classList?.remove('ww-bodylock');
  try { win.scrollTo(0, s.y); } catch {}   // back to where the page was when the sheet opened
}

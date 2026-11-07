// F262-fix: the phone app is portrait-only. iOS Safari cannot lock orientation, so on a phone
// (coarse pointer, short screen side <= 500 CSS px) that is PHYSICALLY landscape we show a
// full-screen "rotate" overlay that hides the app and swallows input. Desktop/tablets never match.
// F262-fix-A (Wiz H1): orientation comes from the screen, never from the layout viewport alone, so a
// keyboard that shrinks the viewport (412x360 portrait) is not "landscape"; we never blur on block.
// F262-fix-A (Wiz M1): recovery on return to portrait only touches an open speaker/sound sheet;
// unrelated scroll (#desk, window) is preserved when no sheet is open.
// F262-fix-B: root cause was the overflow-only body lock (see sheetlock.js); recovery now re-asserts the real
// lock and re-lays out the open sheet in a delayed burst after EVERY rotation, not only when the overlay hides.
import { relockBody } from './sheetlock.js';
export const PHONE_LANDSCAPE = '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)';
const SHEETS = '.pd42-sheet, .npeqsheet, dialog[open]';
const PHONE_SHORT_SIDE = 500;
// F262-fix-B: iOS reports post-rotation sizes late; recovery runs as a burst at these delays (ms).
export const RECOVER_DELAYS = [0, 100, 350, 700];
const ROTATE_WINDOW_MS = 1200;

export const isEditable = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || ''));

/** Physical orientation from screen signals; null when nothing reliable is available. */
export function screenLandscape(win) {
  const t = win.screen?.orientation?.type;
  if (typeof t === 'string' && t) return t.startsWith('landscape');
  const o = win.orientation;
  if (typeof o === 'number') return Math.abs(o) === 90;
  const w = win.screen?.width, h = win.screen?.height;
  if (w > 0 && h > 0 && w !== h) return w > h;
  return null;
}

/** Should the portrait guard block? Pure on (win, doc). */
export function shouldBlock(win, doc) {
  const coarse = !!win.matchMedia?.('(pointer: coarse)')?.matches;
  if (!coarse) return false;
  const sw = win.screen?.width, sh = win.screen?.height;
  if (sw > 0 && sh > 0 && Math.min(sw, sh) > PHONE_SHORT_SIDE) return false;   // tablet / large screen
  const phys = screenLandscape(win);
  if (phys !== null) return phys;
  // Fallback only: no screen signal. A focused editable means a keyboard may be shrinking the viewport: never block then.
  if (isEditable(doc.activeElement)) return false;
  return !!win.matchMedia?.(PHONE_LANDSCAPE)?.matches;
}

export function installOrientationGuard({ win = globalThis.window, doc = globalThis.document, relock = relockBody, now = () => Date.now() } = {}) {
  if (!win || !doc || typeof win.matchMedia !== 'function') return null;
  const mq = win.matchMedia(PHONE_LANDSCAPE);
  let overlay = null, blocked = false, raf = 0;
  const html = doc.documentElement;
  const tryLock = () => {
    try { const p = win.screen?.orientation?.lock?.('portrait'); p?.catch?.(() => {}); } catch { /* unsupported (iOS, desktop) */ }
  };
  const swallow = e => { if (blocked) { e.preventDefault?.(); e.stopPropagation?.(); } };
  const ensureOverlay = () => {
    if (overlay) return overlay;
    overlay = doc.createElement('div');
    overlay.id = 'ww-rotate'; overlay.className = 'ww-rotate';
    overlay.setAttribute('role', 'alertdialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-live', 'assertive');
    overlay.textContent = 'Rotate your phone to portrait';
    for (const t of ['pointerdown', 'pointerup', 'touchstart', 'touchmove', 'click', 'wheel']) overlay.addEventListener(t, swallow, { passive: false });
    doc.body.append(overlay);
    return overlay;
  };
  const sheets = () => [...(doc.querySelectorAll?.(SHEETS) || [])];
  const step = first => {
    const open = sheets();
    if (!open.length || blocked) return false;   // M1: nothing to realign; keep the user's scroll positions
    if (first) try { const a = doc.activeElement; if (isEditable(a) && open.some(s => s.contains?.(a))) a.blur(); } catch {}   // sheet keyboard only, once
    const keep = open.map(el => el.querySelector?.(':scope > .pd42')?.scrollTop);   // the sheet's own scroll, read before any relayout
    let locked = false; try { locked = !!relock(win, doc); } catch {}
    try { win.scrollTo(0, 0); } catch {}   // window must sit at 0 under the pinned body (body carries -lockY); undo the iOS shift
    open.forEach((el, i) => {
      if (el.classList?.contains?.('npeqsheet')) { el.style.setProperty?.('--sound-vtop', '0px'); el.style.setProperty?.('--sound-vh', (win.visualViewport?.height || win.innerHeight) + 'px'); }
      const d = el.style.display, st = keep[i];
      el.style.display = 'none'; void el.offsetHeight; el.style.display = d; void el.offsetHeight;   // full re-mount of the layer so hit targets realign
      const sc = el.querySelector?.(':scope > .pd42'); if (sc && st != null) sc.scrollTop = st;     // keep the sheet's own scroll
    });
    try { win.dispatchEvent?.(new win.CustomEvent('wavwiz:orientrecover')); } catch {}
    return true;
  };
  let frameDue = false, timers = [], rotatedAt = -Infinity, lastPhys = null;
  const recover = () => {
    if (!sheets().length) return;   // M1
    for (const t of timers) win.clearTimeout?.(t);
    timers = RECOVER_DELAYS.map((ms, i) => win.setTimeout(() => step(i === 0), ms));
    if (!frameDue) { frameDue = true; try { win.requestAnimationFrame(() => { frameDue = false; step(false); }); } catch { frameDue = false; } }   // and once on the next frame
  };
  const apply = () => {
    const want = shouldBlock(win, doc);
    if (want === blocked) return;
    blocked = want;
    if (want) {   // H1: no blur here; the overlay already hides and blocks the app
      ensureOverlay().hidden = false;
      html.classList.add('ww-rotate-block');
      tryLock();
    } else {
      html.classList.remove('ww-rotate-block');
      if (overlay) overlay.hidden = true;
      recover();
    }
  };
  const rotated = () => {   // an orientation change: re-check the guard and run the recovery burst
    rotatedAt = now(); schedule(); if (!shouldBlock(win, doc)) recover();
  };
  const resized = () => {   // late iOS size reports: only follow up inside the post-rotation window (keyboard resizes never trigger recovery)
    const p = screenLandscape(win); if (p !== null && lastPhys !== null && p !== lastPhys) rotatedAt = now(); if (p !== null) lastPhys = p;
    schedule(); if (now() - rotatedAt <= ROTATE_WINDOW_MS && !shouldBlock(win, doc)) recover();
  };
  const schedule = () => { if (raf) return; raf = -1; const r = (win.requestAnimationFrame || (f => win.setTimeout(f, 0)))(() => { raf = 0; apply(); }); if (raf) raf = r; };
  mq.addEventListener ? mq.addEventListener('change', resized) : mq.addListener?.(resized);
  win.screen?.orientation?.addEventListener?.('change', rotated);
  win.addEventListener('orientationchange', rotated);
  win.visualViewport?.addEventListener('resize', resized);
  win.addEventListener('resize', resized);
  lastPhys = screenLandscape(win); tryLock(); apply();
  return { apply, recover, get blocked() { return blocked; }, get overlay() { return overlay; } };
}

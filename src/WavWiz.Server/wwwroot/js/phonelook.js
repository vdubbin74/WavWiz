// WavWiz 0.7.3 t2225u: a narrow PC window looks like the phone.
//  html.phonelook = a real phone (html.handset) OR any window at phone width (max-width:900px, the same breakpoint as the phone layout).
//  LOOK rules (sizes, one-line headers, one-column grids, the tab bar on Now Playing, docked sheets) use html.phonelook.
//  Phone-only RESTRICTIONS and touch behavior (no pins / shortcut hints in the drawer, hidden PC-file items, bottom-sheet popovers,
//  long-press menus, no text selection, keyboard spacer) stay on html.handset - a narrow PC window keeps every desktop feature
//  (pins, Home, the full menus). Never decide what is available from the window width.
export const PHONE_LOOK_MQ = '(max-width:900px)';
/** Pure: does this window get the phone look? */
export const phoneLook = (realPhone, narrow) => !!realPhone || !!narrow;
/** Set html.phonelook now and whenever the window crosses the breakpoint. Returns the current value. */
export function installPhoneLook(realPhone, doc = typeof document !== 'undefined' ? document : null, mm = typeof matchMedia === 'function' ? matchMedia : null) {
  const root = doc?.documentElement; if (!root) return false;
  let mq = null; try { mq = mm ? mm(PHONE_LOOK_MQ) : null; } catch { mq = null; }
  const paint = () => { const on = phoneLook(realPhone, mq?.matches); root.classList.toggle('phonelook', on); return on; };
  try { mq?.addEventListener ? mq.addEventListener('change', paint) : mq?.addListener?.(paint); } catch { /* old engines */ }
  return paint();
}

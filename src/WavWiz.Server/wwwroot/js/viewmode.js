// WavWiz 0.3.9 L52: the narrow (phone: Now / Library / Devices tabs) <-> wide (desktop panels) switch. Pure, so it is unit-tested.
// Before: a window opened wide kept data-view="library" with an empty page, so shrinking it showed a blank center.
/** What the view state must be after the window crosses (or sits on) the breakpoint. */
export function viewForMode({ wide, view = 'now', hasContent = false } = {}) {
  if (wide) return { view: 'library', clearContent: true };                  // desktop: every panel is on screen; the tab page is unused
  if (view === 'library' && !hasContent) return { view: 'now', clearContent: false };   // narrow with nothing to show -> Now Playing
  if (!view) return { view: 'now', clearContent: false };
  return { view, clearContent: false };
}

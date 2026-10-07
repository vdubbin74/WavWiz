// Web UI display size (View > Display size; Settings > Appearance). Saved per device (this browser / phone / TV). Independent of the WinForms player's
// own size setting, which multiplies on top inside WavWiz Player.
// 0.0.8: it really scales now. 0.0.5-0.0.7 only changed the root font size, but every size in the style sheet is in px, so nothing moved.
// Now the whole page is zoomed (fonts, controls, panels, side bars) and the style sheet divides viewport units by the same factor.
const SCALE_KEY = 'wavwiz.uiscale';
export const SCALES = [['small', 'Small', 0.9], ['compact', 'Compact (default)', 1], ['medium', 'Medium', 1.12], ['large', 'Large', 1.25], ['xlarge', 'Extra large (TV)', 1.5]];
export const scaleFactor = id => (SCALES.find(([x]) => x === id) || SCALES[1])[2];
export function loadScale() {
  try { const v = localStorage.getItem(SCALE_KEY); if (SCALES.some(([id]) => id === v)) return v; } catch { /* ignore */ }
  return 'compact';
}
export function applyScale(id) {
  const v = SCALES.some(([x]) => x === id) ? id : 'compact', z = scaleFactor(v);
  if (typeof document !== 'undefined') {
    const de = document.documentElement; de.dataset.uiscale = v; de.style.setProperty('--z', String(z));
    try { window.dispatchEvent(new CustomEvent('wavwiz:uiscale', { detail: { id: v, zoom: z } })); window.dispatchEvent(new Event('resize')); } catch { /* old browser */ }
  }
  try { localStorage.setItem(SCALE_KEY, v); } catch { /* ignore */ }
  return v;
}
if (typeof document !== 'undefined') applyScale(loadScale());

// Web UI display size (View > Display size; Settings > Appearance). Saved per device (this browser / phone / TV). Independent of the WinForms player's
// own size setting, which multiplies on top inside WavWiz Player.
// 0.0.8: it really scales now. 0.0.5-0.0.7 only changed the root font size, but every size in the style sheet is in px, so nothing moved.
// Now the whole page is zoomed (fonts, controls, panels, side bars) and the style sheet divides viewport units by the same factor.
const SCALE_KEY = 'wavwiz.uiscale';
// 0.3.1 B16: three presets - Small 75 %, Default 100 % (stays the default), Large 125 % (the maximum). Earlier saved choices are kept:
// Small, Compact (now "Default") and Large keep their names; Medium (112 %) stays as it was until another size is picked; Extra large (TV)
// becomes Large, the new maximum.
// 0.4.5 T2: a 67 % card before Small (for big TVs at 200 % Windows scaling); no 50 %.
export const SCALES = [['tiny', 'Extra small', 0.67], ['small', 'Small', 0.75], ['compact', 'Default', 1], ['large', 'Large', 1.25]];
export const LEGACY_SCALES = { medium: 1.12 };
export const scaleFactor = id => (SCALES.find(([x]) => x === id)?.[2]) ?? LEGACY_SCALES[id] ?? 1;
/** A saved value from any earlier version -> today's id ('medium' kept as is). Pure. */
export const migrateScale = v => (v === 'xlarge' ? 'large' : SCALES.some(([id]) => id === v) || v in LEGACY_SCALES ? v : 'compact');
export function loadScale() {
  try { const v = localStorage.getItem(SCALE_KEY); if (v != null) return migrateScale(v); } catch { /* ignore */ }
  return 'compact';
}
export function applyScale(id) {
  const v = migrateScale(id), z = scaleFactor(v);
  if (typeof document !== 'undefined') {
    const de = document.documentElement; de.dataset.uiscale = v; de.style.setProperty('--z', String(z));
    try { window.dispatchEvent(new CustomEvent('wavwiz:uiscale', { detail: { id: v, zoom: z } })); window.dispatchEvent(new Event('resize')); } catch { /* old browser */ }
  }
  try { localStorage.setItem(SCALE_KEY, v); } catch { /* ignore */ }
  return v;
}
if (typeof document !== 'undefined') applyScale(loadScale());

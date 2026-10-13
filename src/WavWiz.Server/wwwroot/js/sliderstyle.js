// 0.3.3 G11 (revised): volume slider style - a per-device choice in Settings > Appearance > Display size.
// "Gradient" (default) is built from the active theme: primary -> secondary -> highlight (Pepecoin: its brand-kit colors only).
// "Flat" is the theme primary. Used by every volume bar: standard + expanded Devices, zones, master and the mini player.
export const SLIDER_KEY = 'wavwiz.sliderstyle';
export const SLIDER_STYLES = [['gradient', 'Gradient'], ['flat', 'Flat']];
export const normSlider = v => (v === 'flat' ? 'flat' : 'gradient');
export function loadSlider(store = globalThis.localStorage) { try { return normSlider(store?.getItem(SLIDER_KEY)); } catch { return 'gradient'; } }
export function applySlider(v, store = globalThis.localStorage) {
  const s = normSlider(v);
  try { store?.setItem(SLIDER_KEY, s); } catch { /* ignore */ }
  if (typeof document !== 'undefined') { document.documentElement.dataset.slider = s; try { window.dispatchEvent(new CustomEvent('wavwiz:slider', { detail: s })); } catch { /* old */ } }
  return s;
}
/** CSS track background for a style (pure; the variables come from the theme). */
export const sliderTrack = s => (normSlider(s) === 'flat' ? 'var(--accent)' : 'linear-gradient(90deg,var(--accent),var(--accent2),var(--hl,var(--accent2)))');
if (typeof document !== 'undefined') { document.documentElement.dataset.slider = loadSlider(); window.addEventListener?.('storage', ev => { if (ev.key === SLIDER_KEY) document.documentElement.dataset.slider = loadSlider(); }); }

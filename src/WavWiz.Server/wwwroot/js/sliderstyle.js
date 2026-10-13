// 0.3.3 G11 (revised): volume slider style - a per-device choice in Settings > Appearance > Display size.
// "Gradient" (default) is the v0.3.2 two-color gradient: theme primary -> secondary (0.3.4 H3: no third color; Pepecoin: brand-kit colors only).
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
export const sliderTrack = s => (normSlider(s) === 'flat' ? 'var(--accent)' : 'linear-gradient(90deg,var(--accent),var(--accent2))');
if (typeof document !== 'undefined') { document.documentElement.dataset.slider = loadSlider(); window.addEventListener?.('storage', ev => { if (ev.key === SLIDER_KEY) document.documentElement.dataset.slider = loadSlider(); }); }

/** 0.3.4 H3: fill fraction for a range input (pure). */
export const fillPct = el => { const lo = +el.min || 0, hi = el.max === '' || el.max == null ? 100 : +el.max, v = +el.value; return hi > lo ? Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100)) : 0; };
export const VOL_SEL = ':is(.dvol,.mp-vol,.np-volrow,.dmaster) input[type=range]';
/** Keeps --v on every volume bar in step with its value: on input right away, and a cheap 4 Hz sweep for values set by code (server updates). */
export function syncFills(root = document) { for (const el of root.querySelectorAll(VOL_SEL)) { const v = fillPct(el).toFixed(1) + '%'; if (el.style.getPropertyValue('--v') !== v) el.style.setProperty('--v', v); } }
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('input', ev => { const t = ev.target; if (t?.matches?.(VOL_SEL)) t.style.setProperty('--v', fillPct(t).toFixed(1) + '%'); }, true);
  const one = el => { if (el?.matches?.(VOL_SEL)) { const v = fillPct(el).toFixed(1) + '%'; if (el.style.getPropertyValue('--v') !== v) el.style.setProperty('--v', v); } };
  // values set by code (server pushes, re-renders): hook the value property of range inputs, catch new bars as they are added, plus a slow safety sweep
  try {
    const P = globalThis.HTMLInputElement?.prototype, d = P && Object.getOwnPropertyDescriptor(P, 'value');
    if (d?.set && !P.__wwFill) { P.__wwFill = 1; Object.defineProperty(P, 'value', { ...d, set(v) { d.set.call(this, v); if (this.type === 'range') one(this); } }); }
  } catch { /* locked-down prototype */ }
  try { new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { one(n); if (n.firstElementChild) syncFills(n); } }).observe(document.documentElement, { childList: true, subtree: true }); } catch { /* old */ }
  try { setInterval(() => syncFills(), 500); } catch { /* no timers */ }
}

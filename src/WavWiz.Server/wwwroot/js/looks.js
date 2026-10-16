// WavWiz 0.3.1 B18 (approved render viz-controls-icons): the center panel's overlay controls - one group of 28x28 icon buttons in the
// stage's top-right corner, muted Lock EQ style, theme variables only - and the Looks popover (Glow / Intensity / Overlay opacity / Speed /
// Button transparency). Values are shared with Settings and saved per device (localStorage). All 0-100 %, default 50 %.
import { loadEqPrefs, saveEqPrefs } from './eqstyle.js';
import { loadSettings, saveSettings } from './vizcore.js';

export const LOOKS_KEY = 'wavwiz.looks.v1';
export const LOOKS_DEFAULT = Object.freeze({ btn: 50, overlay: 50 });
const pct = (v, d = 50) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : d; };
export function loadLooks(store = globalThis.localStorage) {
  let r = {}; try { r = JSON.parse(store?.getItem(LOOKS_KEY) || '{}') || {}; } catch { r = {}; }
  return { btn: pct(r.btn, LOOKS_DEFAULT.btn), overlay: pct(r.overlay, LOOKS_DEFAULT.overlay) };
}
export function saveLooks(p, store = globalThis.localStorage) {
  const c = { btn: pct(p?.btn), overlay: pct(p?.overlay) };
  try { store?.setItem(LOOKS_KEY, JSON.stringify(c)); } catch { /* private mode */ }
  try { globalThis.dispatchEvent?.(new CustomEvent('wavwiz:looks', { detail: c })); } catch { /* node */ }
  return c;
}
/** Resting opacity of the button group for a "Button transparency" value (0 % = solid, 100 % = see-through); hover/focus is always solid. */
export const btnOpacity = t => +(1 - pct(t) / 100).toFixed(2);
/** Wheel / arrow step: ±1, Shift ±10 (clamped 0..100). */
export const stepPct = (v, dir, shift) => pct(pct(v) + (shift ? 10 : 1) * (dir > 0 ? 1 : -1));

/** Which buttons the group shows, left to right (B18). No visualizer-style button: the style is chosen in Settings. */
export function overlayButtons(mode, { popout = true } = {}) {
  // 0.3.6 K12: the group is right-anchored; Pop out and Power go on the LEFT so lock / swap / looks / full keep the exact same x in both modes
  // 0.3.8 L35: in EQ mode the title-bar padlock is the only lock (no overlay lock); the visualizer keeps its own lock
  return mode === 'viz' ? [...(popout ? ['popout'] : []), 'power', 'lock', 'swap', 'looks', 'full'] : ['swap', 'looks', 'full'];
}
/** The Looks popover rows for a mode: [key, label]. */
export function looksRows(mode) {
  return mode === 'viz'
    ? [['intensity', 'Intensity'], ['overlay', 'Overlay opacity'], ['speed', 'Speed'], ['btn', 'Button transparency']]
    : [['glow', 'Glow'], ['overlay', 'Overlay opacity'], ['btn', 'Button transparency']];
}
/** Read / write one Looks value; engine = the current visualizer (Intensity and Speed belong to that look, as in Settings). */
export function getLook(key, engine) {
  if (key === 'glow') return loadEqPrefs().glow;
  if (key === 'intensity' || key === 'speed') return loadSettings(engine)[key];
  return loadLooks()[key];
}
export function setLook(key, v, engine) {
  v = pct(v);
  if (key === 'glow') { saveEqPrefs({ ...loadEqPrefs(), glow: v }); try { dispatchEvent(new CustomEvent('wavwiz:eqglow', { detail: v })); } catch { /* node */ } }
  else if (key === 'intensity' || key === 'speed') { const s = loadSettings(engine); s[key] = v; saveSettings(engine, s); try { dispatchEvent(new CustomEvent('wavwiz:vizsettings')); } catch { /* node */ } }
  else saveLooks({ ...loadLooks(), [key]: v });
  return v;
}
/** Footer "Reset": every row of this mode back to 50 %. */
export function resetLooks(mode, engine) { for (const [k] of looksRows(mode)) setLook(k, 50, engine); }

// One icon set (24 grid, 1.75 stroke, round caps) for the group - matches the render.
export const OV_ICONS = {
  lock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  looks: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  power: '<path d="M12 4v8"/><path d="M7 7a7 7 0 1 0 10 0"/>',
  popout: '<path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};
export const ovSvg = n => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${OV_ICONS[n] || ''}</svg>`;

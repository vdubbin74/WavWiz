// 0.2.0 item 8: four Now Playing control panel styles + panel effect sliders, saved per browser.
// Pure module (no DOM helpers at import time) so node tests can load it.
export const NP_STYLES = [
  ['classic', 'Classic', 'Progress ring around the cover, time in a small pill, round buttons'],
  ['center', 'Center', 'Record slides out of the sleeve, waveform seek, soft buttons'],
  ['stack', 'Stack', 'LCD clock and LED-block seek, rounded-square buttons'],
  ['horizon', 'Horizon', 'Cover glow and reflection, seek line from the cover edge, ring buttons'],
];
export const NP_EFFECTS = [['glow', 'Glow'], ['motion', 'Motion'], ['reflect', 'Reflection']];
export const NP_KEY = 'wavwiz.npstyle.v1';
export const NP_DEFAULT = Object.freeze({ style: 'classic', fx: 50, glow: 50, motion: 50, reflect: 50 });
const pct = (v, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : d; };

export function normNpPrefs(p) {
  p = p && typeof p === 'object' ? p : {};
  const out = { style: NP_STYLES.some(([id]) => id === p.style) ? p.style : NP_DEFAULT.style, fx: pct(p.fx, NP_DEFAULT.fx) };
  for (const [k] of NP_EFFECTS) out[k] = pct(p[k], NP_DEFAULT[k]);
  return out;
}
export function loadNpPrefs(store = globalThis.localStorage) {
  try { return normNpPrefs(JSON.parse(store?.getItem(NP_KEY) || 'null')); } catch { return normNpPrefs(null); }
}
export function saveNpPrefs(p, store = globalThis.localStorage) {
  const n = normNpPrefs(p);
  try { store?.setItem(NP_KEY, JSON.stringify(n)); } catch { /* private mode */ }
  try { globalThis.dispatchEvent?.(new Event('wavwiz:npstyle')); } catch { /* node */ }
  return n;
}
/** Effective strength 0..1 of one effect: its own slider times the Panel effects master (50 % master = as set, 100 % = double, 0 = off). */
export const effectLevel = (p, k) => Math.min(1, (pct(p[k], 50) / 100) * (pct(p.fx, 50) / 50));
/** CSS variables for the panel: --fx-glow, --fx-motion, --fx-reflect (0..1). */
export function npVars(p) { const n = normNpPrefs(p), o = {}; for (const [k] of NP_EFFECTS) o['--fx-' + k] = effectLevel(n, k).toFixed(3); return o; }
/** Deterministic waveform bar heights (0.2..1) for the Center style, seeded by the song so it doesn't jump between redraws. */
export function waveBars(seed, n = 72) {
  let x = 2166136261 >>> 0; for (const ch of String(seed ?? '')) x = Math.imul(x ^ ch.charCodeAt(0), 16777619) >>> 0;
  const out = []; for (let i = 0; i < n; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; const env = 0.55 + 0.45 * Math.sin(i / n * Math.PI); out.push(+(0.2 + 0.8 * env * ((x >>> 8) / 16777216)).toFixed(3)); }
  return out;
}
/** Seek fraction from a pointer angle around the cover (Classic ring): 0 at 12 o'clock, clockwise. */
export function ringFrac(cx, cy, x, y) { let a = Math.atan2(x - cx, cy - y); if (a < 0) a += 2 * Math.PI; return a / (2 * Math.PI); }

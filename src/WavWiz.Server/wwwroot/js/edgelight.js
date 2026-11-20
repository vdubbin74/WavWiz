// WavWiz 0.7.1 t2055u: Settings > Appearance > Zone edge light - how the left-edge trim of a playing zone card lights up (Devices).
// A per-device choice like Slider style: saved in localStorage, applied live as html[data-edgelight] (app.css does the rest), followed
// across tabs. prefers-reduced-motion always gets a static lit edge (CSS). The trim is the drag grip whatever the style.
export const EDGE_KEY = 'wavwiz.edgelight';
export const EDGE_STYLES = [
  ['wave', 'Waveform', 'Two woven waves in your theme colors flow down a playing zone’s edge'],
  ['pipe', 'Light pipe', 'One light travels down the edge'],
  ['comet', 'Clean comet', 'A crisp, quick comet with a short tail'],
  ['pulse', 'Pulse', 'The edge kicks bright on a beat with a comet'],
  ['dual', 'Dual streak', 'Two streaks and a soft shimmer'],
  ['off', 'Off', 'A lit edge, no motion'],
];
export const DEFAULT_EDGE = 'wave';
export const normEdge = v => (EDGE_STYLES.some(([id]) => id === v) ? v : DEFAULT_EDGE);
export function loadEdge(store = globalThis.localStorage) { try { return normEdge(store?.getItem(EDGE_KEY)); } catch { return DEFAULT_EDGE; } }
export function applyEdge(v, store = globalThis.localStorage) {
  const s = normEdge(v);
  try { store?.setItem(EDGE_KEY, s); } catch { /* private mode */ }
  if (typeof document !== 'undefined') { document.documentElement.dataset.edgelight = s; try { window.dispatchEvent(new CustomEvent('wavwiz:edgelight', { detail: s })); } catch { /* old */ } }
  return s;
}
if (typeof document !== 'undefined' && document.documentElement) {
  document.documentElement.dataset.edgelight = loadEdge();
  globalThis.addEventListener?.('storage', ev => { if (ev.key === EDGE_KEY || ev.key == null) document.documentElement.dataset.edgelight = loadEdge(); });
}

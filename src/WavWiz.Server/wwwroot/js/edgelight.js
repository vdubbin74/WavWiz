// WavWiz 0.7.1 t2055u (0.7.2 t2143u: Heartbeat / Heartthrob / Gradient replace Clean comet / Pulse / Dual streak): Settings > Appearance > Zone edge light - how the left-edge trim of a playing zone card lights up (Devices).
// A per-device choice like Slider style: saved in localStorage, applied live as html[data-edgelight] (app.css does the rest), followed
// across tabs. prefers-reduced-motion always gets a static lit edge (CSS). The trim is the drag grip whatever the style.
export const EDGE_KEY = 'wavwiz.edgelight';
export const EDGE_STYLES = [
  ['wave', 'Waveform', 'Two glowing waves in your theme colors take turns and weave down a playing zone’s edge'],
  ['pipe', 'Light pipe', 'One light travels down the edge'],
  ['heartbeat', 'Heartbeat', 'A subtle lub-dub: two quick swells of the glow, then rest'],
  ['heartthrob', 'Heartthrob', 'A slow, gentle throb, like breathing'],
  ['gradient', 'Gradient', 'The whole edge fades smoothly through your theme colors'],
  ['off', 'Off', 'A lit edge, no motion'],
];
export const DEFAULT_EDGE = 'wave';
/** 0.7.2 (t2143u): the three styles they replaced - a saved old choice becomes its new counterpart (and is saved that way). */
export const EDGE_MIGRATE = { comet: 'heartbeat', pulse: 'heartthrob', dual: 'gradient' };
export const normEdge = v => { v = EDGE_MIGRATE[v] || v; return EDGE_STYLES.some(([id]) => id === v) ? v : DEFAULT_EDGE; };
export function loadEdge(store = globalThis.localStorage) {
  try { const raw = store?.getItem(EDGE_KEY), v = normEdge(raw); if (raw && EDGE_MIGRATE[raw]) { try { store.setItem(EDGE_KEY, v); } catch { /* private mode */ } } return v; } catch { return DEFAULT_EDGE; }
}
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

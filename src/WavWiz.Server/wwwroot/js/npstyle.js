// 0.2.0 item 8: four Now Playing control panel styles + panel effect sliders, saved per browser.
// Pure module (no DOM helpers at import time) so node tests can load it.
// 0.5.0 F95: the four locked packages (Classic / Center / Stack / Horizon) are gone; Now Playing mixes three independent axes instead.
/** Track bar (seek) looks: [id, name, tip]. */
export const NP_SEEKS = [
  ['line', 'Classic line', 'Thin bar with a fill and a round knob'],
  ['wave', 'Center wave', 'Waveform of the song; the played part lights up'],
  ['led', 'LED stack', 'Segmented LED blocks'],
  ['eq', 'EQ bars', 'Even-width EQ-style bars; the played part lights up'],
];
/** Transport button looks: [id, name, tip]. */
export const NP_BUTTONS = [
  ['round', 'Round', 'Filled circles, glowing Play'],
  ['soft', 'Soft', 'Soft filled circles, no hard borders'],
  ['square', 'Square', 'Rounded squares'],
  ['ring', 'Ring outline', 'Outline rings, filled Play'],
];
/** 0.5.0 F96: Album art looks: [id, name, tip]. Each has one unique feature. */
export const NP_ARTS = [
  ['square', 'Square', 'Outline follows track time.'],
  ['disc', 'Disc', 'Spins while playing.'],
  ['sleeve', 'Jacket', 'Vinyl slides out of the jacket with progress.'],
  ['cassette', 'Tape', 'Matte tape · wheels spin, tape winds across.'],   // 0.5.0 F97
];
/** Old package id -> { seek, buttons } (F95 migration). */
export const NP_LEGACY = Object.freeze({ classic: ['line', 'round'], center: ['wave', 'soft'], stack: ['led', 'square'], horizon: ['line', 'ring'] });
export const NP_EFFECTS = [['glow', 'Glow'], ['motion', 'Motion'], ['reflect', 'Reflection']];
export const NP_KEY = 'wavwiz.npstyle.v1';
/** 0.5.0 F94: Now Playing Color intensity, how hard the stage + play glow lean into the active theme accent. Default spicy. */
export const NP_COLORS = [['subtle', 'Subtle'], ['spicy', 'Spicy'], ['max', 'Max']];
export const NP_DEFAULT = Object.freeze({ seek: 'line', buttons: 'square', art: 'square', fx: 50, glow: 50, motion: 50, reflect: 50, color: 'spicy' });
export const normNpColor = c => NP_COLORS.some(([id]) => id === c) ? c : NP_DEFAULT.color;
const pct = (v, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : d; };

export function normNpPrefs(p) {
  p = p && typeof p === 'object' ? p : {};
  const leg = NP_LEGACY[p.style] || [NP_DEFAULT.seek, NP_DEFAULT.buttons];   // F95: migrate an old `style`; it is not written back. F157b: unset -> app default (Square buttons); saved choices kept
  const pick = (list, v, d) => list.some(([id]) => id === v) ? v : d;
  const out = { seek: pick(NP_SEEKS, p.seek, leg[0]), buttons: pick(NP_BUTTONS, p.buttons, leg[1]), art: pick(NP_ARTS, p.art, NP_DEFAULT.art), fx: pct(p.fx, NP_DEFAULT.fx), color: normNpColor(p.color) };
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
/** F95: panel classes for a prefs object - one pn-seek-<id> and one pn-btn-<id>. */
export const npClasses = p => { const n = normNpPrefs(p); return ['pn-seek-' + n.seek, 'pn-btn-' + n.buttons, 'pn-art-' + n.art]; };   // F96: + pn-art-<square|disc|sleeve>
/** F95: put the seek + buttons classes (and data-seek / data-buttons) on an element, clearing any other seek/button/legacy package class. */
export function applyNpClasses(el, p) {
  if (!el?.classList) return; const n = normNpPrefs(p), want = npClasses(n);
  for (const c of [...el.classList]) if (/^pn-(seek|btn|art)-|^pn-(classic|center|stack|horizon)$/.test(c) && !want.includes(c)) el.classList.remove(c);
  el.classList.add(...want); if (el.dataset) { el.dataset.seek = n.seek; el.dataset.buttons = n.buttons; el.dataset.art = n.art; delete el.dataset.style; }
}
/** F95: deterministic EQ-bar heights (0.25..1) for the EQ seek - a smooth band shape, seeded by the song. */
export function eqBars(seed, n = 20) {
  const w = waveBars('eq:' + (seed ?? ''), n);
  return w.map((v, i) => +Math.min(1, Math.max(0.25, 0.35 + 0.65 * (0.7 * v + 0.3 * (0.5 + 0.5 * Math.sin(i * 1.7))))).toFixed(3));
}
/** Seek fraction from a pointer angle around the cover (Classic ring): 0 at 12 o'clock, clockwise. */
export function ringFrac(cx, cy, x, y) { let a = Math.atan2(x - cx, cy - y); if (a < 0) a += 2 * Math.PI; return a / (2 * Math.PI); }
/** F94: put the intensity on <html data-npcolor> so every stage (Now Playing, mini player, previews, phone remote) follows it; the CSS
 *  derives the wash and play glow from the live theme vars, so a Theme change recolors without re-applying. */
export function applyNpColor(p, root = globalThis.document?.documentElement) {
  const c = normNpColor(p?.color); if (root?.dataset) root.dataset.npcolor = c; return c;
}

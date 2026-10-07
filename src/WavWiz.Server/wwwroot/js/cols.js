// Pure helpers for the playlist table's resizable columns (unit-tested with node).
export const MIN_COL = 44;
export const DEFAULT_FRACS = [0.05, 0.30, 0.21, 0.21, 0.13, 0.10];     // #, title, artist, album, genre, time
export const COL_KEY = 'wavwiz.cols.v1';

/** Drag the divider right of column i by dx px: column i grows/shrinks and column i+1 gives/takes the same, so the total never changes. Both stay >= min. */
export function resizeCol(widths, i, dx, min = MIN_COL) {
  const w = widths.slice(); if (i < 0 || i >= w.length - 1) return w;
  const lo = min - w[i], hi = w[i + 1] - min;                 // allowed range of dx
  const d = Math.max(lo, Math.min(hi, dx)); if (!(hi >= lo)) return w;
  w[i] += d; w[i + 1] -= d; return w;
}
/** Fractions -> pixel widths that add up to exactly `total` (each >= min when there is room). */
export function fitWidths(total, fracs = DEFAULT_FRACS, min = MIN_COL) {
  const sum = fracs.reduce((a, b) => a + b, 0) || 1; let w = fracs.map(f => Math.max(min, Math.floor(total * f / sum)));
  let over = w.reduce((a, b) => a + b, 0) - total;
  for (let i = 1; over !== 0 && i < 200; i++) { const k = i % w.length; if (over > 0 && w[k] > min) { w[k]--; over--; } else if (over < 0) { w[k]++; over++; } }
  return w;
}
export const toFracs = widths => { const t = widths.reduce((a, b) => a + b, 0) || 1; return widths.map(x => x / t); };
export function loadFracs(store = globalThis.localStorage) {
  try { const v = JSON.parse(store.getItem(COL_KEY) || 'null'); if (Array.isArray(v) && v.length === DEFAULT_FRACS.length && v.every(x => typeof x === 'number' && x > 0 && x < 1)) return v; } catch { /* ignore */ }
  return DEFAULT_FRACS.slice();
}
export function saveFracs(f, store = globalThis.localStorage) { try { store.setItem(COL_KEY, JSON.stringify(f)); } catch { /* ignore */ } }

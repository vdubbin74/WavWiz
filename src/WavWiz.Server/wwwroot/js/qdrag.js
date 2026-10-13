// 0.3.3 G12: pure helpers for playlist drag and drop (reorder with multi-select, insertion index, undo). No DOM.
/** The order after moving the selected positions (any order) to insertion point t (0..n, "before row t"). Returns an array of old indices. */
export function reorder(n, selected, t) {
  const sel = [...new Set(selected)].filter(i => i >= 0 && i < n).sort((a, b) => a - b);
  const rest = []; for (let i = 0; i < n; i++) if (!sel.includes(i)) rest.push(i);
  const p = Math.max(0, Math.min(rest.length, t - sel.filter(i => i < t).length));
  return [...rest.slice(0, p), ...sel, ...rest.slice(p)];
}
/** Sequential server moves ({from, to}: remove at from, insert at to) that turn `cur` (array of ids) into `target`. */
export function movesFor(cur, target) {
  const w = cur.slice(), out = [];
  for (let k = 0; k < target.length; k++) { const at = w.indexOf(target[k]); if (at !== k && at >= 0) { w.splice(at, 1); w.splice(k, 0, target[k]); out.push({ from: at, to: k }); } }
  return out;
}
/** Moves that undo a reorder: from the new order back to 0..n-1. */
export const undoMoves = order => movesFor(order, order.slice().sort((a, b) => a - b));
/** Insertion index for a pointer at y over row boxes [{top, bottom}] (before the row whose middle is below y). */
export function dropIndex(rows, y) { for (let i = 0; i < rows.length; i++) if (y < (rows[i].top + rows[i].bottom) / 2) return i; return rows.length; }
/** Auto-scroll speed (px per frame) near the top / bottom edge of a box. */
export function edgeScroll(y, top, bottom, zone = 36, max = 14) { if (y < top + zone) return -Math.ceil(max * (1 - (y - top) / zone)); if (y > bottom - zone) return Math.ceil(max * (1 - (bottom - y) / zone)); return 0; }
/** Selection after a click: plain = just this one, Ctrl/Cmd = toggle, Shift = range from the anchor. */
export function nextSelection(sel, i, { ctrl = false, shift = false } = {}, anchor = null) {
  if (shift && anchor != null) { const a = Math.min(anchor, i), b = Math.max(anchor, i); const r = []; for (let k = a; k <= b; k++) r.push(k); return r; }
  if (ctrl) return sel.includes(i) ? sel.filter(x => x !== i) : [...sel, i];
  return [i];
}

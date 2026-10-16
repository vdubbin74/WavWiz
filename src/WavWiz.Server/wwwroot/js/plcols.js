// WavWiz 0.3.6 K10: playlist column layout (pure, unit-tested with node): which columns show, their order and widths, the lock, and click-to-sort.
import { MIN_COL, NUM_MIN } from './cols.js';
export const PL_KEY = 'wavwiz.plcols.v2', PL_KEY_NARROW = 'wavwiz.plcols.narrow.v2';
/** id, header text, picker text, default fraction, kind (text | num | time), query field */
export const PL_COLS = [
  { id: 'num', head: '#', pick: '#', frac: 0.05, kind: 'num' },
  { id: 'title', head: 'TITLE', pick: 'Title', frac: 0.30, kind: 'text', f: 'title' },
  { id: 'artist', head: 'ARTIST', pick: 'Artist', frac: 0.21, kind: 'text', f: 'artist' },
  { id: 'album', head: 'ALBUM', pick: 'Album', frac: 0.21, kind: 'text', f: 'album' },
  { id: 'year', head: 'YEAR', pick: 'Year', frac: 0.07, kind: 'numf', f: 'year' },
  { id: 'genre', head: 'GENRE', pick: 'Genre', frac: 0.13, kind: 'text', f: 'genre' },
  { id: 'time', head: 'TIME', pick: 'Time', frac: 0.10, kind: 'time', f: 'durationMs' },
  { id: 'track', head: 'TRACK #', pick: 'Track #', frac: 0.07, kind: 'numf', f: 'trackNo' },
];
export const ALL_IDS = PL_COLS.map(c => c.id);
export const byId = id => PL_COLS.find(c => c.id === id);
/** Default look: the 0.3.5 columns (year and track # off). The narrow (side) playlist starts with fewer: # title artist time. */
export function defaultLayout(narrow = false) {
  return { order: ALL_IDS.slice(), hidden: narrow ? ['album', 'year', 'genre', 'track'] : ['year', 'track'], fracs: Object.fromEntries(PL_COLS.map(c => [c.id, c.frac])), locked: false };
}
export function normLayout(v, narrow = false) {
  const d = defaultLayout(narrow); if (!v || typeof v !== 'object') return d;
  const order = Array.isArray(v.order) ? v.order.filter((x, i, a) => ALL_IDS.includes(x) && a.indexOf(x) === i) : [];
  for (const id of ALL_IDS) if (!order.includes(id)) order.push(id);
  let hidden = Array.isArray(v.hidden) ? v.hidden.filter(x => ALL_IDS.includes(x)) : d.hidden;
  if (hidden.length >= ALL_IDS.length) hidden = d.hidden;           // never hide everything
  const fracs = { ...d.fracs }; if (v.fracs && typeof v.fracs === 'object') for (const id of ALL_IDS) { const f = v.fracs[id]; if (typeof f === 'number' && f > 0 && f < 1) fracs[id] = f; }
  return { order, hidden, fracs, locked: !!v.locked };
}
export function loadLayout(narrow = false, store = globalThis.localStorage) { try { return normLayout(JSON.parse(store.getItem(narrow ? PL_KEY_NARROW : PL_KEY) || 'null'), narrow); } catch { return defaultLayout(narrow); } }
export function saveLayout(l, narrow = false, store = globalThis.localStorage) { try { store.setItem(narrow ? PL_KEY_NARROW : PL_KEY, JSON.stringify(l)); } catch { /* private mode */ } return l; }
export const visible = l => l.order.filter(id => !l.hidden.includes(id));
/** Picker: toggle one column. Locked layouts do not change; the last visible column cannot be hidden. */
export function toggleCol(l, id) {
  if (l.locked || !ALL_IDS.includes(id)) return l;
  if (l.hidden.includes(id)) return { ...l, hidden: l.hidden.filter(x => x !== id) };
  if (visible(l).length <= 1) return l;
  return { ...l, hidden: [...l.hidden, id] };
}
export const resetLayout = (l, narrow = false) => (l.locked ? l : { ...defaultLayout(narrow), locked: l.locked });
export const setLocked = (l, on) => ({ ...l, locked: !!on });
/** Drag header `from` onto header `to` (ids): moves it into that slot among ALL columns (hidden ones keep their relative place). */
export function moveCol(l, from, to) {
  if (l.locked || from === to || !l.order.includes(from) || !l.order.includes(to)) return l;
  const o = l.order.filter(x => x !== from), i = o.indexOf(to), j = l.order.indexOf(from) < l.order.indexOf(to) ? i + 1 : i;
  o.splice(j, 0, from); return { ...l, order: o };
}
/** Pixel widths for the visible columns, adding up to exactly `total` (min widths kept). */
export function widthsFor(l, total) {
  const ids = visible(l), min = id => (id === 'num' ? NUM_MIN : MIN_COL), fr = ids.map(id => l.fracs[id] || 0.1), sum = fr.reduce((a, b) => a + b, 0) || 1;
  const w = fr.map((f, i) => Math.max(min(ids[i]), Math.floor(total * f / sum)));
  let over = w.reduce((a, b) => a + b, 0) - total;
  // Title takes the leftover space (K1); when over, shrink the widest non-number columns first
  const ti = ids.indexOf('title');
  if (over < 0) { const k = ti >= 0 ? ti : 0; w[k] += -over; over = 0; }
  for (let g = 0; over > 0 && g < 4000; g++) { let k = -1, best = -1; w.forEach((x, i) => { if (x - min(ids[i]) > 0 && x > best) { best = x; k = i; } }); if (k < 0) break; w[k]--; over--; }
  return { ids, w };
}
/** Drag the divider right of visible column index i by dx px (neighbors trade width). Returns the new widths. */
export function resizeAt(widths, ids, i, dx) {
  const w = widths.slice(); if (i < 0 || i >= w.length - 1) return w; const min = k => (ids[k] === 'num' ? NUM_MIN : MIN_COL);
  const lo = min(i) - w[i], hi = w[i + 1] - min(i + 1); if (!(hi >= lo)) return w; const d = Math.max(lo, Math.min(hi, dx)); w[i] += d; w[i + 1] -= d; return w;
}
export function fracsFromWidths(l, ids, widths) {
  const total = widths.reduce((a, b) => a + b, 0) || 1, keep = ids.reduce((a, id) => a + (l.fracs[id] || 0.1), 0), f = { ...l.fracs };
  ids.forEach((id, i) => { f[id] = Math.min(0.95, Math.max(0.01, (widths[i] / total) * keep)); }); return { ...l, fracs: f };
}
/** Sort state: click 1 ascending, click 2 descending, click 3 back to the playlist's own order. */
/** 0.3.7 L27: while the layout is locked the sort order is locked too: a click / option changes nothing. Unlocking gives it all back. */
export const sortAllowed = l => !l.locked;
export const applySort = (l, cur, id) => (sortAllowed(l) ? nextSort(cur, id) : cur);
export const CLEAR_LOCK_HINT = 'Locked - unlock the queue (padlock) to clear it';
/** 0.3.7 L30: text of the Sorted-by chip. */
export const sortChipText = (name, dir) => `Sorted by ${name} ${dir === 'desc' ? '▼' : '▲'}`;
export const SORT_LOCK_HINT = 'Sorting is locked while the queue is locked (click the padlock to unlock)';
export function nextSort(cur, id) { if (!cur || cur.id !== id) return { id, dir: 'asc' }; if (cur.dir === 'asc') return { id, dir: 'desc' }; return null; }
const keyOf = (c, q, i) => (c.id === 'num' ? i : c.kind === 'text' ? String(q[c.f] ?? '').toLocaleLowerCase() : Number(q[c.f] ?? -1));
/** Returns the ORIGINAL indexes in display order (stable). */
export function sortedIndexes(queue, sort) {
  const idx = queue.map((_, i) => i); if (!sort) return idx; const c = byId(sort.id); if (!c) return idx; const s = sort.dir === 'desc' ? -1 : 1;
  return idx.sort((a, b) => { const x = keyOf(c, queue[a], a), y = keyOf(c, queue[b], b); const r = typeof x === 'string' ? x.localeCompare(y) : x - y; return r * s || a - b; });
}

// 0.2.0 items 13-16: Library sorting on every tab, A-Z / Z-A flip, letter strip, grid/list and the Expanded view - all remembered per browser.
// Pure module (no DOM) so node tests can load it.
export const SORTS = {
  artists: [['name', 'Name'], ['albums', 'Most albums'], ['songs', 'Most songs'], ['recent', 'Recently added']],
  albums: [['artist', 'Artist'], ['name', 'Album name'], ['year', 'Year (newest)'], ['oldest', 'Oldest first'], ['longest', 'Longest'], ['recent', 'Recently added'], ['shuffle', 'Shuffle']],
  genres: [['name', 'Name'], ['count', 'Song count']],
  years: [['name', 'Year'], ['count', 'Song count']],
  recent: [['recent', 'Recently added'], ['artist', 'Artist'], ['name', 'Album name'], ['year', 'Year (newest)']],
  folders: [['name', 'Name'], ['count', 'Song count']],
  favorites: [['recent', 'Recently hearted'], ['name', 'Name']],
  songs: [['track', 'Track no.'], ['title', 'Title'], ['length', 'Length'], ['added', 'Date added']],
};
export const DEFAULT_SORT = { artists: 'name', albums: 'artist', genres: 'name', years: 'name', recent: 'recent', folders: 'name', favorites: 'recent', songs: 'track' };
export const LIB_KEY = 'wavwiz.libprefs.v1';
const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
export const cmpName = (a, b) => coll.compare(String(a ?? ''), String(b ?? ''));

// 0.2.1 F4 + F8: the Expanded Library opens in tiles on every tab (Large tiles by default). Settings > Library > Library view sets the default
// view, the tile size, the default album sort and whether a tab remembers its own Tiles/List choice. All per browser (this device).
export const VIEW_TABS = ['artists', 'albums', 'genres', 'years', 'recent', 'folders', 'favorites'];
export const TILE_SIZES = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']];
export const DEF_SORTS = [['artist', 'Artist A–Z'], ['name', 'Album A–Z'], ['recent', 'Recently added'], ['year', 'Year']];
export const LIB_VIEW_DEFAULTS = Object.freeze({ defView: 'grid', tileSize: 'large', defSort: 'artist', remember: true });
export function loadLibPrefs(store = globalThis.localStorage) {
  let p = null; try { p = JSON.parse(store?.getItem(LIB_KEY) || 'null'); } catch { /* corrupt */ }
  p = p && typeof p === 'object' ? p : {};
  const D = LIB_VIEW_DEFAULTS;
  const defView = p.defView === 'list' ? 'list' : D.defView, tileSize = TILE_SIZES.some(([v]) => v === p.tileSize) ? p.tileSize : D.tileSize;
  const defSort = DEF_SORTS.some(([v]) => v === p.defSort) ? p.defSort : D.defSort, remember = p.remember !== false;
  const sort = {}, flip = {}, views = {};
  for (const k of Object.keys(SORTS)) { sort[k] = SORTS[k].some(([v]) => v === p.sort?.[k]) ? p.sort[k] : (k === 'albums' ? defSort : DEFAULT_SORT[k]); flip[k] = p.flip?.[k] === true; }
  for (const k of VIEW_TABS) if (p.views?.[k] === 'grid' || p.views?.[k] === 'list') views[k] = p.views[k];
  // compactView = the narrow left panel's own album grid/list choice (0.2.0's single "view" carries over there)
  const compactView = p.compactView === 'grid' || p.compactView === 'list' ? p.compactView : p.view === 'grid' ? 'grid' : 'list';
  return { sort, flip, views, defView, tileSize, defSort, remember, compactView, expanded: p.expanded === true };
}
export function saveLibPrefs(p, store = globalThis.localStorage) {
  const { view, ...rest } = p || {};   // the 0.2.0 global "view" is gone (now compactView + per-tab views)
  try { store?.setItem(LIB_KEY, JSON.stringify(rest)); } catch { /* private mode */ } void view; return p;
}
/** The Expanded view (grid = tiles, list) of a tab: a session pick, else the tab's remembered pick (when Remember is on), else the default. */
export function tabView(p, kind, session = {}) {
  if (!VIEW_TABS.includes(kind)) return 'list';
  return session[kind] || (p.remember && p.views?.[kind]) || p.defView;
}
/** Settings > Library > Library view: Reset to defaults (keeps sort / flip per tab, forgets remembered views). */
export function resetLibView(p) { return { ...p, ...LIB_VIEW_DEFAULTS, views: {}, sort: { ...p.sort, albums: LIB_VIEW_DEFAULTS.defSort } }; }
/** The name a row is listed (and lettered) by for a sort. */
export function rowName(kind, row, key) {
  if (kind === 'songs') return row.title;
  if (kind === 'artists') return row.name;
  if (kind === 'albums' || kind === 'recent' || (kind === 'favorites' && row.album != null && row.title == null)) return key === 'artist' ? (row.artist ?? row.albumArtist) : row.album;
  return row.name ?? row.title ?? row.album;
}
const num = v => (v == null || v === '' ? -Infinity : Number(v));
/** Sorted copy of rows. Name sorts are A-Z; numeric sorts put the biggest / newest first; flip reverses. shuffle is seeded so redraws keep the order. */
export function sortRows(kind, rows, key, flip = false, seed = 1) {
  const r = rows.slice(); const by = f => r.sort(f);
  const name = (a, b) => cmpName(rowName(kind, a, key), rowName(kind, b, key));
  switch (kind === 'favorites' ? (key === 'name' ? 'name' : 'keep') : key) {
    case 'keep': break;
    case 'name': case 'title': kind === 'years' ? by((a, b) => num(b.name) - num(a.name)) : by(name); break;
    case 'artist': by((a, b) => cmpName(a.artist, b.artist) || num(a.year) - num(b.year) || cmpName(a.album, b.album)); break;
    case 'albums': by((a, b) => b.albums - a.albums || name(a, b)); break;
    case 'songs': case 'count': by((a, b) => b.tracks - a.tracks || name(a, b)); break;
    case 'recent': by((a, b) => String(b.addedAt ?? '').localeCompare(String(a.addedAt ?? '')) || name(a, b)); break;
    case 'year': by((a, b) => num(b.year) - num(a.year) || name(a, b)); break;
    case 'oldest': by((a, b) => (a.year ?? 1e9) - (b.year ?? 1e9) || name(a, b)); break;
    case 'longest': by((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0) || name(a, b)); break;
    case 'track': by((a, b) => (a.discNo ?? 0) - (b.discNo ?? 0) || (a.trackNo ?? 1e6) - (b.trackNo ?? 1e6) || name(a, b)); break;
    case 'length': by((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0) || name(a, b)); break;
    case 'added': by((a, b) => b.id - a.id); break;   // track ids grow as files are added
    case 'shuffle': { let x = (seed >>> 0) || 1; const rnd = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } break; }
  }
  return flip ? r.reverse() : r;
}
/** Sorts whose order follows the letters (the side A-Z strip only makes sense for these). */
export const isLetterSort = (kind, key) => kind !== 'years' && ['name', 'title', 'artist'].includes(key);
export function letterOf(s) { const c = String(s ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').charAt(0).toUpperCase(); return c >= 'A' && c <= 'Z' ? c : '#'; }
export const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
/** letter -> index of the first row with it (rows already sorted). */
export function letterIndex(kind, rows, key) { const m = new Map(); rows.forEach((row, i) => { const l = letterOf(rowName(kind, row, key)); if (!m.has(l)) m.set(l, i); }); return m; }

/** 0.2.1 F13: bold color pair for a genre / year block (deterministic from the name, so a genre keeps its color). Pure. */
export function blockColors(name) {
  let x = 2166136261 >>> 0; for (const ch of String(name ?? '')) x = Math.imul(x ^ ch.charCodeAt(0), 16777619) >>> 0;
  const hue = x % 360, h2 = (hue + 28 + (x >>> 9) % 30) % 360;
  return [`hsl(${hue} 68% 46%)`, `hsl(${h2} 72% 30%)`];
}

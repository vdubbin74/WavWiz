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

export function loadLibPrefs(store = globalThis.localStorage) {
  let p = null; try { p = JSON.parse(store?.getItem(LIB_KEY) || 'null'); } catch { /* corrupt */ }
  p = p && typeof p === 'object' ? p : {};
  const sort = {}, flip = {};
  for (const k of Object.keys(SORTS)) { sort[k] = SORTS[k].some(([v]) => v === p.sort?.[k]) ? p.sort[k] : DEFAULT_SORT[k]; flip[k] = p.flip?.[k] === true; }
  return { sort, flip, view: p.view === 'grid' ? 'grid' : 'list', expanded: p.expanded === true };
}
export function saveLibPrefs(p, store = globalThis.localStorage) { try { store?.setItem(LIB_KEY, JSON.stringify(p)); } catch { /* private mode */ } return p; }

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

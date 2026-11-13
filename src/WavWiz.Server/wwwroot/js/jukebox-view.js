// WavWiz 0.3.0 §1: grouped results (Artists (n) / Albums (n) / Songs (n)), used by the guest page and the kiosk's Search & add.
import { groupHead, artistLine, albumLine, albumName } from './jukebox-core.js';
/** Tiny DOM helper with no app imports, so the guest page stays small. */
export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'value') e.value = v; else e.setAttribute(k, v === true ? '' : v); }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
  return e;
}
export function renderResults(r, { songRow, onArtist, onAlbum }) {
  const head = (l, n) => el('h2', { class: 'jb-gh' }, groupHead(l, n));
  r = { artists: r?.artists || [], albums: r?.albums || [], songs: r?.songs || [] };
  const none = !r.artists.length && !r.albums.length && !r.songs.length;
  if (none) return el('p', { class: 'jb-dim' }, 'No matches. Try another word.');
  return el('section', { class: 'jb-res' },
    r.artists.length ? [head('Artists', r.artists.length), ...r.artists.map(a => el('button', { class: 'jb-row jb-link', onclick: () => onArtist(a) }, el('div', { class: 'jb-t' }, el('b', {}, a.name), el('small', {}, artistLine(a))), el('span', { 'aria-hidden': 'true' }, '›')))] : null,
    r.albums.length ? [head('Albums', r.albums.length), ...r.albums.map(a => el('button', { class: 'jb-row jb-link', 'aria-label': `Album ${albumName(a)} by ${a.artist}`, onclick: () => onAlbum({ ...a, album: albumName(a) }) }, el('div', { class: 'jb-t' }, el('b', {}, albumName(a)), el('small', {}, albumLine(a))), el('span', { 'aria-hidden': 'true' }, '›')))] : null,
    r.songs.length ? [head('Songs', r.songs.length), ...r.songs.map(songRow)] : null);
}
// ---- 0.6.9 J1/J2: Jukebox cover art without broken-image icons or flashing ----
/** Art URLs that came back empty (204 = no picture) or failed this page session: never requested again, the placeholder stays. */
export const artFailed = new Set();
/** Art URLs that loaded: the next paint shows them at once (no fade-in from the placeholder). */
export const artLoaded = new Set();
/** A cover box: the tidy WavWiz placeholder (accent gradient + waveform glyph) underneath, the picture on top only once it has really
 *  loaded. A 204 / error leaves the placeholder alone - no broken-image icon - and the URL is remembered so later paints never ask again.
 *  No url (radio, remote items) = the placeholder. */
export function artBox(url, cls = '') {
  const box = el('span', { class: 'jb-art ' + cls, 'data-art': url || '' });
  if (!url || artFailed.has(url)) return box;
  const img = el('img', { alt: '', decoding: 'async', draggable: 'false' });
  const ok = () => { if (!img.naturalWidth) { bad(); return; } artLoaded.add(url); box.classList.add('has'); };
  const bad = () => { artFailed.add(url); artLoaded.delete(url); img.remove(); box.classList.remove('has'); };
  img.addEventListener('load', ok); img.addEventListener('error', bad);
  if (artLoaded.has(url)) box.classList.add('has');
  img.src = url; box.append(img);
  return box;
}
/** Swaps the picture of an existing cover box only when the URL really changed (the big Now Playing cover is reused every second). */
export function setArt(box, url) {
  if ((box.dataset.art || '') === (url || '')) return box;
  const fresh = artBox(url, box.className.replace(/\bjb-art\b|\bhas\b/g, '').trim()); box.replaceWith(fresh); return fresh;
}
/** Paint signature of queue rows: unchanged rows = no DOM work (no img re-created, no re-request, no flash). */
export const rowsSig = (rows, extra = '') => extra + '\u0001' + (rows || []).map(x => [x.id ?? '', x.trackId ?? '', x.title ?? '', x.artist ?? '', x.by ?? '', x.mine ? 1 : 0].join('\u0002')).join('\u0003');

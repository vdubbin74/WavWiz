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

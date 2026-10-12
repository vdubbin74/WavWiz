// WavWiz 0.3.0 §1: guest phone page (/jukebox.html?j=<code>).
import { applyTheme, PRESETS } from './theme.js';
import { guestId, guestApi, groupHead, artistLine, albumLine, mineLine, NAME_KEY } from './jukebox-core.js';
import { renderResults, el } from './jukebox-view.js';

const code = new URLSearchParams(location.search).get('j') || '';
const gid = guestId();
const call = guestApi(code);
const app = document.getElementById('app');
let board = null, lastQ = '', results = null, list = null, msg = '';

const name = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
function ended(text) { app.replaceChildren(el('section', { class: 'jb-card' }, el('h1', {}, 'WavWiz Jukebox'), el('p', {}, text))); }

async function add(t, btn) {
  btn.disabled = true;
  try { await call('/add', { guest: gid, name: nameIn.value.trim(), trackId: t.id }); btn.textContent = '✓ In'; btn.classList.add('in'); msg = ''; await refresh(); }
  catch (e) { btn.disabled = false; flash(e.message); }
}
function flash(t) { msg = t; draw(); }
const nameIn = el('input', { class: 'jb-in', placeholder: 'Your name (shown on the big screen)', maxlength: '24', 'aria-label': 'Your name', value: name(), oninput: () => { try { localStorage.setItem(NAME_KEY, nameIn.value); } catch { /* ignore */ } } });
const searchIn = el('input', { class: 'jb-in jb-search', type: 'search', placeholder: 'Search songs, artists, albums', 'aria-label': 'Search', oninput: () => { clearTimeout(searchIn._t); searchIn._t = setTimeout(search, 250); } });

async function search() {
  const q = searchIn.value.trim(); lastQ = q; list = null;
  if (!q) { results = null; draw(); return; }
  try { const r = await call('/search?q=' + encodeURIComponent(q)); if (q === lastQ) { results = r; draw(); } } catch (e) { flash(e.message); }
}
async function open(kind, a) {
  try { const songs = kind === 'artist' ? await call('/artist?name=' + encodeURIComponent(a.name)) : await call(`/album?artist=${encodeURIComponent(a.artist)}&album=${encodeURIComponent(a.album)}`); list = { title: kind === 'artist' ? a.name : a.album, songs }; draw(); }
  catch (e) { flash(e.message); }
}
async function vote() {
  try { const r = await call('/vote', { guest: gid }); flash(r.skipped ? 'Skipped. Thanks!' : `Vote counted (${r.votes} of ${r.needed}).`); } catch (e) { flash(e.message); }
}

function draw() {
  const b = board; if (!b) return;
  const np = b.now ? el('div', { class: 'jb-np' }, b.now.trackId ? el('img', { src: `/api/v1/jukebox/guest/art/${b.now.trackId}?size=128&j=${encodeURIComponent(code)}`, alt: '' }) : el('div', { class: 'jb-art0' }), el('div', {}, el('b', {}, b.now.title), el('small', {}, 'Now playing' + (b.now.by ? ` · requested by ${b.now.by}` : '')))) : el('div', { class: 'jb-np' }, el('small', {}, 'Nothing playing yet. Add the first song!'));
  const body = list
    ? el('section', {}, el('button', { class: 'btn', onclick: () => { list = null; draw(); } }, '‹ Back'), el('h2', { class: 'jb-gh' }, list.title), ...list.songs.map(s => songRow(s)))
    : results ? renderResults(results, { songRow, onArtist: a => open('artist', a), onAlbum: a => open('album', a) }) : el('p', { class: 'jb-dim' }, 'Type to find a song. Every Add queues one song.');
  app.replaceChildren(
    el('h1', {}, 'WavWiz Jukebox'), np,
    b.locked ? el('p', { class: 'jb-note' }, 'The host has paused requests for now.') : null,
    nameIn, searchIn, msg ? el('p', { class: 'jb-note', role: 'status' }, msg) : null,
    body,
    el('div', { class: 'jb-foot' }, el('span', { class: 'jb-mine' }, mineLine(b, gid)), b.voteSkip && b.now ? el('button', { class: 'btn', onclick: vote }, `👎 Skip (${b.votes}/${b.votesNeeded})`) : null));
  if (document.activeElement !== searchIn && results == null && !list) { /* keep focus where the guest is */ }
}
function songRow(s) {
  const btn = el('button', { class: 'btn primary jb-add', onclick: () => add(s, btn), 'aria-label': `Add ${s.title}` }, 'Add');
  return el('div', { class: 'jb-row' }, el('div', { class: 'jb-t' }, el('b', {}, s.title), el('small', {}, s.artist)), btn);
}
async function refresh() {
  try {
    board = await call('/board');
    const t = board.theme || {}; applyTheme({ ...PRESETS.default, ...t, preset: 'custom' });
    document.body.classList.toggle('retro', board.style === 'retro');
    const keepFocus = document.activeElement; draw(); if (keepFocus && keepFocus.isConnected) keepFocus.focus();
  } catch (e) { if (e.status === 403) ended(e.message); }
}
if (!code) ended('Scan the QR code on the big screen to join.');
else { refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 5000); }
export { groupHead, artistLine, albumLine };

// WavWiz 0.3.0 §1: guest phone page (/jukebox.html?j=<code>).
// 0.3.4 H6/H7: the page is built ONCE (name + search inputs never leave the DOM); refreshes and new results only replace the slots
// around them, so typing a whole multi-word search keeps focus and the caret. H4: Modern or Retro CD (maroon) look, from the host's setting.
import { applyTheme, PRESETS } from './theme.js';
import { guestId, guestApi, groupHead, artistLine, albumLine, albumName, mineLine, minePicks, playsLine, playsLeft, NAME_KEY, selNo } from './jukebox-core.js';
import { renderResults, el } from './jukebox-view.js';

const code = new URLSearchParams(location.search).get('j') || '';
const gid = guestId();
const call = guestApi(code);
const app = document.getElementById('app');
let board = null, lastQ = '', results = null, list = null, msg = '', built = false, endedNow = false;
const added = new Set();   // track ids this phone added (button stays "✓ In" across redraws)
const retro = () => board?.style === 'retro';
const fmt = ms => { const s = Math.max(0, Math.floor((ms || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const art = id => `/api/v1/jukebox/guest/art/${id}?size=128&j=${encodeURIComponent(code)}`;

const name = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
function ended(text) { endedNow = true; app.replaceChildren(el('section', { class: 'jb-card' }, el('h1', {}, 'WavWiz Jukebox'), el('p', {}, text))); built = false; }

// ---- the fixed frame (built once) ----
const title = el('h1', { class: 'jbg-title' }, 'WavWiz Jukebox');
const npSlot = el('div', { class: 'jbg-npslot' }), noteSlot = el('div', { class: 'jbg-noteslot' }), msgSlot = el('div', { class: 'jbg-msgslot', role: 'status', 'aria-live': 'polite' });
const bodySlot = el('div', { class: 'jbg-body' }), foot = el('div', { class: 'jb-foot' });
const nameIn = el('input', { class: 'jb-in jb-name', placeholder: 'Your name (shown on the big screen)', maxlength: '24', 'aria-label': 'Your name', autocomplete: 'nickname', value: name(), oninput: () => { try { localStorage.setItem(NAME_KEY, nameIn.value); } catch { /* ignore */ } } });
const searchIn = el('input', { class: 'jb-in jb-search', type: 'search', placeholder: 'Search songs, artists, albums', 'aria-label': 'Search', autocomplete: 'off', enterkeyhint: 'search',
  oninput: () => { clearTimeout(searchIn._t); searchIn._t = setTimeout(search, 250); },
  onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchIn._t); search(); } } });
const searchBox = el('label', { class: 'jbg-sbox' }, el('span', { class: 'jbg-sico', 'aria-hidden': 'true' }), searchIn);
function build() { if (built) return; built = true; app.replaceChildren(title, npSlot, noteSlot, nameIn, searchBox, msgSlot, bodySlot, foot); }

async function add(t, btn) {
  btn.disabled = true;
  try { await call('/add', { guest: gid, name: nameIn.value.trim(), trackId: t.id }); added.add(t.id); markIn(btn); msg = ''; paintMsg(); if (board && Number.isFinite(board.playsLeft)) { board.playsLeft = Math.max(0, board.playsLeft - 1); paintNow(); } await refresh(); }
  catch (e) { btn.disabled = false; flash(e.message); }
}
const markIn = btn => { btn.disabled = true; btn.classList.add('in'); btn.replaceChildren(el('span', { class: 'jb-chk', 'aria-hidden': 'true' }, '✓'), retro() ? ' IN' : ' In'); btn.setAttribute('aria-label', 'Added'); };
function flash(t) { msg = t; paintMsg(); }
function paintMsg() { msgSlot.replaceChildren(msg ? el('p', { class: 'jb-note' }, msg) : ''); }

async function search() {
  const q = searchIn.value.trim(); lastQ = q; list = null;
  if (!q) { results = null; paintBody(); return; }
  try { const r = await call('/search?q=' + encodeURIComponent(q)); if (q === lastQ) { results = r; paintBody(); } } catch (e) { flash(e.message); }
}
async function open(kind, a) {
  try {
    const songs = kind === 'artist' ? await call('/artist?name=' + encodeURIComponent(a.name)) : await call(`/album?artist=${encodeURIComponent(a.artist)}&album=${encodeURIComponent(albumName(a))}`);
    list = { title: kind === 'artist' ? a.name : albumName(a), songs }; paintBody();
  } catch (e) { flash(e.message); }
}
async function vote() {
  try { const r = await call('/vote', { guest: gid }); flash(r.skipped ? 'Skipped. Thanks!' : `Vote counted (${r.votes} of ${r.needed}).`); } catch (e) { flash(e.message); }
}

function songRow(s, i = 0) {
  const btn = el('button', { class: 'btn primary jb-add', type: 'button', onclick: () => add(s, btn), 'aria-label': `Add ${s.title}` }, retro() ? 'ADD' : 'Add');
  if (added.has(s.id)) markIn(btn);
  if (retro()) return el('div', { class: 'jb-row jbr-strip' }, el('span', { class: 'jbr-code' }, 'C' + (i + 1)), el('div', { class: 'jb-t' }, el('b', {}, s.title), el('small', {}, s.artist)), btn);
  return el('div', { class: 'jb-row' }, el('img', { class: 'jb-thumb', src: art(s.id), alt: '', loading: 'lazy' }), el('div', { class: 'jb-t' }, el('b', {}, s.title), el('small', {}, s.artist)), btn);
}
function paintNow() {
  const b = board, n = b.now;
  if (retro()) {
    npSlot.replaceChildren(el('div', { class: 'jb-np jbr-np' }, el('div', { class: 'jbr-mini' + (n?.state === 'playing' ? ' spin' : '') }, n?.trackId ? el('img', { src: art(n.trackId), alt: '' }) : null),
      el('div', { class: 'jb-t' }, el('span', { class: 'jbr-kick' }, 'NOW PLAYING'), el('b', { class: 'jbr-script' }, n ? n.title : 'Add the first song')),
      n ? el('span', { class: 'jbr-vfd' }, fmt(n.positionMs)) : null));
  } else {
    npSlot.replaceChildren(n ? el('div', { class: 'jb-np' }, n.trackId ? el('img', { src: art(n.trackId), alt: '' }) : el('div', { class: 'jb-art0' }), el('div', { class: 'jb-t' }, el('b', {}, n.title), el('small', {}, 'Now playing' + (n.by ? ` · requested by ${n.by}` : ''))))
      : el('div', { class: 'jb-np' }, el('small', {}, 'Nothing playing yet. Add the first song!')));
  }
  noteSlot.replaceChildren(b.locked ? el('p', { class: 'jb-note' }, 'The host has paused requests for now.') : '');
  // 0.3.5 J18: "3 available plays" - counts down with each add, back up as each pick has played or is removed (server count, survives reloads)
  foot.replaceChildren(el('span', { class: 'jb-mine jb-plays', 'data-left': String(playsLeft(b, gid)) }, playsLine(b, gid)),
    b.voteSkip && b.now ? el('button', { class: 'btn', type: 'button', onclick: vote }, `👎 Skip (${b.votes}/${b.votesNeeded})`) : null);
}
function paintBody() {
  bodySlot.replaceChildren(list
    ? el('section', {}, el('button', { class: 'btn', type: 'button', onclick: () => { list = null; paintBody(); } }, '‹ Back'), el('h2', { class: 'jb-gh' }, list.title), ...list.songs.map((s, i) => songRow(s, i)))
    : results ? el('div', {}, retro() ? null : el('h2', { class: 'jb-gh jb-reshead' }, 'Results'), renderResults(results, { songRow, onArtist: a => open('artist', a), onAlbum: a => open('album', a) }))
      : el('p', { class: 'jb-dim' }, 'Type to find a song. Every Add queues one song.'));
}
let lastStyle = null;
async function refresh() {
  try {
    board = await call('/board?g=' + encodeURIComponent(gid));
    const t = board.theme || {}; applyTheme({ ...PRESETS.default, ...t, preset: 'custom' });
    document.body.classList.toggle('retro', retro());
    if (endedNow) { endedNow = false; built = false; }
    build(); paintNow();
    if (lastStyle !== board.style) { lastStyle = board.style; paintBody(); }   // results restyle only when the host switches style
  } catch (e) { if (e.status === 403) ended(e.message); }
}
if (!code) ended('Scan the QR code on the big screen to join.');
else { refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 3000); document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); }); }
export { groupHead, artistLine, albumLine, selNo };

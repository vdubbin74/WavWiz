// WavWiz 0.3.0 §1: guest phone page (/jukebox.html?j=<code>).
// 0.3.4 H6/H7: the page is built ONCE (name + search inputs never leave the DOM); refreshes and new results only replace the slots
// around them, so typing a whole multi-word search keeps focus and the caret. H4: Modern or Retro CD (maroon) look, from the host's setting.
import { applyTheme, PRESETS } from './theme.js';
import { guestId, guestApi, groupHead, artistLine, albumLine, albumName, mineLine, minePicks, playsLine, playsLeft, NAME_KEY, selNo, addedLine, picksLeftLine, voteInfo, livePos } from './jukebox-core.js';
import { renderResults, el, artBox, rowsSig, artFailed } from './jukebox-view.js';

const code = new URLSearchParams(location.search).get('j') || '';
// 0.6.8-#6d: ?tv=1 = view-only big-screen board for a smart-TV browser (no name / search / vote, no player, no sign-in)
const tv = new URLSearchParams(location.search).get('tv') === '1';
const gid = guestId();
const call = guestApi(code);
const app = document.getElementById('app');
let board = null, lastQ = '', results = null, list = null, msg = '', built = false, endedNow = false;
// 0.6.9 J4: the phone has two views - Search & add (as before) and Queue (Now playing + Up next with who asked for each song, live)
let tab = 'search', queueSig = null, tvSig = null, npSig = null;
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
const tabBtn = (k, label) => el('button', { class: 'jbg-tab', type: 'button', role: 'tab', 'data-tab': k, 'aria-selected': String(tab === k), onclick: () => setTab(k) }, label);
const tabSearch = tabBtn('search', 'Search & add'), tabQueue = tabBtn('queue', 'Queue');
const tabs = el('div', { class: 'jbg-tabs', role: 'tablist', 'aria-label': 'Jukebox' }, tabSearch, tabQueue);
/** 0.6.9 J4: switch between Search & add and Queue. The search box and its results are kept (typing is never lost). */
function setTab(k) {
  tab = k === 'queue' ? 'queue' : 'search'; queueSig = null;
  for (const b of [tabSearch, tabQueue]) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  searchBox.hidden = tab !== 'search'; document.body.classList.toggle('jbg-onqueue', tab === 'queue');
  paintTabs(); paintBody();
}
function paintTabs() { const n = (board?.next || []).length; const t = n ? `Queue (${n}${n >= 10 ? '+' : ''})` : 'Queue'; if (tabQueue.textContent !== t) tabQueue.textContent = t; }
function build() {
  if (built) return; built = true;
  if (tv) { document.body.classList.add('jbtv'); app.replaceChildren(title, npSlot, noteSlot, bodySlot, foot); return; }
  app.replaceChildren(title, npSlot, noteSlot, nameIn, tabs, searchBox, msgSlot, bodySlot, foot);
}
// 0.6.8-#6d: TV board - Up next + the join QR (guest-code QR endpoint, no sign-in)
function paintTv() {
  const b = board, next = (b.next || []).slice(0, 8);
  // 0.6.9 J2: repaint only when the songs change (no cover re-requested or flashing every 3 s); no picture = placeholder, not a broken image
  const sig = rowsSig(next, code); if (sig === tvSig && bodySlot.firstChild) return; tvSig = sig;
  bodySlot.replaceChildren(el('section', { class: 'jbtv-next' }, el('h2', { class: 'jb-gh' }, 'Up next'),
    ...(next.length ? next.map((s, i) => el('div', { class: 'jb-row' }, el('span', { class: 'jbtv-n' }, String(i + 1)),
      artBox(s.trackId ? art(s.trackId) : '', 'jb-thumb'),
      el('div', { class: 'jb-t' }, el('b', {}, s.title || ''), el('small', {}, [s.artist, s.by ? 'requested by ' + s.by : null].filter(Boolean).join(' · ')))))
      : [el('p', { class: 'jb-dim' }, 'Nothing queued yet - scan the code to add a song.')])));
  foot.replaceChildren(el('div', { class: 'jbtv-join' }, el('img', { src: `/api/v1/jukebox/guest/qr.svg?j=${encodeURIComponent(code)}`, alt: 'Scan to add a song' }),
    el('div', {}, el('b', {}, 'Scan to add a song'), el('small', {}, location.host + '/jukebox.html?j=' + code))));
}

async function add(t, btn) {
  btn.disabled = true;
  try {
    const r = await call('/add', { guest: gid, name: nameIn.value.trim(), trackId: t.id }); added.add(t.id); markIn(btn);
    flash(addedLine(r?.position), true);   // 0.6.9 J4: instant "Added! You're #4 in line."
    if (board && Number.isFinite(board.playsLeft)) { board.playsLeft = Math.max(0, board.playsLeft - 1); paintFoot(); }
    await refresh();
  } catch (e) { btn.disabled = false; flash(e.message); }
}
/** 0.6.9 J4: take back one of this phone's own picks (not the one playing). */
async function removePick(x, btn) {
  btn.disabled = true;
  try { await call('/remove', { guest: gid, id: x.id }); flash(`Removed “${x.title}”. That pick is yours again.`, true); await refresh(); }
  catch (e) { btn.disabled = false; flash(e.message); }
}
const markIn = btn => { btn.disabled = true; btn.classList.add('in'); btn.replaceChildren(el('span', { class: 'jb-chk', 'aria-hidden': 'true' }, '✓'), retro() ? ' IN' : ' In'); btn.setAttribute('aria-label', 'Added'); };
let msgOk = false, msgT = 0;
function flash(t, ok = false) { msg = t; msgOk = ok; paintMsg(); clearTimeout(msgT); if (ok) msgT = setTimeout(() => { msg = ''; paintMsg(); }, 5000); }
function paintMsg() { msgSlot.replaceChildren(msg ? el('p', { class: 'jb-note' + (msgOk ? ' ok' : '') }, msg) : ''); }

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
  try { const r = await call('/vote', { guest: gid }); flash(r.skipped ? 'Skipped. Thanks!' : `Vote counted (${r.votes} of ${r.needed}).`, true); await refresh(); } catch (e) { flash(e.message); }
}

function songRow(s, i = 0) {
  const btn = el('button', { class: 'btn primary jb-add', type: 'button', onclick: () => add(s, btn), 'aria-label': `Add ${s.title}` }, retro() ? 'ADD' : 'Add');
  if (added.has(s.id)) markIn(btn);
  if (retro()) return el('div', { class: 'jb-row jbr-strip' }, el('span', { class: 'jbr-code' }, 'C' + (i + 1)), el('div', { class: 'jb-t' }, el('b', {}, s.title), el('small', {}, s.artist)), btn);
  return el('div', { class: 'jb-row' }, artBox(art(s.id), 'jb-thumb'), el('div', { class: 'jb-t' }, el('b', {}, s.title), el('small', {}, s.artist)), btn);
}
let npArt = null;
/** 0.6.9 J2: the Now playing cover node is kept while the song is the same, so the 3-second refresh never re-requests or flashes it. */
const npCover = (n, cls) => { const u = n?.trackId ? art(n.trackId) : ''; if (!npArt || npArt.dataset.art !== u || !npArt.classList.contains(cls)) npArt = artBox(u, cls); return npArt; };
function paintNow() {
  const b = board, n = b.now;
  paintTabs();
  if (retro()) {
    npSig = null; const u = n?.trackId ? art(n.trackId) : '';
    npSlot.replaceChildren(el('div', { class: 'jb-np jbr-np' }, el('div', { class: 'jbr-mini' + (n?.state === 'playing' ? ' spin' : '') }, u && !artFailed.has(u) ? npCover(n, 'jbr-art') : null),
      el('div', { class: 'jb-t' }, el('span', { class: 'jbr-kick' }, 'NOW PLAYING'), el('b', { class: 'jbr-script' }, n ? n.title : 'Add the first song')),
      n ? el('span', { class: 'jbr-vfd' }, fmt(n.positionMs)) : null));
  } else {
    // 0.6.9 J4: a live Now playing card - cover, title, artist, who asked for it, a progress bar that moves every second between polls,
    // and a small accent equalizer while it plays (CSS only, no audio feed: cheap on a phone)
    const sig = n ? [n.trackId, n.title, n.by, n.mine ? 1 : 0, b.filler ? 1 : 0].join('\u0001') : '';
    if (sig !== npSig || !npSlot.firstChild) {
      npSig = sig;
      const by = !n ? '' : n.mine ? 'Requested by you' : n.by ? `Requested by ${n.by}` : b.filler ? 'Jukebox pick' : '';
      npSlot.replaceChildren(n ? el('div', { class: 'jb-np jbg-npc' + (n.mine ? ' mine' : '') }, npCover(n, 'jb-art0'),
        el('div', { class: 'jb-t' }, el('span', { class: 'jbg-kick' }, el('span', { class: 'jbg-eq', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'), el('i')), 'NOW PLAYING'),
          el('b', {}, n.title), el('small', {}, n.artist || ''), by ? el('small', { class: 'jbg-by' }, by) : null,
          el('div', { class: 'jbg-prog', role: 'progressbar', 'aria-label': 'Song progress' }, el('i')), el('div', { class: 'jbg-times' }, el('span', { class: 'p' }), el('span', { class: 'd' }))))
        : el('div', { class: 'jb-np' }, el('small', {}, 'Nothing playing yet. Add the first song!')));
    }
    npSlot.firstChild?.classList.toggle('playing', n?.state === 'playing');
    npAt = performance.now(); tickProg();
  }
  noteSlot.replaceChildren(b.locked ? el('p', { class: 'jb-note' }, 'The host has paused requests for now.') : '');
  paintFoot();
}
let npAt = 0;
/** 0.6.9 J4: moves the Now playing bar and times every second from the last server position (no extra requests). */
function tickProg() {
  const n = board?.now, card = npSlot.querySelector('.jbg-npc'); if (!n || !card) return;
  const p = livePos(n, performance.now() - npAt), d = n.durationMs || 0;
  card.querySelector('.jbg-prog i').style.width = (d ? Math.min(100, p / d * 100) : 0) + '%';
  card.querySelector('.jbg-times .p').textContent = fmt(p); card.querySelector('.jbg-times .d').textContent = d ? fmt(d) : '';
}
// ---- the bottom bar: "2 of 3 picks left" and vote to skip with its live progress (stable nodes: a tap is never lost to a repaint) ----
const picksEl = el('span', { class: 'jb-mine jb-plays' });
const voteFill = el('i', { class: 'jbg-vfill' }), voteLbl = el('span', {});
const voteBtn = el('button', { class: 'btn jbg-vote', type: 'button', onclick: vote }, voteFill, el('span', { class: 'jbg-vico', 'aria-hidden': 'true' }, '⏭'), voteLbl);
function paintFoot() {
  const b = board; if (!b || tv) return;
  // 0.3.5 J18 / 0.6.9 J4: "2 of 3 picks left" - counts down with each add, back up as each pick has played or is removed (server count, survives reloads)
  picksEl.dataset.left = String(playsLeft(b, gid)); picksEl.textContent = retro() ? playsLine(b, gid) : picksLeftLine(b, gid);
  const showVote = !!(b.voteSkip && b.now); voteBtn.hidden = !showVote;
  if (showVote) { const v = voteInfo(b); voteFill.style.width = Math.round(v.frac * 100) + '%'; voteLbl.textContent = v.label; voteBtn.disabled = !!b.voted; voteBtn.classList.toggle('voted', !!b.voted); voteBtn.setAttribute('aria-label', `Vote to skip this song: ${v.label}`); }
  if (foot.firstChild !== picksEl) foot.replaceChildren(picksEl, voteBtn);
}
setInterval(() => { if (!document.hidden && board && !retro()) tickProg(); }, 1000);
/** 0.6.9 J4: the Queue view - what is playing and what plays next, who asked for each song ("You" for this phone's picks). */
function queueView(b) {
  const n = b.now, next = b.next || [];
  const who = x => x.mine ? 'you' : x.by || (x === n && b.filler ? 'Jukebox pick' : '');
  const row = (x, i, now) => { const r = el('div', { class: 'jb-row jbg-qrow' + (now ? ' now' : '') + (x.mine ? ' mine' : '') },
    el('span', { class: 'jbg-qn' }, now ? '▶' : String(i + 1)), artBox(x.trackId ? art(x.trackId) : '', 'jb-thumb'),
    el('div', { class: 'jb-t' }, el('b', {}, x.title || ''), el('small', {}, [x.artist, who(x) ? 'requested by ' + who(x) : null].filter(Boolean).join(' · '))),
    x.mine && !now ? el('span', { class: 'jbg-you' }, 'YOU') : null);
    // 0.6.9 J4: your own pick that has not started can be taken back (the server checks it is yours)
    if (x.mine && !now && x.id != null) { const btn = el('button', { class: 'btn jbg-rm', type: 'button', 'aria-label': `Remove ${x.title}`, onclick: () => removePick(x, btn) }, 'Remove'); r.append(btn); }
    return r; };
  return el('section', { class: 'jbg-queue', 'aria-label': 'Queue' },
    el('h2', { class: 'jb-gh' }, 'Now playing'),
    n ? row(n, 0, true) : el('p', { class: 'jb-dim' }, 'Nothing playing yet.'),
    el('h2', { class: 'jb-gh' }, next.length ? `Up next (${next.length}${next.length >= 10 ? '+' : ''})` : 'Up next'),
    ...(next.length ? next.map((x, i) => row(x, i, false)) : [el('p', { class: 'jb-dim' }, 'Nothing queued yet. Add a song from Search & add.')]));
}
function paintQueue() {
  const b = board; if (!b) return;
  const sig = rowsSig(b.next, [retro() ? 'r' : 'm', b.now?.trackId, b.now?.title, b.now?.by, b.filler ? 1 : 0].join('|'));
  if (sig === queueSig && bodySlot.firstChild) return;   // live, but no DOM work (and no cover flash) while nothing changed
  queueSig = sig; bodySlot.replaceChildren(queueView(b));
}
function paintBody() {
  if (tab === 'queue' && !tv) { paintQueue(); return; }
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
    if (tv) { paintTv(); return; }
    if (lastStyle !== board.style) { lastStyle = board.style; queueSig = null; paintBody(); }   // results restyle only when the host switches style
    else if (tab === 'queue') paintQueue();   // 0.6.9 J4: the Queue view follows the board live
  } catch (e) { if (e.status === 403) ended(e.message); }
}
if (!code) ended('Scan the QR code on the big screen to join.');
else { refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 3000); document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); }); }
export { groupHead, artistLine, albumLine, selNo, queueView };

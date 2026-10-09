import { h, api, toast, fmtTime } from './util.js';
import { cover, trackArt } from './art.js';
import { attachItem, refTracks, refNode, albumNode, canControl, playNow, addToQueue, chunked, pickPlaylist } from './ui.js';
import { SORTS, loadLibPrefs, saveLibPrefs, sortRows, isLetterSort, letterIndex, LETTERS, tabView, VIEW_TABS, blockColors } from './libsort.js';
import { heartBtn, albumRef, loadFavs } from './fav.js';

const TABS = [['artists', 'Artists'], ['albums', 'Albums'], ['genres', 'Genres'], ['years', 'Years'], ['recent', 'Recently added'], ['folders', 'Folders'], ['favorites', '♥ Favorites']];
const GRID_KINDS = new Set(['albums', 'recent', 'favorites']);
const COUNT_LABEL = { artists: 'artists', albums: 'albums', genres: 'genres', years: 'years', recent: 'albums', folders: 'folders', favorites: 'favorites', songs: 'songs' };

const folderGlyph = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '16'); s.setAttribute('height', '16'); s.innerHTML = '<path fill="currentColor" d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l1.8 2h8.6A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>'; return s; };
/** Artist picture for the round tiles (album art until a real artist photo is found - see F13). */
const artistArt = a => cover(trackArt(a.artTrackId, 384), 'lg rnd', '♪');

/** Tag-based library: grouping comes from the songs' tags (Artist/Album/Genre/Year), never from the folder layout. Folders is its own tab.
 * 0.2.0 items 13-16: sort + A-Z/Z-A flip on every tab (remembered per tab), letter strip on long name-sorted lists, hearts (server
 * favorites) on songs and albums with a Favorites tab, Albums as a cover grid or a list, and the Expanded view (setExpanded) with
 * every tab, a toolbar (filter, sort, flip, grid/list, count) and a big cover grid. */
export function libraryView(S, opts = {}) {
  const compact = !!opts.compact;       // desktop left panel: ARTISTS / ALBUMS / GENRES / FOLDERS + a count, Years / Recently added / Favorites under "more"
  let expanded = false;
  let P = loadLibPrefs(); const seed = (Date.now() & 0xffff) || 1;
  const session = {};      // 0.2.1 F4: a Tiles/List pick that is not remembered (Remember view per tab off) lasts until the page reloads
  const st = { tab: (compact ? S.libTabC : S.libTab) || (compact ? 'artists' : 'albums'), stack: [], q: '', count: null, kind: null, dirty: false };
  const root = h('div', { class: compact ? 'lib compact' : 'lib' }), head = h('div'), tools = h('div', { class: 'libtools' }), crumbs = h('div', { class: 'crumbs' }),
    content = h('div', { class: 'libcontent' }), strip = h('nav', { class: 'azstrip', 'aria-label': 'Jump to letter', hidden: true }), countEl = h('div', { class: 'libcount small dim' });
  // 0.2.1 F5: the filter box is ONE persistent element. Redraws never re-create or re-parent it while you type (that dropped focus after
  // every keystroke); filtering is debounced, and focus + caret are restored if a layout switch ever has to move it.
  const search = h('input', { type: 'search', placeholder: 'Search songs, albums and artists…', 'aria-label': 'Search the library', oninput: ev => { clearTimeout(search._t); search._t = setTimeout(() => { const q = ev.target.value.trim(); if (q !== st.q) { st.q = q; draw(); } }, 250); } });
  const searchField = h('div', { class: 'field libsearch' }, search);
  const tabsSlot = h('div', { class: 'libtabslot' }), headRow = h('div', { class: 'row libhead' }, tabsSlot);
  head.append(headRow);
  root.append(searchField, head, tools, countEl, crumbs, h('div', { class: 'libscroll' }, content, strip));
  /** Move the filter box only when the layout really changes, keeping focus and the caret. */
  const placeSearch = parent => {
    if (searchField.parentElement === parent) return;
    const had = document.activeElement === search, a = search.selectionStart, b = search.selectionEnd;
    if (parent === root) root.prepend(searchField); else parent.append(searchField);
    if (had) { search.focus({ preventScroll: true }); try { search.setSelectionRange(a, b); } catch { /* type=search */ } }
  };

  const MAIN = ['artists', 'albums', 'genres', 'folders'];
  const pick = k => { st.tab = k; if (compact) S.libTabC = k; else S.libTab = k; st.stack = []; st.q = ''; search.value = ''; draw(); };
  const tabs = () => compact && !expanded
    ? h('div', { class: 'tabs ctabs', role: 'tablist' }, TABS.filter(([k]) => MAIN.includes(k)).map(([k, t]) => h('button', { role: 'tab', class: st.tab === k && !st.stack.length ? 'on' : '', onclick: () => pick(k) }, t.toUpperCase())),
        h('select', { 'aria-label': 'More ways to browse', class: 'moresel' + (MAIN.includes(st.tab) ? '' : ' on'), onchange: ev => ev.target.value && pick(ev.target.value) }, h('option', { value: '' }, '⋯'),
          ['years', 'recent', 'favorites'].map(k => h('option', { value: k, selected: st.tab === k }, TABS.find(t => t[0] === k)[1].replace('♥ ', '')))))
    : h('div', { class: 'tabs' + (expanded ? ' xtabs' : ''), role: 'tablist' }, TABS.map(([k, t]) => h('button', { role: 'tab', class: (st.tab === k && !st.stack.length ? 'on' : '') + (k === 'favorites' ? ' favtab' : ''), onclick: () => pick(k) }, t)));
  const push = page => { st.stack.push(page); draw(); };
  const back = () => { st.stack.pop(); draw(); };
  const save = () => saveLibPrefs(P);
  // 0.2.1 F4: Expanded = tiles on every tab by default (per-tab Tiles/List); the narrow panel keeps its own album grid/list choice.
  const gridOn = kind => (expanded ? tabView(P, kind, session) === 'grid' : P.compactView === 'grid' && GRID_KINDS.has(kind));
  const setView = (kind, v) => { if (expanded) { if (P.remember) { P.views[kind] = v; delete session[kind]; } else session[kind] = v; } else P.compactView = v; save(); draw(); };

  // ---- rows ----
  const nameRow = (title, sub, art, ref, onopen, glyph = '♪', rnd = false, extra = null) => {
    const el = h('li', { class: 'item', onclick: onopen }, cover(art, 'sm' + (rnd ? ' rnd' : ''), glyph), h('div', { class: 't' }, h('div', { class: 't1 ell' }, title), h('div', { class: 't2 ell' }, sub)), extra);
    return ref ? attachItem(S, el, ref, title) : el;
  };
  const artistRow = a => nameRow(a.name, `${a.albums} album${a.albums === 1 ? '' : 's'} • ${a.tracks} song${a.tracks === 1 ? '' : 's'}`, trackArt(a.artTrackId, 96), refNode('artist:' + a.name), () => push({ title: a.name, kind: 'albums', load: () => albumsPage({ artist: a.name }) }), '♪', true);
  const openAlbum = al => push({ title: al.album, kind: 'songs', load: () => tracksPage(al) });
  const albumRow = al => nameRow(al.album, [al.artist, al.year || null, `${al.tracks} song${al.tracks === 1 ? '' : 's'}`].filter(Boolean).join(' • '), trackArt(al.artTrackId, 96), refNode(albumNode(al.artist, al.album)), () => openAlbum(al), '♫', false, heartBtn(S, 'album', albumRef(al.artist, al.album), al.album));
  const playingAlbum = al => { const it = S.now?.item; return !!it && it.album === al.album && (it.albumArtist === al.artist || it.artist === al.artist); };
  const albumTile = al => {
    const ref = refNode(albumNode(al.artist, al.album));
    const el = h('li', { class: 'tile' + (playingAlbum(al) ? ' playing' : ''), onclick: () => openAlbum(al) },
      h('div', { class: 'tileart' }, cover(trackArt(al.artTrackId, 384), 'lg', '♫'),
        playingAlbum(al) ? h('span', { class: 'tilebadge' }, '▮▮▮ Playing') : null,
        heartBtn(S, 'album', albumRef(al.artist, al.album), al.album),
        canControl(S) ? h('button', { type: 'button', class: 'tileplay', 'aria-label': `Play ${al.album}`, onclick: ev => { ev.stopPropagation(); playNow(ref); } }, '▶') : null),
      h('div', { class: 't1 ell', title: al.album }, al.album), h('div', { class: 't2 ell' }, al.artist));
    return attachItem(S, el, ref, al.album, { more: false });   // tiles: right-click / long-press menu, no ⋯ row
  };
  // ---- 0.2.1 F4 / F13 tiles: artists (round), genres + years (color blocks with a cover collage), folders (2x2 mosaic) ----
  const playBtn = (ref, label) => canControl(S) ? h('button', { type: 'button', class: 'tileplay', 'aria-label': `Play ${label}`, onclick: ev => { ev.stopPropagation(); playNow(ref); } }, '▶') : null;
  const artistTile = a => {
    const ref = refNode('artist:' + a.name);
    const el = h('li', { class: 'tile atile', onclick: () => push({ title: a.name, kind: 'albums', load: () => albumsPage({ artist: a.name }) }) },
      h('div', { class: 'tileart rnd' }, artistArt(a), playBtn(ref, a.name)),
      h('div', { class: 't1 ell', title: a.name }, a.name), h('div', { class: 't2 ell' }, `${a.albums} album${a.albums === 1 ? '' : 's'} · ${a.tracks} song${a.tracks === 1 ? '' : 's'}`));
    return attachItem(S, el, ref, a.name, { more: false });
  };
  const blockTile = (key, sub) => n => {
    const ref = refNode(key + ':' + n.name), [c1, c2] = blockColors(n.name);
    const el = h('li', { class: 'tile btile', onclick: () => push({ title: n.name, kind: 'albums', load: () => albumsPage({ [key]: key === 'year' ? +n.name : n.name }) }) },
      h('div', { class: 'gblock', style: `--g1:${c1};--g2:${c2}` }, h('b', { class: 'gname ell' }, n.name), h('span', { class: 'gsub' }, sub(n)),
        h('div', { class: 'gcollage', 'aria-hidden': 'true' }, (n.artTrackIds || []).slice(0, 3).map((id, i) => cover(trackArt(id, 192), 'gc gc' + i, '♫'))), playBtn(ref, n.name)));
    return attachItem(S, el, ref, n.name, { more: false });
  };
  const genreTile = blockTile('genre', n => `${n.albums} album${n.albums === 1 ? '' : 's'}`);
  const yearTile = blockTile('year', n => `${n.albums} album${n.albums === 1 ? '' : 's'} · ${n.tracks} song${n.tracks === 1 ? '' : 's'}`);
  const folderTile = f => {
    const ids = (f.artTrackIds || []).slice(0, 4), name = f.name.split(/[\\/]/).filter(Boolean).pop() || f.name;
    const el = h('li', { class: 'tile ftile', onclick: () => push({ title: name, kind: 'folders', load: () => foldersPage(f.path), folder: f.path }) },
      h('div', { class: 'tileart fmosaic' + (ids.length < 2 ? ' one' : '') }, ...(ids.length ? ids.map(id => cover(trackArt(id, 192), 'fm', '♫')) : [h('div', { class: 'cover fm' }, '📁')]),
        h('span', { class: 'fbadge', 'aria-hidden': 'true' }, folderGlyph()), playBtn(refNode('folder:' + f.path), name)),
      h('div', { class: 't1 ell', title: f.name }, name), h('div', { class: 't2' }, `${f.tracks} track${f.tracks === 1 ? '' : 's'}`));
    return attachItem(S, el, refNode('folder:' + f.path), name, { more: false });
  };
  const countRow = (glyph, key) => n => nameRow(n.name, `${n.tracks} song${n.tracks === 1 ? '' : 's'} • ${n.albums} album${n.albums === 1 ? '' : 's'}`, null, refNode(key + ':' + n.name), () => push({ title: n.name, kind: 'albums', load: () => albumsPage({ [key]: key === 'year' ? +n.name : n.name }) }), glyph);

  // ---- lists (sorted, letter strip) ----
  let jump = null;
  function list(kind, rows, make, tile = make === albumRow ? albumTile : null) {
    const key = P.sort[kind], sorted = sortRows(kind, rows, key, P.flip[kind], seed); st.count = rows.length; st.kind = kind;
    const grid = !!tile && gridOn(kind);
    const mk = grid ? tile : make; const ul = h('ul', { class: grid ? 'tilegrid tg-' + kind : 'list' }); const ch = chunked(ul, sorted, (row, i) => mk(row, i, sorted));
    if (isLetterSort(kind, key) && sorted.length >= (expanded ? 20 : 40)) {
      const idx = letterIndex(kind, sorted, key);
      jump = l => { const i = idx.get(l); if (i == null) return; ch?.upTo?.(i); ul.children[i]?.scrollIntoView({ block: 'start' }); };
      strip.replaceChildren(...LETTERS.map(l => h('button', { type: 'button', class: idx.has(l) ? '' : 'off', disabled: !idx.has(l), 'aria-label': `Jump to ${l}`, onclick: () => jump(l) }, l)));
      strip.hidden = false;
    }
    return ul;
  }
  const empty = txt => h('p', { class: 'dim' }, txt);
  async function albumsPage(q) {
    const rows = await api('/library/albums?' + new URLSearchParams({ ...q, sort: 'artist' }).toString());
    return [rows.length ? list('albums', rows, albumRow) : empty('No albums here.')];
  }
  async function tracksPage(al) {
    const rows = await api(`/library/tracks?artist=${encodeURIComponent(al.artist)}&album=${encodeURIComponent(al.album)}`);
    const ids = rows.map(t => t.id), ref = refNode(albumNode(al.artist, al.album));
    return [h('div', { class: 'hero' }, cover(trackArt(al.artTrackId ?? ids[0], 384), ''), h('div', { class: 'grow' }, h('h2', null, al.album, ' ', heartBtn(S, 'album', albumRef(al.artist, al.album), al.album)), h('div', { class: 'dim' }, [al.artist, al.year].filter(Boolean).join(' • ')),
      canControl(S) ? h('div', { class: 'row wrap', style: 'margin-top:8px' }, h('button', { class: 'btn primary', onclick: () => playNow(ref) }, '▶ Play'), h('button', { class: 'btn', onclick: () => addToQueue(ref) }, 'Add to queue'), h('button', { class: 'btn', onclick: () => pickPlaylist(S, ref) }, 'Add to playlist')) : null)),
    trackList(rows)];
  }
  const trackList = (rows, kind = 'songs') => list(kind, rows, (t, i, shown) => {
    const el = h('li', { class: 'item', onclick: () => canControl(S) ? playNow({ kind: 'tracks', ids: shown.map(x => x.id), index: i }) : toast('Your access is view-only.') }, h('span', { class: 'num' }, t.trackNo ?? i + 1), h('div', { class: 't' }, h('div', { class: 't1 ell' }, t.title), h('div', { class: 't2 ell' }, [t.artist, t.album].filter(Boolean).join(' • '))),
      heartBtn(S, 'track', t.id, t.title), h('span', { class: 'dur' }, fmtTime(t.durationMs)));
    return attachItem(S, el, refTracks([t.id]), t.title);
  });
  async function foldersPage(path) {
    const r = await api('/library/folders' + (path ? '?path=' + encodeURIComponent(path) : ''));
    const out = [];
    if (path) out.push(h('ul', { class: 'list' }, h('li', { class: 'item', onclick: () => { st.stack.pop(); draw(); } }, h('div', { class: 't' }, h('div', { class: 't1' }, '‹ Up')))));
    const folderRow = f => { const el = h('li', { class: 'item', onclick: () => push({ title: f.name.split(/[\\/]/).pop() || f.name, kind: 'folders', load: () => foldersPage(f.path), folder: f.path }) }, h('span', { class: 'cover sm' }, '📁'), h('div', { class: 't' }, h('div', { class: 't1 ell' }, f.name), h('div', { class: 't2' }, `${f.tracks} songs`))); return attachItem(S, el, refNode('folder:' + f.path), f.name); };
    if (r.folders.length) out.push(list('folders', r.folders, folderRow, folderTile));
    if (r.tracks.length) out.push(h('div', { class: 'sec' }, 'Songs in this folder'), trackList(r.tracks));
    if (!r.folders.length && !r.tracks.length) out.push(empty('This folder has no songs WavWiz can read.'));
    st.count = r.folders.length; st.kind = 'folders';
    return out;
  }
  async function favoritesPage() {
    await loadFavs();
    const r = await api('/favorites/items'); const out = [];
    if (r.albums.length) out.push(h('div', { class: 'sec' }, 'Albums'), list('favorites', r.albums, albumRow));
    if (r.tracks.length) out.push(h('div', { class: 'sec' }, 'Songs'), trackList(r.tracks, 'favorites'));
    st.count = r.albums.length + r.tracks.length; st.kind = 'favorites';
    return out.length ? out : [empty(canControl(S) ? 'No favorites yet. Tap ♡ on a song or an album to add it here.' : 'No favorites yet.')];
  }
  async function findPage(q) {
    const r = await api('/library/find?q=' + encodeURIComponent(q));
    const out = [];
    if (r.artists.length) out.push(h('div', { class: 'sec' }, 'Artists'), h('ul', { class: 'list' }, r.artists.slice(0, 12).map(artistRow)));
    if (r.albums.length) out.push(h('div', { class: 'sec' }, 'Albums'), h('ul', { class: 'list' }, r.albums.slice(0, 20).map(albumRow)));
    if (r.tracks.length) out.push(h('div', { class: 'sec' }, 'Songs'), trackList(r.tracks));
    st.kind = null;
    return out.length ? out : [empty(`Nothing found for “${q}”.`)];
  }
  const rootPage = {
    artists: async () => { const rows = await api('/library/artists'); return [rows.length ? list('artists', rows, artistRow, artistTile) : empty('No music yet. Add a music folder in Settings > Library.')]; },
    albums: async () => { const rows = await api('/library/albums?sort=artist'); return [rows.length ? list('albums', rows, albumRow) : empty('No albums yet.')]; },
    genres: async () => { const rows = await api('/library/genres'); return [rows.length ? list('genres', rows, countRow('♬', 'genre'), genreTile) : empty('No genre tags found. Songs without a genre appear under Cleanup.')]; },
    years: async () => { const rows = await api('/library/years'); return [rows.length ? list('years', rows, countRow('📅', 'year'), yearTile) : empty('No year tags found.')]; },
    recent: async () => { const rows = await api('/library/recent?limit=120'); return [rows.length ? list('recent', rows, albumRow) : empty('Nothing added yet.')]; },
    folders: async () => foldersPage(''),
    favorites: favoritesPage,
  };
  const pageKind = () => st.q ? null : st.stack.length ? st.stack[st.stack.length - 1].kind : st.tab;

  /** Sort select + A-Z / Z-A flip + grid/list (+ count when expanded). Remembered per tab per browser. */
  function drawTools(kind) {
    if (!kind || !SORTS[kind]) { tools.replaceChildren(expanded ? h('span', { class: 'grow' }) : '', expanded && st.count != null ? h('span', { class: 'small dim' }, `${st.count} results`) : ''); return; }
    const sel = h('select', { class: 'libsort', 'aria-label': 'Sort', onchange: ev => { P.sort[kind] = ev.target.value; save(); draw(); } }, SORTS[kind].map(([v, t]) => h('option', { value: v, selected: P.sort[kind] === v }, t)));
    const flip = h('button', { type: 'button', class: 'chipbtn libflip' + (P.flip[kind] ? ' on' : ''), 'aria-pressed': String(P.flip[kind]), title: P.flip[kind] ? 'Reversed - tap for the normal order' : 'Tap to reverse the order', onclick: () => { P.flip[kind] = !P.flip[kind]; save(); draw(); } }, P.flip[kind] ? 'Z–A ↑' : 'A–Z ↓');
    const canGrid = expanded ? VIEW_TABS.includes(kind) : GRID_KINDS.has(kind) || kind === 'albums', cur = gridOn(kind) ? 'grid' : 'list';
    const gl = canGrid ? h('span', { class: 'seg libview', role: 'group', 'aria-label': 'Tiles or list' },
      h('button', { type: 'button', class: cur === 'grid' ? 'on' : '', 'aria-pressed': String(cur === 'grid'), 'aria-label': 'Tiles', title: 'Tiles', onclick: () => setView(kind, 'grid') }, '▦'),
      h('button', { type: 'button', class: cur === 'list' ? 'on' : '', 'aria-pressed': String(cur === 'list'), 'aria-label': 'List', title: 'List', onclick: () => setView(kind, 'list') }, '☰')) : null;
    tools.replaceChildren(expanded ? h('span', { class: 'small dim' }, 'Sort:') : null, sel, flip, gl, h('span', { class: 'grow' }), expanded && st.count != null ? h('span', { class: 'small dim libn' }, `${st.count} ${COUNT_LABEL[kind] || ''}`) : null);
  }

  let drawing = 0;
  const visible = () => root.isConnected && root.getClientRects().length > 0;
  async function draw() {
    if (!visible()) { st.dirty = true; return; }       // hidden copy (phone vs desktop layout): draw when it is shown
    st.dirty = false; const my = ++drawing; st.count = null; jump = null; strip.hidden = true; strip.replaceChildren();
    root.classList.toggle('expanded', expanded); root.classList.toggle('compact', compact && !expanded); root.dataset.tiles = P.tileSize;
    tabsSlot.replaceChildren(tabs());
    placeSearch(expanded ? headRow : root);
    search.placeholder = expanded ? 'Filter…' : 'Search songs, albums and artists…';
    crumbs.replaceChildren();
    if (st.stack.length) crumbs.append(h('button', { class: 'btn', onclick: back }, '‹ Back'), h('b', { class: 'ell' }, st.stack[st.stack.length - 1].title));
    content.replaceChildren(h('p', { class: 'dim' }, 'Loading…')); drawTools(pageKind());
    try {
      const nodes = st.q ? await findPage(st.q) : st.stack.length ? await st.stack[st.stack.length - 1].load() : await rootPage[st.tab]();
      if (my !== drawing) return;
      content.replaceChildren(...nodes); drawTools(pageKind());
      content.classList.toggle('grid', !!content.querySelector('.tilegrid'));
      const lab = COUNT_LABEL[st.tab];
      countEl.textContent = compact && !expanded && st.count != null && !st.stack.length && !st.q && lab ? `${st.count} ${lab}` : '';
    } catch (e) { if (my === drawing) content.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }
  window.addEventListener('wavwiz:library', () => draw());
  window.addEventListener('wavwiz:libprefs', () => { const e = P.expanded; P = loadLibPrefs(); P.expanded = e; for (const k of Object.keys(session)) delete session[k]; draw(); });   // Settings > Library view
  window.addEventListener('wavwiz:favs', () => { if (st.tab === 'favorites' && !st.stack.length && !st.q && visible()) { clearTimeout(draw._f); draw._f = setTimeout(draw, 300); } });
  window.addEventListener('resize', () => { if (st.dirty && visible()) draw(); });
  loadFavs(); draw();
  return { el: root, reload: draw, get dirty() { return st.dirty; }, get expanded() { return expanded; },
    setExpanded(on) { expanded = !!on; P.expanded = expanded; save(); draw(); } };
}

import { h, api, toast, fmtTime } from './util.js';
import { cover, trackArt, artistCover } from './art.js';
import { icon } from './icons.js';
import { pulse } from './motion.js';
import { attachItem, refTracks, refNode, albumNode, canControl, playNow, playShuffled, addToQueue, chunked, pickPlaylist, songsLabel } from './ui.js';
import { SORTS, loadLibPrefs, saveLibPrefs, sortRows, isLetterSort, letterIndex, LETTERS, tabView, VIEW_TABS, blockColors, tileSpec, tileCount, byDecade } from './libsort.js';
import { heartBtn, albumRef, loadFavs } from './fav.js';
import { openCtx } from './ctxmenu.js';

const TABS = [['artists', 'Artists'], ['albums', 'Albums'], ['genres', 'Genres'], ['years', 'Years'], ['recent', 'Recently added'], ['folders', 'Folders'], ['favorites', '♥ Favorites'], ['playlists', 'Playlists'], ['radio', 'Radio']];
// 0.3.5 J9: Playlists + Radio tabs (were popups); the tools are tabs of the expanded Library only (next-j9-lib-*.png)
const ALL_TOOL_TABS = [['rip', 'CD ripper'], ['tags', 'Tag & cover fix'], ['cleanup', 'Tidy up library']];
// 0.4.8 F57: the CD ripper only exists in the PC app (this machine, not a phone/remote browser) - decided by client type, not screen width
let ripOk = false;
export function setRipAllowed(auth, ua = navigator.userAgent) { ripOk = !!auth?.thisMachine && !/iPhone|iPad|iPod|Android|Mobile/i.test(ua); document.documentElement.dataset.rip = ripOk ? '1' : '0'; TOOL_TABS = ALL_TOOL_TABS.filter(t => t[0] !== 'rip' || ripOk); return ripOk; }
export const ripAllowed = () => ripOk;
export let TOOL_TABS = ALL_TOOL_TABS.filter(t => t[0] !== 'rip');
export const EXTRA_TABS = new Set(['playlists', 'radio', 'rip', 'tags', 'cleanup']);
/** Which tabs the Library shows (pure): the narrow panel = row 1 + row 2 (Playlists, Radio); expanded = everything + Tools. */
export function libTabs(expanded) {
  return expanded ? { main: ['artists', 'albums', 'genres', 'years', 'folders', 'playlists', 'radio'], more: ['recent', 'favorites'], tools: TOOL_TABS.map(t => t[0]) }
    : { main: ['artists', 'albums', 'genres', 'folders'], row2: ['playlists', 'radio'], more: ['years', 'recent', 'favorites'], tools: [] };
}
const GRID_KINDS = new Set(['albums', 'recent', 'favorites']);
const COUNT_LABEL = { artists: 'artists', albums: 'albums', genres: 'genres', years: 'years', recent: 'albums', folders: 'folders', favorites: 'favorites', songs: 'songs' };

const folderGlyph = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '16'); s.setAttribute('height', '16'); s.innerHTML = '<path fill="currentColor" d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l1.8 2h8.6A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>'; return s; };
/** 0.2.1 F13: round artist photo (MusicBrainz / Wikidata via the server, cached); a generated portrait until / unless one is found. */
const artistArt = a => artistCover(a.name, a.artTrackIds, 'lg rnd', 384);      // 0.2.2 T4d: photo, else album covers, else generated portrait
/** 0.2.1 F13: "Artist · 2021" under album tiles. */
export const albumSub = al => [al.artist, al.year || null].filter(Boolean).join(' · ');
/** 0.2.1 F13: album page header color = the cover's dominant color (average of its colorful pixels), applied as --dom. */
export function dominantColor(img) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 32, 32);
    return dominantOf(g.getImageData(0, 0, 32, 32).data);
  } catch { return null; }
}
/** Pure part (tested): the most common colorful hue bucket of RGBA pixels, averaged; mostly gray pictures fall back to the overall average. */
export function dominantOf(d) {
  const B = Array.from({ length: 12 }, () => [0, 0, 0, 0]); let R = 0, G = 0, Bl = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); R += r; G += g; Bl += b; n++;
    if (mx - mn < 40 || mx < 50) continue;
    let hh = mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn); hh = ((hh * 60) + 360) % 360;
    const k = B[Math.floor(hh / 30) % 12], w = (mx - mn) / 255; k[0] += r * w; k[1] += g * w; k[2] += b * w; k[3] += w;
  }
  const best = B.reduce((a, k) => k[3] > a[3] ? k : a, [0, 0, 0, 0]);
  if (!n) return null;
  if (best[3] < n * 0.04) return `rgb(${Math.round(R / n)},${Math.round(G / n)},${Math.round(Bl / n)})`;
  return `rgb(${Math.round(best[0] / best[3])},${Math.round(best[1] / best[3])},${Math.round(best[2] / best[3])})`;
}

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

  const extras = opts.extras || {};
  const pick = k => { if (TOOL_TABS.some(t => t[0] === k) && !expanded) k = 'artists'; st.tab = k; if (compact) S.libTabC = k; else S.libTab = k; st.stack = []; st.q = ''; search.value = ''; draw(); };
  const tname = k => (TABS.find(t => t[0] === k) || TOOL_TABS.find(t => t[0] === k))[1];
  const tabBtn = (k, cls = '') => h('button', { role: 'tab', 'data-tab': k, class: ((st.tab === k && !st.stack.length) ? 'on ' : '') + cls, 'aria-selected': String(st.tab === k), onclick: () => pick(k) }, compact && !expanded ? tname(k).toUpperCase() : tname(k));
  // 0.4.6 F40: no native <select> in the Library (WebView2 draws its open list in Windows colors): themed dropdown buttons that open the themed menu.
  const ddBtn = (cls, label, txt, opts, cur, onpick) => { const b = h('button', { type: 'button', class: 'wwdd ' + cls, 'aria-label': label, 'aria-haspopup': 'menu', title: label },
      h('span', { class: 'wwdd-t' }, txt), h('span', { class: 'wwdd-c', 'aria-hidden': 'true' }, '▾'));
    b.onclick = () => { const r = b.getBoundingClientRect(); openCtx(r.left, r.bottom + 2, opts.map(([v, t]) => ({ id: 'dd:' + v, label: (v === cur ? '✓ ' : '') + t, onclick: () => onpick(v) })), { label, from: b }); };
    return b; };
  const moreSel = keys => ddBtn('moresel' + (keys.includes(st.tab) ? ' on' : ''), 'More ways to browse', '⋯', keys.map(k => [k, tname(k).replace('♥ ', '')]), st.tab, k => pick(k));
  // 0.4.6 F34: the side panel's tabs are ONE row that always fits the panel: tabs that do not fit at this width / scaling / theme go into the "⋯"
  // overflow, a tab-style button (themed like the tabs, never a native select) that opens the themed menu with them + Years / Recently added /
  // Favorites. Re-fitted whenever the panel changes size.
  const ctabRow = T => {
    const keys = [...T.main, ...T.row2], btns = keys.map(k => tabBtn(k));
    const more = h('button', { type: 'button', class: 'tabmore', role: 'tab', 'aria-haspopup': 'menu', 'aria-label': 'More ways to browse', title: 'More ways to browse' }, '⋯');
    const row = h('div', { class: 'tabs ctabs', role: 'tablist' }, btns, more), wrap = h('div', { class: 'ctabwrap' }, row);
    const hiddenKeys = () => keys.filter((k, i) => btns[i].hidden);
    const paintMore = () => { const inMore = [...hiddenKeys(), ...T.more].includes(st.tab) && !st.stack.length; more.classList.toggle('on', inMore); more.setAttribute('aria-selected', String(inMore)); };
    // 0.4.7: fit against the space the panel gives the row (the wrap), measured after layout. Not laid out yet (hidden panel, width 0, cold
    // load before the grid settles): show every tab and wait for the next measure, never push every tab into the overflow.
    // 0.4.9: the wrap is a content-sized flex item in the header, so once tabs were hidden (e.g. mid-way through the reopen-from-collapsed
    // animation) it stayed that narrow and never resized again: watch the panel itself, whose width does change, and re-fit on that too.
    let panelObs = false, ro = null;
    const fit = () => {
      if (!row.isConnected) return;
      if (!panelObs && ro) { const pan = wrap.closest('.libpanel'); if (pan) { ro.observe(pan); panelObs = true; } }
      btns.forEach(b => { b.hidden = false; });
      const room = wrap.clientWidth;
      if (!(room > 0) || !row.offsetParent) { paintMore(); return; }
      for (let i = btns.length - 1; i >= 0 && row.scrollWidth > row.clientWidth + 0.5; i--) btns[i].hidden = true;
      if (btns.length && btns.every(b => b.hidden)) btns[0].hidden = false;   // always keep at least the first tab on the row
      paintMore();
    };
    let fitQ = 0; const refit = () => { if (fitQ) return; fitQ = requestAnimationFrame(() => { fitQ = 0; if (!wrap.isConnected) { off(); return; } fit(); }); };
    const off = () => { ro?.disconnect(); window.removeEventListener('wavwiz:relayout', refit); window.removeEventListener('wavwiz:uiscale', refit); window.removeEventListener('resize', refit); };
    window.addEventListener('wavwiz:relayout', refit); window.addEventListener('wavwiz:uiscale', refit); window.addEventListener('resize', refit);
    try { document.fonts?.ready?.then(refit); document.fonts?.addEventListener?.('loadingdone', refit); } catch { /* no font API */ }
    more.onclick = () => { const r = more.getBoundingClientRect(), mk = k => ({ id: 'tab:' + k, label: (st.tab === k ? '✓ ' : '') + tname(k).replace('♥ ', ''), onclick: () => pick(k) });
      openCtx(r.left, r.bottom + 2, [...hiddenKeys().map(mk), ...(hiddenKeys().length ? [{ sep: true }] : []), ...T.more.map(mk), { sep: true }, { id: 'tools', label: 'Tools in Expanded view', disabled: true }], { label: 'More ways to browse', from: more }); };
    try { ro = new ResizeObserver(() => refit()); ro.observe(wrap); ro.observe(row); } catch { /* old browser: the events above re-fit */ }
    try { const io = new IntersectionObserver(() => refit()); io.observe(wrap); } catch { /* old browser */ }
    requestAnimationFrame(refit);
    return wrap;
  };
  const tabs = () => {
    const T = libTabs(expanded);
    if (compact && !expanded) return ctabRow(T);
    return h('div', { class: 'tabs' + (expanded ? ' xtabs' : ''), role: 'tablist' }, [...T.main, ...(T.row2 || [])].map(k => tabBtn(k)), moreSel(T.more),
      T.tools.length ? [h('span', { class: 'tabsep small dim', 'aria-hidden': 'true' }, 'TOOLS'), ...T.tools.map(k => tabBtn(k, 'tooltab'))] : null);
  };
  const push = page => { st.stack.push(page); draw(); };
  const back = () => { st.stack.pop(); draw(); };
  const save = () => saveLibPrefs(P);
  // 0.2.1 F4: Expanded = tiles on every tab by default (per-tab Tiles/List); the narrow panel keeps its own album grid/list choice.
  const gridOn = kind => (expanded ? tabView(P, kind, session) === 'grid' : P.compactView === 'grid' && GRID_KINDS.has(kind));
  const setView = (kind, v) => { if (expanded) { if (P.remember) { P.views[kind] = v; delete session[kind]; } else session[kind] = v; } else P.compactView = v; save(); draw(); };

  // ---- rows ----
  const nameRow = (title, sub, art, ref, onopen, glyph = '♪', rnd = false, extra = null, gen = null) => {
    const el = h('li', { class: 'item', onclick: onopen }, cover(art, 'sm' + (rnd ? ' rnd' : ''), glyph, gen), h('div', { class: 't' }, h('div', { class: 't1 ell' }, title), h('div', { class: 't2 ell' }, sub)), extra);
    return ref ? attachItem(S, el, ref, title) : el;
  };
  const artistRow = a => {
    const el = h('li', { class: 'item', onclick: () => push({ title: a.name, kind: 'albums', load: () => albumsPage({ artist: a.name }) }) }, artistCover(a.name, a.artTrackIds, 'sm rnd', 96),
      h('div', { class: 't' }, h('div', { class: 't1 ell' }, a.name), h('div', { class: 't2 ell' }, `${a.albums} album${a.albums === 1 ? '' : 's'} • ${a.tracks} song${a.tracks === 1 ? '' : 's'}`)));
    return attachItem(S, el, refNode('artist:' + a.name), a.name, { count: a.tracks ?? null, kind: 'Artist' });
  };
  const openAlbum = al => push({ title: al.album, kind: 'songs', load: () => tracksPage(al) });
  const albumRow = al => nameRow(al.album, [al.artist, al.year || null, `${al.tracks} song${al.tracks === 1 ? '' : 's'}`].filter(Boolean).join(' • '), trackArt(al.artTrackId, 96), refNode(albumNode(al.artist, al.album)), () => openAlbum(al), '♫', false, heartBtn(S, 'album', albumRef(al.artist, al.album), al.album), { album: al.album, artist: al.artist });
  const playingAlbum = al => { const it = S.now?.item; return !!it && it.album === al.album && (it.albumArtist === al.artist || it.artist === al.artist); };
  const albumTile = al => {
    const ref = refNode(albumNode(al.artist, al.album));
    const el = h('li', { class: 'tile' + (playingAlbum(al) ? ' playing' : ''), onclick: () => openAlbum(al) },
      h('div', { class: 'tileart' }, cover(trackArt(al.artTrackId, 384), 'lg', '♫', { album: al.album, artist: al.artist }),
        playingAlbum(al) ? h('span', { class: 'tilebadge' }, '▮▮▮ Playing') : null,
        heartBtn(S, 'album', albumRef(al.artist, al.album), al.album),
        canControl(S) ? h('button', { type: 'button', class: 'tileplay', 'aria-label': `Play ${al.album}`, onclick: ev => { ev.stopPropagation(); playNow(ref); } }, '▶') : null),
      h('div', { class: 't1 ell', title: al.album }, al.album), h('div', { class: 't2 ell' }, albumSub(al)), al.tracks != null ? h('div', { class: 't3' }, h('span', { class: 'tcount' }, songsLabel(al.tracks))) : null);   // 0.3.5 J11
    return attachItem(S, el, ref, al.album, { more: false, count: al.tracks ?? null, kind: 'Album' });   // tiles: right-click / long-press menu, no ⋯ row
  };
  // ---- 0.2.1 F4 / F13 tiles: artists (round), genres + years (color blocks with a cover collage), folders (2x2 mosaic) ----
  const playBtn = (ref, label) => canControl(S) ? h('button', { type: 'button', class: 'tileplay', 'aria-label': `Play ${label}`, onclick: ev => { ev.stopPropagation(); playNow(ref); } }, '▶') : null;
  const artistTile = a => {
    const ref = refNode('artist:' + a.name);
    const el = h('li', { class: 'tile atile', onclick: () => push({ title: a.name, kind: 'albums', load: () => albumsPage({ artist: a.name }) }) },
      h('div', { class: 'tileart rnd' }, artistArt(a), playBtn(ref, a.name)),
      h('div', { class: 't1 ell', title: a.name }, a.name), h('div', { class: 't2 ell' }, `${a.albums} album${a.albums === 1 ? '' : 's'} · ${a.tracks} song${a.tracks === 1 ? '' : 's'}`));
    return attachItem(S, el, ref, a.name, { more: false, count: a.tracks ?? null, kind: 'Artist' });
  };
  // 0.3.5 J10: theme-colored tiles with a pattern per name (no album covers), a soft scrim behind the text, a bold title and a clear count
  const blockTile = key => n => {
    const ref = refNode(key + ':' + n.name), t = tileSpec(n.name);
    const el = h('li', { class: 'tile btile', onclick: () => push({ title: n.name, kind: 'albums', load: () => albumsPage({ [key]: key === 'year' ? +n.name : n.name }) }) },
      h('div', { class: `gblock j10 p-${t.pattern} lead${t.lead}`, style: `--gmix:${t.mix}%` }, tilePattern(t),
        h('b', { class: 'gname ell', title: n.name }, n.name), tileCountEl(n), playBtn(ref, n.name)));
    return attachItem(S, el, ref, n.name, { more: false, count: n.tracks ?? null, kind: key === 'year' ? 'Year' : 'Genre' });
  };
  const tileCountEl = n => h('span', { class: 'gsub gcount', title: tileCount(n) }, h('b', null, songsLabel(n.tracks)), h('span', { class: 'galb' }, ` · ${n.albums} album${n.albums === 1 ? '' : 's'}`));
  const genreTile = blockTile('genre');
  const yearTile = blockTile('year');
  const decadeTile = (n, rows) => { const t = tileSpec(n.name);
    const el = h('li', { class: 'tile btile dtile', 'data-decade': n.name, onclick: () => push({ title: n.name, kind: 'years', load: async () => { st.decade = true; try { return [list('years', rows, countRow('📅', 'year'), yearTile)]; } finally { st.decade = false; } } }) },
      h('div', { class: `gblock j10 p-${t.pattern} lead${t.lead}`, style: `--gmix:${t.mix}%` }, tilePattern(t), h('b', { class: 'gname ell' }, n.name), tileCountEl(n)));
    return attachItem(S, el, refNode('decade:' + n.name), n.name, { more: false, count: n.tracks, kind: 'Decade' }); };
  const folderTile = f => {
    const ids = (f.artTrackIds || []).slice(0, 4), name = f.name.split(/[\\/]/).filter(Boolean).pop() || f.name;
    const el = h('li', { class: 'tile ftile', onclick: () => push({ title: name, kind: 'folders', load: () => foldersPage(f.path), folder: f.path }) },
      h('div', { class: 'tileart fmosaic' + (ids.length < 2 ? ' one' : '') }, ...(ids.length ? ids.map(id => cover(trackArt(id, 192), 'fm', '♫')) : [h('div', { class: 'cover fm' }, '📁')]),
        h('span', { class: 'fbadge', 'aria-hidden': 'true' }, folderGlyph()), playBtn(refNode('folder:' + f.path), name)),
      h('div', { class: 't1 ell', title: f.name }, name), h('div', { class: 't2' }, `${f.tracks} track${f.tracks === 1 ? '' : 's'}`));
    return attachItem(S, el, refNode('folder:' + f.path), name, { more: false, count: f.tracks ?? null, kind: 'Folder' });
  };
  const countRow = (glyph, key) => n => nameRow(n.name, `${n.tracks} song${n.tracks === 1 ? '' : 's'} • ${n.albums} album${n.albums === 1 ? '' : 's'}`, null, refNode(key + ':' + n.name), () => push({ title: n.name, kind: 'albums', load: () => albumsPage({ [key]: key === 'year' ? +n.name : n.name }) }), glyph);

  // ---- lists (sorted, letter strip) ----
  let jump = null;
  function list(kind, rows, make, tile = make === albumRow ? albumTile : null) {
    const key = P.sort[kind], sorted = sortRows(kind, rows, key, P.flip[kind], seed); st.count = rows.length; st.kind = kind;
    const grid = !!tile && gridOn(kind);
    const mk = grid ? tile : make;
    if (grid && kind === 'years' && (key || 'name') === 'name' && !st.decade) {   // 0.3.5 J10/J11: Years open as decade tiles, then single years
      const ul = h('ul', { class: 'tilegrid tg-years tg-decades' });
      for (const g of byDecade(sorted)) { const sum = { name: g.key, tracks: g.rows.reduce((a, r) => a + (r.tracks || 0), 0), albums: g.rows.reduce((a, r) => a + (r.albums || 0), 0) };
        ul.append(decadeTile(sum, g.rows)); }
      return ul;
    }
    const ul = h('ul', { class: grid ? 'tilegrid tg-' + kind : 'list' }); const ch = chunked(ul, sorted, (row, i) => mk(row, i, sorted));
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
  /** 0.2.1 F13 album page: header tinted with the cover's dominant color, big cover, ALBUM label, title, artist · year · songs, minutes,
   * round Play / Shuffle / heart (same round buttons as the F10 control panel), then the track list (# / Title / Time, playing row lit). */
  async function tracksPage(al) {
    const rows = await api(`/library/tracks?artist=${encodeURIComponent(al.artist)}&album=${encodeURIComponent(al.album)}`);
    const ids = rows.map(t => t.id), ref = refNode(albumNode(al.artist, al.album));
    const year = al.year || rows.find(t => t.year)?.year, mins = Math.max(1, Math.round(rows.reduce((a, t) => a + (t.durationMs || 0), 0) / 60000));
    const art = cover(trackArt(al.artTrackId ?? ids[0], 640), 'albcover', '♫', { album: al.album, artist: al.artist });
    const head = h('header', { class: 'albhead' }, art,
      h('div', { class: 'albmeta' }, h('div', { class: 'albkind' }, 'ALBUM'), h('h2', { class: 'albtitle', title: al.album }, al.album),
        h('div', { class: 'albsub' }, h('b', null, al.artist), year ? h('span', null, ' · ' + year) : null, h('span', null, ` · ${rows.length} song${rows.length === 1 ? '' : 's'}, ${mins} min`)),
        h('div', { class: 'albacts' },
          canControl(S) ? h('button', { type: 'button', class: 'tbtn albplay', 'aria-label': `Play ${al.album}`, title: 'Play', onclick: () => playNow(ref) }, icon('play')) : null,
          canControl(S) ? h('button', { type: 'button', class: 'tbtn albround', 'aria-label': `Shuffle ${al.album}`, title: 'Shuffle', onclick: () => playShuffled(ids) }, icon('shuffle')) : null,
          heartBtn(S, 'album', albumRef(al.artist, al.album), al.album, { round: true }),
          canControl(S) ? h('button', { type: 'button', class: 'linkbtn', onclick: () => addToQueue(ref) }, 'Add to queue') : null,
          canControl(S) ? h('button', { type: 'button', class: 'linkbtn', onclick: () => pickPlaylist(S, ref) }, 'Add to playlist') : null)));
    const img = art.querySelector('img');
    const tint = () => { const c = dominantColor(img); if (c) head.style.setProperty('--dom', c); };
    if (img) img.addEventListener('load', () => img.naturalWidth && tint(), { once: true });
    return [h('div', { class: 'albpage' }, head,
      h('div', { class: 'albcols', 'aria-hidden': 'true' }, h('span', { class: 'num' }, '#'), h('span', { class: 'grow' }, 'TITLE'), h('span', { class: 'dur' }, 'TIME')),
      trackList(rows, 'songs', true))];
  }
  const isPlayingTrack = t => { const it = S.now?.item; return !!it && (it.refId === t.id || (it.kind === 'track' && it.id === t.id)) && it.kind !== 'radio'; };
  const trackList = (rows, kind = 'songs', albumPage = false) => list(kind, rows, (t, i, shown) => {
    const on = isPlayingTrack(t);
    const el = h('li', { class: 'item' + (on ? ' playing' : ''), onclick: ev => { if (on) pulse(ev.currentTarget); return canControl(S) ? playNow({ kind: 'tracks', ids: shown.map(x => x.id), index: i }) : toast('Your access is view-only.'); } }, h('span', { class: 'num' }, on ? '▮▮▮' : t.trackNo ?? i + 1), h('div', { class: 't' }, h('div', { class: 't1 ell' }, t.title), h('div', { class: 't2 ell' }, (albumPage ? [t.artist] : [t.artist, t.album]).filter(Boolean).join(' • '))),
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
  for (const k of EXTRA_TABS) rootPage[k] = async () => { const v = extras[k]; if (!v) return [empty('Not available here.')]; v.reload?.(); st.kind = null; return [h('div', { class: 'libextra', 'data-extra': k }, v.el)]; };
  const pageKind = () => st.q ? null : st.stack.length ? st.stack[st.stack.length - 1].kind : EXTRA_TABS.has(st.tab) ? null : st.tab;

  /** Sort select + A-Z / Z-A flip + grid/list (+ count when expanded). Remembered per tab per browser. */
  function drawTools(kind) {
    if (!kind || !SORTS[kind]) { tools.replaceChildren(expanded ? h('span', { class: 'grow' }) : '', expanded && st.count != null ? h('span', { class: 'small dim' }, `${st.count} results`) : ''); return; }
    const sel = ddBtn('libsort', 'Sort', (SORTS[kind].find(([v]) => v === P.sort[kind]) || SORTS[kind][0])[1], SORTS[kind], P.sort[kind], v => { P.sort[kind] = v; save(); draw(); });
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
      root.dataset.tab = st.tab; root.classList.toggle('extratab', EXTRA_TABS.has(st.tab) && !st.q && !st.stack.length);
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
    setExpanded(on) { expanded = !!on; P.expanded = expanded; if (!expanded && TOOL_TABS.some(t => t[0] === st.tab)) st.tab = 'artists'; save(); draw(); },
    /** 0.3.5 J9: open a tab from a menu (Library > Playlists / Radio / tools). */
    showTab(k) { pick(k); }, get tab() { return st.tab; } };
}

/** 0.3.5 J10: the tile pattern as a small inline SVG painted with theme colors (CSS variables), deterministic from the tile seed. */
function tilePattern(t) {
  let x = t.seed || 1; const r = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
  let body = '';
  if (t.pattern === 'waves') for (let i = 0; i < 6; i++) { const y = 40 + i * 9, a = 4 + r() * 8; body += `<path d="M0 ${y} C 40 ${y - a}, 80 ${y + a}, 120 ${y} S 200 ${y - a}, 240 ${y}" fill="none" class="pl" stroke-width="1.2"/>`; }
  else if (t.pattern === 'bars') for (let i = 0; i < 16; i++) { const hgt = 10 + r() * 40; body += `<rect x="${6 + i * 14.5}" y="${100 - hgt}" width="8" height="${hgt}" class="pf"/>`; }
  else if (t.pattern === 'dots') for (let y = 8; y < 100; y += 14) for (let i = 0; i < 18; i++) body += `<circle cx="${8 + i * 13.5 + (y % 28 ? 6 : 0)}" cy="${y}" r="1.6" class="pf"/>`;
  else { const cx = 170 + r() * 50, cy = 60 + r() * 30; for (let i = 1; i < 9; i++) body += `<circle cx="${cx}" cy="${cy}" r="${i * 11}" fill="none" class="pl" stroke-width="1.2"/>`; }
  const el = h('div', { class: 'gpat', 'aria-hidden': 'true' }); el.innerHTML = `<svg viewBox="0 0 240 100" preserveAspectRatio="none">${body}</svg>`; return el;
}

import { h, api, toast, fmtTime } from './util.js';
import { cover, trackArt, albumArt, artTrackId } from './art.js';
import { attachItem, refTracks, refNode, albumNode, canControl, playNow, addToQueue, chunked, pickPlaylist } from './ui.js';

const TABS = [['artists', 'Artists'], ['albums', 'Albums'], ['genres', 'Genres'], ['years', 'Years'], ['recent', 'Recently added'], ['folders', 'Folders']];

/** Tag-based library: grouping comes from the songs' tags (Artist/Album/Genre/Year), never from the folder layout. Folders is its own tab. */
export function libraryView(S, opts = {}) {
  const compact = !!opts.compact;       // desktop left panel: ARTISTS / ALBUMS / GENRES / FOLDERS + a count, Years and Recently added under "more"
  const st = { tab: (compact ? S.libTabC : S.libTab) || (compact ? 'artists' : 'albums'), stack: [], q: '', count: null, dirty: false };
  const root = h('div', { class: compact ? 'lib compact' : 'lib' }), head = h('div'), crumbs = h('div', { class: 'crumbs' }), content = h('div', { class: 'libcontent' }), countEl = h('div', { class: 'libcount small dim' });
  const search = h('input', { type: 'search', placeholder: 'Search songs, albums and artists…', 'aria-label': 'Search the library', oninput: ev => { clearTimeout(search._t); search._t = setTimeout(() => { st.q = ev.target.value.trim(); draw(); }, 250); } });
  root.append(h('div', { class: 'field' }, search), head, countEl, crumbs, content);

  const MAIN = ['artists', 'albums', 'genres', 'folders'];
  const pick = k => { st.tab = k; if (compact) S.libTabC = k; else S.libTab = k; st.stack = []; st.q = ''; search.value = ''; draw(); };
  const tabs = () => compact
    ? h('div', { class: 'tabs ctabs', role: 'tablist' }, TABS.filter(([k]) => MAIN.includes(k)).map(([k, t]) => h('button', { role: 'tab', class: st.tab === k && !st.stack.length ? 'on' : '', onclick: () => pick(k) }, t.toUpperCase())),
        h('select', { 'aria-label': 'More ways to browse', class: 'moresel' + (MAIN.includes(st.tab) ? '' : ' on'), onchange: ev => ev.target.value && pick(ev.target.value) }, h('option', { value: '' }, '⋯'), h('option', { value: 'years', selected: st.tab === 'years' }, 'Years'), h('option', { value: 'recent', selected: st.tab === 'recent' }, 'Recently added')))
    : h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, t]) => h('button', { role: 'tab', class: st.tab === k && !st.stack.length ? 'on' : '', onclick: () => pick(k) }, t)));
  const push = page => { st.stack.push(page); draw(); };
  const back = () => { st.stack.pop(); draw(); };

  const nameRow = (title, sub, art, ref, onopen, glyph = '♪', rnd = false) => {
    const el = h('li', { class: 'item', onclick: onopen }, cover(art, 'sm' + (rnd ? ' rnd' : ''), glyph), h('div', { class: 't' }, h('div', { class: 't1 ell' }, title), h('div', { class: 't2 ell' }, sub)));
    return ref ? attachItem(S, el, ref, title) : el;
  };
  const artistRow = a => nameRow(a.name, `${a.albums} album${a.albums === 1 ? '' : 's'} • ${a.tracks} song${a.tracks === 1 ? '' : 's'}`, trackArt(a.artTrackId, 96), refNode('artist:' + a.name), () => push({ title: a.name, load: () => albumsPage({ artist: a.name }, a.name) }), '♪', true);
  const albumRow = al => nameRow(al.album, [al.artist, al.year || null, `${al.tracks} song${al.tracks === 1 ? "" : "s"}`].filter(Boolean).join(' • '), trackArt(al.artTrackId, 96), refNode(albumNode(al.artist, al.album)), () => push({ title: al.album, load: () => tracksPage(al) }), '♫');
  const countRow = (glyph, key) => n => nameRow(n.name, `${n.tracks} song${n.tracks === 1 ? "" : "s"} • ${n.albums} album${n.albums === 1 ? '' : 's'}`, null, refNode(key + ':' + n.name), () => push({ title: n.name, load: () => albumsPage({ [key]: key === 'year' ? +n.name : n.name }, n.name) }), glyph);

  const list = (rows, make) => { st.count = rows.length; const ul = h('ul', { class: 'list' }); chunked(ul, rows, make); return ul; };
  const empty = txt => h('p', { class: 'dim' }, txt);
  async function albumsPage(q, title, sort = 'artist') {
    const qs = new URLSearchParams({ ...q, sort }).toString();
    const rows = await api('/library/albums?' + qs);
    return [rows.length ? list(rows, albumRow) : empty('No albums here.')];
  }
  async function tracksPage(al) {
    const rows = await api(`/library/tracks?artist=${encodeURIComponent(al.artist)}&album=${encodeURIComponent(al.album)}`);
    const ids = rows.map(t => t.id), ref = refNode(albumNode(al.artist, al.album));
    return [h('div', { class: 'hero' }, cover(trackArt(al.artTrackId ?? ids[0], 384), ''), h('div', { class: 'grow' }, h('h2', null, al.album), h('div', { class: 'dim' }, [al.artist, al.year].filter(Boolean).join(' • ')),
      canControl(S) ? h('div', { class: 'row wrap', style: 'margin-top:8px' }, h('button', { class: 'btn primary', onclick: () => playNow(ref) }, '▶ Play'), h('button', { class: 'btn', onclick: () => addToQueue(ref) }, 'Add to queue'), h('button', { class: 'btn', onclick: () => pickPlaylist(S, ref) }, 'Add to playlist')) : null)),
    trackList(rows)];
  }
  const trackList = rows => list(rows, (t, i) => {
    const el = h('li', { class: 'item', onclick: () => canControl(S) ? playNow({ kind: 'tracks', ids: rows.map(x => x.id), index: i }) : toast('Your access is view-only.') }, h('span', { class: 'num' }, t.trackNo ?? i + 1), h('div', { class: 't' }, h('div', { class: 't1 ell' }, t.title), h('div', { class: 't2 ell' }, [t.artist, t.album].filter(Boolean).join(' • '))), h('span', { class: 'dur' }, fmtTime(t.durationMs)));
    return attachItem(S, el, refTracks([t.id]), t.title);
  });
  async function foldersPage(path) {
    const r = await api('/library/folders' + (path ? '?path=' + encodeURIComponent(path) : ''));
    const rows = [];
    if (path) rows.push(h('li', { class: 'item', onclick: () => { st.stack.pop(); draw(); } }, h('div', { class: 't' }, h('div', { class: 't1' }, '‹ Up'))));
    for (const f of r.folders) { const el = h('li', { class: 'item', onclick: () => push({ title: f.name.split(/[\\/]/).pop() || f.name, load: () => foldersPage(f.path), folder: f.path }) }, h('span', { class: 'cover sm' }, '📁'), h('div', { class: 't' }, h('div', { class: 't1 ell' }, f.name), h('div', { class: 't2' }, `${f.tracks} songs`))); rows.push(attachItem(S, el, refNode('folder:' + f.path), f.name)); }
    const out = [h('ul', { class: 'list' }, rows)];
    if (r.tracks.length) out.push(h('div', { class: 'sec' }, 'Songs in this folder'), trackList(r.tracks));
    if (!r.folders.length && !r.tracks.length) out.push(empty('This folder has no songs WavWiz can read.'));
    return out;
  }
  async function findPage(q) {
    const r = await api('/library/find?q=' + encodeURIComponent(q));
    const out = [];
    if (r.artists.length) out.push(h('div', { class: 'sec' }, 'Artists'), h('ul', { class: 'list' }, r.artists.slice(0, 12).map(artistRow)));
    if (r.albums.length) out.push(h('div', { class: 'sec' }, 'Albums'), h('ul', { class: 'list' }, r.albums.slice(0, 20).map(albumRow)));
    if (r.tracks.length) out.push(h('div', { class: 'sec' }, 'Songs'), trackList(r.tracks));
    return out.length ? out : [empty(`Nothing found for “${q}”.`)];
  }
  const rootPage = {
    artists: async () => { const rows = await api('/library/artists'); return [rows.length ? list(rows, artistRow) : empty('No music yet. Add a music folder in Settings > Library.')]; },
    albums: async () => { const sort = S.albumSort || 'artist'; const sel = h('select', { 'aria-label': 'Sort albums', onchange: ev => { S.albumSort = ev.target.value; draw(); } }, [['artist', 'By artist'], ['name', 'By album name'], ['year', 'By year (newest)'], ['recent', 'Recently added']].map(([v, t]) => h('option', { value: v, selected: v === sort }, t))); return [h('div', { class: 'field' }, sel), ...await albumsPage({}, '', sort)]; },
    genres: async () => { const rows = await api('/library/genres'); return [rows.length ? list(rows, countRow('♬', 'genre')) : empty('No genre tags found. Songs without a genre appear under Cleanup.')]; },
    years: async () => { const rows = await api('/library/years'); return [rows.length ? list(rows, countRow('📅', 'year')) : empty('No year tags found.')]; },
    recent: async () => { const rows = await api('/library/recent?limit=120'); return [rows.length ? list(rows, albumRow) : empty('Nothing added yet.')]; },
    folders: async () => foldersPage(''),
  };

  let drawing = 0;
  const visible = () => root.isConnected && root.getClientRects().length > 0;
  async function draw() {
    if (!visible()) { st.dirty = true; return; }       // hidden copy (phone vs desktop layout): draw when it is shown
    st.dirty = false; const my = ++drawing; st.count = null;
    head.replaceChildren(h('div', { class: 'row' }, tabs()));
    crumbs.replaceChildren();
    if (st.stack.length) crumbs.append(h('button', { class: 'btn', onclick: back }, '‹ Back'), h('b', { class: 'ell' }, st.stack[st.stack.length - 1].title));
    content.replaceChildren(h('p', { class: 'dim' }, 'Loading…'));
    try {
      const nodes = st.q ? await findPage(st.q) : st.stack.length ? await st.stack[st.stack.length - 1].load() : await rootPage[st.tab]();
      if (my === drawing) { content.replaceChildren(...nodes); const lab = ({ artists: 'artists', albums: 'albums', genres: 'genres', years: 'years', recent: 'albums', folders: '' })[st.tab]; countEl.textContent = compact && st.count != null && !st.stack.length && !st.q && lab ? `${st.count} ${lab}` : ''; }
    } catch (e) { if (my === drawing) content.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }
  window.addEventListener('wavwiz:library', () => draw());
  window.addEventListener('resize', () => { if (st.dirty && visible()) draw(); });
  draw();
  return { el: root, reload: draw, get dirty() { return st.dirty; } };
}

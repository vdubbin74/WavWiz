import { h, api, toast, fmtTime } from './util.js';
import { cover, coverGlyph, trackArt, artistCover } from './art.js';
import { icon } from './icons.js';
import { pulse } from './motion.js';
import { attachItem, refTracks, refNode, albumNode, canControl, playNow, playShuffled, addToQueue, chunked, pickPlaylist, songsLabel } from './ui.js';
import { SORTS, loadLibPrefs, saveLibPrefs, sortRows, isLetterSort, letterIndex, LETTERS, fitAzLetters, visibleCssHeight, tabView, VIEW_TABS, blockColors, tileSpec, tileCount, byDecade } from './libsort.js';
import { heartBtn, albumRef, loadFavs } from './fav.js';
import { openCtx } from './ctxmenu.js';

const TABS = [['artists', 'Artists'], ['albums', 'Albums'], ['genres', 'Genres'], ['years', 'Years'], ['recent', 'Recently added'], ['folders', 'Folders'], ['favorites', '♥ Favorites'], ['playlists', 'Playlists'], ['radio', 'Radio'], ['remote', 'Remote']];
// 0.3.5 J9: Playlists + Radio were category tabs; F235 made them sources; F239 promotes sources to top xtabs above search.
const ALL_TOOL_TABS = [['rip', 'CD ripper'], ['tags', 'Tag & cover fix'], ['cleanup', 'Tidy up library']];
// 0.4.8 F57: the CD ripper only exists in the PC app (this machine, not a phone/remote browser) - decided by client type, not screen width
let ripOk = false;
export function setRipAllowed(auth, ua = navigator.userAgent) { ripOk = !!auth?.thisMachine && (auth?.serverOs ?? 'windows') === 'windows' && !/iPhone|iPad|iPod|Android|Mobile/i.test(ua); document.documentElement.dataset.rip = ripOk ? '1' : '0'; TOOL_TABS = ALL_TOOL_TABS.filter(t => t[0] !== 'rip' || ripOk); return ripOk; }
export const ripAllowed = () => ripOk;
export let TOOL_TABS = ALL_TOOL_TABS.filter(t => t[0] !== 'rip');
export const EXTRA_TABS = new Set(['playlists', 'radio', 'rip', 'tags', 'cleanup']);
export const LIB_SOURCES = ['local', 'remote', 'radio', 'playlists'];
export const LIB_SOURCE_KEY = 'wavwiz.libSource';
export const LIB_RSID_KEY = 'wavwiz.libRsid';
const LOCAL_CATS = new Set(['artists', 'albums', 'genres', 'years', 'recent', 'folders', 'favorites']);
const REMOTE_CATS = new Set(['artists', 'albums', 'recent']);
const tabToRmode = k => k === 'recent' ? 'newest' : (k === 'artists' ? 'artists' : 'albums');
/** F235/F239: category strip by source. Radio / Playlists / Remote are top source tabs (never rs:*). Tools ⋯ Local-only. */
export function libTabs(expanded, source = 'local') {
  if (source === 'remote') {
    return expanded
      ? { main: ['artists', 'albums', 'recent'], more: [], tools: [] }
      : { main: ['artists', 'albums', 'recent'], row2: [], more: [], tools: [] };
  }
  // Local (default): Favorites / Folders stay; Radio + Playlists removed from the category strip
  return expanded
    ? { main: ['artists', 'albums', 'genres', 'years', 'recent', 'folders', 'favorites'], more: [], tools: TOOL_TABS.map(t => t[0]) }
    : { main: ['artists', 'albums', 'genres', 'folders'], row2: ['years', 'recent', 'favorites'], more: [], tools: [] };
}
/** F174 leftover key "rs:{serverId}" — still recognized for saved-tab migration (F235 drops the tabs). */
export const isRsTab = k => typeof k === 'string' && k.startsWith('rs:');
const GRID_KINDS = new Set(['albums', 'recent', 'favorites', 'artists', 'genres', 'years', 'remote', 'radio', 'playlists']);
const COUNT_LABEL = { artists: 'artists', albums: 'albums', genres: 'genres', years: 'years', recent: 'albums', folders: 'folders', favorites: 'favorites', songs: 'songs', radio: 'stations', playlists: 'playlists' };

const folderGlyph = () => icon('folder', 'fold-ic');
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
  const phone = !!opts.phone;            // F250-P2: opt-in full-page presentation, never desktop panels
  const compact = !!opts.compact;       // desktop left panel: ARTISTS / ALBUMS / GENRES / FOLDERS + a count, Years / Recently added / Favorites under "more"
  let expanded = false;
  let P = loadLibPrefs(); const seed = (Date.now() & 0xffff) || 1;
  const session = {};      // 0.2.1 F4: a Tiles/List pick that is not remembered (Remember view per tab off) lasts until the page reloads
  const st = { tab: (compact ? S.libTabC : S.libTab) || (compact ? 'artists' : 'albums'), stack: [], q: '', count: null, kind: null, dirty: false };
  const root = h('div', { class: compact ? 'lib compact' : (phone ? 'lib phone-library' : 'lib') }), head = h('div'), tools = h('div', { class: 'libtools' }), crumbs = h('div', { class: 'crumbs' }),
    content = h('div', { class: 'libcontent' }), strip = h('nav', { class: 'azstrip', 'aria-label': 'Jump to letter', hidden: true }), countEl = h('div', { class: 'libcount small dim' });
    const azBubble = h('div', { class: 'azbubble', hidden: true, 'aria-hidden': 'true' });
    const hideAzBubble = () => { azBubble.hidden = true; azBubble.textContent = ''; };
    const showAzBubble = (letter, ev) => {
      if (!letter) return hideAzBubble();
      azBubble.textContent = letter;
      azBubble.hidden = false;
      const r = strip.getBoundingClientRect();
      const y = (ev && (ev.clientY ?? ev.touches?.[0]?.clientY)) ?? (r.top + r.height / 2);
      azBubble.style.top = `${Math.max(8, Math.min(r.height - 8, y - r.top))}px`;
    };
    const azBtnAt = ev => {
      const pt = ev.touches?.[0] || ev.changedTouches?.[0] || ev;
      const y = pt.clientY, buttons = [...strip.querySelectorAll('button[data-letter]')];
      if (!buttons.length) return null;
      let best = null, bestD = Infinity;
      for (const b of buttons) {
        const r = b.getBoundingClientRect(), mid = (r.top + r.bottom) / 2, d = Math.abs(mid - y);
        if (d < bestD) { bestD = d; best = b; }
      }
      return best;
    };
    const azClipHeight = el => {
      if (!el) return 0;
      const ch = el.clientHeight;
      const r = el.getBoundingClientRect?.();
      if (!r || !(r.height > 0)) return ch || 0;
      let vis = r.height;
      const clip = (top, bot) => { vis = Math.min(vis, Math.max(0, Math.min(r.bottom, bot) - Math.max(r.top, top))); };
      for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
        const oy = n.ownerDocument?.defaultView?.getComputedStyle?.(n)?.overflowY || '';
        if (oy === 'auto' || oy === 'scroll' || oy === 'hidden' || oy === 'clip') {
          const p = n.getBoundingClientRect();
          clip(p.top, p.bottom);
        }
      }
      const win = el.ownerDocument?.defaultView, vv = win?.visualViewport;
      if (vv) clip(vv.offsetTop, vv.offsetTop + vv.height);
      else if (win) clip(0, win.innerHeight);
      return visibleCssHeight(ch, r.height, vis);
    };
    const paintAz = (idx) => {
      const hgt = azClipHeight(strip.parentElement);
      const plan = fitAzLetters(hgt);
      const nLet = plan.filter(it => it.kind === 'letter').length;
      const fs = hgt && nLet ? Math.max(6, Math.min(11, (hgt - 8) / nLet)) : 10;
      strip.style.setProperty('--az-fs', fs + 'px');
      strip.replaceChildren(...plan.map(it => {
        if (it.kind === 'dot') return h('span', { class: 'azdot', 'aria-hidden': 'true' }, '·');
        const ch = it.ch, on = idx.has(ch);
        return h('button', { type: 'button', class: on ? '' : 'off', disabled: !on, 'data-letter': ch, 'aria-label': `Jump to ${ch}` }, ch);
      }), azBubble);
      strip.style.height = hgt ? hgt + 'px' : '';
    };
    let azScrub = false;
    const azFrom = (ev, hop) => {
      const btn = azBtnAt(ev); if (!btn) return;
      const l = btn.dataset.letter;
      showAzBubble(l, ev);
      if (hop && !btn.disabled) jump?.(l);
    };
    strip.addEventListener('pointerdown', ev => {
      if (ev.button != null && ev.button !== 0) return;
      const btn = ev.target.closest?.('button[data-letter]');
      azScrub = true;
      try { strip.setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
      if (btn) azFrom(ev, true);
      ev.preventDefault();
    });
    strip.addEventListener('pointermove', ev => { if (azScrub) azFrom(ev, true); });
    const endAz = ev => { if (!azScrub) return; azFrom(ev, true); azScrub = false; hideAzBubble(); };
    strip.addEventListener('pointerup', endAz);
    strip.addEventListener('pointercancel', endAz);
    strip.addEventListener('pointerleave', ev => { if (!azScrub) hideAzBubble(); });
    let azRaf = 0;
    const azResize = () => {
      const go = () => { azRaf = 0; if (!strip.hidden && strip._azIdx) paintAz(strip._azIdx); };
      if (typeof requestAnimationFrame === 'function') { if (azRaf) return; azRaf = requestAnimationFrame(go); }
      else go();
    };

  // 0.2.1 F5: the filter box is ONE persistent element. Redraws never re-create or re-parent it while you type (that dropped focus after
  // every keystroke); filtering is debounced, and focus + caret are restored if a layout switch ever has to move it.
  const search = h('input', { type: 'search', placeholder: 'Search songs, albums and artists…', 'aria-label': 'Search the library', oninput: ev => { clearTimeout(search._t); search._t = setTimeout(() => { const q = ev.target.value.trim(); if (q !== st.q) { st.q = q; draw(); } }, 250); } });
  const searchField = h('div', { class: 'field libsearch' }, search);
  // F239: source tabs (Local|Remote|Radio|Playlists) above search — xtabs underline chrome in compact + expanded
  const srcSlot = h('div', { class: 'libsrcslot' });
  const tabsSlot = h('div', { class: 'libtabslot' }), headRow = h('div', { class: 'row libhead' }, tabsSlot);
  head.append(headRow);
  root.append(srcSlot, searchField, head, tools, countEl, crumbs, h('div', { class: 'libscroll' }, content, strip));
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(azResize).observe(strip.parentElement);
  if (typeof window !== 'undefined') {
    window.addEventListener('scroll', azResize, true);
    window.addEventListener('resize', azResize);
    window.visualViewport?.addEventListener('resize', azResize);
  }

  /** F239/t2544u: search always under source tabs — never into headRow (that jumped lines on expand). Preserve focus + caret. */
  const placeSearch = () => {
    if (searchField.parentElement === root && searchField.previousElementSibling === srcSlot) return;
    const had = document.activeElement === search, a = search.selectionStart, b = search.selectionEnd;
    srcSlot.after(searchField);
    if (had) { search.focus({ preventScroll: true }); try { search.setSelectionRange(a, b); } catch { /* type=search */ } }
  };
  const srcTabs = () => h('div', { class: 'tabs xtabs libsrc-tabs', role: 'tablist', 'aria-label': 'Library source' },
    ...[['local', 'Local'], ['remote', 'Remote'], ['radio', 'Radio'], ['playlists', 'Playlists']].map(([k, l]) =>
      h('button', { type: 'button', role: 'tab', 'data-src': k, class: st.source === k ? 'on' : '', 'aria-selected': String(st.source === k), onclick: () => setSource(k) }, l)));

  const extras = opts.extras || {};
  let RS = [];      // F174/F235/F239: /remote/servers rows — server chip on tools row when Remote + 2+ servers (never source tabs)
  const rsById = id => RS.find(x => x.id === id) || null;
  const loadRS = async () => { try { const r = await api('/remote/servers'), nx = r?.servers || [], sig = l => JSON.stringify(l.map(x => [x.id, x.label, !!x.lastError])), ch = sig(nx) !== sig(RS); RS = nx; return ch; } catch { return false; } };
  const saveTab = () => { if (compact) S.libTabC = st.tab; else S.libTab = st.tab; };
  const saveSource = () => { try { localStorage.setItem(LIB_SOURCE_KEY, st.source); } catch { /* private mode */ } };
  const saveRsid = () => { try { if (st.rsid) localStorage.setItem(LIB_RSID_KEY, st.rsid); } catch { /* private mode */ } };
  // F235: migrate saved F174 rs:* / radio / playlists / bare remote tabs into source + category
  const seedTab = st.tab;
  let seedSource = 'local', seedRsid = null;
  try { const s = localStorage.getItem(LIB_SOURCE_KEY); if (LIB_SOURCES.includes(s)) seedSource = s; } catch { /* */ }
  try { seedRsid = localStorage.getItem(LIB_RSID_KEY) || null; } catch { /* */ }
  if (isRsTab(seedTab)) { seedSource = 'remote'; seedRsid = seedTab.slice(3); st.tab = 'artists'; }
  else if (seedTab === 'remote') { seedSource = 'remote'; st.tab = 'artists'; }
  else if (seedTab === 'radio') { seedSource = 'radio'; st.tab = compact ? 'artists' : 'albums'; }
  else if (seedTab === 'playlists') { seedSource = 'playlists'; st.tab = compact ? 'artists' : 'albums'; }
  else if (!localStorage.getItem(LIB_SOURCE_KEY) && seedSource === 'local') { /* keep */ }
  st.source = seedSource; st.rsid = seedRsid; st.rmode = tabToRmode(st.tab);
  if (st.source === 'remote' && !REMOTE_CATS.has(st.tab)) { st.tab = 'artists'; st.rmode = 'artists'; }
  if (st.source === 'local' && !LOCAL_CATS.has(st.tab) && !TOOL_TABS.some(t => t[0] === st.tab)) { st.tab = compact ? 'artists' : 'albums'; }
  saveTab(); saveSource();
  const pick = k => {
    if (TOOL_TABS.some(t => t[0] === k)) { if (!expanded) k = 'artists'; st.source = 'local'; saveSource(); }
    st.tab = k; saveTab();
    if (st.source === 'remote') { st.rmode = tabToRmode(k); if (!REMOTE_CATS.has(k)) { st.tab = 'artists'; st.rmode = 'artists'; saveTab(); } }
    st.stack = []; st.q = ''; search.value = ''; draw();
  };
  const setSource = s => {
    if (!LIB_SOURCES.includes(s) || s === st.source) return;
    const prev = st.source; st.source = s; saveSource();
    st.stack = []; st.q = ''; search.value = '';
    if (s === 'remote') {
      if (!REMOTE_CATS.has(st.tab)) st.tab = 'artists';
      st.rmode = tabToRmode(st.tab); saveTab();
    } else if (s === 'local') {
      if (!LOCAL_CATS.has(st.tab) && !TOOL_TABS.some(t => t[0] === st.tab)) { st.tab = compact ? 'artists' : 'albums'; saveTab(); }
    } else { /* radio / playlists: leave last Local/Remote category prefs alone */ void prev; }
    draw();
  };
  const tname = k => (TABS.find(t => t[0] === k) || TOOL_TABS.find(t => t[0] === k) || [k, k])[1];
  const tabBtn = (k, cls = '') => h('button', { role: 'tab', 'data-tab': k, class: ((st.tab === k && !st.stack.length) ? 'on ' : '') + cls, 'aria-selected': String(st.tab === k), onclick: () => pick(k) }, compact && !expanded ? tname(k).toUpperCase() : tname(k));
  // 0.4.6 F40: no native <select> in the Library (WebView2 draws its open list in Windows colors): themed dropdown buttons that open the themed menu.
  const ddBtn = (cls, label, txt, opts, cur, onpick) => { const b = h('button', { type: 'button', class: 'wwdd ' + cls, 'aria-label': label, 'aria-haspopup': 'menu', title: label },
      h('span', { class: 'wwdd-t' }, txt), h('span', { class: 'wwdd-c', 'aria-hidden': 'true' }, '▾'));
    b.onclick = () => { const r = b.getBoundingClientRect(); openCtx(r.left, r.bottom + 2, opts.map(([v, t]) => ({ id: 'dd:' + v, label: (v === cur ? '✓ ' : '') + t, onclick: () => onpick(v) })), { label, from: b }); };
    return b; };
  const toolsSel = keys => ddBtn('moresel toolsel' + (keys.includes(st.tab) ? ' on' : ''), 'Tools', '⋯', keys.map(k => [k, tname(k)]), st.tab, k => pick(k));
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
      openCtx(r.left, r.bottom + 2, [...hiddenKeys().map(mk), ...T.more.map(mk), ...(hiddenKeys().length || T.more.length ? [{ sep: true }] : []), { id: 'tools', label: 'Tools in Expanded view', disabled: true }], { label: 'More ways to browse', from: more }); };
    try { ro = new ResizeObserver(() => refit()); ro.observe(wrap); ro.observe(row); } catch { /* old browser: the events above re-fit */ }
    try { const io = new IntersectionObserver(() => refit()); io.observe(wrap); } catch { /* old browser */ }
    requestAnimationFrame(refit);
    return wrap;
  };
  const tabs = () => {
    if (st.source === 'radio' || st.source === 'playlists') return h('div', { class: 'tabs libsrc-only', hidden: true });
    const T = libTabs(expanded, st.source);
    if (compact && !expanded) return ctabRow(T);
    return h('div', { class: 'tabs' + (expanded ? ' xtabs' : ''), role: 'tablist' }, [...T.main, ...(T.row2 || [])].map(k => tabBtn(k)),
      T.tools.length ? toolsSel(T.tools) : null);   // F172: the "⋯" dropdown = Tools only (Local)
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
      h('div', { class: 'tileart fmosaic' + (ids.length < 2 ? ' one' : '') }, ...(ids.length ? ids.map(id => cover(trackArt(id, 192), 'fm', '♫')) : [h('div', { class: 'cover fm' }, coverGlyph('folder'))]),
        h('span', { class: 'fbadge', 'aria-hidden': 'true' }, folderGlyph()), playBtn(refNode('folder:' + f.path), name)),
      h('div', { class: 't1 ell', title: f.name }, name), h('div', { class: 't2' }, `${f.tracks} track${f.tracks === 1 ? '' : 's'}`));
    return attachItem(S, el, refNode('folder:' + f.path), name, { more: false, count: f.tracks ?? null, kind: 'Folder' });
  };
  const countRow = (glyph, key) => n => nameRow(n.name, `${n.tracks} song${n.tracks === 1 ? '' : 's'} • ${n.albums} album${n.albums === 1 ? '' : 's'}`, null, refNode(key + ':' + n.name), () => push({ title: n.name, kind: 'albums', load: () => albumsPage({ [key]: key === 'year' ? +n.name : n.name }) }), glyph);

  // ---- lists (sorted, letter strip) ----
  let jump = null;
  let stripPlan = null; // applied only after draw() commits, so a stale list() cannot leak the rail onto tool pages
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
      stripPlan = idx; // letterIndex map; painted after draw() commits so height is the visible list
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
    return attachItem(S, el, refTracks([t.id]), t.title, { phoneSong: phone ? { ...t, kind: 'track', refId: t.id } : null });
  });
  async function foldersPage(path) {
    const r = await api('/library/folders' + (path ? '?path=' + encodeURIComponent(path) : ''));
    const out = [];
    if (path) out.push(h('ul', { class: 'list' }, h('li', { class: 'item', onclick: () => { st.stack.pop(); draw(); } }, h('div', { class: 't' }, h('div', { class: 't1' }, '‹ Up')))));
    const folderRow = f => { const el = h('li', { class: 'item', onclick: () => push({ title: f.name.split(/[\\/]/).pop() || f.name, kind: 'folders', load: () => foldersPage(f.path), folder: f.path }) }, h('span', { class: 'cover sm' }, coverGlyph('folder')), h('div', { class: 't' }, h('div', { class: 't1 ell' }, f.name), h('div', { class: 't2' }, `${f.tracks} songs`))); return attachItem(S, el, refNode('folder:' + f.path), f.name); };
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
  // ---- F164: Remote libraries (Subsonic / OpenSubsonic, e.g. Navidrome). WavWiz is the client; songs stream from the server, local library untouched. ----
  const rsong = x => ({ id: x.id, title: x.title, artist: x.artist, album: x.album, durationMs: x.durationMs, coverArt: x.coverArt, trackNo: x.trackNo, year: x.year, genre: x.genre });
  const rplay = (sid, songs, index = 0) => canControl(S) ? playNow({ kind: 'remote', server: sid, songs: songs.map(rsong), index }) : toast('Your access is view-only.');
  // F175 / 0.6.8: remote albums, artists and songs drag onto the WavWiz queue like local rows (queue drop POSTs the ref to /queue/add with the drop position)
  const rdrag = (el, sid, al, more = false) => attachItem(S, el, { kind: 'remote', server: sid, album: al.id }, al.album, { more, count: al.tracks ?? null, kind: 'Remote album' });
  const rartistDrag = (el, sid, a, more = false) => attachItem(S, el, { kind: 'remote', server: sid, artist: a.id }, a.name, { more, count: a.albums ?? null, kind: 'Remote artist' });
  const rsongDrag = (el, sid, t) => attachItem(S, el, { kind: 'remote', server: sid, songs: [rsong(t)] }, t.title, { more: !!phone, count: 1, kind: 'Remote song', phoneSong: phone ? { ...t, kind: 'remote' } : null });
  const rbadge = () => h('span', { class: 'small dim rbadge' }, ' · Remote');
  const ralbumRow = sid => al => { const el = h('li', { class: 'item', onclick: () => push({ title: al.album, kind: null, load: () => remoteAlbumPage(sid, al) }) }, cover(al.artUrl, 'sm', '♫', { album: al.album, artist: al.artist }),
      h('div', { class: 't' }, h('div', { class: 't1 ell' }, al.album), h('div', { class: 't2 ell' }, [al.artist, al.year || null, al.tracks != null ? `${al.tracks} song${al.tracks === 1 ? '' : 's'}` : null].filter(Boolean).join(' • '), rbadge())),
      canControl(S) ? h('button', { type: 'button', class: 'btn sm', 'aria-label': `Play ${al.album}`, onclick: ev => { ev.stopPropagation(); playNow({ kind: 'remote', server: sid, album: al.id }); } }, '▶') : null); return rdrag(el, sid, al, true); };
  const rartistRow = sid => a => { const el = h('li', { class: 'item', onclick: () => rartistOpen(sid, a) },
    cover(a.artUrl, 'sm rnd', '♪', { portrait: a.name }), h('div', { class: 't' }, h('div', { class: 't1 ell' }, a.name), h('div', { class: 't2 ell' }, `${a.albums} album${a.albums === 1 ? '' : 's'}`, rbadge()))); return rartistDrag(el, sid, a, true); };
  // F172: remote tiles (same tilegrid / tile size as the local Library): albums square, artists round
  const ralbumOpen = (sid, al) => push({ title: al.album, kind: null, load: () => remoteAlbumPage(sid, al) });
  const ralbumTile = sid => al => rdrag(h('li', { class: 'tile', onclick: () => ralbumOpen(sid, al) },
    h('div', { class: 'tileart' }, cover(al.artUrl, 'lg', '♫', { album: al.album, artist: al.artist }),
      canControl(S) ? h('button', { type: 'button', class: 'tileplay', 'aria-label': `Play ${al.album}`, onclick: ev => { ev.stopPropagation(); playNow({ kind: 'remote', server: sid, album: al.id }); } }, '▶') : null),
    h('div', { class: 't1 ell', title: al.album }, al.album), h('div', { class: 't2 ell' }, albumSub(al), rbadge())), sid, al);
  const rartistOpen = (sid, a) => push({ title: a.name, kind: 'remote', load: async () => { const rows = await api(`/remote/${sid}/artist/${encodeURIComponent(a.id)}`); return [rows.length ? rlist(sid, 'albums', rows) : empty('No albums.')]; } });
  const rartistTile = sid => a => rartistDrag(h('li', { class: 'tile atile', onclick: () => rartistOpen(sid, a) },
    h('div', { class: 'tileart rnd' }, cover(a.artUrl, 'lg rnd', '♪', { portrait: a.name })),
    h('div', { class: 't1 ell', title: a.name }, a.name), h('div', { class: 't2 ell' }, `${a.albums} album${a.albums === 1 ? '' : 's'}`, rbadge())), sid, a);
  /** F172: remote Albums / Newest / Artists honor the Library view (own P.sort/flip/views.remote; never touches local views.artists / albums). */
  function rlist(sid, mode, rows) {
    st.kind = 'remote'; st.count = rows.length;
    const key = P.sort.remote, art = mode === 'artists';
    let sorted = rows.slice();
    if (key !== 'server' && mode !== 'newest') sorted = art ? sortRows('artists', rows, key === 'name' || key === 'artist' ? 'name' : 'albums') : sortRows('albums', rows, key);
    if (P.flip.remote) sorted.reverse();
    const grid = gridOn('remote');
    return h('ul', { class: grid ? 'tilegrid ' + (art ? 'tg-artists' : 'tg-albums') : 'list' }, sorted.map(art ? (grid ? rartistTile(sid) : rartistRow(sid)) : (grid ? ralbumTile(sid) : ralbumRow(sid))));
  }
  const rsongList = (sid, rows, albumPage = false) => h('ul', { class: 'list' }, rows.map((t, i) => {
    const it = S.now?.item, on = !!it && it.kind === 'remote' && it.title === t.title && it.album === t.album;
    return rsongDrag(h('li', { class: 'item' + (on ? ' playing' : ''), onclick: () => rplay(sid, rows, i) }, h('span', { class: 'num' }, on ? '▮▮▮' : t.trackNo ?? i + 1),
      h('div', { class: 't' }, h('div', { class: 't1 ell' }, t.title), h('div', { class: 't2 ell' }, (albumPage ? [t.artist] : [t.artist, t.album]).filter(Boolean).join(' • '))), h('span', { class: 'dur' }, fmtTime(t.durationMs))), sid, t); }));
  async function remoteAlbumPage(sid, al) {
    // F238: same albhead / albcover chrome as local tracksPage (not cover 'lg' — that is width:100% and giant)
    const r = await api(`/remote/${sid}/album/${encodeURIComponent(al.id)}`);
    const songs = r.songs, year = r.album.year || songs.find(t => t.year)?.year;
    const mins = Math.max(1, Math.round(songs.reduce((a, t) => a + (t.durationMs || 0), 0) / 60000));
    const art = cover(r.album.artUrl, 'albcover', '♫', { album: r.album.album, artist: r.album.artist });
    const head = h('header', { class: 'albhead' }, art,
      h('div', { class: 'albmeta' }, h('div', { class: 'albkind' }, 'ALBUM'), h('h2', { class: 'albtitle', title: r.album.album }, r.album.album),
        h('div', { class: 'albsub' }, h('b', null, r.album.artist), year ? h('span', null, ' · ' + year) : null, h('span', null, ` · ${songs.length} song${songs.length === 1 ? '' : 's'}, ${mins} min`), rbadge()),
        h('div', { class: 'albacts' },
          canControl(S) ? h('button', { type: 'button', class: 'tbtn albplay', 'aria-label': `Play ${r.album.album}`, title: 'Play', onclick: () => rplay(sid, songs) }, icon('play')) : null,
          canControl(S) ? h('button', { type: 'button', class: 'tbtn albround', 'aria-label': `Shuffle ${r.album.album}`, title: 'Shuffle', onclick: () => { const a = songs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } rplay(sid, a); } }, icon('shuffle')) : null,
          canControl(S) ? h('button', { type: 'button', class: 'linkbtn', onclick: () => api('/queue/add', { method: 'POST', body: { kind: 'remote', server: sid, songs: songs.map(rsong) } }).then(() => toast('Added to the queue'), e => toast(e.message, true)) }, 'Add to queue') : null)));
    const img = art.querySelector('img');
    const tint = () => { const c = dominantColor(img); if (c) head.style.setProperty('--dom', c); };
    if (img) img.addEventListener('load', () => img.naturalWidth && tint(), { once: true });
    return [h('div', { class: 'albpage' }, head,
      h('div', { class: 'albcols', 'aria-hidden': 'true' }, h('span', { class: 'num' }, '#'), h('span', { class: 'grow' }, 'TITLE'), h('span', { class: 'dur' }, 'TIME')),
      rsongList(sid, songs, true))];
  }
  async function remoteServerPage(sv) {
    st.rsid = sv.id; saveRsid();
    const mode = st.rmode || tabToRmode(st.tab) || 'albums'; st.rmode = mode;
    // F235: category strip (Artists / Albums / Recently added) replaces the in-page Albums A–Z / Newest / Artists seg
    const head = h('div', { class: 'row wrap', style: 'gap:8px;margin:4px 0 8px' }, h('b', null, sv.label), h('span', { class: 'small ' + (sv.lastError ? 'err' : 'dim') }, sv.lastError || 'Remote library'));
    try {
      if (mode === 'artists') { const rows = await api(`/remote/${sv.id}/artists`); st.count = rows.length; return [head, rows.length ? rlist(sv.id, 'artists', rows) : empty('No artists on this server.')]; }
      const rows = await api(`/remote/${sv.id}/albums?type=${mode === 'newest' ? 'newest' : 'alphabeticalByName'}&size=500`); st.count = rows.length;
      return [head, rows.length ? rlist(sv.id, mode === 'newest' ? 'newest' : 'albums', rows) : empty('No albums on this server.')];
    } catch (e) { loadRS().then(ch => { if (ch) draw(); });
      return [head, h('p', { class: 'dim roffline' }, e.message + ' Your local library is not affected.')]; }
  }
  /** F235 Remote source: 0 servers → Settings empty; 1 → auto; 2+ → selected chip (tools row). */
  async function remoteSourcePage() {
    await loadRS();
    if (!RS.length) { st.rsid = null; st.kind = null; return [empty('No remote libraries yet. An administrator can add a Navidrome (Subsonic / OpenSubsonic) server in Settings > Library > Remote libraries.')]; }
    let sv = rsById(st.rsid);
    if (!sv) sv = RS.length === 1 ? RS[0] : (RS.find(x => !x.lastError) || RS[0]);
    st.rsid = sv.id; saveRsid();
    return remoteServerPage(sv);
  }
  async function remotePage() { return remoteSourcePage(); }
  async function remoteFind(sid, q) {
    const r = await api(`/remote/${sid}/search?q=${encodeURIComponent(q)}`), out = [];
    if (r.artists.length) out.push(h('div', { class: 'sec' }, 'Artists'), h('ul', { class: 'list' }, r.artists.map(rartistRow(sid))));
    if (r.albums.length) out.push(h('div', { class: 'sec' }, 'Albums'), h('ul', { class: 'list' }, r.albums.map(ralbumRow(sid))));
    if (r.tracks.length) out.push(h('div', { class: 'sec' }, 'Songs'), rsongList(sid, r.tracks));
    return out.length ? out : [empty(`Nothing found on the remote library for “${q}”.`)];
  }
  const rootPage = {
    artists: async () => { const rows = await api('/library/artists'); return [rows.length ? list('artists', rows, artistRow, artistTile) : empty('No music yet. Add a music folder in Settings > Library.')]; },
    albums: async () => { const rows = await api('/library/albums?sort=artist'); return [rows.length ? list('albums', rows, albumRow) : empty('No albums yet.')]; },
    genres: async () => { const rows = await api('/library/genres'); return [rows.length ? list('genres', rows, countRow('♬', 'genre'), genreTile) : empty('No genre tags found. Songs without a genre appear under Cleanup.')]; },
    years: async () => { const rows = await api('/library/years'); return [rows.length ? list('years', rows, countRow('📅', 'year'), yearTile) : empty('No year tags found.')]; },
    recent: async () => { const rows = await api('/library/recent?limit=120'); return [rows.length ? list('recent', rows, albumRow) : empty('Nothing added yet.')]; },
    folders: async () => foldersPage(''),
    favorites: favoritesPage,
    remote: remotePage,
  };
  for (const k of EXTRA_TABS) rootPage[k] = async () => { const v = extras[k]; if (!v) return [empty('Not available here.')]; v.reload?.(); st.kind = null; st.count = null; return [h('div', { class: 'libextra', 'data-extra': k }, v.el)]; };
  const extraPage = k => rootPage[k]();
  const pageKind = () => {
    if (st.q) return null;
    if (st.stack.length) return st.stack[st.stack.length - 1].kind;
    if (st.source === 'radio') return 'radio';
    if (st.source === 'playlists') return 'playlists';
    if (st.source === 'remote') return 'remote';
    if (EXTRA_TABS.has(st.tab)) return null;
    return st.tab;
  };

  /** F239: tools = Remote server chip (2+) + Sort / flip / tiles — sources live in libsrcslot above search. */
  function drawTools(kind) {
    // Phone adapters expose their own supported controls. Do not advertise
    // a Library sort/view/filter that cannot operate their station/playlist DOM.
    if (phone && (st.source === 'radio' || st.source === 'playlists')) { tools.replaceChildren(); return; }
    const kids = [];
    if (st.source === 'remote' && RS.length >= 2) {
      const cur = rsById(st.rsid) || RS[0];
      const off = !!cur?.lastError;
      kids.push(ddBtn('libsrv' + (off ? ' rsoff' : ''), 'Remote server', cur?.label || 'Server',
        RS.map(sv => [sv.id, sv.label + (sv.lastError ? ' (offline)' : '')]), st.rsid || cur?.id,
        id => { st.rsid = id; saveRsid(); st.stack = []; draw(); }));
    }
    if (kind && SORTS[kind]) {
      const sel = ddBtn('libsort', 'Sort', (SORTS[kind].find(([v]) => v === P.sort[kind]) || SORTS[kind][0])[1], SORTS[kind], P.sort[kind], v => { P.sort[kind] = v; save(); draw(); });
      const flip = h('button', { type: 'button', class: 'chipbtn libflip' + (P.flip[kind] ? ' on' : ''), 'aria-pressed': String(P.flip[kind]), title: P.flip[kind] ? 'Reversed - tap for the normal order' : 'Tap to reverse the order', onclick: () => { P.flip[kind] = !P.flip[kind]; save(); draw(); } }, P.flip[kind] ? 'Z–A ↑' : 'A–Z ↓');
      kids.push(expanded ? h('span', { class: 'small dim' }, 'Sort:') : null, sel, flip);
    }
    const canGrid = kind && ((expanded ? VIEW_TABS.includes(kind) : GRID_KINDS.has(kind) || kind === 'albums'));
    if (canGrid) {
      const cur = gridOn(kind) ? 'grid' : 'list';
      kids.push(h('span', { class: 'seg libview', role: 'group', 'aria-label': 'Tiles or list' },
        h('button', { type: 'button', class: cur === 'grid' ? 'on' : '', 'aria-pressed': String(cur === 'grid'), 'aria-label': 'Tiles', title: 'Tiles', onclick: () => setView(kind, 'grid') }, '▦'),
        h('button', { type: 'button', class: cur === 'list' ? 'on' : '', 'aria-pressed': String(cur === 'list'), 'aria-label': 'List', title: 'List', onclick: () => setView(kind, 'list') }, '☰')));
    }
    kids.push(h('span', { class: 'grow' }));
    if (expanded && st.count != null) kids.push(h('span', { class: 'small dim libn' }, `${st.count} ${COUNT_LABEL[kind] || (kind ? 'results' : '')}`));
    tools.replaceChildren(...kids.filter(x => x != null));
  }

  let drawing = 0;
  const visible = () => root.isConnected && root.getClientRects().length > 0;
  async function draw() {
    if (!visible()) { st.dirty = true; return; }       // hidden copy (phone vs desktop layout): draw when it is shown
    st.dirty = false; const my = ++drawing; st.count = null; jump = null; stripPlan = null; strip.hidden = true; strip.replaceChildren();
    if (phone) countEl.textContent = '';  // no stale count while a different source/detail loads
    root.classList.toggle('expanded', expanded); root.classList.toggle('compact', compact && !expanded); root.dataset.tiles = P.tileSize;
    root.dataset.source = st.source;
    srcSlot.replaceChildren(srcTabs());
    const hideCats = st.source === 'radio' || st.source === 'playlists';
    head.hidden = phone && hideCats;
    searchField.hidden = phone && hideCats;  // Radio keeps its real finder; Playlists its create/open tools
    tabsSlot.hidden = hideCats; if (!hideCats) tabsSlot.replaceChildren(tabs()); else tabsSlot.replaceChildren();
    placeSearch();
    search.placeholder = st.source === 'remote' ? (expanded ? 'Filter remote…' : 'Search the remote library…')
      : st.source === 'radio' || st.source === 'playlists' ? (expanded ? 'Filter…' : 'Search…')
      : (expanded ? 'Filter…' : 'Search songs, albums and artists…');
    crumbs.replaceChildren();
    if (st.stack.length) crumbs.append(h('button', { class: 'btn', onclick: back }, '‹ Back'), h('b', { class: 'ell' }, st.stack[st.stack.length - 1].title));
    content.replaceChildren(h('p', { class: 'dim' }, 'Loading…')); drawTools(pageKind());
    try {
      root.dataset.tab = st.tab;
      const onExtra = (st.source === 'radio' || st.source === 'playlists' || (st.source === 'local' && EXTRA_TABS.has(st.tab))) && !st.q && !st.stack.length;
      root.classList.toggle('extratab', onExtra);
      let nodes;
      if (st.q) {
        nodes = (st.source === 'remote' && st.rsid) ? await remoteFind(st.rsid, st.q) : (st.source === 'local' || st.source === 'remote' ? await findPage(st.q) : [empty('Use the finder below to search stations.')]);
      } else if (st.stack.length) nodes = await st.stack[st.stack.length - 1].load();
      else if (st.source === 'radio') nodes = await extraPage('radio');
      else if (st.source === 'playlists') nodes = await extraPage('playlists');
      else if (st.source === 'remote') nodes = await remoteSourcePage();
      else nodes = await (rootPage[st.tab] || rootPage.artists)();
      if (my !== drawing) return;
      content.replaceChildren(...nodes); drawTools(pageKind());
      if (stripPlan) { strip._azIdx = stripPlan; paintAz(stripPlan); strip.hidden = false; }
      else { strip._azIdx = null; strip.hidden = true; strip.replaceChildren(); hideAzBubble(); }
      content.classList.toggle('grid', !!content.querySelector('.tilegrid'));
      const lab = COUNT_LABEL[phone ? st.kind : st.tab] || (phone && st.kind === 'remote' ? (st.count === 1 ? 'result' : 'results') : null);
      countEl.textContent = ((compact && !expanded && !st.stack.length) || phone) && st.count != null && !st.q && lab ? `${st.count} ${lab}` : '';
    } catch (e) { if (my === drawing) content.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }
  window.addEventListener('wavwiz:library', () => { loadRS().finally(() => draw()); });   // F174: servers added / removed / renamed -> tabs follow
  window.addEventListener('wavwiz:libprefs', () => { const e = P.expanded; P = loadLibPrefs(); P.expanded = e; for (const k of Object.keys(session)) delete session[k]; draw(); });   // Settings > Library view
  window.addEventListener('wavwiz:favs', () => { if (st.tab === 'favorites' && !st.stack.length && !st.q && visible()) { clearTimeout(draw._f); draw._f = setTimeout(draw, 300); } });
  let rzT = 0; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { if (st.dirty && visible()) draw(); }, 150); });   // 0.6.8e: a pending redraw waits until the drag ends (150 ms after the last resize), never mid-drag
  loadFavs(); draw(); loadRS().then(ch => { if (ch) draw(); });
  return { el: root, reload: draw, get dirty() { return st.dirty; }, get expanded() { return expanded; },
    setExpanded(on) { expanded = !!on; P.expanded = expanded; if (!expanded && TOOL_TABS.some(t => t[0] === st.tab)) st.tab = 'artists'; save(); draw(); },
    /** 0.3.5 J9 / F235: open a category or source from a menu (Library > Playlists / Radio / tools). */
    showTab(k) {
      if (k === 'radio' || k === 'playlists') { setSource(k); return; }
      if (k === 'remote') { setSource('remote'); return; }
      if (isRsTab(k)) { st.rsid = k.slice(3); saveRsid(); st.tab = 'artists'; st.rmode = 'artists'; saveTab(); if (st.source !== 'remote') setSource('remote'); else draw(); return; }
      if (TOOL_TABS.some(t => t[0] === k) || LOCAL_CATS.has(k)) { if (st.source !== 'local') { st.source = 'local'; saveSource(); } pick(k); return; }
      pick(k);
    },
    get tab() { return st.tab; }, get source() { return st.source; }, setSource };
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

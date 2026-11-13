import { dndMode, pointerDragSource, pointerDropTarget } from './pdrag.js';
import { openSongSheet } from './songsheet.js';
import { openCtx } from './ctxmenu.js';
import { h, api, toast, dialog, getApiZone } from './util.js';
import { isFav, toggleFav } from './fav.js';

export const canControl = S => S.auth && S.auth.role !== 'view';
/** 0.2.0 item 28: admin-only controls are shown READ-ONLY (disabled, with this hint) to everyone else - never hidden. */
export const isAdmin = S => S?.auth?.role === 'admin';
export const ADMIN_HINT = 'Only an administrator can change this. Use File > Sign in as admin.';
// 0.6.9: "this device" lives in thisdevice.js (no DOM imports) so zones40.js can use it to open on the player's own zone; re-exported here unchanged.
export { webRoomId, thisDevice } from './thisdevice.js';
/** Can this session change delay/output on zone z? Admins: any device. Everyone else: only their own (server enforces the same). */
export const canTune = (S, z) => isAdmin(S) || (canControl(S) && !!z?.mine);
/** Disable a control for non-admins and explain why (title + aria). Returns the element. */
export function adminOnly(S, el, ok = isAdmin(S)) { if (!ok) { el.disabled = true; el.title = ADMIN_HINT; el.setAttribute('aria-disabled', 'true'); el.classList.add('ro'); } return el; }

// ---- "refs": what a row stands for when you play it, queue it, drag it or add it to a playlist ----
export const refTracks = ids => ({ kind: 'tracks', ids });
export const refNode = node => ({ kind: 'node', node });
export const albumNode = (artist, album) => `album:${artist}\u001f${album}`;
const MIME = 'application/x-wavwiz-ref';

async function act(path, body, ok) { try { await api(path, { method: 'POST', body }); if (ok) toast(ok); return true; } catch (e) { toast(e.message, true); return false; } }
export const playNow = ref => act('/stream/play', ref);
/** 0.2.1 F13: album page Shuffle - shuffle on, then play the songs starting from a random one. */
export async function playShuffled(ids) { if (!ids?.length) return false; if (!(await act('/stream/shuffle', { on: true }))) return false; return act('/stream/play', { kind: 'tracks', ids, index: Math.floor(Math.random() * ids.length) }); }
export const playNext = ref => act('/queue/add', { ...ref, next: true }, 'Will play next');
export const addToQueue = ref => act('/queue/add', ref, 'Added to the queue');

/** Bottom sheet (phone) / centered menu (desktop). */
export function sheet(title, actions) {
  let pressed = false;   // 0.6.8-#4: only a press that started after the sheet opened closes it from the scrim (not the opening tap's trailing click)
  const close = () => { el.remove(); document.removeEventListener('keydown', esc); };
  const esc = ev => { if (ev.key === 'Escape') close(); };
  const el = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title },
    h('div', { class: 'scrim', onpointerdown: () => { pressed = true; }, onclick: () => { if (pressed) close(); } }),
    h('div', { class: 'panel' }, h('h4', null, title), actions.filter(Boolean).map(a => h('button', { class: 'act' + (a.danger ? ' err' : ''), disabled: a.disabled || undefined, title: a.title || undefined, onclick: async () => { if (a.disabled) return; close(); await a.onclick(); } }, a.text))));
  document.addEventListener('keydown', esc); document.body.append(el); el.querySelector('button.act:not([disabled])')?.focus() || el.querySelector('button.act')?.focus(); return close;
}

/** F175: remote (Subsonic / Navidrome) refs can be queued but not saved in WavWiz playlists yet. */
export const REMOTE_PL_MSG = 'Remote songs can’t go in playlists yet';
export const isRemoteRef = ref => ref?.kind === 'remote';
/** 0.3.5 J9 #8: Add to playlist = a small dropdown next to the song row (no window); "New playlist…" is typed in place. */
let lastPt = { x: 0, y: 0 };
if (typeof document !== 'undefined') document.addEventListener('pointerdown', ev => { lastPt = { x: ev.clientX, y: ev.clientY }; }, true);
export async function pickPlaylist(S, ref, title = 'Add to playlist', scope = null) {
  if (scope && !scope.valid()) return null;
  if (isRemoteRef(ref)) return toast(REMOTE_PL_MSG, true);   // F175
  let lists = []; try { lists = await api('/playlists'); } catch (e) { return toast(e.message, true); }
  if (scope && !scope.valid()) return null;
  (scope?.host || document).querySelector('.pldrop')?.remove();
  let closed = false;
  const close = reason => { if (closed) return; closed = true; box.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc, true); scope?.onClose?.(reason); };
  const outside = ev => { if (!box.contains(ev.target)) close(); }, esc = ev => { if (ev.key === 'Escape') { if (scope) { ev.preventDefault(); ev.stopImmediatePropagation(); } close(scope ? 'escape' : undefined); } };
  const add = async id => { if (scope && (closed || !scope.valid())) { close(); return; } try { const r = await api(`/playlists/${id}/items`, { method: 'POST', body: ref }); toast(`Added ${r.added} item(s)`); close('done'); window.dispatchEvent(new CustomEvent('wavwiz:playlists')); } catch (e) { toast(e.message, true); } };
  const nm = h('input', { type: 'text', placeholder: 'New playlist name', maxlength: 80, 'aria-label': 'New playlist name', onkeydown: ev => { if (ev.key === 'Enter') create(); } });
  const create = async () => { if (scope && (closed || !scope.valid())) { close(); return; } const name = nm.value.trim(); if (!name) { nm.focus(); return; } try { const p = await api('/playlists', { method: 'POST', body: { name } }); await add(p.id); } catch (e) { toast(e.message, true); } };
  const newRow = h('div', { class: 'pl-new', hidden: true }, nm, h('button', { class: 'btn sm primary', type: 'button', onclick: create }, 'Add'));
  const box = h('div', { class: 'pldrop mpanel', role: 'menu', 'aria-label': title },
    h('div', { class: 'pl-h small dim' }, title),
    ...lists.map(p => h('button', { type: 'button', role: 'menuitem', onclick: () => add(p.id) }, h('span', { class: 'grow ell' }, p.name), h('span', { class: 'small dim' }, String(p.count)))),
    h('button', { type: 'button', role: 'menuitem', class: 'pl-newbtn', onclick: () => { newRow.hidden = false; nm.focus(); } }, 'New playlist…'), newRow);
  (scope?.host || document.body).append(box);
  const r = box.getBoundingClientRect(), z = Number(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1;
  const vw = innerWidth / z, vh = innerHeight / z, x = lastPt.x / z, y = lastPt.y / z;
  box.style.left = Math.max(4, Math.min(x, vw - r.width - 4)) + 'px'; box.style.top = Math.max(4, Math.min(y, vh - r.height - 4)) + 'px';
  if (scope) { box.classList.add('songsheet-picker'); box.style.left = ''; box.style.top = ''; box.querySelector('button')?.focus(); }
  setTimeout(() => { if (scope && closed) return; document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', esc, true); }, 0);
  return { el: box, close };
}

/** Makes a row work everywhere: click = open/play (caller), "..." = menu, right-click = menu, long-press on touch = menu, drag (desktop) = add to a playlist/queue. */
/** 0.3.5 J11: what is being dragged from the Library (the playlist's drop line says "Drop here: 17 songs at #4"). */
export const dragInfo = { count: null, title: '', kind: '', ref: null };  // 0.4.4 F8: ref stashed so WebKit/TV dragover (no custom MIME in types) still accepts
export const songsLabel = n => `${n} song${n === 1 ? '' : 's'}`;
/** "Drop here: 17 songs at #4" (pure; no count known -> "Drop here at #4"). */
export const dropLabel = (count, at) => `Drop here${count != null ? ': ' + songsLabel(count) : ''} at #${at + 1}`;
/** F236: local single-track ref → Favorites menu action (reuse fav.js). */
export function trackIdFromRef(ref) {
  if (!ref) return null;
  if (ref.kind === 'tracks' && Array.isArray(ref.ids) && ref.ids.length === 1) return ref.ids[0];
  return null;
}
export function favActionForTrack(S, trackId, title = '') {
  if (trackId == null || trackId === '') return null;
  const on = isFav('track', trackId);
  const text = on ? '♡  Remove from Favorites' : '♥  Add to Favorites';
  if (!canControl(S)) return { text, disabled: true, title: 'Only Control or Admin access can change favorites.' };
  return { text, onclick: () => toggleFav(S, 'track', trackId) };
}
export function attachItem(S, el, ref, title, { menu = [], more = true, count = null, kind = '', phoneSong = null } = {}) {
  // Desktop right-click used to open sheet() — a centered dialog (far from the cursor).
  // Now: shared openCtx at the pointer; keyboard / ⋯ anchors to the focused control; phone keeps the existing bottom sheet.
  const isPhone = () => matchMedia('(max-width:900px)').matches;
  const favItem = () => favActionForTrack(S, trackIdFromRef(ref), title);
  const ctxItems = () => {
    const fav = favItem();
    return [
      { id: 'play', ic: 'play', label: 'Play', onclick: () => playNow(ref) },
      { id: 'next', ic: 'queue', label: 'Play next', onclick: () => playNext(ref) },
      { id: 'add', ic: 'plus', label: 'Add to queue', onclick: () => addToQueue(ref) },
      { id: 'playlist', ic: 'plus', label: 'Add to playlist…', disabled: isRemoteRef(ref), hint: isRemoteRef(ref) ? REMOTE_PL_MSG : undefined, onclick: () => pickPlaylist(S, ref) },
      ...[fav].filter(Boolean).map(a => ({ id: 'favorite', label: String(a.text || '').replace(/^[♡♥]  /, ''), disabled: a.disabled, hint: a.title, onclick: a.onclick })),
      ...menu.filter(Boolean).map((a, i) => ({ id: 'extra:' + i, label: a.text, disabled: a.disabled, hint: a.title, danger: a.danger, onclick: a.onclick })),
    ].map(a => ({ ...a, disabled: a.disabled || !canControl(S) }));
  };
  const openPhoneSheet = () => {
    const fav = favItem();
    if (phoneSong) {
      const zone = getApiZone(), identity = JSON.stringify(ref), view = S.view, route = S._streamRoute;
      const valid = () => el.isConnected && S.view === view && route === S._streamRoute && getApiZone() === zone && JSON.stringify(ref) === identity;
      const build = () => [
        { id: 'play', label: 'Play now', onclick: () => playNow(ref) },
        { id: 'next', label: 'Play next', onclick: () => playNext(ref) },
        { id: 'add', label: 'Add to queue', onclick: () => addToQueue(ref) },
        { id: 'playlist', label: 'Add to playlist…', keepOpen: true, disabled: isRemoteRef(ref), hint: isRemoteRef(ref) ? REMOTE_PL_MSG : undefined },
        ...[favActionForTrack(S, trackIdFromRef(ref), title)].filter(Boolean).map(a => ({ ...a, id: 'favorite', label: a.text.replace(/^[♡♥]  /, ''), hint: a.title })),
        ...menu.filter(Boolean).map((a, i) => ({ ...a, id: 'extra:' + i, label: a.text, hint: a.title }))
      ].map(a => ({ ...a, disabled: a.disabled || !canControl(S) }));
      return openSongSheet({ item: phoneSong, from: el.querySelector('.more') || el, valid, items: build, run: async (it, modal) => {
        if (!valid() || !canControl(S)) { modal.close(); return; }
        if (it.id === 'playlist') await modal.playlist(opts => pickPlaylist(S, ref, 'Add to playlist', { ...opts, valid: () => opts.valid() && canControl(S) }));
        else await it.onclick?.();
      } });
    }
    return sheet(title, [{ text: '▶  Play now', onclick: () => playNow(ref) }, { text: '⏭  Play next', onclick: () => playNext(ref) }, { text: '＋  Add to queue', onclick: () => addToQueue(ref) }, { text: '♫  Add to playlist…', onclick: () => pickPlaylist(S, ref) }, fav, ...menu]);
  };
  const openAt = (x, y, from) => {
    if (!canControl(S)) return toast('Your access is view-only, so you can browse but not play.', false);
    if (isPhone()) return openPhoneSheet();
    return openCtx(x, y, ctxItems(), { label: title, from: from || el });
  };
  const openMenu = ev => {
    const pointer = ev && ev.clientX != null && (ev.type === 'contextmenu' || ev.type === 'touchstart' || ev.type === 'touchend' || ev.type === 'pointerdown');
    if (pointer) return openAt(ev.clientX, ev.clientY, ev.currentTarget || el);
    const t = (typeof document !== 'undefined' && document.activeElement && el.contains(document.activeElement)) ? document.activeElement : (ev?.currentTarget || el);
    const r = t.getBoundingClientRect();
    return openAt(r.left, ev?.type === 'click' ? r.bottom + 2 : r.top, t);
  };
  if (more) el.append(h('button', { class: 'more', 'aria-label': 'More actions for ' + title, onclick: ev => { ev.stopPropagation(); openMenu(ev); } }, '⋯'));
  el.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); openMenu(ev); });
  el.addEventListener('keydown', ev => { if ((ev.key === 'F10' && ev.shiftKey) || ev.key === 'ContextMenu') { ev.preventDefault(); openMenu(ev); } });
  longPress(el, openMenu);
  if (canControl(S)) {   // 0.4.5 F8: pointer-event drag too (touch / pen everywhere; every input in the WavWiz Player window, where HTML5 DnD did not reach the queue)
    el.classList.add('ldrag');   // 0.4.5: grab cursor on every draggable Library row / tile (songs and categories)
    const mode = dndMode(), mkGhost = () => { const n = count ?? (ref?.kind === 'tracks' ? ref.ids.length : null); return h('div', { class: 'dragghost' }, h('div', { class: 'dg-t' }, h('b', { class: 'ell' }, title), h('span', { class: 'small dim' }, [kind, n != null ? songsLabel(n) : null].filter(Boolean).join(' · '))), n != null ? h('span', { class: 'dgbadge' }, String(n)) : null); };
    pointerDragSource(el, () => ({ lib: true, ref, title }), { mode, ghost: mkGhost,
      onStart: () => { dragInfo.count = count ?? (ref?.kind === 'tracks' ? ref.ids.length : null); dragInfo.title = title; dragInfo.kind = kind; dragInfo.ref = ref; },
      onEnd: () => { dragInfo.count = null; dragInfo.title = ''; dragInfo.kind = ''; dragInfo.ref = null; } });
    if (mode === 'pointer') return el; }
  if (canControl(S)) { el.draggable = true; el.addEventListener('dragstart', ev => { ev.dataTransfer.setData(MIME, JSON.stringify(ref)); ev.dataTransfer.setData('text/plain', title); ev.dataTransfer.effectAllowed = 'copy'; el.classList.add('dragging');
    const n = count ?? (ref?.kind === 'tracks' ? ref.ids.length : null); dragInfo.count = n; dragInfo.title = title; dragInfo.kind = kind; dragInfo.ref = ref;
    // 0.3.5 J11: a small ghost - title, kind · N songs, and a count badge
    try { const g = h('div', { class: 'dragghost' }, h('div', { class: 'dg-t' }, h('b', { class: 'ell' }, title), h('span', { class: 'small dim' }, [kind, n != null ? songsLabel(n) : null].filter(Boolean).join(' · '))), n != null ? h('span', { class: 'dgbadge' }, String(n)) : null);
      document.body.append(g); ev.dataTransfer.setDragImage?.(g, 14, 14); setTimeout(() => g.remove(), 0); } catch { /* old browsers: default ghost */ } });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragInfo.count = null; dragInfo.title = ''; dragInfo.kind = ''; dragInfo.ref = null; }); }
  return el;
}

export function longPress(el, fn, ms = 520) {
  let t = null, sx = 0, sy = 0, fired = false;
  const cancel = () => { clearTimeout(t); t = null; };
  el.addEventListener('touchstart', ev => { fired = false; const p = ev.touches[0]; sx = p.clientX; sy = p.clientY; t = setTimeout(() => { fired = true; try { navigator.vibrate?.(15); } catch { /* optional */ } fn({ clientX: sx, clientY: sy, type: 'touchstart', currentTarget: el }); }, ms); }, { passive: true });
  el.addEventListener('touchmove', ev => { const p = ev.touches[0]; if (Math.abs(p.clientX - sx) > 9 || Math.abs(p.clientY - sy) > 9) cancel(); }, { passive: true });
  el.addEventListener('touchend', ev => { cancel(); if (fired) { ev.preventDefault(); } });
  el.addEventListener('touchcancel', cancel);
  el.addEventListener('click', ev => { if (fired) { ev.stopImmediatePropagation(); ev.preventDefault(); fired = false; } }, true);
}

/** F230: primary click cycles off↔all only (never lands on One). */
export const repeatClickNext = m => ({ off: 'all', all: 'off', one: 'off' }[m || 'off']);

/** F230: labels / title / icon name for a Repeat mode (caller applies setIcon). */
export function repeatChrome(mode) {
  const m = mode || 'off';
  return {
    on: m !== 'off', one: m === 'one', icon: m === 'one' ? 'repeatOne' : 'repeat',
    aria: m === 'off' ? 'Repeat off' : m === 'all' ? 'Repeat all · whole queue' : 'Repeat one',
    title: m === 'off' ? 'Repeat off — click for all; long-press for one track'
      : m === 'all' ? 'Repeat all · whole queue — click to turn off; long-press for one track'
      : 'Repeat one track — click to turn off',
  };
}

/** F230: long-press (pointer) or Alt-click → Repeat One. Suppresses the following click when long-press fires. */
export function wireRepeatOne(el, onOne, ms = 520) {
  let t = null, sx = 0, sy = 0, fired = false;
  const cancel = () => { clearTimeout(t); t = null; };
  const fire = () => { if (fired) return; fired = true; cancel(); try { navigator.vibrate?.(15); } catch { /* optional */ } onOne(); };
  el.addEventListener('pointerdown', ev => {
    if (ev.button != null && ev.button !== 0) return;
    if (ev.altKey) return;   // Alt-click uses the click path
    fired = false; sx = ev.clientX; sy = ev.clientY;
    t = setTimeout(fire, ms);
  });
  el.addEventListener('pointermove', ev => { if (t != null && (Math.abs(ev.clientX - sx) > 9 || Math.abs(ev.clientY - sy) > 9)) cancel(); });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('click', ev => {
    if (fired) { ev.preventDefault(); ev.stopImmediatePropagation(); fired = false; return; }
    if (ev.altKey) { ev.preventDefault(); ev.stopImmediatePropagation(); onOne(); }
  }, true);
}

export function dropTarget(el, onRef, accept = ev => ev.dataTransfer?.types?.includes(MIME)) {
  pointerDropTarget(el, { accept: p => !!p?.lib, over: () => el.classList.add('dragover'), leave: () => el.classList.remove('dragover'), drop: p => { el.classList.remove('dragover'); return onRef(p.ref); } });   // 0.4.5 F8
  el.addEventListener('dragover', ev => { if (accept(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; el.classList.add('dragover'); } });
  el.addEventListener('dragleave', () => el.classList.remove('dragover'));
  el.addEventListener('drop', ev => { el.classList.remove('dragover'); const raw = ev.dataTransfer.getData(MIME); if (!raw) return; ev.preventDefault(); try { onRef(JSON.parse(raw), ev); } catch { /* bad payload */ } });
}

/** Renders rows in chunks so a 5,000-album library does not freeze a phone. */
export function chunked(container, rows, make, chunk = 120) {
  let i = 0; const sentinel = h('div', { style: 'height:1px' });
  const more = () => { const end = Math.min(rows.length, i + chunk); const frag = document.createDocumentFragment(); for (; i < end; i++) frag.append(make(rows[i], i)); container.insertBefore(frag, sentinel); if (i >= rows.length) { io.disconnect(); sentinel.remove(); } };
  const io = new IntersectionObserver(es => { if (es[0].isIntersecting) more(); }, { rootMargin: '600px' });
  container.append(sentinel); more(); if (i < rows.length) io.observe(sentinel);
  return { upTo: n => { while (i <= n && i < rows.length) more(); } };   // 0.2.0 item 13: the letter strip renders ahead before jumping
}
export { MIME };

// WavWiz 0.3.8 L48: right-click (phone: long-press) on a Queue item -> a themed popup with the same look as the other menus (.pldrop.mpanel).
import { h, api, toast, getApiZone } from './util.js';
import { openSongSheet } from './songsheet.js';
import { pickPlaylist, longPress, canControl } from './ui.js';
import { isFav, toggleFav } from './fav.js';
export const QUEUE_LOCK_HINT = 'The queue is locked - click the padlock to unlock it.';
/** Pure: the menu rows for queue item `i` of `n` (cur = playing index or -1). Remove and both Moves are disabled while locked. */
export const FAV_REMOTE_HINT = 'Favorites are for library songs';
/** Pure: Favorites row for a queue item (local track only; remote/radio soft-disabled). */
export function queueFavoriteItem(q, { canFav = true } = {}) {
  if (!q) return null;
  const local = q.kind === 'track' && q.refId != null && q.refId !== '';
  if (!local) return { id: 'favorite', label: 'Add to Favorites', disabled: true, hint: FAV_REMOTE_HINT };
  const on = isFav('track', q.refId);
  return { id: 'favorite', label: on ? 'Remove from Favorites' : 'Add to Favorites', disabled: !canFav, hint: canFav ? undefined : 'Only Control or Admin access can change favorites.', on, refId: q.refId };
}
export function queueMenuItems({ i, n, cur = -1, locked = false, favorite = null } = {}) {
  const playNextTo = cur < 0 ? 0 : i > cur ? cur + 1 : cur;   // where the item lands so it plays right after the current song
  const fav = favorite || null;
  return [
    { id: 'play', label: 'Play now' },
    { id: 'next', label: 'Play next', disabled: i === cur || (cur >= 0 && i === cur + 1), to: playNextTo },
    { id: 'remove', label: 'Remove from queue', disabled: locked, lock: locked },
    { id: 'up', label: 'Move up', disabled: locked || i === 0, lock: locked },
    { id: 'down', label: 'Move down', disabled: locked || i === n - 1, lock: locked },
    { id: 'top', label: 'Move to top', disabled: locked || i === 0, lock: locked },
    { id: 'bottom', label: 'Move to bottom', disabled: locked || i === n - 1, lock: locked },
    { id: 'playlist', label: 'Add to playlist…' },
    fav,
    { id: 'library', label: 'Show in Library' },
    { id: 'copy', label: 'Copy title' },
  ].filter(Boolean);
}
let lastPt = { x: 0, y: 0 };
if (typeof document !== 'undefined') document.addEventListener('pointerdown', ev => { lastPt = { x: ev.clientX, y: ev.clientY }; }, true);
const act = async (path, body, method = 'POST') => { try { await api(path, { method, body }); return true; } catch (e) { toast(e.message, true); return false; } };
/** Open the menu for queue index `i`. ctl: { refreshAll, showInLibrary }. locked: () => bool. */
export function openQueueMenu(S, ctl, i, { locked = () => false, x = lastPt.x, y = lastPt.y, valid = null, song = null, phone = false, from = document.activeElement } = {}) {
  // F250-P5 opt-in: the current song may not be a queue occurrence. The
  // normal desktop popup/runner stays the default; P6 is explicit phone opt-in.
  const q = song ? song.item : S.queue?.[i]; if (!q) return null;
  phone = phone && matchMedia('(max-width:900px)').matches;
  if (phone) {
    const guard = valid, route = getApiZone(), stream = S._streamRoute, identity = JSON.stringify([q, S.queue]);
    // Matching accepted stream read-origin required before index actions (same fence as npsongmenu).
    valid = () => (!guard || guard()) && route === getApiZone() && stream === S._streamRoute && identity === JSON.stringify([q, S.queue]) && S._nowRoute === stream;
  }
  document.querySelector('.qmenu:not(.songsheet-actions)')?.remove(); document.querySelector('.pldrop')?.remove();
  const lk = !!locked(), playlistOk = q.kind === 'track' && q.refId != null && q.refId !== '';
  const queueActions = ['play', 'next', 'remove', 'up', 'down', 'top', 'bottom'];
  const edit = ctl.queueEdit; // explicit phone opt-in; never the desktop runner
  const queueAct = (path, body, method, action) => edit ? edit.run(path, body, method, action) : act(path, body, method);
  const mutations = [...queueActions, 'playlist', 'favorite'];
  const build = () => {
    const fav = queueFavoriteItem(q, { canFav: canControl(S) });
    return queueMenuItems({ i, n: S.queue.length, cur: S.now?.index ?? -1, locked: phone ? !!locked() : lk, favorite: fav })
    .filter(it => !song || i >= 0 || !queueActions.includes(it.id))
    .map(it => edit?.pending() && queueActions.includes(it.id) ? { ...it, disabled: true } : it)
    .map(it => !song ? it : { ...it, disabled: it.disabled || (mutations.includes(it.id) && !canControl(S)) ||
      ((phone ? locked() : lk) && it.id === 'next') || (it.id === 'playlist' && q.kind !== 'track'),
      hint: it.id === 'playlist' && q.kind !== 'track' ? 'Only library songs can be saved in playlists' : it.hint })
    .map(it => !phone ? it : { ...it, disabled: it.disabled || (mutations.includes(it.id) && !canControl(S)) || (it.id === 'playlist' && !playlistOk),
      keepOpen: it.id === 'playlist', danger: it.id === 'remove', hint: it.lock ? QUEUE_LOCK_HINT : it.id === 'playlist' && !playlistOk ? 'Only library songs can be saved in playlists' : it.hint });
  };
  const items = build();
  let closed = false, modal = null;
  const close = () => { if (phone) { modal?.close(); return; } closed = true; box.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc, true); };
  const outside = ev => { if (!box.contains(ev.target)) close(); }, esc = ev => { if (ev.key === 'Escape') close(); };
  const run = async (it, sheet = null) => {
    if (queueActions.includes(it.id) && edit?.pending()) { close(); return; }
    if (song && (it.disabled || (mutations.includes(it.id) && !canControl(S)) || (['next', 'remove', 'up', 'down', 'top', 'bottom'].includes(it.id) && locked()))) { close(); return; }
    const ok = !valid || (valid() && (!['remove', 'up', 'down', 'top', 'bottom'].includes(it.id) || !locked())); if (!sheet) close(); if (!ok) { sheet?.close(); return; }
    switch (it.id) {
      case 'play': await act('/stream/jump', { index: i }); break;
      case 'next': await queueAct('/queue/move', { from: i, to: it.to }, 'POST', 'next'); break;
      case 'remove': await queueAct(`/queue/${i}`, undefined, 'DELETE'); break;
      case 'up': await queueAct('/queue/move', { from: i, to: i - 1 }); break;
      case 'down': await queueAct('/queue/move', { from: i, to: i + 1 }); break;
      case 'top': await queueAct('/queue/move', { from: i, to: 0 }); break;
      case 'bottom': await queueAct('/queue/move', { from: i, to: S.queue.length - 1 }); break;
      case 'playlist': { const ref = { kind: 'tracks', ids: [q.refId ?? q.id] }; if (sheet) await sheet.playlist(opts => pickPlaylist(S, ref, 'Add to playlist', { ...opts, valid: () => opts.valid() && canControl(S) })); else pickPlaylist(S, ref); return; }
      case 'favorite': if (!it.disabled && it.refId != null) await toggleFav(S, 'track', it.refId); return;
      case 'library': ctl.showInLibrary?.(q.title, q); return;
      case 'copy': try { await navigator.clipboard.writeText([q.title, q.artist].filter(Boolean).join(' - ')); toast('Copied the title'); } catch { toast('Could not copy here.', true); } return;
    }
    if (!edit || !['next', 'remove', 'up', 'down', 'top', 'bottom'].includes(it.id)) ctl.refreshAll?.();
  };
  if (phone) return modal = openSongSheet({ item: q, label: song ? 'Current song actions' : 'Queue item actions', menuClass: 'qmenu', from, valid: valid || (() => true), items: build, run });
  const box = h('div', { class: 'pldrop qmenu mpanel', role: 'menu', 'aria-label': song ? 'Current song actions' : 'Queue item actions' },
    h('div', { class: 'pl-h small dim ell' }, q.title),
    ...items.map(it => h('button', { type: 'button', role: 'menuitem', 'data-qm': it.id, disabled: it.disabled || undefined, title: it.lock ? QUEUE_LOCK_HINT : (it.hint || undefined), onclick: () => run(it) }, h('span', { class: 'grow' }, it.label))),
    lk ? h('div', { class: 'small dim qm-note' }, QUEUE_LOCK_HINT) : null);
  document.body.append(box);
  const r = box.getBoundingClientRect(), z = Number(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1, vw = innerWidth / z, vh = innerHeight / z;
  box.style.left = Math.max(4, Math.min(x / z, vw - r.width - 4)) + 'px'; box.style.top = Math.max(4, Math.min(y / z, vh - r.height - 4)) + 'px';
  const listen = () => { if (valid && closed) return; document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', esc, true); };
  if (valid) listen(); else setTimeout(listen, 0); // phone opens after pointerdown; immediate Esc must work
  return { el: box, close };
}
/** Wire right-click + long-press on a row element. */
export function attachQueueMenu(el, S, ctl, i, locked, phone = null) {
  // F250-P3 opt-in only. Desktop keeps the original longPress engine below.
  if (phone) {
    let timer = 0, sx = 0, sy = 0, fired = false, firedUntil = 0, menu = null;
    const cancel = () => { clearTimeout(timer); timer = 0; };
    const excluded = ev => !!ev.target.closest?.('.qgrip,button,input,a,[data-nodrag]');
    const valid = () => el.isConnected && canControl(S) && (phone.valid?.() ?? true) && !phone.suppressed?.();
    const open = (x, y) => { if (!valid()) return; cancel(); phone.onOpen?.(); menu?.close(); menu = openQueueMenu(S, ctl, i, { locked, x, y, valid, phone: true, from: phone.menuButton || el }); };
    const context = ev => { ev.preventDefault(); ev.stopPropagation(); cancel(); if (!excluded(ev)) open(ev.clientX, ev.clientY); };
    const start = ev => {
      cancel(); fired = false; if (excluded(ev) || !valid() || ev.touches.length !== 1) return;
      sx = ev.touches[0].clientX; sy = ev.touches[0].clientY;
      timer = setTimeout(() => { if (valid()) { fired = true; firedUntil = performance.now() + 450; open(sx, sy); } }, 520);
    };
    const move = ev => { const p = ev.touches[0]; if (!p || Math.abs(p.clientX - sx) > 9 || Math.abs(p.clientY - sy) > 9) cancel(); };
    const end = ev => { cancel(); if (fired) ev.preventDefault(); };
    const click = ev => { if ((fired && performance.now() < firedUntil) || phone.suppressed?.()) { ev.preventDefault(); ev.stopImmediatePropagation(); fired = false; } };
    const more = ev => { ev.preventDefault(); ev.stopPropagation(); const r = phone.menuButton.getBoundingClientRect(); open(r.left, r.bottom); };
    el.addEventListener('contextmenu', context); el.addEventListener('touchstart', start, { passive: true }); el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', cancel); el.addEventListener('click', click, true); phone.menuButton?.addEventListener('click', more);
    return { close: () => { cancel(); menu?.close(); menu = null; }, destroy() {
      cancel(); menu?.close(); menu = null;
      el.removeEventListener('contextmenu', context); el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', cancel); el.removeEventListener('click', click, true); phone.menuButton?.removeEventListener('click', more);
    } };
  }
  el.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); openQueueMenu(S, ctl, i, { locked, x: ev.clientX, y: ev.clientY }); });
  longPress(el, () => openQueueMenu(S, ctl, i, { locked }));
}

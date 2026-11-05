// WavWiz 0.3.8 L48: right-click (phone: long-press) on a Queue item -> a themed popup with the same look as the other menus (.pldrop.mpanel).
import { h, api, toast } from './util.js';
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
export function openQueueMenu(S, ctl, i, { locked = () => false, x = lastPt.x, y = lastPt.y } = {}) {
  const q = S.queue?.[i]; if (!q) return null;
  document.querySelector('.qmenu')?.remove(); document.querySelector('.pldrop')?.remove();
  const lk = !!locked();
  const fav = queueFavoriteItem(q, { canFav: canControl(S) });
  const items = queueMenuItems({ i, n: S.queue.length, cur: S.now?.index ?? -1, locked: lk, favorite: fav });
  const close = () => { box.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc, true); };
  const outside = ev => { if (!box.contains(ev.target)) close(); }, esc = ev => { if (ev.key === 'Escape') close(); };
  const run = async it => {
    close();
    switch (it.id) {
      case 'play': await act('/stream/jump', { index: i }); break;
      case 'next': await act('/queue/move', { from: i, to: it.to }); break;
      case 'remove': await act(`/queue/${i}`, undefined, 'DELETE'); break;
      case 'up': await act('/queue/move', { from: i, to: i - 1 }); break;
      case 'down': await act('/queue/move', { from: i, to: i + 1 }); break;
      case 'top': await act('/queue/move', { from: i, to: 0 }); break;
      case 'bottom': await act('/queue/move', { from: i, to: S.queue.length - 1 }); break;
      case 'playlist': pickPlaylist(S, { kind: 'tracks', ids: [q.refId ?? q.id] }); return;
      case 'favorite': if (!it.disabled && it.refId != null) await toggleFav(S, 'track', it.refId); return;
      case 'library': ctl.showInLibrary?.(q.title, q); return;
      case 'copy': try { await navigator.clipboard.writeText([q.title, q.artist].filter(Boolean).join(' - ')); toast('Copied the title'); } catch { toast('Could not copy here.', true); } return;
    }
    ctl.refreshAll?.();
  };
  const box = h('div', { class: 'pldrop qmenu mpanel', role: 'menu', 'aria-label': 'Queue item actions' },
    h('div', { class: 'pl-h small dim ell' }, q.title),
    ...items.map(it => h('button', { type: 'button', role: 'menuitem', 'data-qm': it.id, disabled: it.disabled || undefined, title: it.lock ? QUEUE_LOCK_HINT : (it.hint || undefined), onclick: () => run(it) }, h('span', { class: 'grow' }, it.label))),
    lk ? h('div', { class: 'small dim qm-note' }, QUEUE_LOCK_HINT) : null);
  document.body.append(box);
  const r = box.getBoundingClientRect(), z = Number(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1, vw = innerWidth / z, vh = innerHeight / z;
  box.style.left = Math.max(4, Math.min(x / z, vw - r.width - 4)) + 'px'; box.style.top = Math.max(4, Math.min(y / z, vh - r.height - 4)) + 'px';
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', esc, true); }, 0);
  return { el: box, close };
}
/** Wire right-click + long-press on a row element. */
export function attachQueueMenu(el, S, ctl, i, locked) {
  el.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); openQueueMenu(S, ctl, i, { locked, x: ev.clientX, y: ev.clientY }); });
  longPress(el, () => openQueueMenu(S, ctl, i, { locked }));
}

// WavWiz 0.3.8 L48: right-click (phone: long-press) on a Queue item -> a themed popup with the same look as the other menus (.pldrop.mpanel).
import { h, api, toast } from './util.js';
import { pickPlaylist, longPress } from './ui.js';
export const QUEUE_LOCK_HINT = 'The queue is locked - click the padlock to unlock it.';
/** Pure: the menu rows for queue item `i` of `n` (cur = playing index or -1). Remove and both Moves are disabled while locked. */
export function queueMenuItems({ i, n, cur = -1, locked = false } = {}) {
  const playNextTo = cur < 0 ? 0 : i > cur ? cur + 1 : cur;   // where the item lands so it plays right after the current song
  return [
    { id: 'play', label: 'Play now' },
    { id: 'next', label: 'Play next', disabled: i === cur || (cur >= 0 && i === cur + 1), to: playNextTo },
    { id: 'remove', label: 'Remove from queue', disabled: locked, lock: locked },
    { id: 'top', label: 'Move to top', disabled: locked || i === 0, lock: locked },
    { id: 'bottom', label: 'Move to bottom', disabled: locked || i === n - 1, lock: locked },
    { id: 'playlist', label: 'Add to playlist…' },
    { id: 'library', label: 'Show in Library' },
    { id: 'copy', label: 'Copy title' },
  ];
}
let lastPt = { x: 0, y: 0 };
if (typeof document !== 'undefined') document.addEventListener('pointerdown', ev => { lastPt = { x: ev.clientX, y: ev.clientY }; }, true);
const act = async (path, body, method = 'POST') => { try { await api(path, { method, body }); return true; } catch (e) { toast(e.message, true); return false; } };
/** Open the menu for queue index `i`. ctl: { refreshAll, showInLibrary }. locked: () => bool. */
export function openQueueMenu(S, ctl, i, { locked = () => false, x = lastPt.x, y = lastPt.y } = {}) {
  const q = S.queue?.[i]; if (!q) return null;
  document.querySelector('.qmenu')?.remove(); document.querySelector('.pldrop')?.remove();
  const lk = !!locked();
  const items = queueMenuItems({ i, n: S.queue.length, cur: S.now?.index ?? -1, locked: lk });
  const close = () => { box.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc, true); };
  const outside = ev => { if (!box.contains(ev.target)) close(); }, esc = ev => { if (ev.key === 'Escape') close(); };
  const run = async it => {
    close();
    switch (it.id) {
      case 'play': await act('/stream/jump', { index: i }); break;
      case 'next': await act('/queue/move', { from: i, to: it.to }); break;
      case 'remove': await act(`/queue/${i}`, undefined, 'DELETE'); break;
      case 'top': await act('/queue/move', { from: i, to: 0 }); break;
      case 'bottom': await act('/queue/move', { from: i, to: S.queue.length - 1 }); break;
      case 'playlist': pickPlaylist(S, { kind: 'tracks', ids: [q.refId ?? q.id] }); return;
      case 'library': ctl.showInLibrary?.(q.title, q); return;
      case 'copy': try { await navigator.clipboard.writeText([q.title, q.artist].filter(Boolean).join(' - ')); toast('Copied the title'); } catch { toast('Could not copy here.', true); } return;
    }
    ctl.refreshAll?.();
  };
  const box = h('div', { class: 'pldrop qmenu mpanel', role: 'menu', 'aria-label': 'Queue item actions' },
    h('div', { class: 'pl-h small dim ell' }, q.title),
    ...items.map(it => h('button', { type: 'button', role: 'menuitem', 'data-qm': it.id, disabled: it.disabled || undefined, title: it.lock ? QUEUE_LOCK_HINT : undefined, onclick: () => run(it) }, h('span', { class: 'grow' }, it.label))),
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

// F250-P5: phone-only adapter to the complete existing song action runner.
// Queue IDs identify occurrences; refId alone must never select a duplicate.
import { openQueueMenu } from './queuemenu.js';
import { current, zoneIdFor } from './zones40.js';
import { loadLayout } from './plcols.js';
const zoneKey = () => JSON.stringify([current()?.key, current()?.playbackId]);
const ref = q => q && JSON.stringify([q.id, q.kind, q.refId, q.location]);
export function currentSongContext(S) {
  const c = current(), item = S.now?.item, route = S._streamRoute;
  // Only a response from the current resolved stream authorizes song indices.
  // Linked visual zones may share it; same-key link/split changes may not.
  if (!c || !item || !route || S._nowRoute !== route || route.target !== zoneIdFor(c)) return null;
  const index = S.now.index, q = Number.isInteger(index) && index >= 0 ? S.queue?.[index] : null;
  const i = q && q.id != null && item.id != null && ref(q) === ref(item) ? index : -1;
  const zone = zoneKey(), itemRef = ref(item), order = JSON.stringify(S.queue);
  return { item, i, valid: () => zone === zoneKey() && S._nowRoute === route && S._streamRoute === route && route.target === zoneIdFor(current()) &&
    itemRef === ref(S.now?.item) && S.now?.index === index && order === JSON.stringify(S.queue) };
}
export function openNowSongMenu(S, ctl, anchor) {
  const ctx = currentSongContext(S); if (!ctx) return null;
  const r = anchor.getBoundingClientRect();
  const menu = openQueueMenu(S, { ...ctl, queueEdit: S._phoneQueueEdit }, ctx.i, { song: ctx, phone: true, from: anchor, valid: () => ctx.valid() && S.view === 'now' &&
    matchMedia('(max-width:900px)').matches, locked: () => !!loadLayout(true).locked, x: r.left, y: r.bottom });
  return menu && { ...menu, valid: ctx.valid };
}

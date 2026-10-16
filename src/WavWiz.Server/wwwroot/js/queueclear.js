import { api, toast, ask, undoToast } from './util.js';
/** 0.3.7 L14: Clear queue asks first ("Clear N tracks?"), then offers a short Undo that puts the same tracks back (desktop title bar and phone Queue page). */
export async function clearQueueFlow(S, ctl) {
  const snap = S.queue.slice(), n = snap.length; if (!n) return;
  if (!await ask(`Clear ${n} track${n === 1 ? '' : 's'}?`, `This empties the queue (${n} track${n === 1 ? '' : 's'}). You can undo it for a few seconds afterwards.`, { ok: 'Clear', danger: true })) return;
  await ctl.act('/queue/clear');
  undoToast(`Cleared ${n} track${n === 1 ? '' : 's'}`, async () => {
    const items = snap.filter(q => q.refId != null && (q.kind === 'track' || q.kind === 'radio'));   // address-only radio entries have no id to put back
    for (let i = 0; i < items.length;) {
      const q = items[i]; if (q.kind === 'radio') { await api('/queue/add', { method: 'POST', body: { kind: 'radio', id: q.refId } }); i++; continue; }
      let j = i; while (j < items.length && items[j].kind === 'track' && j - i < 500) j++;
      await api('/queue/add', { method: 'POST', body: { kind: 'tracks', ids: items.slice(i, j).map(x => x.refId) } }); i = j;
    }
    toast(`Restored ${n} track${n === 1 ? '' : 's'}`); ctl.refreshAll?.();
  });
}

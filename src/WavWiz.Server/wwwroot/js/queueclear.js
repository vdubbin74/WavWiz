import { ask } from './util.js';
/** 0.3.7 L14: Clear queue asks first ("Clear N tracks?"), then the server-side Undo toast can put the same queue back (desktop title bar and phone Queue page). */
export async function clearQueueFlow(S, ctl) {
  const snap = S.queue.slice(), n = snap.length; if (!n) return;
  if (!await ask(`Clear ${n} track${n === 1 ? '' : 's'}?`, `This empties the queue (${n} track${n === 1 ? '' : 's'}). You can undo it for a few seconds afterwards.`, { ok: 'Clear', danger: true })) return;
  await ctl.act('/queue/clear');   // the server keeps a snapshot; util.js api() raises the 10 s Undo toast (queuetools.js)
}

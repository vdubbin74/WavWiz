// 0.6.8-#15: one reference speaker per zone (the zone's timing clock for calibration). The server keeps at most one per zone (none until the user
// picks one), picks a new one when it leaves and 2+ speakers remain, re-bases the saved offsets and leaves a quiet note. This module: the swap prompt after a move, the note, and which
// reference a calibration starts from. Pure helpers are exported for tests.
import { api, toast, ask } from './util.js';

const groupOf = (S, id) => (S.groups || []).find(g => (g.deviceIds || []).includes(id)) || null;
/** The reference a speaker is measured against: its zone's reference, else the house reference (a reference speaker in no zone), else any. Pure. */
export function refFor(S, speakerId) {
  const zs = S.zones || [], byId = id => zs.find(z => z.id === id) || null, g = speakerId != null ? groupOf(S, speakerId) : null;
  if (g?.referenceId != null && byId(g.referenceId)) return byId(g.referenceId);
  return zs.find(z => z.reference && !groupOf(S, z.id)) || zs.find(z => z.reference) || null;
}
/** The question to ask after moving a reference speaker into a zone that already has its own, or null. Pure; uses the state BEFORE the move. */
export function swapQuestion(S, z, toId) {
  if (!z?.reference || toId == null) return null;
  const g = (S.groups || []).find(x => x.id === toId);
  if (!g || g.referenceId == null || g.referenceId === z.id || !(g.deviceIds || []).length) return null;
  return `${g.name} already has a reference. Make ${z.name} the reference instead?`;
}
/** After a successful move: ask (only when it applies) and swap only on yes. */
export async function offerSwap(q, toId, z, refresh) {
  if (!q) return false;
  if (!await ask('Reference speaker', q, { ok: 'Make it the reference', cancel: 'Keep the current one' })) return false;
  try { await api(`/groups/${toId}/reference`, { method: 'PUT', body: { zoneId: z.id } }); toast(`${z.name} is now the reference`); refresh?.(); return true; }
  catch (e) { toast(e.message, true); return false; }
}
/** Dismiss a zone's "Reference changed, re-check timing" note. */
export async function dismissNote(g, refresh) { try { await api(`/groups/${g.id}/reference-note`, { method: 'DELETE' }); refresh?.(); } catch (e) { toast(e.message, true); } }

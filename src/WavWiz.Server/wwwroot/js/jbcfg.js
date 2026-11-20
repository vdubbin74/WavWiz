// WavWiz 0.6.9 #19 (t1846-t1849): the Jukebox zone's saved settings - OFF / ON, songs per guest, vote to skip.
// The OFF / ON used to be worked out from the zone's speakers, and the Jukebox zone only holds speakers while the Jukebox runs, so with
// "No speakers" the switch changed nothing and sprang back. It is now a real saved setting (server: Jukebox config "zoneOn", off by default).
// 0.7.1 t2040u: every Jukebox setting (Settings > Jukebox and the Jukebox zone panel) SAVES ON EACH CHANGE, like the rest of Settings:
// switches and pickers at once, typed numbers after a short pause. A failed save shows the error and puts the control back. Nothing is staged,
// so there is no Save button and no "unsaved changes" prompt; a typed number still waiting for its pause is sent when you leave.

/** The saved values, from the /jukebox/zone view (S.jb). Off when it was never set. */
export function jbSaved(jb) { const j = jb || {}; return { zoneOn: j.zoneOn === true, perGuest: Number.isFinite(+j.perGuest) && +j.perGuest > 0 ? +j.perGuest : 3, voteSkip: j.voteSkip !== false }; }
/** t2040u: one saver per settings view. now(patch) saves at once (and anything still waiting with it); later(patch) waits `ms` after the
 *  last keystroke; flush() sends what is waiting now. put(patch, { keepalive }) does the PUT; onSaved(patch) / onError(err, patch) paint. */
const savers = new Set();
export function jbAutosave(put, { ms = 600, onSaved, onError, owner = null } = {}) {
  let pend = null, t = 0;
  const send = async (patch, keepalive) => { try { await put(patch, { keepalive }); onSaved?.(patch); return true; } catch (e) { onError?.(e, patch); return false; } };
  const sv = {
    now: patch => { const p = { ...(pend || {}), ...patch }; pend = null; clearTimeout(t); return send(p); },
    later: patch => { pend = { ...(pend || {}), ...patch }; clearTimeout(t); t = setTimeout(() => sv.flush(), ms); },
    flush: keepalive => { clearTimeout(t); if (!pend) return Promise.resolve(true); const p = pend; pend = null; return send(p, keepalive); },
    get pending() { return pend; },
    drop: () => { savers.delete(sv); },
    owner,
  };
  savers.add(sv); return sv;
}
/** Send every typed value still waiting (leaving the panel, closing Settings, closing or hiding the page). */
export function jbFlushAll(keepalive) {
  return Promise.all([...savers].map(s => { const p = s.flush(keepalive); if (s.owner && !s.owner.isConnected) s.drop(); return p; }));   // a closed Settings view is forgotten once flushed
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('pagehide', () => { jbFlushAll(true); });
  if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'hidden') jbFlushAll(true); });
}
/** The line under the switch: what ON / OFF means here, and the hint when ON would not be heard. `speakers` = the zone's speakers now, or the
 *  default speakers while the Jukebox is not running. */
export function jbHint(on, speakers) {
  if (!on) return 'Off: the Jukebox zone’s speakers stay silent. Guests can still add songs.';
  return speakers > 0 ? 'On: guests’ songs play on the Jukebox zone’s speakers.' : 'On, but no speakers yet. Add a speaker to the Jukebox zone to hear it.';
}
/** A zone OFF / ON with no speakers would do nothing: such pills are shown disabled with this tooltip instead (0.6.9 #19). */
export const EMPTY_ZONE_TIP = 'Add a speaker to this zone first';

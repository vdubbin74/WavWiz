// WavWiz 0.6.9 #19 (t1846-t1849): the Jukebox zone's saved settings - OFF / ON, songs per guest, vote to skip.
// The OFF / ON used to be worked out from the zone's speakers, and the Jukebox zone only holds speakers while the Jukebox runs, so with
// "No speakers" the switch changed nothing and sprang back. It is now a real saved setting (server: Jukebox config "zoneOn", off by default).
// In the Jukebox zone panel the switch and the settings are STAGED and applied with Save (persisted on the server); the quick switch on the
// Jukebox card in the zone tree saves at once, like the other live controls.

/** The saved values, from the /jukebox/zone view (S.jb). Off when it was never set. */
export function jbSaved(jb) { const j = jb || {}; return { zoneOn: j.zoneOn === true, perGuest: Number.isFinite(+j.perGuest) && +j.perGuest > 0 ? +j.perGuest : 3, voteSkip: j.voteSkip !== false }; }
/** The staged edits (null = nothing staged). Module state so a redraw of the panel (every zones refresh) keeps them. */
export const jbDraft = { v: null };
export const jbValue = jb => ({ ...jbSaved(jb), ...(jbDraft.v || {}) });
export const jbDirty = jb => { if (!jbDraft.v) return false; const s = jbSaved(jb), v = jbValue(jb); return Object.keys(s).some(k => s[k] !== v[k]); };
/** Stage one change; a value set back to the saved one is no longer a change. */
export function jbStage(jb, k, val) { const s = jbSaved(jb); const v = { ...(jbDraft.v || {}), [k]: val }; for (const key of Object.keys(v)) if (v[key] === s[key]) delete v[key]; jbDraft.v = Object.keys(v).length ? v : null; return jbDirty(jb); }
export function jbDiscard() { jbDraft.v = null; }
/** What the PUT /jukebox/config body is for the staged changes (only what changed). */
export const jbBody = jb => { const s = jbSaved(jb), v = jbValue(jb), b = {}; for (const k of Object.keys(s)) if (s[k] !== v[k]) b[k] = v[k]; return b; };
/** The line under the switch: what ON / OFF means here, and the hint when ON would not be heard. `speakers` = the zone's speakers now, or the
 *  default speakers while the Jukebox is not running. */
export function jbHint(on, speakers) {
  if (!on) return 'Off: the Jukebox zone’s speakers stay silent. Guests can still add songs.';
  return speakers > 0 ? 'On: guests’ songs play on the Jukebox zone’s speakers.' : 'On, but no speakers yet. Add a speaker to the Jukebox zone to hear it.';
}
/** A zone OFF / ON with no speakers would do nothing: such pills are shown disabled with this tooltip instead (0.6.9 #19). */
export const EMPTY_ZONE_TIP = 'Add a speaker to this zone first';
// leaving with unsaved changes: the browser asks before the page is closed or reloaded
let guard = false;
export function jbGuard(dirtyNow) {
  if (typeof window === 'undefined') return;
  if (dirtyNow && !guard) { guard = true; window.addEventListener('beforeunload', onLeave); }
  else if (!dirtyNow && guard) { guard = false; window.removeEventListener('beforeunload', onLeave); }
}
function onLeave(e) { e.preventDefault(); e.returnValue = ''; return ''; }

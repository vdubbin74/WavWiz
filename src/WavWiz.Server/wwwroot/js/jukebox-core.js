// WavWiz 0.3.0 §1 Jukebox (beta): pieces shared by the big screen (kiosk) and the guest phone page. No DOM work at import time.
export const GUEST_KEY = 'wavwiz.jukebox.guest';
export const NAME_KEY = 'wavwiz.jukebox.name';
export const STYLES = [['modern', 'Modern'], ['retro', 'Retro CD']];
/** A random id that stays on this phone so the per-guest limit and votes follow the person, not the tab. */
export function guestId(store = globalThis.localStorage, rnd = () => crypto.getRandomValues(new Uint32Array(2))) {
  try { const old = store?.getItem(GUEST_KEY); if (old && old.length >= 8) return old; } catch { /* private mode */ }
  const id = 'g-' + [...rnd()].map(n => n.toString(36)).join('-');
  try { store?.setItem(GUEST_KEY, id); } catch { /* ignore */ }
  return id;
}
/** Group heads, e.g. "Artists (2)". */
export const groupHead = (label, n) => `${label} (${n})`;
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const artistLine = a => plural(a.songs, 'song');
/** 0.3.4 H5: the server sends albums as { artist, name, tracks }; older builds used { artist, album }. One reader for both. */
export const albumName = a => (a ? (a.album ?? a.name ?? '') : '');
export const albumLine = a => `${a.artist} · ${plural(a.tracks, 'track')}`;
/** "Your songs in queue: 1 of 3" (Modern) / "Your picks: 1 of 3" (Retro CD). */
export function minePicks(board, gid) { return (board?.next || []).filter(x => x.mine || (x.guest && x.guest === gid)).length; }
/** Retro CD selection number for the LED readout ("SEL 107"). */
export const selNo = trackId => 100 + (Math.abs(Number(trackId) || 0) % 900);
/** Up next total, e.g. "5 songs · 19 min" (durations when known, else ~3.5 min a song). */
export function upNextLine(next) { const n = (next || []).length; if (!n) return plural(0, 'song'); const ms = next.reduce((a, x) => a + (x.durationMs > 0 ? x.durationMs : 210000), 0); return `${plural(n, 'song')} · ${Math.max(1, Math.round(ms / 60000))} min`; }
/** 0.3.5 J18: plays this guest has left - the server's own count (board.playsLeft, same rule as the per-guest limit), else from the board. */
export function playsLeft(board, gid) { const per = board?.perGuest ?? 3; if (Number.isFinite(board?.playsLeft)) return Math.max(0, Math.min(per, board.playsLeft)); return Math.max(0, per - minePicks(board, gid)); }
/** "3 available plays" / "1 available play" / "No plays left" */
export function playsLine(board, gid) { const n = playsLeft(board, gid); return n === 0 ? '0 available plays' : `${n} available play${n === 1 ? '' : 's'}`; }
/** "Your songs in queue: 1 of 3" */
export function mineLine(board, gid) {
  const mine = (board?.next || []).filter(x => x.mine || (x.guest && x.guest === gid)).length;
  return `Your songs in queue: ${mine} of ${board?.perGuest ?? 3}`;
}
/** Selection codes for the Retro CD typewriter strips: A1..A9, B1.. */
export const selCode = i => String.fromCharCode(65 + Math.floor(i / 9) % 26) + (i % 9 + 1);
/** Minutes left in "Up next" (rough: 3.5 min per song when lengths are unknown). */
export const upNextHead = next => `${plural(next.length, 'song')}`;
/** The kiosk exit gestures: long-press the corner logo, or Ctrl+Shift+J. */
export const isExitChord = e => e.ctrlKey && e.shiftKey && (e.key === 'J' || e.key === 'j');
/** Keys the kiosk swallows inside WavWiz (the OS keeps Ctrl+Alt+Del and the Windows key: see the setup guide, Windows Assigned Access). */
export function blockedKey(e) {
  if (isExitChord(e)) return false;
  if (e.key === 'Escape' || e.key === 'F11' || e.key === 'F5' || e.key === 'ContextMenu') return true;
  if (e.altKey && (e.key === 'Tab' || e.key === 'F4' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return true;
  if (e.ctrlKey && /^[wrnqtlp]$/i.test(e.key)) return true;
  return false;
}
/** Guest API: the session code rides in a header; no sign-in, no cookies. */
export function guestApi(code, fetchFn = (...a) => fetch(...a)) {
  return async (path, body) => {
    const r = await fetchFn('/api/v1/jukebox/guest' + path, { method: body ? 'POST' : 'GET', headers: { 'X-WavWiz-Guest': code, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    if (!r.ok) { const e = new Error(j?.error || 'Something went wrong. Try again.'); e.status = r.status; throw e; }
    return j;
  };
}

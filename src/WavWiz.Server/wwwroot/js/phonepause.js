// WavWiz 0.7.1 t2044u / t2045u: a phone call (or another app taking the audio, or switching apps) on an iPhone that plays as a speaker
// paused the WHOLE zone. iOS ends the page's audio for the interruption and sends the Now Playing "pause" to the page; the lock-screen
// handlers turned that into /stream/pause for the zone. Rule now: only the user's own Pause pauses the zone. A pause that comes with a
// system interruption (the AudioContext not running, the page's media element stopped by the system, the page just went to the background)
// only drops THIS phone out; the zone keeps playing and the phone resyncs and rejoins when the interruption ends (room.js).
// The lock-screen Pause the user presses while nothing interrupts still pauses the zone: that widget is the zone's remote (it shows the
// zone's song and its Next / Previous move the zone), the same as the Pause button in the app.

/** What the phone speaker last saw. Times are Date.now() ms; 0 = never. */
export const phoneAudio = { active: false, ctxState: 'running', interruptedAt: 0, resumedAt: 0, hiddenAt: 0, silentPaused: false, skipped: [] };
export const WAIT_MS = 350;      // iOS sends the pause action and the interruption in either order: decide a moment later
export const WINDOW_MS = 2000;   // a pause / play this close to an interruption (or to going to the background) belongs to it

/** Record what happened (room.js calls this): 'active' | 'inactive' | 'ctx' (+state) | 'hidden' | 'shown' | 'silent-pause' | 'silent-play'. */
export function notePhone(what, arg, now = Date.now(), s = phoneAudio) {
  if (what === 'active') { s.active = true; s.ctxState = arg || 'running'; }
  else if (what === 'inactive') { s.active = false; }
  else if (what === 'ctx') { const was = s.ctxState; s.ctxState = arg; if (arg !== 'running' && was === 'running') s.interruptedAt = now; if (arg === 'running' && was !== 'running') s.resumedAt = now; }
  else if (what === 'hidden') s.hiddenAt = now;
  else if (what === 'silent-pause') { s.silentPaused = true; s.interruptedAt = now; }
  else if (what === 'silent-play') s.silentPaused = false;
  return s;
}
/** Pure: is a "pause" from the system (an interruption / going to the background) rather than the user? */
export function isSystemPause(s, now = Date.now()) {
  if (!s.active) return false;                                   // not a phone speaker: every pause is the user's
  if (s.ctxState !== 'running' || s.silentPaused) return true;    // the phone's own audio was stopped by iOS
  return now - s.interruptedAt <= WINDOW_MS || now - s.hiddenAt <= WINDOW_MS;
}
/** Pure: is a "play" just iOS handing the audio back after an interruption? (The zone was never paused by it, so nothing to resume.) */
export function isSystemPlay(s, now = Date.now()) {
  if (!s.active) return false;
  return now - s.resumedAt <= WINDOW_MS || now - s.interruptedAt <= WINDOW_MS;
}
/** Wrap a lock-screen / media-key handler: on a phone speaker, wait a moment, then drop it when it belongs to an interruption. */
export function guardMedia(kind, fn, { wait = WAIT_MS, s = phoneAudio, clock = () => Date.now(), timer = setTimeout } = {}) {
  if (kind !== 'pause' && kind !== 'stop' && kind !== 'play') return fn;   // stop: treated like pause
  return (...a) => {
    if (!s.active) return fn(...a);
    timer(() => {
      const sys = kind === 'play' ? isSystemPlay(s, clock()) : isSystemPause(s, clock());
      if (sys) { s.skipped.push({ kind, at: clock() }); if (s.skipped.length > 20) s.skipped.shift(); return; }   // only this phone drops out / rejoins
      fn(...a);
    }, wait);
  };
}

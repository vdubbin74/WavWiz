// WavWiz 0.3.8 L45: media keys. (1) navigator.mediaSession handlers + metadata for browsers (phone / desktop browser tabs that play audio).
// (2) The WavWiz Player forwards the global media keys (RegisterHotKey, see MediaKeys.cs) as { cmd: 'media', key } host messages; the same actions run here,
// and volume keys answer with a themed on-screen indicator (posted back to the host, which shows it even when the window is minimized).
export const VOL_STEP = 5;
/** Pure: the action a media key stands for, given the state. Returns { path, body, method } or { master: delta } or { mute: true }. */
export function mediaAction(key, now) {
  switch (key) {
    case 'playpause': return now?.state === 'playing' ? { path: '/stream/pause' } : { path: '/stream/play', body: {} };
    case 'next': return { path: '/stream/next' };
    case 'prev': return { path: '/stream/prev' };
    case 'volup': return { master: VOL_STEP };
    case 'voldown': return { master: -VOL_STEP };
    case 'mute': return { mute: true };
    default: return null;
  }
}
export const clampPct = v => Math.max(0, Math.min(100, Math.round(+v || 0)));
export function installMedia({ S, api, act, masterLevel, allMuted } = {}) {
  const host = globalThis.window?.chrome?.webview;
  const osd = text => { try { const cs = getComputedStyle(document.documentElement); host?.postMessage({ cmd: 'osd', text, bg: cs.getPropertyValue('--panel').trim(), ink: cs.getPropertyValue('--ink').trim(), line: cs.getPropertyValue('--accent').trim() }); } catch { /* ignore */ } };
  const run = async key => {
    const a = mediaAction(key, S.now); if (!a) return;
    if (a.path) { await act(a.path, a.body); return; }
    if (a.master != null) {
      const cur = Math.round(masterLevel(S.zones)), next = clampPct(cur + a.master);
      try { await api('/zones/master', { method: 'POST', body: { set: next } }); for (const z of S.zones || []) if (z.enabled) z.volume = Math.max(0, Math.min(100, z.volume * (cur ? next / cur : 1))); } catch { /* offline */ }
      osd(`Volume ${next}%`); window.dispatchEvent(new CustomEvent('wavwiz:devredraw')); return;
    }
    if (a.mute) { const want = !allMuted(S.zones); for (const z of S.zones || []) z.muted = want; await act('/zones/mute-all', { muted: want }); osd(want ? 'Muted' : 'Sound on'); }
  };
  host?.addEventListener?.('message', ev => { const m = ev.data || {}; if (m.cmd === 'media') run(m.key); });
  const ms = globalThis.navigator?.mediaSession;
  if (ms) {
    for (const [name, key] of [['play', 'playpause'], ['pause', 'playpause'], ['nexttrack', 'next'], ['previoustrack', 'prev']]) { try { ms.setActionHandler(name, () => run(key)); } catch { /* unsupported action */ } }
    const paint = () => {
      const it = S.now?.item; try { ms.playbackState = S.now?.state === 'playing' ? 'playing' : S.now?.state === 'paused' ? 'paused' : 'none'; if (it && typeof MediaMetadata !== 'undefined') ms.metadata = new MediaMetadata({ title: it.title || '', artist: it.artist || '', album: it.album || '' }); } catch { /* ignore */ }
    };
    paint(); setInterval(paint, 2000);
  }
  return { run };
}

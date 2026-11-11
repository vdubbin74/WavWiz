// 0.7.0 item 2: radio now-playing on every surface (Now Playing, mini player, queue, Devices zone tiles, zone menu, phone lock screen).
// The server parses ICY StreamTitle and HLS #EXTINF titles into now.liveTitle (raw), liveArtist + liveSong (split), liveArt (song picture).
// Pure helpers so each surface says the same thing.

/** The song a station says is on, or null (not radio, or the station sends nothing). n = a now object (stream now or a zone's now). */
export function liveSong(n, it = n?.item) {
  const kind = it?.kind ?? n?.kind; if (kind !== 'radio') return null;
  const song = (n?.liveSong || '').trim(), raw = (n?.liveTitle || '').trim(); if (!song && !raw) return null;
  const station = ((it?.title ?? n?.title) || '').trim() || 'Internet radio';
  return { song: song || raw, artist: song ? ((n?.liveArtist || '').trim() || null) : null, station };
}
/** Title + second line for compact surfaces: radio = "Song" / "Artist · Station"; anything else = title / artist. */
export function nowLines(n, it = n?.item) {
  const l = liveSong(n, it);
  if (l) return { title: l.song, sub: l.artist ? `${l.artist} · ${l.station}` : l.station, artist: l.artist || '', station: l.station, live: true };
  return { title: (it?.title ?? n?.title) || '', sub: (it?.artist ?? n?.artist) || '', artist: (it?.artist ?? n?.artist) || '', station: null, live: false };
}
/** The phone lock screen / media keys (MediaSession): title = song, artist = artist (or the station), album = station. */
export function mediaSessionMeta(n, it = n?.item) {
  const l = liveSong(n, it);
  if (l) return { title: l.song, artist: l.artist || l.station, album: l.station };
  return { title: it?.title || 'WavWiz', artist: it?.artist || '', album: it?.album || 'WavWiz' };
}

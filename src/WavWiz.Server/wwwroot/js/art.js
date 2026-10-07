import { h } from './util.js';

const base = '/api/v1/art';
export const trackArt = (id, size = 192) => id ? `${base}/track/${id}?size=${size}` : null;
export const albumArt = (artist, album, size = 192) => `${base}/album?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&size=${size}`;
export const radioArt = (id, size = 192) => id ? `${base}/radio/${id}?size=${size}` : null;

/** 0.1.1: live sources. radio = internet station; airplay / spotify = a phone sending to the house (title/artist/artwork from the sender). */
export const isReceiver = it => !!it && (it.kind === 'airplay' || it.kind === 'spotify');
export const isLive = it => !!it && (it.kind === 'radio' || isReceiver(it));
export const sourceLabel = it => it?.kind === 'airplay' ? 'AirPlay' : it?.kind === 'spotify' ? 'Spotify Connect' : it?.kind === 'radio' ? 'Internet radio' : '';
/** 0.1.2 streaming chip: "AirPlay — Name" when a friendly sender is known; else "AirPlay" / "Spotify Connect". */
export function streamingChip(it, receivers) {
  if (!it) return null;
  if (it.kind === 'airplay') {
    const raw = receivers?.airplay?.lastSender || '';
    const name = friendlySender(raw);
    return name ? `AirPlay — ${name}` : 'AirPlay';
  }
  if (it.kind === 'spotify') {
    const u = receivers?.spotify?.user;
    return u ? `Spotify Connect — ${u}` : 'Spotify Connect';
  }
  return null;
}
function friendlySender(s) {
  if (!s || typeof s !== 'string') return '';
  const t = s.trim();
  if (t.length < 2 || t.length > 40) return '';
  if (/^[0-9A-Fa-f]{8,}$/.test(t)) return '';           // DACP hex ids
  if (/^iTunes_Ctrl/i.test(t)) return '';
  return t;
}

/** Cover element: themed placeholder underneath, the real picture on top once it loads (no picture = placeholder stays; nothing flickers). */
export function cover(src, cls = '', glyph = '♪') {
  const box = h('div', { class: 'cover ' + cls }, glyph);
  if (src) { const img = h('img', { src, alt: '', loading: 'lazy', decoding: 'async' }); img.onerror = () => img.remove(); img.onload = () => { box.firstChild && box.firstChild.nodeType === 3 && (box.firstChild.textContent = ''); }; box.append(img); }
  return box;
}

/** Best art URL for a now-playing / queue item (radio favicon or track cover). */
export function itemArtUrl(it, size = 192) {
  if (!it) return null;
  if (it.kind === 'radio' && it.refId) return radioArt(it.refId, size);
  if (it.artUrl) return it.artUrl;
  if (isReceiver(it)) return null;
  const id = artTrackId(it);
  if (id) return trackArt(id, size);
  // Album/artist fallback when tags are present but no track id
  if (it.artist && it.album) return albumArt(it.artist, it.album, size);
  return null;
}

/** The track id behind any of the item shapes the server returns (library row, queue item, playlist item, album/artist row). */
export function artTrackId(x) {
  if (!x) return null;
  if (x.artTrackId) return x.artTrackId;
  if (x.kind === 'radio') return null;
  if (x.refId && (x.kind === 'track' || x.kind == null)) return x.refId;
  if (x.id && x.path !== undefined) return x.id;         // library track rows have path
  return null;
}

// ---- Media Session (lock-screen / notification controls + cover) ----
export function setMediaSession(now, handlers) {
  if (!('mediaSession' in navigator)) return;
  try {
    const it = now?.item;
    if (!it) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; return; }
    const art = itemArtUrl(it, 512);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: (it.kind === 'radio' ? (now.liveTitle || it.title) : it.title) || 'WavWiz', artist: it.artist || '', album: it.album || 'WavWiz',
      artwork: art
        ? [96, 192, 384, 512].map(s => ({ src: itemArtUrl(it, s), sizes: `${s}x${s}`, type: 'image/jpeg' }))
        : [{ src: '/assets/logo-512.png', sizes: '512x512', type: 'image/png' }],
    });
    navigator.mediaSession.playbackState = now.state === 'playing' ? 'playing' : now.state === 'paused' ? 'paused' : 'none';
    for (const [a, fn] of Object.entries(handlers || {})) { try { navigator.mediaSession.setActionHandler(a, fn); } catch { /* action not supported on this browser */ } }
  } catch { /* old browser */ }
}

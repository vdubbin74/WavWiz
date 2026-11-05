import { h } from './util.js';
import { genNode } from './gencover.js';

const base = '/api/v1/art';
/** 0.3.2 F10: art URL version from the server (auth state artCv). A new build = new URLs, so pictures cached by older builds are never reused. */
let cv = '';
export const setArtCv = v => { cv = v ? String(v) : ''; };
export const artCv = () => cv;
const cvq = () => cv ? `&cv=${encodeURIComponent(cv)}` : '';
export const trackArt = (id, size = 192) => id ? `${base}/track/${id}?size=${size}${cvq()}` : null;
export const albumArt = (artist, album, size = 192) => `${base}/album?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&size=${size}${cvq()}`;
/** 0.2.1 F13: artist photo (server: MusicBrainz / Wikidata, cached). 204 = none -> the generated portrait stays. */
export const artistArt = (name, size = 384) => name ? `${base}/artist?name=${encodeURIComponent(name)}&size=${size}${cvq()}` : null;
export const radioArt = (id, size = 192) => id ? `${base}/radio/${id}?size=${size}${cvq()}` : null;

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

/** Cover element: themed placeholder underneath, the real picture on top once it loads (no picture = placeholder stays; nothing flickers).
 * 0.2.1 F13: gen = { album, artist } draws a unique generated cover as the placeholder, gen = { portrait: name } a round artist portrait. */
export function cover(src, cls = '', glyph = '♪', gen = null) {
  // 0.3.6 K4: while the picture loads the tile shows the dark theme placeholder (never the generated cover, never an accent gradient); the <img> stays hidden
  // until it has loaded AND decoded, then fades in (~150 ms). The generated cover is drawn only AFTER a failed load (or when there is no picture at all).
  const box = h('div', { class: 'cover ' + cls + (gen ? ' gen' : '') + (src ? ' loading' : '') }, gen ? '' : glyph);
  const showGen = () => { box.classList.remove('loading'); if (gen && !box.querySelector('.gencover') && !box.classList.contains('loaded')) box.append(gen.portrait != null ? genNode('artist', gen.portrait) : genNode('album', gen.album, gen.artist)); };
  const load = u => {
    const img = h('img', { src: u, alt: '', loading: 'lazy', decoding: 'async', class: 'cimg' }); img.onerror = () => { img.remove(); showGen(); };
    img.onload = () => {
      if (!img.naturalWidth) { img.remove(); showGen(); return; }
      const shown = () => { box.classList.remove('loading'); box.classList.add('loaded'); box.firstChild && box.firstChild.nodeType === 3 && (box.firstChild.textContent = ''); box.querySelector('.gencover')?.remove(); };
      (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(shown);
    };
    box.append(img);
  };
  if (src) { load(src); if (gen && gen.portrait == null) { box.dataset.src = src; box._wwReload = () => { if (!box.classList.contains('loaded') && !box.querySelector('img')) { box.classList.add('loading'); box.querySelector('.gencover')?.remove(); load(src + (src.includes('?') ? '&' : '?') + 'v=' + Date.now()); } }; } }
  else showGen();
  return box;
}

/** 0.5.0 F123: Now Playing / Up next cover with a fallback chain for library tracks: 1) track/album art; 2) artist photo (same cached artistArt as
 * Library, square box, object-fit cover); 3) generated album cover. Radio keeps radio art / 📻, receivers keep artUrl / 📱 (no artist lookup).
 * onReal(url) fires only when the track picture itself loaded (bloom / jacket vars never point at a failed URL). Tagged data-artist for artPushed. */
export const npArtistName = it => String(it?.albumArtist || it?.artist || '').trim();
export const npKey = (it, src) => [src || '', it ? npArtistName(it) : '', it?.album || '', it?.title || ''].join('\0');
export function npCover(it, size = 192, cls = '', onReal = null) {
  const src = itemArtUrl(it, size);
  if (!it || it.kind === 'radio' || isReceiver(it)) return cover(src, cls, it?.kind === 'radio' ? '📻' : isReceiver(it) ? '📱' : '♪');
  const name = npArtistName(it);
  const box = h('div', { class: 'cover ' + cls + ' gen loading' });
  if (name) { box.classList.add('acover'); box.dataset.artist = name; }
  const showGen = () => { box.classList.remove('loading'); if (!box.classList.contains('loaded') && !box.querySelector('.gencover')) box.append(genNode('album', it.album || it.title || '', it.artist || name || '')); };
  const done = () => { box.classList.remove('loading'); box.classList.add('loaded'); box.querySelector('.gencover')?.remove(); };
  const img = (u, cl, fail, ok) => {
    const im = h('img', { src: u, alt: '', loading: 'lazy', decoding: 'async', class: cl }); im.onerror = () => { im.remove(); fail(); };
    im.onload = () => { if (!im.naturalWidth) { im.remove(); fail(); return; } (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => { done(); ok?.(); }); };
    box.append(im);
  };
  const photo = bust => { const u = artistArt(name, Math.max(size, 192)); if (!u) { showGen(); return; } img(bust ? `${u}&v=${bust}` : u, 'cimg aphoto', showGen); };
  let trackOk = false;
  box._wwReload = () => { if (!trackOk && name) { box.querySelector('.aphoto')?.remove(); photo(Date.now()); } };
  if (src) img(src, 'cimg', () => name ? photo() : showGen(), () => { trackOk = true; onReal?.(src); });
  else if (name) photo(); else showGen();
  return box;
}

/** 0.2.2 T4d: round artist picture with a fallback chain. 1) the artist photo (online, cached); 2) if there is none, the artist's own album
 * covers - a 2x2 mosaic when 4 load, else the first one that loads; 3) the generated portrait only when nothing loads at all.
 * T4b: the element is tagged with the artist name so an "art" push from the server swaps the photo in live (artPushed). */
export function artistCover(name, ids = [], cls = 'lg rnd', size = 384) {
  const box = h('div', { class: 'cover acover ' + cls + ' gen loading', 'data-artist': name || '' });
  const showGen = () => { box.classList.remove('loading'); if (!box.classList.contains('loaded') && !box.querySelector('.gencover')) box.append(genNode('artist', name || '')); };   // 0.3.6 K4: only after every picture failed
  const done = () => { box.classList.remove('loading'); box.classList.add('loaded'); box.querySelector('.gencover')?.remove(); };
  const tryAlbums = () => {
    const list = (ids || []).filter(Boolean).slice(0, 4); if (!list.length || box.querySelector('.amosaic')) return;
    const m = h('div', { class: 'amosaic', 'aria-hidden': 'true' }); let pending = list.length; const ok = [];
    const settle = () => {
      if (--pending > 0) return;
      if (!ok.length) { m.remove(); showGen(); return; }                      // no album art either: the generated portrait is drawn
      m.replaceChildren(...(ok.length >= 4 ? ok.slice(0, 4) : [ok[0]])); m.classList.toggle('one', ok.length < 4); m.hidden = false; done();
    };
    m.hidden = true;
    for (const id of list) {
      const img = h('img', { alt: '', decoding: 'async', src: trackArt(id, ids.length >= 4 ? Math.max(96, size >> 1) : size) });
      img.onload = () => { if (img.naturalWidth) ok.push(img); settle(); }; img.onerror = settle;
    }
    box.append(m);
  };
  const photo = (bust) => {
    const src = artistArt(name, size); if (!src) { tryAlbums(); if (!(ids || []).filter(Boolean).length) showGen(); return; }
    const img = h('img', { class: 'aphoto', alt: '', loading: 'lazy', decoding: 'async', src: bust ? `${src}&v=${bust}` : src });
    img.onerror = () => { img.remove(); tryAlbums(); };
    img.onload = () => { if (!img.naturalWidth) { img.remove(); tryAlbums(); return; } box.querySelector('.aphoto:not(:last-of-type)')?.remove(); box.querySelector('.amosaic')?.remove(); done(); };
    box.append(img);
  };
  box._wwReload = () => photo(Date.now());
  photo();
  return box;
}
/** 0.2.2 T4b: the server found a picture - swap it into every open tile / row of that artist (album covers reload through their track art). */
export function artPushed(d) {
  if (!d) return;
  if (d.kind === 'rebuild') { if (d.cv) setArtCv(d.cv); return; }   // 0.4.4 F24: new picture URLs after "Rebuild album art"
  if (d.kind === 'artist' && d.artist) {
    const want = String(d.artist).trim().toLowerCase().replace(/\s+/g, ' ');
    document.querySelectorAll('.acover[data-artist]').forEach(el => { if (el.dataset.artist.trim().toLowerCase().replace(/\s+/g, ' ') === want && el._wwReload) el._wwReload(); });
  } else if (d.kind === 'album') {
    // album covers are fetched by track id, so every cover still showing its generated placeholder is asked once more (debounced: a big library sends many)
    clearTimeout(albumTimer);
    albumTimer = setTimeout(() => document.querySelectorAll('.cover.gen:not(.loaded)[data-src]').forEach(el => el._wwReload?.()), 4000);
  }
}
let albumTimer = 0;

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
// F206: one metadata owner; MediaMetadata rewritten only when track/title/art/state class changes; position forced only on
// track/state/duration change, from the caller's smooth clock (posMs = localPos clock like tickPos), never raw stale positionMs every paint.
// F212: metaKey has no play/pause class (iOS reloads artwork on every MediaMetadata write -> logo flash + 0:00 jump); last good art kept per track;
// new 512 art is preloaded and applied on load. Any metadata write re-publishes the stable position right after (never 0 unless it is 0).
let msMetaKey = '', msForceKey = '', msTrackKey = '', msArt = null, msArtWant = '', msLastPos = null;
const msArtwork = (it, url512) => url512 ? [96, 192, 384, 512].map(s => ({ src: itemArtUrl(it, s) || url512, sizes: `${s}x${s}`, type: 'image/jpeg' })) : null;
const msLogo = () => [{ src: '/assets/logo-512.png', sizes: '512x512', type: 'image/png' }];
function msWrite(ms, title, it, artwork) {
  ms.metadata = new MediaMetadata({ title, artist: it.artist || '', album: it.album || 'WavWiz', artwork });
  if (msLastPos) { const L = msLastPos; updateMediaSessionPosition(L.now, Number(L.posMs) + (L.now?.state === 'playing' ? performance.now() - L.at : 0), true); }   // F212: metadata write must not leave the scrubber at 0:00
}
export function setMediaSession(now, handlers, posMs) {
  if (!('mediaSession' in navigator)) return;
  try {
    const ms = navigator.mediaSession, it = now?.item;
    if (!it) {
      if (msMetaKey !== 'none') { msMetaKey = 'none'; ms.metadata = null; ms.playbackState = 'none'; }
      msForceKey = ''; msTrackKey = ''; msArt = null; msArtWant = ''; msLastPos = null; updateMediaSessionPosition(now, 0, true); return;
    }
    const title = (it.kind === 'radio' ? (now.liveTitle || it.title) : it.title) || 'WavWiz';
    const stateCls = now.state === 'playing' ? 'playing' : now.state === 'paused' ? 'paused' : 'none';
    const trackKey = String(it.id ?? it.refId ?? '');
    if (trackKey !== msTrackKey) { msTrackKey = trackKey; msArt = null; msArtWant = ''; }
    const art = itemArtUrl(it, 512) || msArt;   // F212: slim poll (no art) on the same track keeps the last good art
    msLastPos = { now, posMs: posMs ?? now.positionMs, at: performance.now() };
    const textKey = [trackKey, title, it.artist || '', it.album || ''].join('\u0001');
    const metaKey = textKey + '\u0001' + (art || '');
    if (metaKey !== msMetaKey || !ms.metadata) {
      const textSame = msMetaKey.startsWith(textKey + '\u0001') && ms.metadata;
      msMetaKey = metaKey;
      if (art && art !== msArt && typeof Image === 'function') {
        // soft preload: keep current artwork (prior art of this track, or logo for a brand-new track) until the 512 picture has loaded
        if (!textSame) msWrite(ms, title, it, msArt ? msArtwork(it, msArt) : msLogo());
        if (msArtWant !== art) {
          msArtWant = art; const img = new Image(), tk = trackKey, artwork = msArtwork(it, art);
          img.onload = () => { if (msTrackKey !== tk || msArtWant !== art) return; msArt = art; msWrite(ms, title, it, artwork); };
          img.onerror = () => { if (msArtWant === art) msArtWant = ''; };
          img.src = art;
        }
      } else {
        if (art) msArt = art;
        msWrite(ms, title, it, art ? msArtwork(it, art) : msLogo());
      }
    }
    if (ms.playbackState !== stateCls) ms.playbackState = stateCls;
    for (const [a, fn] of Object.entries(handlers || {})) { try { ms.setActionHandler(a, fn); } catch { /* action not supported on this browser */ } }
    const forceKey = `${trackKey}|${Number(now.durationMs)}|${now.state}`;
    if (forceKey !== msForceKey) { msForceKey = forceKey; updateMediaSessionPosition(now, posMs ?? now.positionMs, true); }   // F204/F206: else tickPos throttled updates own it
  } catch { /* old browser */ }
}
/** F206: true once setMediaSession owns metadata (media.js must not write artwork-less metadata). */
export const mediaSessionOwnsMetadata = () => msMetaKey !== '';
// F204: lock-screen scrubber (iOS shows 0:00 / -0:01 without setPositionState). Single owner: setMediaSession + now.js tickPos.
let msPosAt = 0, msPosKey = '';
export function updateMediaSessionPosition(now, posMs, force = false) {
  const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
  if (!ms || typeof ms.setPositionState !== 'function') return;
  try {
    const it = now?.item, durMs = Number(now?.durationMs);
    if (!it || isLive(it) || !Number.isFinite(durMs) || durMs <= 0) {   // live/radio/unknown: never publish duration 0
      if (msPosKey !== 'none') { msPosKey = 'none'; try { ms.setPositionState(); } catch { /* clear unsupported */ } }
      return;
    }
    const key = `${it.id ?? it.refId ?? ''}|${durMs}|${now.state}`, t = performance.now();
    if (!force && key === msPosKey && t - msPosAt < 1000) return;   // ~1s throttle; immediate on track/state/duration change
    msPosKey = key; msPosAt = t; if (String(it.id ?? it.refId ?? '') === msTrackKey) msLastPos = { now, posMs, at: t };
    const duration = durMs / 1000, p = Number(posMs) / 1000;
    ms.setPositionState({ duration, playbackRate: 1, position: Math.min(duration, Math.max(0, Number.isFinite(p) ? p : 0)) });
  } catch { /* old browser / invalid state */ }
}

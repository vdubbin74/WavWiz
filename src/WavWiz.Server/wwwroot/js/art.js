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

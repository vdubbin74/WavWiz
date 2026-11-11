import { h } from './util.js';
import { genNode } from './gencover.js';
import { icon } from './icons.js';
import { mediaSessionMeta } from './livemeta.js';

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
/** Same-origin proxy for a Radio Browser favicon. `hash` is the opaque faviconArt token the finder returned — never a raw URL (CSP is img-src 'self' data:). */
export const remoteArt = (hash, size = 192) => hash ? `${base}/remote/${encodeURIComponent(hash)}?size=${size}${cvq()}` : null;

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
/** Themed placeholder glyph (folder / note / radio / phone) — never a system emoji, so every theme colors it. */
export function coverGlyph(glyph = '♪') {
  const name = glyph === '📁' || glyph === 'folder' ? 'folder'
    : glyph === '📻' || glyph === 'radio' ? 'radio'
    : glyph === '📱' || glyph === 'phone' ? 'phone'
    : 'note';
  return icon(name, 'cover-ic');
}
export function cover(src, cls = '', glyph = '♪', gen = null) {
  // 0.3.6 K4: while the picture loads the tile shows the dark theme placeholder (never the generated cover, never an accent gradient); the <img> stays hidden
  // until it has loaded AND decoded, then fades in (~150 ms). The generated cover is drawn only AFTER a failed load (or when there is no picture at all).
  const box = h('div', { class: 'cover ' + cls + (gen ? ' gen' : '') + (src ? ' loading' : '') }, gen ? '' : coverGlyph(glyph));
  const showGen = () => { box.classList.remove('loading'); if (gen && !box.querySelector('.gencover') && !box.classList.contains('loaded')) box.append(gen.portrait != null ? genNode('artist', gen.portrait) : genNode('album', gen.album, gen.artist)); };
  const load = u => {
    const img = h('img', { src: u, alt: '', loading: 'lazy', decoding: 'async', class: 'cimg' }); img.onerror = () => { img.remove(); showGen(); };
    img.onload = () => {
      if (!img.naturalWidth) { img.remove(); showGen(); return; }
      const shown = () => { box.classList.remove('loading'); box.classList.add('loaded'); box.querySelector(':scope > .ic')?.remove(); box.firstChild && box.firstChild.nodeType === 3 && (box.firstChild.textContent = ''); box.querySelector('.gencover')?.remove(); };
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
/** 0.6.8-#8: the radio item with the live song picture (amgArtworkURL, served by /art/radio/{id}/live) when the station sends one; k changes per song. */
export function liveRadioItem(n) {
  const it = n?.item; if (it?.kind !== 'radio' || !it.refId || !n.liveArt) return it;
  let k = 0; for (const c of String(n.liveTitle || '')) k = (k * 31 + c.codePointAt(0)) >>> 0;
  return { ...it, liveArt: k.toString(36) };
}
export function itemArtUrl(it, size = 192) {
  if (!it) return null;
  if (it.kind === 'radio' && it.refId) return it.liveArt ? `${base}/radio/${it.refId}/live?size=${size}&k=${it.liveArt}` : radioArt(it.refId, size);
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
// F243: queue ids are not track identity. Keep last-good artwork and duration across slim/empty polls;
// async covers may publish only for the current track AND request. Tests are not iPhone runtime proof.
// F248: valid-duration zero/backward candidates are a reproducible smooth-clock poison. Reconcile at
// ingestion (refreshNow) and again here; do not blanket-ignore seeks — use version/index/track evidence
// or bounded confirmation so repeat/seek/reconnect still land.
let msMetaKey = '', msForceKey = '', msTrackKey = '', msArt = null, msArtWant = '', msLastPos = null, msCurrent = null, msGeneration = 0;
export function mediaSessionTrackKey(it) {
  if (!it) return '';
  // Receivers reuse their queue entry for multiple songs; radio artwork belongs to the station.
  if (isReceiver(it)) return [it.kind, it.refId || it.location || '', it.title || '', it.artist || '', it.album || ''].join('\u0001');
  // Library and saved radio IDs come from separate tables. Slim library polls can use
  // kind:'url', so keep their art/ref IDs in the library domain, not the queue shape.
  const domain = it.kind === 'radio' ? 'radio' : it.kind === 'remote' ? 'remote' : 'library';
  const id = it.kind === 'radio' ? it.refId : artTrackId(it) ?? it.refId;
  if (id != null && id !== '') return domain + ':ref:' + id;
  const loc = it.path || it.location || it.url;
  return domain + (loc ? ':loc:' + loc : ':queue:' + (it.id ?? [it.kind, it.title, it.artist, it.album].join('\u0001')));
}
/** F248: reconcile once per authoritative poll; writers consume this result, never confirm it again. */
export function reconcileSmoothPosition(prev, now, candidateMs, at = 0) {
  const state = now?.state || 'none', version = now?.version, index = now?.index;
  const trackKey = now?.item ? mediaSessionTrackKey(now.item) : '';
  const duration = Number(now?.durationMs), candidate = candidateMs == null ? NaN : Number(candidateMs);
  const accept = pos => ({ posMs: Number.isFinite(pos) ? pos : 0, at, version, index, trackKey, state,
    durationMs: Number.isFinite(duration) && duration > 0 ? duration : 0, pending: null, pendingAt: null });
  if (state === 'stopped' || state === 'none') return accept(0);
  if (!prev || !prev.trackKey || (trackKey && trackKey !== prev.trackKey)) return accept(candidate);
  const predicted = Number(prev.posMs) + (prev.state === 'playing' ? Math.max(0, at - Number(prev.at || 0)) : 0);
  // A missing non-stop item or incomplete duration is not a new track, stop, or seek to zero.
  // Do not consume version/index evidence until a complete finite clock arrives (Pause also bumps version).
  if (!now?.item || !Number.isFinite(candidate) || (!isLive(now.item) && prev.durationMs > 0 && !(Number.isFinite(duration) && duration > 0)))
    return { ...prev, posMs: predicted, at, state, pending: null, pendingAt: null };
  if (Number.isFinite(index) && Number.isFinite(prev.index) && index !== prev.index) return accept(candidate);
  // Conductor version is a mutation counter (Seek / StartAt / Pause / Resume, etc.), NOT a sample ID.
  // Natural same-index Repeat One and one-item All do NOT bump it.
  if (version != null && prev.version != null && Number(version) !== Number(prev.version)) return accept(candidate);
  // Policy: allow up to 2000ms of backward jitter; larger corrections need event evidence or confirmation.
  if (candidate >= predicted - 2000) return accept(candidate);
  // Consecutive low samples must agree with the pending clock's progression. There is no 2.5s expiry:
  // delayed polls at 3s+ must still recover on the next coherent sample. A good poll clears pending;
  // backwards/non-progressing or disagreeing low samples start fresh instead of confirming.
  const gap = at - Number(prev.pendingAt ?? at);
  const pendingPosition = Number(prev.pending) + (prev.state === 'playing' ? gap : 0);
  if (prev.pending != null && gap > 0 && (prev.state !== 'playing' || candidate > prev.pending) && Math.abs(candidate - pendingPosition) <= 2000) return accept(candidate);
  return { ...accept(predicted), pending: candidate, pendingAt: at };
}
function msClockPrev() {
  if (!msLastPos) return null;
  return { posMs: msLastPos.posMs, at: msLastPos.at, version: msLastPos.version, index: msLastPos.index,
    trackKey: msTrackKey, state: msLastPos.now?.state, durationMs: msLastPos.now?.durationMs,
    pending: msLastPos.pending, pendingAt: msLastPos.pendingAt, sample: msLastPos.sample };
}
function msApplyClock(now, candidate, at, clock = null, sample = now) {
  let rec;
  if (clock) {
    // refreshNow already reconciled this poll. Draw, tick and asynchronous artwork writes are consumers.
    const pos = Number.isFinite(candidate) ? candidate : Number(clock.posMs) + (clock.state === 'playing' ? Math.max(0, at - clock.at) : 0);
    rec = { ...clock, posMs: pos, at };
  } else if (msLastPos && msLastPos.sample === sample) {
    // Compatibility callers without the ingest clock: one snapshot object is one poll, not one sample per writer.
    rec = { ...msClockPrev(), posMs: msElapsed(), at };
  } else rec = reconcileSmoothPosition(msClockPrev(), now, candidate, at);
  msLastPos = { now, posMs: rec.posMs, at: rec.at, version: rec.version, index: rec.index,
    pending: rec.pending, pendingAt: rec.pendingAt, sample: clock?.sample || sample };
  return rec.posMs;
}
// Do not mislabel PNG art as JPEG; the browser can determine its actual MIME type.
const msArtwork = (it, url512) => [96, 192, 384, 512].map(s => ({ src: itemArtUrl(it, s) || url512, sizes: `${s}x${s}` }));
const msLogo = () => [{ src: '/assets/logo-512.png', sizes: '512x512', type: 'image/png' }];
const msElapsed = () => msLastPos ? Number(msLastPos.posMs) + (msLastPos.now.state === 'playing' ? performance.now() - msLastPos.at : 0) : 0;
function msWrite(ms) {
  if (!msCurrent) return;
  const { title, artist, album } = msCurrent, artwork = msArt?.artwork || msLogo();
  const key = JSON.stringify([msTrackKey, title, artist, album, artwork]);
  if (key === msMetaKey && ms.metadata) return;
  ms.metadata = new MediaMetadata({ title, artist, album, artwork }); msMetaKey = key;
  if (msLastPos) updateMediaSessionPosition(msLastPos.now, msElapsed(), true, msClockPrev());
}
function msDurationBlip(now) {
  const duration = Number(now?.durationMs);
  return now?.item && mediaSessionTrackKey(now.item) === msTrackKey && !isLive(now.item) &&
    (now.state === 'playing' || now.state === 'paused') && !(Number.isFinite(duration) && duration > 0) && msLastPos?.now.durationMs > 0;
}
function msPositionNow(now) {
  if (msDurationBlip(now))
    return { ...now, durationMs: msLastPos.now.durationMs };
  return now;
}
export function setMediaSession(now, handlers, posMs, clock = null) {
  if (!('mediaSession' in navigator)) return;
  try {
    const ms = navigator.mediaSession, it = now?.item, sample = now;
    if (!it) {
      // An incomplete playing/paused poll is not a stop. Retain metadata AND the moving/frozen clock.
      if (msCurrent && now?.state !== 'stopped' && now?.state !== 'none') {
        const state = now?.state === 'paused' || now?.state === 'playing' ? now.state : msLastPos?.now.state;
        updateMediaSessionPosition({ ...msLastPos?.now, state }, msElapsed(), true, msClockPrev());
        if (state) ms.playbackState = state;
        return;
      }
      if (msMetaKey !== 'none') { msMetaKey = 'none'; ms.metadata = null; ms.playbackState = 'none'; }
      msForceKey = ''; msTrackKey = ''; msArt = null; msArtWant = ''; msLastPos = null; msCurrent = null; msGeneration++;
      updateMediaSessionPosition(now, 0, true); return;
    }
    const trackKey = mediaSessionTrackKey(it), changed = trackKey !== msTrackKey;
    if (changed) { msTrackKey = trackKey; msArt = null; msArtWant = ''; msLastPos = null; msGeneration++; }
    const stateCls = now.state === 'playing' ? 'playing' : now.state === 'paused' ? 'paused' : 'none';
    const durationBlip = msDurationBlip(now);
    now = msPositionNow(now);
    const rawPosition = posMs ?? now.positionMs;
    // F243 duration blip OR F248 suspicious valid-duration zero: reconcile decides; never trust raw blindly.
    const candidate = durationBlip || rawPosition == null ? NaN : Number(rawPosition);
    const position = msApplyClock(now, candidate, performance.now(), clock, sample);
    msCurrent = { ...mediaSessionMeta(now, it), it };   // 0.7.0: radio = song / artist / station on the lock screen
    const art = itemArtUrl(it, 512) || msArt?.url;
    if (art !== msArtWant) { msArtWant = art || ''; msGeneration++; }
    if (art && art !== msArt?.url && typeof Image === 'function') {
      // Never replace the last-good cover with a logo during an art refresh of the same track.
      msWrite(ms);
      if (msPending !== msGeneration) {
        msPending = msGeneration;
        const img = new Image(), gen = msGeneration, artwork = msArtwork(it, art);
        img.onload = () => { if (gen !== msGeneration || trackKey !== msTrackKey) return; msArt = { url: art, artwork }; msWrite(ms); };
        img.onerror = () => { if (gen === msGeneration) msPending = -1; };
        img.src = art;
      }
    } else {
      if (art && !msArt) msArt = { url: art, artwork: msArtwork(it, art) };
      msWrite(ms);
    }
    if (ms.playbackState !== stateCls) ms.playbackState = stateCls;
    for (const [a, fn] of Object.entries(handlers || {})) { try { ms.setActionHandler(a, fn); } catch { /* unsupported action */ } }
    const forceKey = `${trackKey}|${Number(now.durationMs)}|${now.state}`;
    if (forceKey !== msForceKey) { msForceKey = forceKey; updateMediaSessionPosition(now, position, true, msClockPrev()); }
  } catch { /* old browser */ }
}
let msPending = -1;
/** F206: true once setMediaSession owns metadata (media.js must not write artwork-less metadata). */
export const mediaSessionOwnsMetadata = () => msMetaKey !== '';
// F204/F243/F248: scrubber uses reconciled smooth clock, stable identity, and last valid duration.
let msPosAt = 0, msPosKey = '';
export function updateMediaSessionPosition(now, posMs, force = false, clock = null) {
  const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
  if (!ms || typeof ms.setPositionState !== 'function') return;
  try {
    if (!now?.item && msCurrent && now?.state !== 'stopped' && now?.state !== 'none') return;
    const sample = now, durationBlip = msDurationBlip(now);
    now = msPositionNow(now);
    const it = now?.item, durMs = Number(now?.durationMs);
    if (!it || isLive(it) || !Number.isFinite(durMs) || durMs <= 0) {
      if (msPosKey !== 'none') { msPosKey = 'none'; ms.setPositionState(); }
      return;
    }
    const trackKey = mediaSessionTrackKey(it), key = `${trackKey}|${durMs}|${now.state}`, t = performance.now();
    if (!force && key === msPosKey && t - msPosAt < 1000) return;
    const p = Number(posMs), candidate = durationBlip || !Number.isFinite(p) ? NaN : p;
    const position = trackKey === msTrackKey ? msApplyClock(now, candidate, t, clock, sample) : (Number.isFinite(p) ? p : 0);
    msPosKey = key; msPosAt = t;
    const duration = durMs / 1000;
    ms.setPositionState({ duration, playbackRate: 1, position: Math.min(duration, Math.max(0, position / 1000)) });
  } catch { /* old browser / invalid state */ }
}

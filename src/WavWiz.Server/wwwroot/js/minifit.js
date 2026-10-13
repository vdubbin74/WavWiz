// 0.3.3 G4: pure helpers for the mini player (window transparency and text fit) - no DOM, so they are unit tested.
export const OPACITY_KEY = 'wavwiz.mini.opacity', OPACITY_MIN = 30, OPACITY_DEFAULT = 100;
/** 30..100 (percent), anything else -> 100. */
export const clampOpacity = v => (Number.isFinite(+v) && v !== null && v !== '' ? Math.max(OPACITY_MIN, Math.min(100, Math.round(+v))) : OPACITY_DEFAULT);
export function loadOpacity() { try { const v = localStorage.getItem(OPACITY_KEY); return v == null ? OPACITY_DEFAULT : clampOpacity(v); } catch { return OPACITY_DEFAULT; } }
export function saveOpacity(v) { try { localStorage.setItem(OPACITY_KEY, String(clampOpacity(v))); } catch { /* ignore */ } }
/** G4c: font sizes (px) for the title and the artist line so they sit above / below the progress bar without crowding:
 *  shrink with the text block height and the title length, never below the readable minimum. Overflow ellipsizes in CSS. */
export const TITLE_MIN = 11, ARTIST_MIN = 10;
export function fitText(blockH, titleLen = 0) {
  const t = Math.max(TITLE_MIN, Math.min(13, Math.floor(blockH * 0.2) - (titleLen > 28 ? 1 : 0)));
  const a = Math.max(ARTIST_MIN, Math.min(11.5, t - 1.5));
  return { title: t, artist: a };
}

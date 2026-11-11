import { LOGO, emblem } from './logo.js';   // 0.7.0 item 4
// Header wordmark (0.0.6): plain text "WavWiz" (Wav = --accent, Wiz = --accent2). No logo image in the header (fixes broken "MANMLS" SVG rendering).
export function wordmark(cls = 'wordmark') {
  const el = document.createElement('span');
  el.className = cls;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'WavWiz - Multi-zone music, in sync.');
  const wav = document.createElement('span'); wav.className = 'wm-wav'; wav.textContent = 'Wav';
  const wiz = document.createElement('span'); wiz.className = 'wm-wiz'; wiz.textContent = 'Wiz';
  el.append(wav, wiz);
  return el;
}
/** Header brand: 0.7.0 Parallel Flow emblem (inline, theme colors) + the text wordmark in the current app font. LOGO.header = false -> text only. */
export function brandMark(opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = opts.class || 'logo';
  if (LOGO.header && opts.emblem !== false) wrap.append(emblem('pf-emblem brand-emblem'));
  wrap.append(wordmark(opts.wordmarkClass || 'wordmark'));
  return wrap;
}
// Kept so older tests/imports that read WORDMARK_SVG still see Wav/Wiz color tokens.
export const WORDMARK_SVG = 'WavWiz plain text; Wav #FF3C00 / var(--accent); Wiz #19C3B1 / var(--accent2)';

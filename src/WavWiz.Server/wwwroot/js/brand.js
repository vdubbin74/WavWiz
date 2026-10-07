// Header wordmark (0.0.6): plain text "WavWiz" (Wav = --accent, Wiz = --accent2). No logo image in the header (fixes broken "MANMLS" SVG rendering).
export function wordmark(cls = 'wordmark') {
  const el = document.createElement('span');
  el.className = cls;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'WavWiz - Whole-home music, in sync.');
  const wav = document.createElement('span'); wav.className = 'wm-wav'; wav.textContent = 'Wav';
  const wiz = document.createElement('span'); wiz.className = 'wm-wiz'; wiz.textContent = 'Wiz';
  el.append(wav, wiz);
  return el;
}
/** Text wordmark only (no logo image) for the page header. */
export function brandMark(opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = opts.class || 'logo';
  wrap.append(wordmark(opts.wordmarkClass || 'wordmark'));
  return wrap;
}
// Kept so older tests/imports that read WORDMARK_SVG still see Wav/Wiz color tokens.
export const WORDMARK_SVG = 'WavWiz plain text; Wav #FF3C00 / var(--accent); Wiz #19C3B1 / var(--accent2)';

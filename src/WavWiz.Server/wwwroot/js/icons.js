// 0.0.7: one consistent SVG icon set (24 x 24, 2 px round strokes, currentColor) so every transport icon follows the theme (no system emoji).
const P = {
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  prev: '<path d="M18 6.2v11.6a.8.8 0 0 1-1.25.66L9 13.2a1.4 1.4 0 0 1 0-2.4l7.75-5.26A.8.8 0 0 1 18 6.2z" fill="currentColor" stroke="none"/><rect x="5.5" y="5.5" width="2.6" height="13" rx="1" fill="currentColor" stroke="none"/>',
  next: '<path d="M6 6.2v11.6a.8.8 0 0 0 1.25.66L15 13.2a1.4 1.4 0 0 0 0-2.4L7.25 5.54A.8.8 0 0 0 6 6.2z" fill="currentColor" stroke="none"/><rect x="15.9" y="5.5" width="2.6" height="13" rx="1" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.6" fill="currentColor" stroke="none"/>',
  shuffle: '<path d="M3 7h3.5c2.2 0 3.5 1.2 4.6 3l2.8 4.4c1 1.6 2.2 2.6 4.3 2.6H21"/><path d="M3 17h3.5c1.6 0 2.7-.6 3.6-1.7"/><path d="M14 8.7c.9-1.1 2-1.7 3.7-1.7H21"/><path d="M18.5 4.5 21 7l-2.5 2.5"/><path d="M18.5 14.5 21 17l-2.5 2.5"/>',
  repeat: '<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19"/><path d="M16 3l3 3-3 3"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5"/><path d="M8 21l-3-3 3-3"/>',
  repeatOne: '<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19"/><path d="M16 3l3 3-3 3"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5"/><path d="M8 21l-3-3 3-3"/><path d="M11.2 10.2 12.6 9v6"/>',
  volume: '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  eq: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  vizoff: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M3 3l18 18"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16.5V20"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  popout: '<path d="M14 4h6v6M20 4l-8 8"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  wave: '<path d="M3 12h1.5M6.5 8v8M10 5v14M13.5 9v6M17 7v10M20.5 11v2"/>',
};
export const ICON_NAMES = Object.keys(P);
export function iconSvg(name) { return `<svg class="ico-svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ''}</svg>`; }
/** A span holding the icon (innerHTML of a fixed, local SVG string: no user data, CSP-safe). */
export function icon(name, cls = '') { const s = document.createElement('span'); s.className = 'ic' + (cls ? ' ' + cls : ''); s.innerHTML = iconSvg(name); s.dataset.icon = name; return s; }
export function setIcon(el, name) { if (el.dataset.icon === name) return; el.dataset.icon = name; el.innerHTML = iconSvg(name); }

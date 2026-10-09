/** 0.2.1 F13: generated covers and artist portraits for music without a picture.
 * Every album gets its own deterministic tile (same name = same cover, on every device): a theme gradient (mixes of the theme's Main and
 * Second colors, so it follows the theme), big initials, a wave pattern and a small note glyph. Artists without a photo get a round
 * generated portrait (gradient, soft silhouette, initials). Pure helpers first (tested in Node), then the DOM builder. */

/** FNV-1a 32-bit hash of a string. */
export function hashStr(s) {
  let x = 2166136261;
  for (const ch of String(s ?? '')) { x ^= ch.codePointAt(0); x = Math.imul(x, 16777619); }
  return x >>> 0;
}
const SMALL = /^(the|a|an|and|of|&|\+|-|le|la|el|los|die|der|das)$/i;
/** "Low Tide Radio" -> "LT", "Northbound" -> "N", "The Glass Harbor" -> "GH"; nothing usable -> "". */
export function initials(name) {
  const words = String(name ?? '').replace(/[^\p{L}\p{N}\s&+-]/gu, ' ').split(/\s+/).filter(Boolean);
  const real = words.filter(w => !SMALL.test(w)); const use = real.length ? real : words.filter(w => /[\p{L}\p{N}]/u.test(w));
  if (!use.length) return '';
  const first = w => [...w].find(c => /[\p{L}\p{N}]/u.test(c)) || '';
  return (use.length === 1 ? first(use[0]) : first(use[0]) + first(use[1])).toUpperCase();
}
/** Small seeded generator (deterministic per name). */
function rng(seed) { let x = seed || 1; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** Everything that makes a cover unique, from the album + artist names. */
export function coverSpec(name, artist = '') {
  const seed = hashStr(String(name ?? '').toLowerCase() + '\u001f' + String(artist ?? '').toLowerCase()), r = rng(seed);
  const angle = Math.round(r() * 360);
  const mixA = 62 + Math.round(r() * 38), mixB = Math.round(r() * 34);              // % of Main in each gradient stop (Second makes up the rest)
  const shade = 4 + Math.round(r() * 22);                                                 // darken the far corner a little
  const waveCount = 5 + Math.floor(r() * 6), amp = 3 + r() * 7, freq = 1 + Math.floor(r() * 3), phase = r() * Math.PI * 2, tilt = (r() - 0.5) * 18;
  const waveTop = 52 + Math.round(r() * 16);
  const corner = Math.floor(r() * 2);                                                 // 0 = initials top-left, 1 = bottom-left
  return { seed, angle, mixA, mixB, shade, waveCount, amp, freq, phase, tilt, waveTop, corner, initials: initials(name) || '♪' };
}
/** One wave line across a 100-unit tile as an SVG path (smooth, deterministic). */
export function wavePath(y, amp, freq, phase, tilt = 0) {
  const pts = [];
  for (let i = 0; i <= 20; i++) { const x = i * 5; pts.push([x, y + tilt * (x - 50) / 100 + amp * Math.sin(phase + (x / 100) * freq * Math.PI * 2)]); }
  return 'M' + pts.map(([x, yy]) => `${x.toFixed(1)} ${yy.toFixed(2)}`).join(' L');
}
const mix = p => `color-mix(in oklch, var(--accent) ${p}%, var(--accent2))`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** SVG markup for an album cover (colors are theme CSS variables, so it re-colors with the theme). */
export function coverSvg(name, artist = '') {
  const c = coverSpec(name, artist), id = 'g' + c.seed.toString(36);
  const rad = c.angle * Math.PI / 180, x2 = (50 + 50 * Math.cos(rad)).toFixed(1), y2 = (50 + 50 * Math.sin(rad)).toFixed(1), x1 = (100 - x2).toFixed(1), y1 = (100 - y2).toFixed(1);
  const waves = [];
  for (let i = 0; i < c.waveCount; i++) waves.push(`<path d="${wavePath(c.waveTop + i * (100 - c.waveTop) / c.waveCount, c.amp * (1 - i * 0.05), c.freq, c.phase + i * 0.45, c.tilt)}" />`);
  const big = c.initials.length > 1 ? 34 : 44, ty = c.corner ? 44 : 42;
  return `<svg class="gencover" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">`
    + `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" style="stop-color:${mix(c.mixA)}"/><stop offset="1" style="stop-color:${mix(c.mixB)}"/></linearGradient>`
    + `<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${(c.shade / 100).toFixed(2)}"/></linearGradient></defs>`
    + `<rect width="100" height="100" fill="url(#${id})"/><rect width="100" height="100" fill="url(#${id}s)"/>`
    + `<g fill="none" stroke="#fff" stroke-width=".7" opacity=".38">${waves.join('')}</g>`
    + `<text x="9" y="${ty}" font-family="Ubuntu, 'Segoe UI', system-ui, sans-serif" font-weight="700" font-size="${big}" fill="#fff" fill-opacity=".94" letter-spacing="-1">${esc(c.initials)}</text>`
    + `<text x="91" y="15" text-anchor="end" font-size="10" fill="#fff" fill-opacity=".8">♫</text></svg>`;
}
/** SVG markup for a round artist portrait placeholder. */
export function portraitSvg(name) {
  const c = coverSpec(name, '\u0001artist'), id = 'p' + c.seed.toString(36);
  const ini = initials(name) || '♪';
  return `<svg class="gencover portrait" viewBox="0 0 100 100" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">`
    + `<defs><radialGradient id="${id}" cx="${30 + c.mixB / 3}%" cy="25%" r="85%"><stop offset="0" style="stop-color:${mix(c.mixA)}"/><stop offset="1" style="stop-color:${mix(c.mixB)}"/></radialGradient></defs>`
    + `<rect width="100" height="100" fill="url(#${id})"/>`
    + `<g fill="none" stroke="#fff" opacity=".16" stroke-width=".8"><circle cx="50" cy="50" r="40"/><circle cx="50" cy="50" r="33"/></g>`
    + `<text x="50" y="${ini.length > 1 ? 59 : 61}" text-anchor="middle" font-family="Ubuntu, 'Segoe UI', system-ui, sans-serif" font-weight="700" font-size="${ini.length > 1 ? 30 : 36}" fill="#fff" fill-opacity=".95">${esc(ini)}</text></svg>`;
}
/** DOM node for a generated cover / portrait (parsed once, tiny). */
export function genNode(kind, name, artist = '') {
  const t = document.createElement('template');
  t.innerHTML = kind === 'artist' ? portraitSvg(name) : coverSvg(name, artist);
  return t.content.firstChild;
}

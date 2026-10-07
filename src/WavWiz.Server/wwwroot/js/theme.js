// Theme: five presets (Midnight Neon default, Ember, Arctic, Pepecoin, Violet Pulse); custom uses Background / Accent / Text only.
// Secondary/highlight/muted/panel/line are derived. Color math is pure (no DOM) so it is unit-tested with node.
export const PRESETS = {
  default:  { name: 'Midnight Neon', accent: '#FF3C00', accent2: '#19C3B1', bg: '#14171A', ink: '#E8EDF0' },
  ember:    { name: 'Ember',         accent: '#FF5A1F', accent2: '#FFB347', bg: '#160E0A', ink: '#E8EDF0' },
  arctic:   { name: 'Arctic',        accent: '#3BA7FF', accent2: '#A8E6FF', bg: '#0B1218', ink: '#E8EDF0' },
  pepecoin: { name: 'Pepecoin',      accent: '#269B4D', accent2: '#C07A4E', bg: '#212121', ink: '#E8EDF0' },
  violet:   { name: 'Violet Pulse',  accent: '#A855F7', accent2: '#C084FC', bg: '#1A1028', ink: '#F5F3FF' },
};
export const DEFAULT_THEME_ID = 'default';
const KEY = 'unison.theme.v1';
/** Preset ids removed in 0.1.2 theme slim-down — migrate to Midnight Neon. */
const REMOVED = new Set(['charcoal', 'steel', 'midnight', 'forest', 'synthwave', 'mono', 'teal', 'purple', 'green', 'light', 'amber', 'browns', 'brown']);

export const isHex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
export function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgbToHex([r, g, b]) { return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase(); }
export function luminance(hex) { const c = hexToRgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
export function mix(a, b, t) { const x = hexToRgb(a), y = hexToRgb(b); return rgbToHex(x.map((v, i) => v + (y[i] - v) * t)); }
export const readableOn = hex => { const l = luminance(hex); return (l + 0.05) / (luminance('#111111') + 0.05) >= (1.05) / (l + 0.05) ? '#111111' : '#FFFFFF'; };

/** Default text color for a background (light bg → dark ink). */
export function defaultInk(bg) { return luminance(bg) > 0.35 ? '#1A1D20' : '#E8EDF0'; }

/** Secondary / highlight companion derived from Accent (hue rotate ~160°). Presets keep their designed accent2. */
export function companionAccent(accent) {
  let [r, g, b] = hexToRgb(accent).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; default: h = (r - g) / d + 4; }
    h /= 6;
  }
  h = ((h * 360 + 160) % 360) / 360;
  s = Math.min(1, Math.max(0.35, s * 0.9));
  l = Math.min(0.62, Math.max(0.38, l * 0.95 + 0.05));
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h * 12) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
  return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

/** All CSS variables for a theme. Adjustable knobs: bg, accent, ink. Everything else is derived. */
export function derive(t) {
  const bg = t.bg, accent = t.accent;
  const ink = isHex(t.ink) ? t.ink : defaultInk(bg);
  const accent2 = isHex(t.accent2) ? t.accent2 : companionAccent(accent);
  const light = luminance(bg) > 0.35, toward = light ? '#000000' : '#ffffff';
  const [r, g, b] = hexToRgb(accent);
  return {
    '--accent': accent, '--accent2': accent2, '--bg': bg,
    '--panel': mix(bg, toward, light ? 0.03 : 0.045), '--panel2': mix(bg, toward, light ? 0.07 : 0.095), '--line': mix(bg, toward, light ? 0.18 : 0.2),
    '--ink': ink, '--dim': mix(ink, bg, 0.42), '--accent-ink': readableOn(accent), '--accent-soft': `rgba(${r},${g},${b},.16)`,
  };
}

export function loadTheme() {
  let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* private mode / corrupt */ }
  const base = { ...PRESETS[DEFAULT_THEME_ID] };
  if (saved && isHex(saved.accent) && isHex(saved.bg)) {
    let preset = saved.preset || 'custom';
    if (preset === 'amber' || /^br[o]wn/.test(preset)) preset = 'default';   // old amber/browns → Midnight Neon
    if (REMOVED.has(preset) || (preset !== 'custom' && !PRESETS[preset])) {
      return { ...PRESETS[DEFAULT_THEME_ID], preset: DEFAULT_THEME_ID };       // removed preset → Midnight Neon
    }
    if (preset !== 'custom' && PRESETS[preset]) {
      return { ...PRESETS[preset], preset };
    }
    // custom: Background / Accent / Text; derive accent2
    const ink = isHex(saved.ink) ? saved.ink.toUpperCase() : defaultInk(saved.bg.toUpperCase());
    const accent = saved.accent.toUpperCase(), bg = saved.bg.toUpperCase();
    return { ...base, accent, bg, ink, accent2: companionAccent(accent), preset: 'custom' };
  }
  return { ...base, preset: DEFAULT_THEME_ID };
}
export function saveTheme(t) {
  const ink = isHex(t.ink) ? t.ink : defaultInk(t.bg);
  const accent2 = t.preset && PRESETS[t.preset] ? PRESETS[t.preset].accent2 : companionAccent(t.accent);
  try { localStorage.setItem(KEY, JSON.stringify({ accent: t.accent, accent2, bg: t.bg, ink, preset: t.preset })); } catch { /* ignore */ }
}
export function resetTheme() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } return loadTheme(); }

export function applyTheme(t) {
  const vars = derive(t), st = document.documentElement.style;
  for (const [k, v] of Object.entries(vars)) st.setProperty(k, v);
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', t.bg);
  document.documentElement.dataset.theme = t.preset || 'custom';
  st.colorScheme = luminance(t.bg) > 0.35 ? 'light' : 'dark';
}

import { migrateKey } from './phonejoin.js';
// Theme: ten presets (0.2.0 items 4-7; Midnight Neon default). Custom uses five colors: Background / Main / Second / Highlight / Text.
// Panel/line/dim are derived. Color math is pure (no DOM) so it is unit-tested with node.
// 0.2.1 F14: hl = Highlight, the third color for small accents only (hearts, selected tab underline, EQ / visualizer peak caps, the active
// zone bar + count, NEW chips, selected node / tooltip borders). Main stays on Play, primary buttons and sliders. Unset = Main.
// 0.2.1 F15: picker order is the object order below (Custom colors stays last).
export const PRESETS = {
  default:  { name: 'Midnight Neon', accent: '#FF3C00', accent2: '#19C3B1', hl: '#F5C542', bg: '#14171A', ink: '#E8EDF0' },
  pepecoin: { name: 'Pepecoin',      accent: '#269B4D', accent2: '#208241', hl: '#C07A4E', bg: '#212121', ink: '#FFFFFF' },   // all brand-kit colors
  ember:    { name: 'Ember',         accent: '#FF5A1F', accent2: '#FFB347', hl: '#4FC3F7', bg: '#160E0A', ink: '#E8EDF0' },
  arctic:   { name: 'Arctic',        accent: '#3BA7FF', accent2: '#A8E6FF', hl: '#6EF7B2', bg: '#0B1218', ink: '#E8EDF0' },
  violet:   { name: 'Violet Pulse',  accent: '#A855F7', accent2: '#C084FC', hl: '#2EE6D6', bg: '#1A1028', ink: '#F5F3FF' },
  mono:     { name: 'Monochrome',    accent: '#E8EDF0', accent2: '#9AA6AE', hl: '#FF5A5F', bg: '#0E1012', ink: '#E8EDF0' },
  daylight: { name: 'Daylight',      accent: '#E03500', accent2: '#0E8F82', hl: '#6B4EE6', bg: '#F3F1EE', ink: '#1A1D21' },
  nebula:   { name: 'Nebula',        accent: '#8B5CF6', accent2: '#2DD4BF', hl: '#F472B6', bg: '#0F0B1A', ink: '#EDE9FE' },
  steel:    { name: 'Blue Steel',    accent: '#A9BCCF', accent2: '#5F7488', hl: '#E0B15A', bg: '#18202A', ink: '#E3EAF2' },
  lime:     { name: 'Lime Circuit',  accent: '#A3E635', accent2: '#22D3EE', hl: '#F472D0', bg: '#0B120E', ink: '#ECFCCB' },
};
/** 0.3.6 K13: the "hot" color of each theme (the VU meter's 0..+3 zone, peak LEDs, level-bar top). Pepecoin: brand copper only. */
export const HOT = { default: '#C62F22', pepecoin: '#C07A4E', ember: '#C62F22', arctic: '#E5533D', violet: '#D9298B', mono: '#C62F22', daylight: '#C62F22', nebula: '#D9298B', steel: '#C62F22', lime: '#C62F22' };
/** 0.3.6 K11: LED bar ramp (low, middle, top). Midnight Neon: green, amber, copper-red; Pepecoin: brand green, green, copper (brand colors only); others: second color, main color, hot color. */
export function ledColors(t, accent, accent2) {
  if (t.preset === 'default') return { '--led-lo': '#3DDC84', '--led-mid': '#F5C542', '--led-hi': '#D9552B' };
  if (t.preset === 'pepecoin') return { '--led-lo': '#269B4D', '--led-mid': '#208241', '--led-hi': '#C07A4E' };
  return { '--led-lo': accent2, '--led-mid': accent, '--led-hi': hotFor(t) };
}
export const hotFor = t => (t && HOT[t.preset]) || '#C62F22';
export const DEFAULT_THEME_ID = 'default';
const KEY = 'wavwiz.theme.v1';         // 0.2.0 item 12: was unison.theme.v1; moved over once
const migrate = () => { try { migrateKey(localStorage, 'unison.theme.v1', KEY); } catch { /* no storage */ } };   // read lazily: the old value moves over the first time it is read
/** Preset ids removed in 0.1.2 theme slim-down — migrate to Midnight Neon. */
// 0.2.0: 'steel' and 'mono' are presets again (Blue Steel, Monochrome), so they no longer migrate.
const REMOVED = new Set(['charcoal', 'midnight', 'forest', 'synthwave', 'teal', 'purple', 'green', 'light', 'amber', 'browns', 'brown']);

export const isHex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
export function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgbToHex([r, g, b]) { return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase(); }
export function luminance(hex) { const c = hexToRgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
export function mix(a, b, t) { const x = hexToRgb(a), y = hexToRgb(b); return rgbToHex(x.map((v, i) => v + (y[i] - v) * t)); }
export const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** Text color for a fill. 0.3.0 §7.11: at least 4.5:1 - near-black / white first, pure black when needed; a brand theme passes its own palette. */
export const readableOn = (hex, palette = null) => {
  const c = palette || ['#111111', '#FFFFFF', '#000000'];
  return c.find(x => contrast(hex, x) >= 4.5) || c.reduce((a, b) => (contrast(hex, b) > contrast(hex, a) ? b : a));
};
/** 0.3.0 §7.11: a color used as TEXT moved toward the ink (a tint) until it reads at 4.5:1 on every surface. */
export function textOn(color, ink, surfaces) { for (let t = 0; t <= 1.0001; t += 0.04) { const c = t ? mix(color, ink, t) : color; if (surfaces.every(sf => contrast(c, sf) >= 4.5)) return c; } return ink; }

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
  const hl = isHex(t.hl) ? t.hl : accent;         // 0.2.1 F14: no Highlight = Main (the 0.2.0 look)
  const panel = mix(bg, toward, light ? 0.03 : 0.045), panel2 = mix(bg, toward, light ? 0.07 : 0.095), surf = [bg, panel, panel2];
  // 0.3.0 §7.11: secondary text stays as quiet as before but never under 4.5:1; Pepecoin text/fill pairs come from its brand kit only
  let dim = mix(ink, bg, 0.42); for (let k = 0.42; k > 0 && !surf.every(sf => contrast(dim, sf) >= 4.5); k -= 0.02) dim = mix(ink, bg, Math.max(0, k));
  const pal = t.preset === 'pepecoin' || t.brand ? [bg, '#FFFFFF', ink] : null;
  const pepe = t.preset === 'pepecoin';   // 0.3.5: Pepecoin status colors from the brand kit only (warning/MUTED/danger = copper, OK = primary)
  return {
    ...(pepe ? { '--amber': '#C07A4E', '--red': '#C07A4E', '--green': '#269B4D' } : {}),
    '--hot': hotFor(t),
    ...ledColors(t, accent, accent2),   // 0.3.6 K11: the EQ's live LED bars
    '--accent': accent, '--accent2': accent2, '--hl': hl, '--hl-ink': readableOn(hl, pal), '--bg': bg,
    '--panel': panel, '--panel2': panel2, '--line': mix(bg, toward, light ? 0.18 : 0.2),
    '--ink': ink, '--dim': dim, '--accent-ink': readableOn(accent, pal), '--accent-soft': `rgba(${r},${g},${b},.16)`,
    '--accent-text': textOn(accent, ink, surf), '--accent2-text': textOn(accent2, ink, surf), '--hl-text': textOn(hl, ink, surf),
  };
}

export function loadTheme() {
  let saved = null; try { saved = JSON.parse((migrate(), localStorage.getItem(KEY)) || 'null'); } catch { /* private mode / corrupt */ }
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
    // custom: Background / Main / Second / Text. Old three-color saves (before 0.2.0, or the 0.1.2-0.1.4 saves whose second was
    // always derived) get their second derived once and written back, so it is a stored color from then on.
    const ink = isHex(saved.ink) ? saved.ink.toUpperCase() : defaultInk(saved.bg.toUpperCase());
    const accent = saved.accent.toUpperCase(), bg = saved.bg.toUpperCase();
    const own = saved.v === 4 && isHex(saved.accent2);
    const t = { ...base, accent, bg, ink, accent2: own ? saved.accent2.toUpperCase() : companionAccent(accent), hl: isHex(saved.hl) ? saved.hl.toUpperCase() : accent, preset: 'custom' };
    if (!own) saveTheme(t);
    return t;
  }
  return { ...base, preset: DEFAULT_THEME_ID };
}
export function saveTheme(t) {
  const ink = isHex(t.ink) ? t.ink : defaultInk(t.bg);
  const accent2 = t.preset && PRESETS[t.preset] ? PRESETS[t.preset].accent2 : isHex(t.accent2) ? t.accent2 : companionAccent(t.accent);
  const hl = t.preset && PRESETS[t.preset] ? PRESETS[t.preset].hl : isHex(t.hl) ? t.hl : t.accent;
  try { localStorage.setItem(KEY, JSON.stringify({ v: 4, accent: t.accent, accent2, hl, bg: t.bg, ink, preset: t.preset })); } catch { /* ignore */ }
}
export function resetTheme() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } return loadTheme(); }

export function applyTheme(t) {
  const vars = derive(t), st = document.documentElement.style;
  for (const k of ['--amber', '--red', '--green']) st.removeProperty(k);   // 0.3.5: Pepecoin-only overrides do not leak into other themes
  for (const [k, v] of Object.entries(vars)) st.setProperty(k, v);
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', t.bg);
  document.documentElement.dataset.theme = t.preset || 'custom';
  st.colorScheme = luminance(t.bg) > 0.35 ? 'light' : 'dark';
}

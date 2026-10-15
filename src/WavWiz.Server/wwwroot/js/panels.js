// WavWiz 0.3.0 §6: Library / Devices panels - states rail · normal · expanded (only one expanded at a time), one storage key,
// one restore rule, auto-rail when Now Playing would drop under 420 px (not saved). Pure: no DOM here.
export const PANELS_KEY = 'wavwiz.panels';
export const RAIL_PX = 30, NP_MIN = 420, GAP = 10;
const LIBW = vw => Math.min(360, Math.max(230, vw * 0.21)), DEVW = vw => Math.min(380, Math.max(250, vw * 0.22));
const base = v => (v === 'rail' ? 'rail' : 'normal');
/** { lib: 'rail'|'normal', dev: 'rail'|'normal', exp: null|'lib'|'dev', list: 'open'|'collapsed', ctl: 'open'|'collapsed' } */
export function normPanels(p) {
  p = p && typeof p === 'object' ? p : {};
  return { lib: base(p.lib), dev: base(p.dev), exp: p.exp === 'lib' || p.exp === 'dev' ? p.exp : null, list: p.list === 'collapsed' ? 'collapsed' : p.list === 'expanded' ? 'expanded' : 'open', ctl: p.ctlSet ? (p.ctl === 'open' ? 'open' : 'collapsed') : 'collapsed', ...(p.ctlSet ? { ctlSet: true } : {}) };   // 0.3.6 K9: starts COLLAPSED until the user picks (then remembered)
}
/** One key; the 0.2.x keys (wavwiz.libcollapsed, wavwiz.devsize, wavwiz.listcollapsed, wavwiz.npctlcollapsed, libprefs.expanded) move over once. */
export function loadPanels(store = globalThis.localStorage) {
  try {
    const raw = store.getItem(PANELS_KEY); if (raw) return normPanels(JSON.parse(raw));
    let libExp = false; try { libExp = !!JSON.parse(store.getItem('wavwiz.libprefs.v1') || store.getItem('wavwiz.libprefs') || 'null')?.expanded; } catch { /* ignore */ }
    const ds = store.getItem('wavwiz.devsize') || (store.getItem('wavwiz.devcollapsed') === '1' ? 'collapsed' : 'standard');
    const p = normPanels({ lib: store.getItem('wavwiz.libcollapsed') === '1' ? 'rail' : 'normal', dev: ds === 'collapsed' ? 'rail' : 'normal', exp: libExp ? 'lib' : ds === 'expanded' ? 'dev' : null,
      list: store.getItem('wavwiz.listcollapsed') === '1' ? 'collapsed' : 'open', ctl: store.getItem('wavwiz.npctlcollapsed') === '1' ? 'collapsed' : 'open', ctlSet: store.getItem('wavwiz.npctlcollapsed') != null });
    store.setItem(PANELS_KEY, JSON.stringify(p)); return p;
  } catch { return normPanels(null); }
}
export function savePanels(p, store = globalThis.localStorage) { try { store.setItem(PANELS_KEY, JSON.stringify(normPanels(p))); } catch { /* private mode */ } return p; }
/** What a panel shows right now. */
export const shown = (p, k) => (p.exp === k ? 'expanded' : p.exp ? 'rail' : p[k]);
/** Chevron on the outer edge: rail <-> normal; from expanded straight to rail (one press, as the icon shows). */
export function chevron(p, k) { const s = shown(p, k); if (s === 'expanded') return { ...p, exp: null, [k]: 'rail' }; if (p.exp) return { ...p, exp: k, [k]: p[k] }; return { ...p, [k]: s === 'rail' ? 'normal' : 'rail' }; }
/** Clicking a rail: opens it; while the other panel is expanded, focus is handed over (that panel becomes the expanded one). */
export function railClick(p, k) { if (p.exp && p.exp !== k) return { ...p, exp: k }; return { ...p, [k]: 'normal' }; }
/** Expand button (inner edge): normal -> expanded; while expanded it is "⤡ Esc" and goes back. */
export function expand(p, k, on = p.exp !== k) { return on ? { ...p, exp: k } : { ...p, exp: p.exp === k ? null : p.exp }; }
/** Esc: leave expanded; both panels return to exactly what they were. */
export const esc = p => (p.exp ? { ...p, exp: null } : p);
/** Chevron glyph: points where the panel will move. */
export function chevronGlyph(p, k) { const s = shown(p, k), toLeft = k === 'lib' ? s !== 'rail' : s === 'rail'; return toLeft ? '‹' : '›'; }
/** 0.3.6 K2: the same, as a direction letter for the SVG chevron (l | r). */
export const chevronDir = (p, k) => (chevronGlyph(p, k) === '‹' ? 'l' : 'r');
export function chevronLabel(p, k) { const name = k === 'lib' ? 'Library' : 'Devices', s = shown(p, k); return s === 'rail' ? `Open the ${name} panel` : `Fold the ${name} panel to a rail`; }
/** Layout for this width: the saved state, but (temporarily, not saved) the other side folds to a rail when Now Playing would drop under 420 px,
 *  and an expanded panel falls back to normal for this load when the window is phone-sized. */
export function effective(p, width, { opened = null } = {}) {
  const e = { ...p };
  if (width <= 900) return { ...e, exp: null, auto: false };
  if (e.exp) return { ...e, auto: false };
  const lw = e.lib === 'rail' ? RAIL_PX : LIBW(width), dw = e.dev === 'rail' ? RAIL_PX : DEVW(width);
  const np = width - lw - dw - GAP * 4;
  if (np >= NP_MIN) return { ...e, auto: false };
  const fold = opened === 'lib' ? 'dev' : opened === 'dev' ? 'lib' : (e.dev === 'normal' ? 'dev' : 'lib');
  return { ...e, [fold]: 'rail', auto: fold };
}
export const npWidth = (e, width) => (e.exp ? 0 : width - (e.lib === 'rail' ? RAIL_PX : LIBW(width)) - (e.dev === 'rail' ? RAIL_PX : DEVW(width)) - GAP * 4);
/** Keyboard: [ / ] fold or open, Shift+[ / Shift+] expand, Esc leaves expanded. Returns the new state or null. */
export function keyAction(p, ev) {
  const t = ev.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
  if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return null;
  const k = ev.code === 'BracketLeft' ? 'lib' : ev.code === 'BracketRight' ? 'dev' : null;
  if (k) return ev.shiftKey ? expand(p, k) : chevron(p, k);
  if (ev.key === 'Escape' && p.exp) return esc(p);
  return null;
}
/** 0.3.2 F13/F15: the Playlist has three heights - collapsed (header strip) · open (today's --listh) · expanded (rises over the EQ / visualizer,
 *  Now Playing stays below). Up = expand one step, down = collapse one step. */
export const LIST_STEPS = ['collapsed', 'open', 'expanded'];
export function listStep(p, dir) { const i = LIST_STEPS.indexOf(normPanels(p).list), j = Math.max(0, Math.min(2, i + (dir === 'up' ? 1 : -1))); return { ...p, list: LIST_STEPS[j] }; }
/** Which arrows the Playlist header shows: up while it can grow, down while it can shrink. */
export const listArrows = list => ({ up: list !== 'expanded', down: list !== 'collapsed' });
/** 0.3.2 F8: the center panel width with both side panels open (popup width fallback while a panel is expanded). 1920 -> 1140. */
export const centerWidthFor = vw => Math.round(vw - LIBW(vw) - DEVW(vw) - GAP * 4);
/** 0.3.3 G1: popup width = the live center column. rectW is getBoundingClientRect().width (device-zoomed in some engines), offsetW the
 *  layout width; both are reduced to CSS px of the zoomed page. While the center is hidden (a side panel expanded) the both-panels-open
 *  width is used. Never wider than the viewport minus 32 px. Pure. */
export function centerPopupWidth(rectW, offsetW, vw, z = 1) {
  let w = rectW;
  if (offsetW > 0 && rectW > 0 && Math.abs(rectW - offsetW * z) < Math.abs(rectW - offsetW)) w = rectW / z;   // rect came back zoomed
  if (!(w > 200)) w = centerWidthFor(vw / z);
  return Math.round(Math.max(280, Math.min(w, vw / z - 32)));
}

/** 0.3.5 J1: the one fixed popup width - the center column's standard width (normal view, both side panels open) for this SCREEN
 *  (screenW = screen.availWidth; the window width only when it is larger, e.g. a spanned window). Never resized with the window;
 *  only capped so it always fits inside the viewport (phones get the full width from the CSS). Pure. */
export function popupWidth(screenW, vw, z = 1) {
  const base = Math.max(screenW || 0, vw || 0) / z;
  const w = base >= 1000 ? centerWidthFor(base) : base - 32;
  return Math.round(Math.max(280, w));
}

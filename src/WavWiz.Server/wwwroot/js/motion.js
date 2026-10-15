// WavWiz 0.3.6 K8 / K15: the ONE place that defines how things move and how a menu / button "shows you" something already on screen.
// K8: every slide, expand and collapse (panels, playlist, Library, Devices, speaker settings, Now Playing, mini player, dropdowns, Settings tabs)
//     uses this one glide. Tune GLIDE.ms between 200 and 300 here - the CSS reads --glide / --glide-ease from :root, nothing else hard-codes it.
// K15: pulse(el) = the one shared "look here" effect (brief accent glow; brings a hidden target to the front first). Both honor reduce-motion.
export const GLIDE = { ms: 250, ease: 'ease-in-out', fade: 160 };
export const PULSE_MS = 900;
export const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Publishes the glide as CSS custom properties (--glide, --glide-ease, --glide-fade). Idempotent. */
export function applyGlide(root = globalThis.document?.documentElement) {
  if (!root?.style) return GLIDE;
  const ms = Math.max(200, Math.min(300, GLIDE.ms));
  root.style.setProperty('--glide', ms + 'ms'); root.style.setProperty('--glide-ease', GLIDE.ease); root.style.setProperty('--glide-fade', GLIDE.fade + 'ms');
  return { ...GLIDE, ms };
}
applyGlide();
/** Web Animations helper on the shared glide (FLIP moves etc.). Returns null when reduce-motion is on. */
export function glide(el, frames, opts = {}) { if (reduced() || !el?.animate) return null; return el.animate(frames, { duration: GLIDE.ms, easing: GLIDE.ease, ...opts }); }
/** Make a hidden target visible: opens a collapsed <details>, un-hides it, scrolls it into view. Returns the element. */
export function bringToFront(el) {
  if (!el) return el;
  for (let p = el; p && p !== document.body; p = p.parentElement) { if (p.tagName === 'DETAILS') p.open = true; if (p.hidden) p.hidden = false; }
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  return el;
}
/** K15: pulse a target in the theme accent (ONE effect, class .k-pulse in app.css). With reduce-motion the target just gets a static ring. */
export function pulse(el, { front = true } = {}) {
  if (!el) return false;
  if (front) bringToFront(el);
  el.classList.remove('k-pulse'); void el.offsetWidth; el.classList.add('k-pulse');
  clearTimeout(el._kp); el._kp = setTimeout(() => el.classList.remove('k-pulse'), PULSE_MS);
  return true;
}
/** Resolve a selector (or element), pulse it. Used by menu actions that target something already on screen. */
export function pulseSel(sel, opts) { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; return pulse(el, opts); }

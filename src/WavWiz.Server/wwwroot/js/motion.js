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
export function glide(el, frames, opts = {}) { if (reduced() || !el?.animate) return null; const a = el.animate(frames, { duration: GLIDE.ms, easing: GLIDE.ease, ...opts }); holdFor([a], opts.duration || GLIDE.ms); return a; }   // F74: page held while it runs
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
// 0.4.9 F74 (generalizes F72): while ANY slide / expand / collapse runs (Now Playing, queue, Library, Devices, Roomy slide-over, mini player)
// a panel can stick out past the bottom for a few frames; the page (html or body - body scrolls on its own because html clips x) then grew a
// scrollbar and Devices jumped ~10 px left and back. holdPage() clips the page's y overflow for the duration - only when the page has no
// scrollbar already, so nothing visible changes. Every CSS transition / animation and every glide() / FLIP goes through it.
let holdN = 0, holdT = 0;
const pageScrolls = () => { const H = document.documentElement, b = document.body; return H.scrollHeight > H.clientHeight + 1 || (b && b.scrollHeight > b.clientHeight + 1 && getComputedStyle(b).overflowY !== 'visible'); };
export function holdPage(ms = GLIDE.ms + 150) {
  const H = globalThis.document?.documentElement; if (!H) return () => {};
  if (!H.classList.contains('hold74')) { if (pageScrolls()) return () => {}; H.classList.add('hold74'); }
  holdN++; let done = false; const rel = () => { if (done) return; done = true; if (--holdN <= 0) { holdN = 0; H.classList.remove('hold74'); } };
  setTimeout(rel, ms); clearTimeout(holdT); holdT = setTimeout(() => { holdN = 0; H.classList.remove('hold74'); document.querySelectorAll('.flip72').forEach(e => e.classList.remove('flip72')); }, ms + 2000);   // 0.4.9 F81: hard cap - iOS may never fire transitionend / animationend
  return rel;
}
/** Hold the page until all these animations finish (null entries ignored). */
export function holdFor(anims, ms = GLIDE.ms + 200) { const a = (anims || []).filter(Boolean); if (!a.length) return; const rel = holdPage(ms + 300); Promise.all(a.map(x => x.finished?.catch(() => {}))).then(rel); }
if (globalThis.document?.addEventListener) {
  const runs = new Map();
  const start = ev => { const t = ev.target; if (!(t instanceof Element) || ev.type === 'animationstart' && /infinite/.test(getComputedStyle(t).animationIterationCount)) return; const k = t; if (runs.has(k)) return; runs.set(k, holdPage(1500)); };
  const end = ev => { const r = runs.get(ev.target); if (r) { runs.delete(ev.target); setTimeout(r, 30); } };
  for (const e of ['transitionrun', 'animationstart']) document.addEventListener(e, start, true);
  for (const e of ['transitionend', 'transitioncancel', 'animationend', 'animationcancel']) document.addEventListener(e, end, true);
}

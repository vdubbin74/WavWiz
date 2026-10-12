// WavWiz 0.3.0 §9 + §7.8: ONE shared slider helper for every range input in the app.
// - While a slider's pointer is captured (being dragged), incoming state updates must not re-render or replace it: renderers call whenIdle(fn), which
//   runs fn now, or once right after the drag ends (coalesced). Live values are sent throttled by the caller without re-rendering.
// - Mouse wheel fine-tune on any hovered/focused slider: wheel = 1 step, Shift = coarse step (data-coarse, else 10 steps). The page does not scroll
//   while adjusting. Respects Lock EQ / read-only (disabled, aria-disabled or data-locked sliders are never moved).
let dragging = null; const pending = new Map(); let installed = false;

export const isDragging = el => !!dragging && (!el || dragging === el || (el.contains && el.contains(dragging)));
/** Run fn now, or after the current slider drag ends. key coalesces repeated requests (default: the function itself). */
export function whenIdle(fn, key = fn) { if (!dragging) { fn(); return true; } pending.set(key, fn); return false; }
function release() { if (!dragging) return; dragging = null; const fns = [...pending.values()]; pending.clear(); for (const f of fns) { try { f(); } catch (e) { console.error(e); } } }

/** Throttle with a trailing call (live slider updates, ~every ms). */
export function throttle(fn, ms) {
  let last = 0, t = 0, args = null;
  return (...a) => { args = a; const now = Date.now(), wait = ms - (now - last);
    if (wait <= 0) { clearTimeout(t); t = 0; last = now; fn(...args); } else if (!t) t = setTimeout(() => { t = 0; last = Date.now(); fn(...args); }, wait); };
}

const locked = r => r.disabled || r.getAttribute('aria-disabled') === 'true' || r.dataset.locked === '1' || r.closest('[data-locked="1"],.eqlocked');
/** Wheel step for a range input: 1 step, or the coarse step with Shift. Pure (unit tested). */
export function wheelValue({ value, min, max, step, coarse }, deltaY, shift) {
  const st = +step > 0 ? +step : 1, c = +coarse > 0 ? +coarse : st * 10, d = (shift ? c : st) * (deltaY < 0 ? 1 : -1);
  const v = Math.min(+max, Math.max(+min, +value + d)); const dec = (String(st).split('.')[1] || '').length;
  return +v.toFixed(dec);
}

export function installSliderGuard(doc = document) {
  if (installed || !doc) return; installed = true;
  const isRange = t => t && t.tagName === 'INPUT' && t.type === 'range';
  doc.addEventListener('pointerdown', ev => { if (isRange(ev.target) && !locked(ev.target)) { dragging = ev.target; try { ev.target.setPointerCapture?.(ev.pointerId); } catch { /* ok */ } } }, true);
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) doc.addEventListener(t, () => setTimeout(release, 0), true);
  doc.addEventListener('keyup', ev => { if (isRange(ev.target)) setTimeout(release, 0); }, true);
  doc.addEventListener('wheel', ev => {
    const r = ev.target; if (!isRange(r) || !(r.matches(':hover') || doc.activeElement === r)) return;
    ev.preventDefault(); if (locked(r)) return;
    const v = wheelValue({ value: r.value, min: r.min || 0, max: r.max || 100, step: r.step || 1, coarse: r.dataset.coarse }, ev.deltaY || -ev.deltaX, ev.shiftKey);
    if (String(v) === r.value) return;
    r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true }));
    clearTimeout(r._wheelT); r._wheelT = setTimeout(() => r.dispatchEvent(new Event('change', { bubbles: true })), 250);
  }, { passive: false, capture: true });
}

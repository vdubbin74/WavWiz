// 0.4.5 F8: pointer-event drag (mouse, pen, touch) for Library -> queue / playlist drops that does NOT depend on native HTML5 drag and drop.
// Why: in the Windows Player (WebView2 host) native HTML5 DnD from the Library never reached the queue on the user's PC (200 % / 65" TV), and
// touch / pen never start an HTML5 drag at all (Chromium needs a long press, which our long-press menu takes first). The Devices tree has used
// pointer events since 0.4.0 and works there, so drops now go through the same kind of path: pointerdown -> move past a threshold (touch/pen:
// after a short hold) -> a ghost follows the pointer -> document.elementFromPoint() finds a registered drop target (CSS px, so 100 % / 200 % /
// page zoom need no math) -> pointerup calls the target's drop().
// Modes (pure, unit tested): 'pointer' = every input uses this path and rows are not natively draggable (the WavWiz Player window, ?dnd=pointer);
// 'hybrid' = mouse keeps native HTML5 DnD, touch and pen use this path (browsers, default); 'native' = old behaviour (?dnd=native).
// (no util.js import: kept DOM-free at load so the pure parts are unit tested in node)

export function dndMode({ ua = globalThis.navigator?.userAgent || '', search = (() => { try { return location.search; } catch { return ''; } })(), stored = (() => { try { return localStorage.getItem('wavwiz.dnd'); } catch { return null; } })() } = {}) {
  let q; try { q = new URLSearchParams(search); } catch { q = new URLSearchParams(); }
  const want = q.get('dnd') || stored;
  if (want === 'pointer' || want === 'native' || want === 'hybrid') return want;
  return /WavWizPlayer\//.test(ua) ? 'pointer' : 'hybrid';
}
/** Pure: does this pointer type use the pointer path in `mode`? */
export const usesPointer = (mode, pointerType) => mode === 'pointer' || (mode === 'hybrid' && pointerType !== 'mouse');
/** Pure: has the drag started? mouse: 5 px; touch/pen: held >= holdMs first (a quick swipe scrolls instead). */
export function dragStarts({ dx, dy, heldMs, pointerType, holdMs = 180 }) {
  const d = Math.hypot(dx, dy);
  if (pointerType === 'mouse') return d >= 5 ? 'drag' : 'wait';   // 0.4.5: ~5 px, so a plain click still opens a category
  if (heldMs < holdMs) return d > 10 ? 'scroll' : 'wait';
  return d >= 6 ? 'drag' : 'wait';
}

const targets = new Set();
export const PD = { active: null };   // { payload, x, y, target } while a pointer drag runs (tests read it)
/** Registers a drop target. t = { accept(payload) -> bool, over?(payload, x, y), leave?(), drop(payload, x, y) }. Returns an unregister function. */
export function pointerDropTarget(el, t) { const e = { el, ...t }; targets.add(e); el.dataset.pdrop = '1'; return () => targets.delete(e); }
function findTarget(x, y, payload) {
  let n = document.elementFromPoint(x, y);
  while (n) { for (const t of targets) if (t.el === n && t.el.isConnected && t.accept(payload)) return t; n = n.parentElement; }
  return null;
}

/** Pure: the page zoom (html{zoom:var(--z)} - Display size). clientX/Y are unzoomed viewport px; a position:fixed ghost's left/top are multiplied by
 *  the zoom, so they are divided by it. rectW = the root's on-screen width, cssW = its layout width (offsetWidth). */
export const zoomOf = (rectW, cssW) => (rectW > 0 && cssW > 0 ? rectW / cssW : 1);
/** Pure (0.4.5 F26): where the pinned ghost goes so the point that was grabbed stays exactly under the pointer at any Display size / scaling. */
export const pinnedGhostPos = ({ x, y, offX, offY, zoom = 1 }) => ({ left: (x - offX) / zoom, top: (y - offY) / zoom });
const pageZoom = () => { try { const de = document.documentElement; return zoomOf(de.getBoundingClientRect().width, de.offsetWidth); } catch { return 1; } };

/** Makes `el` a pointer drag source. payload() is read when the drag starts; onStart / onEnd let the caller set its own state (dragInfo). */
export function pointerDragSource(el, payload, opts = {}) {
  el.addEventListener('pointerdown', ev => startPointerDrag(ev, el, payload, opts));
  el.addEventListener('contextmenu', ev => { if (PD.active || el.dataset.justdragged) { ev.stopImmediatePropagation(); ev.preventDefault(); } }, true);
  // a finished pointer drag is not also a click (would play the row)
  el.addEventListener('click', ev => { if (el.dataset.justdragged) { ev.stopImmediatePropagation(); ev.preventDefault(); } }, true);
}

/** One pointer drag from a pointerdown (also used by delegated sources such as the Devices tree grips).
 *  opts: mode, ghost(payload) -> element, pin (element: the ghost is a copy of it, held at the exact point it was grabbed - 0.4.5 F26),
 *  onStart(payload), onEnd(payload, dropped), noSkip (do not ignore presses on buttons - a grip may be one). */
export function startPointerDrag(ev, el, payload, { mode = dndMode(), ghost = null, pin = null, onStart, onEnd, noSkip = false } = {}) {
  if (ev.button > 0 || PD.active || !usesPointer(mode, ev.pointerType)) return;
  if (!noSkip && ev.target.closest('button,input,select,textarea,a[href],.more')) return;
  if (ev.pointerType === 'mouse') ev.preventDefault?.();   // no text selection while dragging with a mouse
  const pid = ev.pointerId, sx = ev.clientX, sy = ev.clientY, t0 = performance.now(), type = ev.pointerType;
  let started = false, cur = null, g = null, p = null, x = sx, y = sy, offX = 14, offY = 14, zoom = 1, pinned = false;
  const blockTouch = e => { if (started) e.preventDefault(); };
  const moveGhost = () => { if (!g) return; if (pinned) { const q = pinnedGhostPos({ x, y, offX, offY, zoom }); g.style.left = q.left + 'px'; g.style.top = q.top + 'px'; } else { g.style.left = (x + offX) / zoom + 'px'; g.style.top = (y + offY) / zoom + 'px'; } };
  const move = e => {
    if (e.pointerId !== pid) return; x = e.clientX; y = e.clientY;
    if (!started) {
      const s = dragStarts({ dx: x - sx, dy: y - sy, heldMs: performance.now() - t0, pointerType: type });
      if (s === 'scroll') return stop(); if (s === 'wait') return;
      started = true; p = payload(); PD.active = { payload: p, x, y, target: null, pointerType: type };
      try { el.setPointerCapture(pid); } catch { /* synthetic */ }
      el.classList.add('dragging'); document.body.classList.add('pdragging'); zoom = pageZoom();
      if (pin && pin.isConnected) {   // F26: a copy of the row, held where it was grabbed (sx, sy relative to the row's on-screen box)
        const r = pin.getBoundingClientRect(); offX = sx - r.left; offY = sy - r.top; pinned = true;
        g = pin.cloneNode(true); g.removeAttribute('id'); g.querySelectorAll('[id]').forEach(n => n.removeAttribute('id')); g.classList.add('dragghost', 'pdpin');
        g.setAttribute('aria-hidden', 'true'); g.style.width = r.width / zoom + 'px'; g.style.height = r.height / zoom + 'px';
      } else g = ghost ? ghost(p) : Object.assign(document.createElement('div'), { className: 'dragghost', textContent: String(p?.title || '') });
      g.classList.add('pdghost'); document.body.append(g);
      onStart?.(p); try { el.dispatchEvent(new TouchEvent('touchcancel')); } catch { /* no TouchEvent: nothing to cancel */ }
    }
    e.preventDefault(); moveGhost();
    const t = findTarget(x, y, p); if (t !== cur) { cur?.leave?.(); cur = t; } PD.active.x = x; PD.active.y = y; PD.active.target = t ? t.el : null;
    t?.over?.(p, x, y);
  };
  const finish = async (drop) => {
    stop(); if (!started) return;
    const t = cur; cur?.leave?.(); g?.remove(); el.classList.remove('dragging'); document.body.classList.remove('pdragging'); PD.active = null;
    el.dataset.justdragged = '1'; setTimeout(() => { delete el.dataset.justdragged; }, 0);
    try { if (drop && t) await t.drop(p, x, y); } finally { onEnd?.(p, !!(drop && t)); }
  };
  const up = e => { if (e.pointerId === pid) finish(true); }, cancel = e => { if (e.pointerId === pid) finish(false); }, esc = e => { if (e.key === 'Escape' && started) { e.preventDefault(); e.stopPropagation(); finish(false); } };
  function stop() {
    document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', cancel, true);
    document.removeEventListener('keydown', esc, true); document.removeEventListener('touchmove', blockTouch, { capture: true });
    try { el.releasePointerCapture(pid); } catch { /* not captured */ }
  }
  document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', cancel, true);
  document.addEventListener('keydown', esc, true); document.addEventListener('touchmove', blockTouch, { capture: true, passive: false });
}

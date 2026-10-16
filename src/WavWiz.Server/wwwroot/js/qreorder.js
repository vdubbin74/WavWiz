// WavWiz 0.3.7 L29: drag-to-reorder for the touch / compact Queue list (phone page). Pointer events on a grip handle, so it works with a finger and a mouse.
// The desktop table keeps its own HTML5 drag (listtable.js); both follow the same rules: not while the queue is locked (L27), and while a sort is
// showing a drop first asks "Apply this sort as the queue order?".
import { dropIndex, edgeScroll } from './qdrag.js';

/** Pure: the {from, to} server move for dragging row `from` to insertion point t (0..n, "before row t"), or null when nothing changes. */
export function moveFor(from, t, n) { if (from < 0 || from >= n) return null; const to = t > from ? t - 1 : t; return to === from || to < 0 || to >= n ? null : { from, to }; }
/** Pure: may rows be dragged right now? */
export const canDragRows = ({ can = true, locked = false } = {}) => !!can && !locked;
export const APPLY_SORT_Q = 'Apply this sort as the queue order?';

/** list: the scroller holding one element per track (data-i = queue index) each containing a .qgrip. opts: { locked(), can(), onMove({from,to}), sorted() , onSorted() }. */
export function attachReorder(list, opts) {
  const line = document.createElement('div'); line.className = 'qins'; line.hidden = true; list.style.position ||= 'relative'; list.append(line);
  let from = -1, y = 0, raf = 0, t = 0;
  const rows = () => [...list.querySelectorAll(':scope > [data-i]')];
  const place = () => { const bs = rows().map(r => r.getBoundingClientRect()), lr = list.getBoundingClientRect(); t = dropIndex(bs, y); const ly = bs.length ? (t < bs.length ? bs[t].top : bs[bs.length - 1].bottom) : lr.top; line.hidden = false; line.style.top = (ly - lr.top + list.scrollTop - 1) + 'px'; line.dataset.at = String(t); };
  list.addEventListener('pointerdown', ev => {
    const g = ev.target.closest?.('.qgrip'); if (!g || !canDragRows({ can: opts.can?.() ?? true, locked: opts.locked?.() })) return;
    const row = g.closest('[data-i]'); if (!row) return; from = +row.dataset.i; y = ev.clientY; row.classList.add('dragging'); g.setPointerCapture?.(ev.pointerId); ev.preventDefault(); place();
    const move = e => { y = e.clientY; place(); const lr = list.getBoundingClientRect(), v = edgeScroll(y, lr.top, lr.bottom); cancelAnimationFrame(raf); if (v) raf = requestAnimationFrame(function s() { list.scrollTop += v; place(); raf = requestAnimationFrame(s); }); };
    const up = async e => {
      g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); cancelAnimationFrame(raf);
      line.hidden = true; row.classList.remove('dragging'); const f = from; from = -1;
      if (e.type === 'pointercancel') return;
      if (opts.sorted?.()) { await opts.onSorted?.(); return; }
      const mv = moveFor(f, t, rows().length); if (mv) await opts.onMove(mv);
    };
    g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
  });
  return { destroy: () => line.remove() };
}

// WavWiz 0.3.7 L29: drag-to-reorder for the touch / compact Queue list (phone page). Pointer events on a grip handle, so it works with a finger and a mouse.
// The desktop table keeps its own HTML5 drag (listtable.js); both follow the same rules: not while the queue is locked (L27), and while a sort is
// showing a drop first asks "Apply this sort as the queue order?".
import { dropIndex, edgeScroll } from './qdrag.js';

/** Pure: the {from, to} server move for dragging row `from` to insertion point t (0..n, "before row t"), or null when nothing changes. */
export function moveFor(from, t, n) { if (from < 0 || from >= n) return null; const to = t > from ? t - 1 : t; return to === from || to < 0 || to >= n ? null : { from, to }; }
/** Pure: may rows be dragged right now? */
export const canDragRows = ({ can = true, locked = false } = {}) => !!can && !locked;
export const APPLY_SORT_Q = 'Apply this sort as the queue order?';

/** Compact Queue only: existing pointer engine, not the desktop/native/hybrid table.
 * identity() must include the ordered occurrences AND editing zone. A redraw must
 * destroy before replacing rows. Identical polls may defer row replacement
 * while the complete snapshot still matches; changed data always cancels.
 */
export function attachReorder(list, opts) {
  let pending = false, session = null, raf = 0, destroyed = false, blockedUntil = 0, guardTimer = 0;
  const root = opts.guardRoot || list;
  const line = document.createElement('div'); line.className = 'phone-qins'; line.hidden = true; line.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span'); line.append(label);
  const status = document.createElement('div'); status.className = 'phone-qstatus'; if (opts.announce) status.setAttribute('aria-hidden', 'true'); else { status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); } list.append(status);
  const rows = () => [...list.querySelectorAll(':scope > [data-i]')];
  const allowed = () => !pending && !destroyed && list.isConnected && canDragRows({ can: opts.can?.() ?? true, locked: opts.locked?.() }) && (opts.active?.() ?? true);
  const identity = () => opts.identity?.();
  const valid = () => allowed() && session && identity() === session.identity && session.row.isConnected && rows()[session.from] === session.row;
  // App Display size lives on html. DOMRects are viewport-scaled; fixed styles
  // and the 5px threshold are CSS pixels, not rounded offsetWidth ratios.
  const zoom = () => Number(getComputedStyle(document.documentElement).zoom) || 1;
  const scrollParent = () => {
    for (let p = list.parentElement; p; p = p.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
    }
    return document.scrollingElement;
  };
  const viewport = s => {
    const lr = list.getBoundingClientRect(), r = s.scroller === document.scrollingElement ? { top: 0, bottom: innerHeight, left: 0, right: innerWidth } : s.scroller.getBoundingClientRect();
    return { top: Math.max(0, r.top), bottom: Math.min(innerHeight, r.bottom), left: Math.max(0, r.left, lr.left), right: Math.min(innerWidth, r.right, lr.right) };
  };
  const inside = s => { const r = viewport(s), lr = list.getBoundingClientRect(); return s.x >= r.left && s.x <= r.right && s.y >= Math.max(r.top, lr.top) && s.y <= Math.min(r.bottom, lr.bottom); };
  const title = row => row?.dataset.qtitle || row?.querySelector('.t1')?.textContent || row?.textContent || 'song';
  const announce = text => { if (status.textContent === text) return; status.textContent = text; opts.announce?.(text); };
  const blocked = () => !!session || performance.now() < blockedUntil;
  const guard = ev => { if (blocked() && (session || root.contains(ev.target))) { ev.preventDefault(); ev.stopImmediatePropagation(); } };
  window.addEventListener('click', guard, true); window.addEventListener('contextmenu', guard, true);
  const removeGuards = () => { window.removeEventListener('click', guard, true); window.removeEventListener('contextmenu', guard, true); clearTimeout(guardTimer); };
  const suppressTail = () => {
    blockedUntil = performance.now() + 450; clearTimeout(guardTimer);
    guardTimer = setTimeout(() => { if (destroyed) removeGuards(); }, 460);
  };
  function place() {
    const s = session; if (!s?.moved) return;
    if (!valid()) { cancel(); return; }
    if (!inside(s)) { line.hidden = true; s.destination = null; announce('Outside queue — release to cancel'); return; }
    const rr = rows(), boxes = rr.map(r => r.getBoundingClientRect()), t = dropIndex(boxes, s.y), mv = moveFor(s.from, t, rr.length);
    const rest = rr.filter(r => r !== s.row), to = mv?.to ?? s.from;
    const before = rest[to], neighbor = before || rest[rest.length - 1];
    const text = mv ? `${before ? 'Before' : 'After'} ${title(neighbor)} · #${to + 1}` : `Keep ${title(s.row)} · #${s.from + 1}`;
    // One destination drives both the visible prediction and the server move.
    s.destination = mv; line.dataset.from = String(s.from); line.dataset.to = String(to); line.dataset.at = String(t); line.classList.toggle('noop', !mv);
    label.textContent = text; announce(text);
    const z = zoom(), lr = list.getBoundingClientRect(), vr = viewport(s);
    const gap = boxes[t]?.top ?? boxes.at(-1)?.bottom ?? lr.top;
    const y = Math.max(vr.top + 4 * z, Math.min(gap, vr.bottom - 4 * z));
    line.style.left = Math.max(vr.left, lr.left) / z + 'px'; line.style.width = Math.max(0, vr.right - vr.left) / z + 'px'; line.style.top = y / z + 'px';
    line.classList.toggle('label-below', y < vr.top + 32 * z); line.hidden = false;
    // Pinned source/count stays away from the destination label, in the viewport.
    s.ghost.style.left = Math.max(4, Math.min(s.x / z + 16, innerWidth / z - 184)) + 'px';
    s.ghost.style.top = Math.max(4, Math.min(s.y / z + 40, innerHeight / z - 48)) + 'px';
  }
  function frame() {
    if (!session) return;
    if (!valid()) { cancel(); return; }
    const s = session;
    if (s.moved && inside(s)) {
      const r = viewport(s), z = zoom();
      const v = edgeScroll(s.y, r.top, r.bottom, 40 * z);
      if (v) s.scroller.scrollTop += v;
      // Recompute even with a stationary pointer, after actual ancestor scroll.
      place();
    }
    if (session) raf = requestAnimationFrame(frame);
  }
  function finish() {
    const s = session; if (!s) return null;
    session = null; cancelAnimationFrame(raf); raf = 0;
    window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', pointerCancel, true);
    s.grip.removeEventListener('lostpointercapture', lost);
    window.removeEventListener('keydown', escape, true); window.removeEventListener('resize', cancel); window.removeEventListener('blur', cancel);
    s.row.classList.remove('dragging'); s.grip.setAttribute('aria-pressed', 'false'); s.ghost?.remove(); line.remove(); line.hidden = true;
    try { if (s.grip.hasPointerCapture(s.id)) s.grip.releasePointerCapture(s.id); } catch { /* detached or canceled */ }
    suppressTail(); opts.onEnd?.(); return s;
  }
  function cancel() { if (finish()) announce('Reorder canceled'); }
  const pointerCancel = ev => { if (ev.pointerId === session?.id) cancel(); };
  const lost = ev => { if (ev.pointerId === session?.id) cancel(); };
  const escape = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); cancel(); } };
  function move(ev) {
    const s = session; if (!s || ev.pointerId !== s.id) return;
    if (!valid()) { cancel(); return; }
    s.x = ev.clientX; s.y = ev.clientY;
    if (!s.moved && Math.hypot(s.x - s.x0, s.y - s.y0) / zoom() >= 5) {
      s.moved = true; s.row.classList.add('dragging'); s.grip.setAttribute('aria-pressed', 'true');
      s.ghost = document.createElement('div'); s.ghost.className = 'phone-qghost'; s.ghost.textContent = `1 song · ${title(s.row)}`; s.ghost.setAttribute('aria-hidden', 'true'); document.body.append(s.ghost, line);
    }
    ev.preventDefault(); place();
  }
  async function commit(mv, row, expected) {
    if (!mv || !allowed() || identity() !== expected) return;
    if (opts.sorted?.()) { await opts.onSorted?.(); return; }
    pending = true;
    try { await opts.onMove(mv); } catch (e) { announce(`Could not reorder: ${e.message || e}`); opts.onError?.(e); return; } finally { pending = false; }
    // Main's refresh path highlights the resulting occurrence in the new DOM.
    opts.onSettled?.(mv.to, title(row));
  }
  function up(ev) {
    if (!session || ev.pointerId !== session.id) return;
    if (!valid()) { cancel(); return; }
    session.x = ev.clientX; session.y = ev.clientY; place();
    const ok = session?.moved && inside(session), s = finish();
    if (ok && s.destination) void commit(s.destination, s.row, s.identity);
  }
  function down(ev) {
    const grip = ev.target.closest?.('.qgrip');
    if (!grip || !list.contains(grip) || session || ev.isPrimary === false || ev.button !== 0 || !allowed()) return;
    const row = grip.closest('[data-i]'), from = +row?.dataset.i;
    if (!row || rows()[from] !== row) return;
    // Cancel any pending row hold at ownership start, not after activation.
    row.dispatchEvent(new Event('touchcancel', { bubbles: true }));
    opts.onStart?.();
    session = { row, grip, from, id: ev.pointerId, x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, identity: identity(), scroller: scrollParent(), moved: false, destination: null };
    ev.preventDefault(); ev.stopPropagation();
    try { grip.setPointerCapture(ev.pointerId); } catch { /* window listeners still own the pointer */ }
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', pointerCancel, true);
    grip.addEventListener('lostpointercapture', lost);
    window.addEventListener('keydown', escape, true); window.addEventListener('resize', cancel); window.addEventListener('blur', cancel);
    raf = requestAnimationFrame(frame);
  }
  function key(ev) {
    const grip = ev.target.closest?.('.qgrip'); if (!grip || !list.contains(grip)) return;
    if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); return; }
    if (!ev.altKey || !['ArrowUp', 'ArrowDown'].includes(ev.key)) return;
    ev.preventDefault(); ev.stopPropagation(); if (!allowed() || session) return;
    const row = grip.closest('[data-i]'), from = +row.dataset.i, to = from + (ev.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= rows().length) return;
    announce(`Moving ${title(row)} to #${to + 1}`); void commit({ from, to }, row, identity());
  }
  list.addEventListener('pointerdown', down); list.addEventListener('keydown', key);
  return { cancel, blocked, isCurrent: () => !!session && !!valid(), get active() { return !!session; }, destroy() {
    cancel(); destroyed = true; list.removeEventListener('pointerdown', down); list.removeEventListener('keydown', key); status.remove(); line.remove();
    if (performance.now() >= blockedUntil) removeGuards();
  } };
}

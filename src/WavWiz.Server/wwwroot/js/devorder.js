// WavWiz 0.3.8 L40: click-and-drag reorder of device cards and zone cards. The order is remembered on this device (localStorage) and used by the
// standard column, the expanded view and the phone page. Pure helpers first, then the DOM wiring.
export const ORDER_KEY = 'wavwiz.devorder.v1';
export function loadOrder(store = globalThis.localStorage) { try { const v = JSON.parse(store.getItem(ORDER_KEY) || '{}'); return { z: Array.isArray(v.z) ? v.z.map(String) : [], g: Array.isArray(v.g) ? v.g.map(String) : [] }; } catch { return { z: [], g: [] }; } }
export function saveOrder(o, store = globalThis.localStorage) { try { store.setItem(ORDER_KEY, JSON.stringify(o)); } catch { /* private mode */ } }
/** Pure: sort items by a saved id list; unknown (new) items keep their natural order after the known ones. */
export function applyOrder(items, ids) {
  const list = items || [], pos = new Map((ids || []).map((id, i) => [String(id), i]));
  return list.map((x, i) => ({ x, i })).sort((a, b) => { const pa = pos.has(String(a.x.id)) ? pos.get(String(a.x.id)) : 1e6 + a.i, pb = pos.has(String(b.x.id)) ? pos.get(String(b.x.id)) : 1e6 + b.i; return pa - pb; }).map(o => o.x);
}
/** Pure: move `id` before (after=false) or after (after=true) `target` in the id list. */
export function moveBefore(ids, id, target, after = false) {
  const a = ids.map(String).filter(x => x !== String(id)); let i = a.indexOf(String(target)); if (i < 0) return ids.map(String);
  a.splice(after ? i + 1 : i, 0, String(id)); return a;
}
/** 0.4.6 F30 (tree42 zone drag) - Pure: the zone id order after moving box `fromIdx` before (after=false) / after (after=true) box `toIdx`. boxes = [[zone ids], ...] in the shown order. */
export function zoneOrderAfterDrop(boxes, fromIdx, toIdx, after) {
  const b = boxes.map(x => x.map(String)); if (fromIdx === toIdx || !b[fromIdx] || !b[toIdx]) return b.flat();
  const moving = b[fromIdx], target = b[toIdx], rest = b.filter((_, i) => i !== fromIdx); let at = rest.indexOf(target) + (after ? 1 : 0);
  rest.splice(at, 0, moving); return rest.flat();
}
export const orderedZones = zs => applyOrder(zs, loadOrder().z);
export const orderedGroups = gs => applyOrder(gs, loadOrder().g);

let dragNow = false, linkHandler = null;
/** 0.4.1: what dropping a zone card onto the MIDDLE of another zone card does (link the two). Set by the Devices screen. */
export const setLinkHandler = fn => { linkHandler = fn; };
/** Pure: is a pointer height in the middle band (30% - 70%) of a card? Dropping there links; near an edge it only reorders. */
export const inMiddle = (rect, y) => y >= rect.top + rect.height * 0.3 && y <= rect.top + rect.height * 0.7;
/** True while a card is being dragged (the periodic refresh must not rebuild the cards under the pointer). */
export const isDevDragging = () => dragNow;
/** Pure: where does a pointer at (x, y) land among sibling rects (the dragged card excluded)? -> { index, after, grid } or null when there are no other cards.
 *  A single column compares y with each card's middle; a grid (cards side by side, like the speakers) picks the card nearest the pointer and the side of it. */
export function dropTarget(rects, y, x = 0) {
  if (!rects.length) return null;
  const grid = rects.some((r, i) => rects.some((q, j) => j !== i && Math.abs(q.top - r.top) < 4));
  if (!grid) {
    for (let i = 0; i < rects.length; i++) if (y < rects[i].top + rects[i].height / 2) return { index: i, after: false, grid: false };
    return { index: rects.length - 1, after: true, grid: false };
  }
  let best = 0, bd = Infinity;
  rects.forEach((r, i) => { const cx = r.left + (r.width || 0) / 2, cy = r.top + r.height / 2, inside = x >= r.left && x <= r.left + (r.width || 0) && y >= r.top && y <= r.top + r.height, d = inside ? -1 : Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = i; } });
  const r = rects[best]; return { index: best, after: x > r.left + (r.width || 0) / 2, grid: true };
}
const scrollParent = el => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p; } return document.scrollingElement; };

/** DOM: make every speaker / zone card in `root` reorderable by its grip (0.4.0: pointer events - mouse, pen and touch - instead of HTML5 drag and drop;
 *  the grip is a full-height strip at the card's left edge, 34 px wide; grab / grabbing cursor, a drop line, autoscroll, Esc cancels, Alt+Up / Alt+Down from the keyboard). Called after each draw (idempotent). */
export function attachDevDrag(root, { onChange } = {}) {
  if (!root) return;
  const kinds = [['z', '[data-zone-id]:is(.dc3,.drow,.dcard):not(.zinline)', 'zoneId'], ['g', '.zcard[data-group-id]:not(.zinline):not(.zjuke)', 'groupId']];
  const commit = (kind, key, el, targetEl, after) => {
    const cur = [...root.querySelectorAll(`[data-dkind="${kind}"]`)].map(e => e.dataset[key]), o = loadOrder();
    o[kind] = moveBefore(cur, el.dataset[key], targetEl.dataset[key], after); saveOrder(o);
    try { window.dispatchEvent(new CustomEvent('wavwiz:devredraw')); } catch { /* ignore */ } onChange?.(o);
  };
  for (const [kind, sel, key] of kinds) for (const el of root.querySelectorAll(sel)) {
    if (el.dataset.dragwired === '1' && el.querySelector(':scope > .dgrip')) continue;
    el.dataset.dragwired = '1'; el.dataset.dkind = kind;
    const name = el.dataset.zone || el.querySelector('.dname')?.textContent || 'card';
    const grip = document.createElement('span'); grip.className = 'dgrip'; grip.title = 'Drag to reorder'; grip.setAttribute('tabindex', '0'); grip.setAttribute('role', 'button'); grip.setAttribute('aria-label', `Reorder ${name} (drag, or Alt+Up / Alt+Down)`);
    const dots = document.createElement('i'); dots.textContent = ''; dots.setAttribute('aria-hidden', 'true'); grip.append(dots); el.prepend(grip);
    const sibs = () => [...root.querySelectorAll(`[data-dkind="${kind}"]`)].filter(e => e !== el && (kind === 'g' || e.parentElement === el.parentElement));   // 0.4.1: zone cards inside a shared box are still siblings
    const clear = () => root.querySelectorAll('.dropbefore,.dropafter,.droplink').forEach(e => { e.classList.remove('dropbefore', 'dropafter', 'dropx', 'droplink'); delete e.dataset.linklabel; });
    grip.addEventListener('keydown', ev => {
      if (!ev.altKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return; ev.preventDefault();
      const all = [el, ...sibs()].sort((a, b) => a.compareDocumentPosition(b) & 4 ? -1 : 1), i = all.indexOf(el), t = all[i + (ev.key === 'ArrowUp' ? -1 : 1)]; if (t) commit(kind, key, el, t, ev.key === 'ArrowDown');
    });
    grip.addEventListener('pointerdown', ev => {
      if (ev.button > 0 || dragNow) return; ev.preventDefault();
      const sy = ev.clientY, sx = ev.clientX, pid = ev.pointerId; let started = false, tgt = null, raf = 0, lastY = sy, lastX = sx, scrolled = 0; const sp = scrollParent(el);
      try { grip.setPointerCapture(pid); } catch { /* synthetic pointer */ }
      const place = () => {
        const list = sibs(), rects = list.map(e => e.getBoundingClientRect()), t = dropTarget(rects, lastY, lastX); clear(); tgt = null;
        const mi = kind === 'g' && linkHandler ? rects.findIndex(r => lastX >= r.left && lastX <= r.left + r.width && inMiddle(r, lastY)) : -1;
        if (mi >= 0) { tgt = { el: list[mi], link: true }; list[mi].classList.add('droplink'); list[mi].dataset.linklabel = `Drop to link with ${list[mi].dataset.zone || 'this zone'}`; }
        else if (t) { tgt = { el: list[t.index], after: t.after }; list[t.index].classList.add(t.after ? 'dropafter' : 'dropbefore'); list[t.index].classList.toggle('dropx', t.grid); }
        el.style.transform = `translate(${lastX - sx}px, ${lastY - sy + (sp ? sp.scrollTop - scrolled : 0)}px)`;
      };
      const auto = () => { if (!started) return; const r = sp.getBoundingClientRect ? sp.getBoundingClientRect() : { top: 0, bottom: innerHeight }, top = sp === document.scrollingElement ? 0 : r.top, bot = sp === document.scrollingElement ? innerHeight : r.bottom;
        const d = lastY < top + 40 ? -12 : lastY > bot - 40 ? 12 : 0; if (d) { sp.scrollTop += d; place(); } raf = requestAnimationFrame(auto); };
      const move = e => { if (e.pointerId !== pid) return; lastY = e.clientY; lastX = e.clientX;
        if (!started) { if (Math.abs(lastY - sy) < 4 && Math.abs(lastX - sx) < 4) return; started = true; dragNow = true; scrolled = sp ? sp.scrollTop : 0; el.classList.add('dragging'); document.body.classList.add('devdragging'); raf = requestAnimationFrame(auto); }
        place(); };
      const end = (e, cancel) => { if (e.pointerId !== pid) return;
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', cn); grip.removeEventListener('lostpointercapture', cn); document.removeEventListener('keydown', esc, true);
        try { grip.releasePointerCapture(pid); } catch { /* already released */ }
        cancelAnimationFrame(raf); const t = tgt; clear(); el.style.transform = ''; el.classList.remove('dragging'); document.body.classList.remove('devdragging');
        if (started) { dragNow = false; el.dataset.justdragged = '1'; setTimeout(() => { delete el.dataset.justdragged; }, 0); if (!cancel && t && t.link) { linkHandler?.(el.dataset.groupId, t.el.dataset.groupId); try { window.dispatchEvent(new CustomEvent('wavwiz:devredraw')); } catch { /* ignore */ } } else if (!cancel && t) commit(kind, key, el, t.el, t.after); else try { window.dispatchEvent(new CustomEvent('wavwiz:devredraw')); } catch { /* ignore */ } } };
      const up = e => end(e, false), cn = e => end(e, true), esc = e => { if (e.key === 'Escape') { e.stopPropagation(); end({ pointerId: pid }, true); } };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', cn); grip.addEventListener('lostpointercapture', cn); document.addEventListener('keydown', esc, true);
    });
    el.addEventListener('click', ev => { if (el.dataset.justdragged || ev.target.closest('.dgrip')) { ev.stopImmediatePropagation(); ev.preventDefault(); } }, true);
  }
}

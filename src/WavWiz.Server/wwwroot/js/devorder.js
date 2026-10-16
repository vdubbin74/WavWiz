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
export const orderedZones = zs => applyOrder(zs, loadOrder().z);
export const orderedGroups = gs => applyOrder(gs, loadOrder().g);

/** DOM: make every speaker / zone card in `root` draggable by its grip. Called after each draw (idempotent). */
export function attachDevDrag(root, { onChange } = {}) {
  if (!root) return;
  const kinds = [['z', '[data-zone-id]:is(.dc3,.drow,.dcard):not(.zinline)', 'zoneId'], ['g', '.zcard[data-group-id]:not(.zinline)', 'groupId']];
  for (const [kind, sel, key] of kinds) for (const el of root.querySelectorAll(sel)) {
    if (el.dataset.dragwired === '1' && el.querySelector(':scope > .dgrip, :scope .dgrip')) continue;
    el.dataset.dragwired = '1'; el.dataset.dkind = kind;
    const grip = document.createElement('span'); grip.className = 'dgrip'; grip.textContent = '⋮⋮'; grip.title = 'Drag to reorder'; grip.setAttribute('aria-hidden', 'true');
    grip.addEventListener('pointerdown', () => { el.draggable = true; }); grip.addEventListener('pointerup', () => { el.draggable = false; });
    el.prepend(grip);
    el.addEventListener('dragstart', ev => { if (!el.draggable) { ev.preventDefault(); return; } root._drag = { kind, id: el.dataset[key] }; el.classList.add('dragging'); ev.dataTransfer?.setData('text/plain', el.dataset[key]); if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragend', () => { el.draggable = false; el.classList.remove('dragging'); root._drag = null; root.querySelectorAll('.dropbefore,.dropafter').forEach(e => e.classList.remove('dropbefore', 'dropafter')); });
    el.addEventListener('dragover', ev => {
      const d = root._drag; if (!d || d.kind !== kind || d.id === el.dataset[key]) return; ev.preventDefault();
      const r = el.getBoundingClientRect(), after = ev.clientY > r.top + r.height / 2;
      root.querySelectorAll('.dropbefore,.dropafter').forEach(e => e.classList.remove('dropbefore', 'dropafter')); el.classList.add(after ? 'dropafter' : 'dropbefore');
    });
    el.addEventListener('drop', ev => {
      const d = root._drag; if (!d || d.kind !== kind) return; ev.preventDefault();
      const r = el.getBoundingClientRect(), after = ev.clientY > r.top + r.height / 2, o = loadOrder();
      const cur = [...root.querySelectorAll(`[data-dkind="${kind}"]`)].map(e => e.dataset[key]);
      o[kind] = moveBefore(cur, d.id, el.dataset[key], after); saveOrder(o); root._drag = null;
      try { window.dispatchEvent(new CustomEvent('wavwiz:devredraw')); } catch { /* ignore */ } onChange?.(o);
    });
  }
}

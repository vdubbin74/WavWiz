// WavWiz 0.4.1: right-click (and long-press / Menu key / Shift+F10) context menus for speaker and zone cards.
// Pure part first (what each menu holds), then the small DOM menu. Items are { label, icon?, onclick, danger?, disabled?, hint?, sep? }.
import { h } from './util.js';

/** Pure: the items of a speaker card's menu, in the approved order. `a` = { admin, can, muted, on, calibrate, canCalibrate }. */
export function speakerMenuItems(a) {
  return [
    { id: 'settings', label: 'Settings' },
    { id: 'rename', label: 'Rename', disabled: !a.admin, hint: 'Only an administrator can rename a device.' },
    { id: 'mute', label: a.muted ? 'Unmute' : 'Mute', disabled: !a.can },
    { id: 'off', label: a.on ? 'Turn off' : 'Turn on', disabled: !a.can },
    { id: 'calibrate', label: 'Calibrate this speaker', disabled: !a.canCalibrate, hint: 'Calibrate from the device you are using, or ask an administrator.' },
    { id: 'move', label: 'Move to zone', disabled: !a.admin, hint: 'Only an administrator can change zones.' },
    { sep: true },
    { id: 'remove', label: 'Remove', danger: true, disabled: !a.admin, hint: 'Only an administrator can remove a device.' },
  ];
}
/** Pure: the items of a zone card's menu. `a` = { admin, can, muted, on, linked, canLink }. */
export function zoneMenuItems(a) {
  const l = [
    { id: 'settings', label: 'Settings', disabled: !a.admin, hint: 'Only an administrator can edit a zone.' },
    { id: 'rename', label: 'Rename', disabled: !a.admin, hint: 'Only an administrator can rename a zone.' },
    { id: 'mute', label: a.muted ? 'Unmute' : 'Mute', disabled: !a.can },
    { id: 'off', label: a.on ? 'Turn off' : 'Turn on', disabled: !a.can },
  ];
  if (a.canLink) l.push({ id: a.linked ? 'split' : 'link', label: a.linked ? 'Split off' : 'Link…', disabled: !a.can });
  l.push({ sep: true }, { id: 'remove', label: 'Remove zone', danger: true, disabled: !a.admin, hint: 'Only an administrator can remove a zone.' });
  return l;
}

// 0.4.2: the menus of the new zone tree. Pure item builders (ids are what the tests and the wiring use).
const IC = {
  play: 'M8 5v14l11-7z', pause: 'M7 5h3v14H7zM14 5h3v14h-3z', mute: 'M4 9v6h4l5 4V5L8 9zM16 9l5 6M21 9l-5 6', unmute: 'M4 9v6h4l5 4V5L8 9zM16 8a5 5 0 010 8',
  ctl: 'M12 3l2.5 6 6.5.5-5 4.3 1.6 6.4L12 17l-5.6 3.2L8 13.8 3 9.5 9.5 9z', queue: 'M4 6h12M4 12h12M4 18h8M18 14v6l4-3z', link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  split: 'M10 14a4 4 0 005.7 0M14 10a4 4 0 00-5.7 0M4 4l16 16', rename: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4', del: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13', move: 'M5 12h14M13 6l6 6-6 6', gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19 12a7 7 0 00-.1-1.4l2-1.5-2-3.4-2.4 1a7 7 0 00-2.4-1.4L13.7 3h-3.4l-.4 2.3a7 7 0 00-2.4 1.4l-2.4-1-2 3.4 2 1.5a7 7 0 000 2.8l-2 1.5 2 3.4 2.4-1a7 7 0 002.4 1.4l.4 2.3h3.4l.4-2.3a7 7 0 002.4-1.4l2.4 1 2-3.4-2-1.5c.1-.5.1-.9.1-1.4z',
  cal: 'M3 12h4l2-6 4 12 2-6h6', power: 'M12 3v9M6.3 7a8 8 0 1011.4 0', plus: 'M12 5v14M5 12h14',
};
export function ctxIcon(k) { const p = IC[k]; if (!p) return null; const NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ctx-ic'); s.setAttribute('aria-hidden', 'true'); const e = document.createElementNS(NS, 'path'); e.setAttribute('d', p); e.setAttribute('fill', 'none'); e.setAttribute('stroke', 'currentColor'); e.setAttribute('stroke-width', '1.8'); e.setAttribute('stroke-linecap', 'round'); e.setAttribute('stroke-linejoin', 'round'); s.append(e); return s; }
/** ZONE: Play/Pause, Mute/Unmute, Set as Controlling, Open queue, Link to… (submenu), Split off (only if linked), Rename, Delete zone. `a` = { admin, can, playing, muted, controlling, linked, others:[{id,name}] }. */
export function zoneMenu42(a) {
  const l = [
    { id: 'playpause', ic: a.playing ? 'pause' : 'play', label: a.playing ? 'Pause' : 'Play', disabled: !a.can },
    { id: 'mute', ic: a.muted ? 'unmute' : 'mute', label: a.muted ? 'Unmute' : 'Mute', disabled: !a.can },
    { id: 'control', ic: 'ctl', label: 'Set as Controlling', disabled: !!a.controlling, hint: 'This zone is already Controlling.' },
    { id: 'queue', ic: 'queue', label: 'Open queue' },
    { id: 'settings', ic: 'gear', label: 'Zone settings' },   // 0.4.9 F69
    { id: 'link', ic: 'link', label: 'Link to…', sub: (a.others || []).map(o => ({ id: 'link:' + o.id, label: o.name, zone: o.id })), disabled: !a.admin || !(a.others || []).length, hint: (a.others || []).length ? 'Only an administrator can link zones.' : 'There is no other zone to link to.' },
  ];
  // 0.4.9 F69 / 0.6.9 #12: manual order (admin) - a.order = { i, n } = the card's place among ALL Devices cards (saved on the server); ends disabled
  if (a.order && a.order.n > 1) { const { i, n } = a.order; l.push({ sep: true },
    { id: 'movetop', ic: 'move', label: 'Move to top', disabled: i === 0, hint: 'Already at the top.' }, { id: 'moveup', ic: 'move', label: 'Move up', disabled: i === 0, hint: 'Already at the top.' },
    { id: 'movedown', ic: 'move', label: 'Move down', disabled: i === n - 1, hint: 'Already at the bottom.' }, { id: 'movebottom', ic: 'move', label: 'Move to bottom', disabled: i === n - 1, hint: 'Already at the bottom.' }, { sep: true }); }
  if (a.linked) l.push({ id: 'split', ic: 'split', label: 'Split off', disabled: !a.can });
  l.push({ id: 'rename', ic: 'rename', label: 'Rename', disabled: !a.admin, hint: 'Only an administrator can rename a zone.' },
    { sep: true }, { id: 'delete', ic: 'del', label: 'Delete zone', danger: true, disabled: !a.admin, hint: 'Only an administrator can delete a zone.' });
  return l;
}
/** SPEAKER (in a zone): Mute/Unmute, Settings, Move to zone (submenu incl. Unassigned), Calibrate, Rename, Enable/Disable. `a.zones` = other zones [{id,name}]. */
export function speakerMenu42(a) {
  return [
    { id: 'mute', ic: a.muted ? 'unmute' : 'mute', label: a.muted ? 'Unmute' : 'Mute', disabled: !a.can },
    { id: 'settings', ic: 'gear', label: 'Settings' },
    { id: 'move', ic: 'move', label: 'Move to zone', sub: [...(a.zones || []).map(z => ({ id: 'move:' + z.id, label: z.name, zone: z.id })), { id: 'move:', label: 'Unassigned', zone: '' }], disabled: !a.admin, hint: 'Only an administrator can change zones.' },
    { id: 'calibrate', ic: 'cal', label: 'Calibrate', disabled: !a.canCalibrate, hint: 'Calibrate from the device you are using, or ask an administrator.' },
    { id: 'rename', ic: 'rename', label: 'Rename', disabled: !a.admin, hint: 'Only an administrator can rename a device.' },
    { id: 'off', ic: 'power', label: a.on ? 'Disable' : 'Enable', disabled: !a.can },
  ];
}
/** UNASSIGNED speaker: Add to zone (submenu), Settings. */
export function unassignedMenu42(a) {
  return [
    { id: 'add', ic: 'plus', label: 'Add to zone', sub: (a.zones || []).map(z => ({ id: 'move:' + z.id, label: z.name, zone: z.id })), disabled: !a.admin || !(a.zones || []).length, hint: (a.zones || []).length ? 'Only an administrator can change zones.' : 'Create a zone first.' },
    { id: 'settings', ic: 'gear', label: 'Settings', },
  ];
}

let open = null;
export function closeCtx() { if (!open) return; open.el.remove(); open.subs?.forEach(e => e.remove()); document.removeEventListener('pointerdown', open.off, true); document.removeEventListener('keydown', open.key, true); window.removeEventListener('blur', closeCtx); const f = open.from; open = null; f?.focus?.({ preventScroll: true }); }
/** Viewport box in client px. topMin clears the in-page title bar / topbar so the menu does not sit under it. */
export function ctxViewBox(win = globalThis, doc = typeof document !== 'undefined' ? document : null, pad = 4) {
  const vw = win.innerWidth ?? 0, vh = win.innerHeight ?? 0;
  let topMin = pad;
  try {
    const bar = doc?.querySelector?.('.topbar');
    if (bar) {
      const b = bar.getBoundingClientRect();
      if (b.bottom > 0 && b.top < 80) topMin = Math.max(topMin, Math.round(b.bottom) + pad);
    }
  } catch { /* no DOM / no bar */ }
  return { vw, vh, pad, topMin };
}

/** Pure: menu top-left in client pixels.
 *  Default: top-left at (x, y). If it would overflow the right, flip so the right edge is at x;
 *  if it would overflow the bottom, flip so the bottom edge is at y. Then clamp into the viewport
 *  (below topMin). Submenus pass the parent item's rect as `anchor` and flip to its left when the right side has no room. */
export function ctxPlaceBox(x, y, w, h, view, anchor) {
  const pad = view.pad ?? 4, topMin = view.topMin ?? pad, vw = view.vw, vh = view.vh;
  const maxHeight = Math.max(44, vh - topMin - pad);
  const useH = Math.min(h, maxHeight);
  let left = x;
  if (anchor) {
    if (left + w > vw - pad) left = Math.max(pad, (anchor.left ?? x) - w + 2);
  } else if (x + w > vw - pad) left = x - w;
  left = Math.max(pad, Math.min(vw - w - pad, left));
  if (!Number.isFinite(left)) left = pad;
  let top = y;
  if (!anchor && y + useH > vh - pad) top = y - useH;
  top = Math.max(topMin, Math.min(vh - useH - pad, top));
  if (!Number.isFinite(top)) top = topMin;
  return { left, top, maxHeight };
}

const cssZoom = () => Number(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1;

/** Write a client-pixel position. Measures a 0→100px probe so html zoom (`--z`) and a transformed
 *  containing block (dialog, sheet, filter/transform ancestor that breaks position:fixed) do not offset the menu. */
function writeClientPos(el, clientX, clientY, z) {
  el.style.left = '0px'; el.style.top = '0px';
  const a = el.getBoundingClientRect();
  el.style.left = '100px';
  const b = el.getBoundingClientRect();
  const sx = (b.left - a.left) / 100;
  const scale = (Number.isFinite(sx) && Math.abs(sx) > 1e-6) ? sx : z;
  el.style.left = (clientX - a.left) / scale + 'px';
  el.style.top = (clientY - a.top) / scale + 'px';
}

/** Place a menu at (x, y) in client pixels (top-left), flipping or clamping to stay in the window. Submenus pass the parent item's rect. */
function place(el, x, y, r) {
  // 0.6.8-#6a: Display size is html{zoom:var(--z)}. Client rects are zoomed; style.left/top are in pre-zoom CSS px.
  // writeClientPos measures the actual scale so the menu still opens under the pointer (and inside a transformed host).
  const z = cssZoom(), box = el.getBoundingClientRect();
  const w = box.width || el.offsetWidth * z, hh = box.height || el.offsetHeight * z;
  const pos = ctxPlaceBox(x, y, w, hh, ctxViewBox(), r || null);
  writeClientPos(el, pos.left, pos.top, z);
  el.style.maxHeight = pos.maxHeight / z + 'px';
}
/** Show a menu at (x, y) (clamped into the window). Items: { id, label, ic?, onclick | sub:[{label,onclick}], danger, disabled, hint, sep }. A disabled item is dim, with its hint as a tooltip. Esc closes (submenu first); Up/Down move, Right opens a submenu, Left closes it. */
export function openCtx(x, y, items, { label = 'Actions', from = null } = {}) {
  // F199/F246: popovers belong to their nearest modal (top-layer dialog or phone sheet),
  // so their stacking, focus and teardown stay inside that modal. Desktop still uses body.
  const host = from?.closest?.('dialog,.pd42-sheet') || document.body;
  closeCtx();
  const subs = []; let subEl = null;
  const closeSub = () => { if (subEl) { subEl.remove(); subs.splice(subs.indexOf(subEl), 1); subEl = null; } };
  const mk = (list, lab) => h('div', { class: 'ctxmenu', role: 'menu', 'aria-label': lab }, list.map(it => it.sep ? h('div', { class: 'ctx-sep', role: 'separator' }) : item(it)));
  const item = it => {
    const b = h('button', { type: 'button', role: 'menuitem', class: 'ctx-item' + (it.danger ? ' danger' : '') + (it.sub ? ' has-sub' : ''), 'data-ctx': it.id || '', disabled: it.disabled || null, title: it.disabled && it.hint ? it.hint : null, 'aria-haspopup': it.sub ? 'menu' : null,
      onclick: ev => { ev.stopPropagation(); if (it.sub) { openSub(b, it); return; } closeCtx(); it.onclick?.(); } },
      (it.ic && ctxIcon(it.ic)) || h('span', { class: 'ctx-ic' }), h('span', { class: 'ctx-l' }, it.label), it.sub ? h('span', { class: 'ctx-arrow', 'aria-hidden': 'true' }, '›') : null);
    b._it = it;
    if (it.sub) b.addEventListener('pointerenter', () => { if (!b.disabled) openSub(b, it, true); });
    else b.addEventListener('pointerenter', () => { if (subEl && !subEl.contains(b)) closeSub(); });
    return b;
  };
  const openSub = (b, it, hover) => {
    closeSub(); if (b.disabled) return;
    const m = mk(it.sub, it.label); m.classList.add('ctx-sub'); host.append(m); subs.push(m); subEl = m;
    const r = b.getBoundingClientRect(); place(m, r.right - 2, r.top - 4, r);
    if (!hover) m.querySelector('.ctx-item:not([disabled])')?.focus();
  };
  const el = mk(items, label); host.append(el); place(el, x, y);
  const off = ev => { if (!el.contains(ev.target) && !subs.some(s => s.contains(ev.target))) closeCtx(); };
  const key = ev => {
    if (ev.key === 'Escape') { ev.stopPropagation(); if (subEl) { const c = el.querySelector('.has-sub.cur'); closeSub(); c?.focus(); return; } closeCtx(); return; }
    const scope = subEl && subEl.contains(document.activeElement) ? subEl : el;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); const it = [...scope.querySelectorAll('.ctx-item:not([disabled])')], i = it.indexOf(document.activeElement); it[(i + (ev.key === 'ArrowDown' ? 1 : -1) + it.length) % it.length]?.focus(); }
    else if (ev.key === 'ArrowRight') { const a = document.activeElement; if (a?.classList.contains('has-sub') && !a.disabled) { ev.preventDefault(); a.classList.add('cur'); openSub(a, a._it || items.find(i => i.id === a.dataset.ctx)); } }
    else if (ev.key === 'ArrowLeft' && subEl) { ev.preventDefault(); const c = el.querySelector('.has-sub.cur'); closeSub(); c?.focus(); }
    else if (ev.key === 'Home' || ev.key === 'End') { ev.preventDefault(); const it = [...scope.querySelectorAll('.ctx-item:not([disabled])')]; it[ev.key === 'Home' ? 0 : it.length - 1]?.focus(); }
  };
  open = { el, off, key, from, subs }; document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', key, true); window.addEventListener('blur', closeCtx);
  el.querySelector('.ctx-item:not([disabled])')?.focus(); return el;
}
/** Wire a card: contextmenu (right-click), Shift+F10 / the Menu key, and a long press on touch. `build()` returns the items. */
export function attachCtx(card, build, label) {
  const show = (x, y) => openCtx(x, y, build(), { label, from: card });
  card.addEventListener('contextmenu', ev => { if (ev.target.closest('input,textarea')) return; ev.preventDefault(); ev.stopPropagation(); show(ev.clientX, ev.clientY); });
  card.addEventListener('keydown', ev => { if ((ev.key === 'F10' && ev.shiftKey) || ev.key === 'ContextMenu') { ev.preventDefault(); const t = (document.activeElement && card.contains(document.activeElement)) ? document.activeElement : card; const r = t.getBoundingClientRect(); show(r.left, r.top); } });
  let t = 0, sx = 0, sy = 0;
  card.addEventListener('pointerdown', ev => { if (ev.pointerType !== 'touch' || ev.target.closest('button,input,.dgrip,.dgrip42,.vbar')) return; if (ev._ctxDone) return; ev._ctxDone = true; sx = ev.clientX; sy = ev.clientY; t = setTimeout(() => { t = 0; show(sx, sy); }, 550); });
  const stop = () => { if (t) { clearTimeout(t); t = 0; } };
  card.addEventListener('pointerup', stop); card.addEventListener('pointercancel', stop); card.addEventListener('pointermove', ev => { if (t && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) stop(); });
}

// F250-P6: explicit phone song-menu presentation. Callers own ALL actions,
// capabilities and identity/routing checks; global popup/gesture defaults stay put.
import { h } from './util.js';
import { npCover } from './art.js';
let active = null;
export function openSongSheet({ item, label = 'Song actions', menuClass = '', items, run, valid = () => true, from = document.activeElement }) {
  active?.close();
  if (!matchMedia('(max-width:900px)').matches || !valid()) return null;
  let closed = false, picker = null, picking = false;
  const opener = from, locks = [document.documentElement, document.body, document.getElementById('desk')].filter(Boolean)
    .map(el => ({ el, overflow: el.style.overflow, top: el.scrollTop }));
  const close = (reason) => {
    if (closed) return; closed = true; picker?.close();
    observer.disconnect(); window.removeEventListener('resize', check); window.removeEventListener('wavwiz:zonesync', check);
    window.removeEventListener('wavwiz:favs', paint); document.removeEventListener('keydown', key, true);
    el.close(); el.remove(); locks.forEach(s => { s.el.style.overflow = s.overflow; s.el.scrollTop = s.top; });
    if (active?.el === el) active = null;
    // Route/view invalidation must not steal destination focus (Library→Now retains opener DOM).
    if (reason !== 'invalid' && opener?.isConnected && !opener.closest('[inert]')) opener.focus?.({ preventScroll: true });
  };
  const check = () => { if (!el.isConnected || !matchMedia('(max-width:900px)').matches || !valid()) close('invalid'); };
  const choose = async id => {
    if (closed || !valid()) { close(); return; }
    // Rebuild at action time: permission, Queue lock/pending and Favorites can
    // change while a modal is open. Never dispatch a captured enabled snapshot.
    const it = items().find(x => x.id === id); if (!it || it.disabled) { paint(); return; }
    if (!it.keepOpen) close();
    await run(it, api);
  };
  const buttons = new Map();
  const paint = () => {
    if (closed) return;
    for (const it of items()) {
      let b = buttons.get(it.id);
      if (!b) { b = h('button', { type: 'button', role: 'menuitem', 'data-qm': it.id, onclick: () => choose(it.id) }); buttons.set(it.id, b); list.append(b); }
      b.textContent = it.label; b.disabled = !!it.disabled; b.title = it.hint || '';
      if (it.hint) b.setAttribute('aria-description', it.hint);
      b.classList.toggle('danger', !!it.danger); b.setAttribute('aria-disabled', String(!!it.disabled));
      if (it.keepOpen) b.setAttribute('aria-haspopup', 'menu');
    }
  };
  const list = h('div', { class: 'songsheet-actions ' + menuClass, role: 'menu', 'aria-label': label });
  const done = h('button', { type: 'button', class: 'songsheet-close ww-close', 'aria-label': 'Close song actions', onclick: close }, '✕');
  const el = h('dialog', { class: 'songsheet', 'aria-label': 'Song actions', 'aria-modal': 'true' },
    h('div', { class: 'songsheet-handle', 'aria-hidden': 'true' }),
    h('header', { class: 'songsheet-head' }, npCover(item, 192, 'songsheet-art'),
      h('div', { class: 'songsheet-meta' }, h('h2', {}, item.title || 'Untitled'), h('div', { class: 'dim' }, item.artist || '')), done), list);
  const key = ev => {
    if (ev.key === 'Tab') {
      const stops = [...el.querySelectorAll('button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(b => !b.closest('[inert]') && b.getClientRects().length);
      const first = stops[0], last = stops.at(-1), at = document.activeElement;
      if (!stops.includes(at) || (ev.shiftKey ? at === first : at === last)) { ev.preventDefault(); (ev.shiftKey ? last : first)?.focus(); }
    }
    if (ev.key === 'Escape' && !el.querySelector('.pldrop')) { ev.preventDefault(); ev.stopImmediatePropagation(); close(); } };
  el.addEventListener('close', close);
  el.addEventListener('cancel', ev => { ev.preventDefault(); if (picker) { picker.close(); picker = null; } else close(); });
  el.addEventListener('click', ev => { if (ev.target === el) { const r = el.getBoundingClientRect(); if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) close(); } });
  const observer = new MutationObserver(records => {
    if (!el.isConnected || (opener && !opener.isConnected)) return close('invalid');
    // Only the router data-view attribute means route invalidation; ignore ordinary art/list mutations.
    if (records.some(r => r.type === 'attributes' && r.attributeName === 'data-view')) check();
  });
  const api = { el, close, async playlist(open) {
    if (picking || closed) return; picking = true;
    const b = buttons.get('playlist'), head = el.querySelector('.songsheet-head');
    const restore = reason => { picking = false; picker = null; head.inert = list.inert = false; el.removeAttribute('aria-busy'); if (reason === 'done' || reason === 'escape') close(); else if (!closed) b?.focus({ preventScroll: true }); };
    list.inert = true; el.setAttribute('aria-busy', 'true'); // Close stays reachable while the picker loads.
    picker = await open({ host: el, from: b, valid: () => !closed && valid(), onClose: restore });
    el.removeAttribute('aria-busy');
    if (closed) picker?.close();
    else if (!picker) restore();
    else head.inert = true;
  } };
  paint(); document.body.append(el); locks.forEach(s => { s.el.style.overflow = 'hidden'; });
  el.showModal(); done.focus({ preventScroll: true }); active = api;
  document.addEventListener('keydown', key, true); window.addEventListener('resize', check); window.addEventListener('wavwiz:zonesync', check); window.addEventListener('wavwiz:favs', paint);
  observer.observe(document.body, { childList: true, subtree: true });
  // P5 retains Library under Now; watch the router's data-view so route invalidation closes even when opener stays connected.
  const deskEl = document.getElementById('desk');
  if (deskEl) observer.observe(deskEl, { attributes: true, attributeFilter: ['data-view'] });
  return api;
}

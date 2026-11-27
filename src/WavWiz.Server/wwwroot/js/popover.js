// WavWiz 0.7.1 (t2032u / t2033u / t2035u): no center-screen pop-up for a one-line name or a small yes/no.
//  inlineName(labelEl, ...)  - rename where the name is shown (zone / speaker names).
//  inlineDraft(listEl, ...)  - a new item appears in its list as a draft card with the name field focused (New zone, New scene, Save as preset).
//  confirmAt(anchor, ...)    - Promise<boolean> confirm in a small popover next to the button that asked (util.ask() uses it).
//  popAt(anchor, content)    - that popover: theme tokens, flips / clamps to the window, Esc + outside click close, Tab stays inside.
// Phone (html.handset = a real phone, never a narrow PC window): popAt is a bottom sheet over a scrim.
import { h, askAnchor } from './util.js';

export const isHandset = () => typeof document !== 'undefined' && !!document.documentElement?.classList?.contains('handset');
const cssZoom = () => { try { return Number(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1; } catch { return 1; } };
const EDIT_SEL = '.wwinl, .wwdraft';
/** Is a name being typed in place inside `el`? (The Devices tree is not rebuilt under it; see devices.js treeNode.) */
export const editingIn = el => !!el?.querySelector?.(EDIT_SEL);
const redrawSoon = () => { try { window.dispatchEvent(new CustomEvent('wavwiz:devredraw')); } catch { /* node */ } };
/** Put focus in `inp` now and again after the menu that opened us has closed: a context menu hands focus back to its card on close,
 *  and a redraw's focus restore can land a tick later. Only takes focus back from <body>, the field's own row, or the opener. */
function settleFocus(inp, box, opener) {
  const go = () => { if (!inp.isConnected) return; const a = document.activeElement; if (a === inp) return;
    if (!a || a === document.body || box.contains(a) || (opener && (a === opener || opener.contains?.(a) || a.contains?.(opener)))) { inp.focus({ preventScroll: true }); try { inp.select?.(); } catch { /* old engines */ } } };
  go(); setTimeout(go, 0); try { requestAnimationFrame(() => { go(); setTimeout(go, 0); }); } catch { setTimeout(go, 16); }
}

/** Pure: where a w x hh popover goes next to anchor rect `a` inside view { vw, vh, pad, topMin }. Below by default; above when below has no
 *  room and above has more. Right edges line up when the anchor is in the right half (opens into the content), else left edges. Then clamp. */
export function popPlace(a, w, hh, view, gap = 6) {
  const pad = view.pad ?? 8, topMin = view.topMin ?? pad, vw = view.vw, vh = view.vh;
  const below = vh - pad - (a.bottom + gap), above = (a.top - gap) - topMin;
  const side = hh <= below || below >= above ? 'below' : 'above';
  const room = Math.max(80, side === 'below' ? below : above), useH = Math.min(hh, room);
  let top = side === 'below' ? a.bottom + gap : a.top - gap - useH;
  top = Math.max(topMin, Math.min(vh - pad - useH, top));
  const mid = (a.left + a.right) / 2;
  let left = mid > vw / 2 ? a.right - w : a.left;
  left = Math.max(pad, Math.min(vw - pad - w, left));
  const arrowX = Math.max(12, Math.min(w - 12, mid - left));
  return { left, top, side, maxHeight: room, arrowX };
}

let cur = null;
export function closePop() { cur?.close('replaced'); }

/** Open `content` next to `anchor` (on a phone: a bottom sheet; anchor may then be null). Returns { el, close }. */
export function popAt(anchor, content, { title = '', cls = '', label = title || 'Options', onClose = null, initialFocus = null } = {}) {
  closePop();
  const phone = isHandset() || !anchor;
  const back = document.activeElement;
  const titleId = 'pop-t-' + Math.random().toString(36).slice(2, 8);
  const el = h('div', { class: 'wwpop' + (phone ? ' wwpop-sheet' : '') + (cls ? ' ' + cls : ''), role: 'dialog', 'aria-modal': phone ? 'true' : 'false', 'aria-labelledby': title ? titleId : null, 'aria-label': title ? null : label },
    phone ? h('div', { class: 'wwpop-grab', 'aria-hidden': 'true' }) : h('div', { class: 'wwpop-caret', 'aria-hidden': 'true' }),
    title ? h('div', { class: 'wwpop-h', id: titleId }, title) : null,
    h('div', { class: 'wwpop-b' }, content));
  let closed = false;
  const scrim = phone ? h('div', { class: 'wwpop-scrim', onclick: () => close('outside') }) : null;
  // opened from inside a top-layer <dialog> / phone sheet: live in it, so it stacks and tears down with it (as openCtx, F199/F246)
  const host = anchor?.closest?.('dialog,.pd42-sheet') || document.body;
  if (scrim) host.append(scrim);
  host.append(el);
  anchor?.setAttribute?.('aria-expanded', 'true');
  function close(reason) {
    if (closed) return; closed = true; el.remove(); scrim?.remove();
    document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', key, true);
    try { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); } catch { /* node */ }
    anchor?.setAttribute?.('aria-expanded', 'false');
    if (cur?.el === el) cur = null;
    const to = anchor?.isConnected ? anchor : back;
    if (reason !== 'replaced' && to && to !== document.body) to.focus?.({ preventScroll: true });
    onClose?.(reason);
  }
  function place() {
    if (phone || closed) return;
    if (!anchor.isConnected) return close('gone');   // the list redrew under it
    const z = cssZoom(), a = anchor.getBoundingClientRect(), r = el.getBoundingClientRect();
    let topMin = 8; try { const bar = document.querySelector('.topbar'); if (bar) { const b = bar.getBoundingClientRect(); if (b.bottom > 0 && b.top < 80) topMin = Math.round(b.bottom) + 6; } } catch { /* no bar */ }
    const p = popPlace(a, r.width, r.height, { vw: globalThis.innerWidth || 1024, vh: globalThis.innerHeight || 768, pad: 8, topMin });
    el.style.left = p.left / z + 'px'; el.style.top = p.top / z + 'px'; el.style.maxHeight = p.maxHeight / z + 'px';
    el.dataset.side = p.side; el.style.setProperty('--caret-x', p.arrowX / z + 'px');
  }
  const off = ev => { const t = ev.target; if (!el.contains(t) && !(anchor && (t === anchor || anchor.contains?.(t)))) close('outside'); };
  const key = ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close('escape'); return; }
    if (ev.key === 'Tab') {   // keep Tab inside while it is open
      const list = [...el.querySelectorAll('button,input,select,textarea')].filter(x => !x.disabled); if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      if (ev.shiftKey && i <= 0) { ev.preventDefault(); list[list.length - 1].focus(); } else if (!ev.shiftKey && i === list.length - 1) { ev.preventDefault(); list[0].focus(); }
    }
  };
  place(); try { requestAnimationFrame(place); } catch { /* node */ }
  document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', key, true);
  try { window.addEventListener('resize', place); window.addEventListener('scroll', place, true); } catch { /* node */ }
  const first = (initialFocus && el.querySelector(initialFocus)) || el.querySelector('input') || el.querySelector('button');
  first?.focus({ preventScroll: true }); setTimeout(() => { if (!closed && !el.contains(document.activeElement)) first?.focus({ preventScroll: true }); }, 0);
  cur = { el, close }; return cur;
}

/** Confirm next to the button. Resolves true / false (Esc, outside click, Cancel = false). Danger confirms focus Cancel first. */
export function confirmAt(anchor, { title, text = '', extra = null, ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return new Promise(res => {
    let v = false;
    const yes = h('button', { type: 'button', class: 'btn sm ' + (danger ? 'danger' : 'primary'), 'data-act': 'pop-ok', onclick: () => { v = true; p.close('done'); } }, ok);
    const no = h('button', { type: 'button', class: 'btn sm', 'data-act': 'pop-cancel', onclick: () => p.close('cancel') }, cancel);
    const p = popAt(anchor, [text ? h('p', { class: 'wwpop-t' }, text) : null, extra, h('div', { class: 'wwpop-f' }, no, yes)],
      { title, cls: 'wwpop-confirm' + (danger ? ' danger' : ''), onClose: () => res(v), initialFocus: danger ? '[data-act="pop-cancel"]' : '[data-act="pop-ok"]' });
  });
}

/** Rename in place: the label is swapped for a field with the same font. Enter / ✓ saves, Esc / ✕ cancels, leaving the field saves a
 *  changed name. `save(v)` may throw: the field stays, red, with the message as its tooltip. Returns { input, cancel, commit }. */
export function inlineName(labelEl, { value = labelEl?.textContent?.trim() || '', label = 'Name', save, max = 60, opener = null, onEnd = null, setText = true } = {}) {
  if (!labelEl || labelEl._editing) return labelEl?._editing || null;
  const inp = h('input', { type: 'text', class: 'wwinl-in', maxlength: max, value, 'aria-label': label, autocomplete: 'off', spellcheck: 'false' });
  const okB = h('button', { type: 'button', class: 'wwinl-b ok', 'aria-label': 'Save name', title: 'Save (Enter)' }, '✓');
  const noB = h('button', { type: 'button', class: 'wwinl-b', 'aria-label': 'Cancel rename', title: 'Cancel (Esc)' }, '✕');
  const box = h('span', { class: 'wwinl', role: 'group', 'aria-label': label }, inp, okB, noB);
  for (const t of ['click', 'pointerdown', 'dblclick', 'contextmenu']) box.addEventListener(t, ev => ev.stopPropagation());   // typing here never selects / drags / opens the card
  labelEl.hidden = true; labelEl.parentNode.insertBefore(box, labelEl.nextSibling);
  const host = labelEl.parentNode; host.classList?.add('wwinl-host');   // 0.7.3 t2231u: the row knows a name is being typed (CSS hides its other buttons on the phone look)
  let done = false, busy = false;
  const end = () => { if (done) return; done = true; box.remove(); host.classList?.remove('wwinl-host'); labelEl.hidden = false; labelEl._editing = null; if (labelEl.isConnected) labelEl.focus?.({ preventScroll: true }); onEnd?.(); redrawSoon(); };
  const commit = async () => { if (done || busy) return; const v = inp.value.trim(); if (!v || v === value) return end();
    busy = true; box.classList.add('busy'); try { await save(v); if (setText) labelEl.textContent = v; end(); } catch (e) { busy = false; box.classList.remove('busy'); box.classList.add('bad'); inp.setAttribute('title', e?.message || 'That did not work.'); inp.focus(); } };
  inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); commit(); } else if (ev.key === 'Escape') { ev.preventDefault(); end(); } });
  okB.addEventListener('click', commit); noB.addEventListener('click', end);
  // leaving the field (not to its own ✓ / ✕) keeps what was typed: saved when changed
  inp.addEventListener('focusout', ev => { if (ev.relatedTarget && box.contains(ev.relatedTarget)) return; setTimeout(() => { if (!done && !box.contains(document.activeElement)) commit(); }, 150); });
  const api = { input: inp, cancel: end, commit, el: box };
  labelEl._editing = api;
  settleFocus(inp, box, opener);
  return api;
}

/** New item in place: a draft card goes into `listEl` (before `before`; undefined = first, null = last) with its name field focused. Enter / Create saves,
 *  Esc / ✕ cancels; clicking away with an empty name cancels, with a name typed it stays open. Returns { el, input, cancel, commit }. */
export function inlineDraft(listEl, { before, cls = '', label = 'New zone name', placeholder = 'Zone name', ok = 'Create', hint = 'Enter to create · Esc to cancel', save, max = 60, opener = null, onEnd = null } = {}) {
  listEl.querySelector('.wwdraft')?._api?.cancel();
  const inp = h('input', { type: 'text', class: 'wwinl-in', maxlength: max, placeholder, 'aria-label': label, autocomplete: 'off' });
  const okB = h('button', { type: 'button', class: 'btn sm primary', 'data-act': 'draft-ok' }, ok);
  const noB = h('button', { type: 'button', class: 'wwinl-b', 'aria-label': 'Cancel', title: 'Cancel (Esc)' }, '✕');
  const msg = h('div', { class: 'wwdraft-hint small dim', role: 'status', 'aria-live': 'polite' }, hint);
  const card = h('section', { class: 'wwdraft' + (cls ? ' ' + cls : ''), role: 'group', 'aria-label': label }, h('div', { class: 'wwdraft-row' }, inp, okB, noB), msg);
  for (const t of ['click', 'pointerdown', 'contextmenu']) card.addEventListener(t, ev => ev.stopPropagation());
  listEl.insertBefore(card, before === undefined ? listEl.firstChild : before && before.parentNode === listEl ? before : null);   // before: undefined = first, null = last
  let done = false, busy = false;
  const end = () => { if (done) return; done = true; card.remove(); if (opener?.isConnected && (document.activeElement === document.body || !document.activeElement)) opener.focus?.({ preventScroll: true }); onEnd?.(); redrawSoon(); };
  const commit = async () => { if (done || busy) return; const v = inp.value.trim(); if (!v) { msg.textContent = 'Type a name first.'; card.classList.add('bad'); inp.focus(); return; }
    busy = true; card.classList.add('busy'); try { await save(v); end(); } catch (e) { busy = false; card.classList.remove('busy'); card.classList.add('bad'); msg.textContent = e?.message || 'That did not work.'; inp.focus(); } };
  inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); commit(); } else if (ev.key === 'Escape') { ev.preventDefault(); end(); } });
  okB.addEventListener('click', commit); noB.addEventListener('click', end);
  inp.addEventListener('focusout', ev => { if (ev.relatedTarget && card.contains(ev.relatedTarget)) return; setTimeout(() => { if (!done && !card.contains(document.activeElement) && !inp.value.trim()) end(); }, 150); });
  const api = { el: card, input: inp, cancel: end, commit };
  card._api = api;
  card.scrollIntoView?.({ block: 'nearest' });
  settleFocus(inp, card, opener);
  return api;
}

/** 0.7.1 t2035u: a confirm opens next to the control that asked (`anchor`, else the pressed / focused one); a phone gets a bottom sheet;
 *  with no anchor on a PC it is the old centered window. Resolves true / false; `null` = use the centered window. */
export function confirmNear(anchor, opts) {
  let at = typeof anchor === 'function' ? anchor() : anchor; if (at === undefined) at = askAnchor(); if (at && !at.isConnected) at = null;
  return at || (isHandset() && anchor !== null) ? confirmAt(at || null, opts) : null;
}

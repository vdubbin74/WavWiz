// F152: ONE themed dropdown for value pickers. No native <select> (WebView2 / Windows paints its open list in OS colors):
// a field-styled button that opens the shared ctxmenu (openCtx, Library F40 pattern) under itself, ✓ + soft accent on the current value.
import { h } from './util.js';
import { openCtx } from './ctxmenu.js';

/** Lock API. options: [{ value, label, disabled?, hint?, group? }] (group = heading row before it). Returns the trigger button. */
export function wwSelect({ label, value, options = [], onChange, class: cls = '', disabled = false } = {}) {
  const store = h('div');
  for (const o of options) store.append(h('option', { value: String(o.value), disabled: o.disabled || null, title: o.hint || null, 'data-group': o.group || null, selected: String(o.value) === String(value) || null }, o.label));
  const b = wsel({ class: cls, 'aria-label': label, disabled: disabled || null }, [...store.children]);
  if (value != null) b.value = value;
  if (onChange) b.addEventListener('change', () => onChange(b.value, b));
  return b;
}

/** Drop-in for h('select', attrs, ...options): same attrs (onchange, aria-label, class, disabled, title, data-*), same kids (option / optgroup
 *  nodes, arrays). The button keeps the select API the callers use: value, selectedIndex, selectedOptions, options, disabled,
 *  append / replaceChildren of options, and a bubbling 'change' event (ev.target.value works). */
export function wsel(attrs, ...kids) {
  const a = { ...(attrs || {}) }, onchange = a.onchange; delete a.onchange;
  const lab = a['aria-label'] || a.title || 'Choose';
  const b = h('button', { ...a, type: 'button', class: 'wwdd wwsel' + (a.class ? ' ' + a.class : ''), 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': lab });
  const t = h('span', { class: 'wwdd-t' }), c = h('span', { class: 'wwdd-c', 'aria-hidden': 'true' }, '▾');
  b.append(t, c);
  let opts = [], idx = -1;
  const ingest = list => { const out = []; for (const n of list.flat(Infinity)) { if (n == null || n === false || !n.nodeType) continue;
    if (n.tagName === 'OPTION') out.push(n);
    else if (n.tagName === 'OPTGROUP') { const g = n.getAttribute('label') || ''; [...n.children].forEach((o, i) => { if (i === 0) o.dataset.group = g; o._grp = g; out.push(o); }); } }
    return out; };
  const paint = () => { const o = opts[idx]; t.textContent = o ? o.textContent : ''; };
  const pickDefault = () => { const s = opts.findIndex(o => o.hasAttribute('selected') || o.selected); idx = s >= 0 ? s : (opts.findIndex(o => !o.disabled) >= 0 ? opts.findIndex(o => !o.disabled) : (opts.length ? 0 : -1)); paint(); };
  const setOpts = (list, keep) => { const prev = keep ? b.value : null; opts = ingest(list); pickDefault(); if (keep && prev != null && !opts.some(o => o.hasAttribute('selected'))) { const i = opts.findIndex(o => o.value === prev); if (i >= 0) { idx = i; paint(); } } };
  Object.defineProperties(b, {
    value: { get: () => opts[idx]?.value ?? '', set: v => { const i = opts.findIndex(o => o.value === String(v ?? '')); idx = i; paint(); }, configurable: true },
    selectedIndex: { get: () => idx, set: i => { idx = i >= 0 && i < opts.length ? i : -1; paint(); }, configurable: true },
    options: { get: () => opts.slice(), configurable: true },
    selectedOptions: { get: () => (opts[idx] ? [opts[idx]] : []), configurable: true },
    length: { get: () => opts.length, configurable: true },
  });
  b.replaceChildren = (...k) => setOpts(k, false);
  b.append = (...k) => { opts = opts.concat(ingest(k)); if (idx < 0) pickDefault(); else paint(); };
  b.appendChild = n => { b.append(n); return n; };
  b.add = n => b.append(n);
  if (onchange) b.addEventListener('change', onchange);
  b.addEventListener('click', ev => {
    ev.stopPropagation(); if (b.disabled) return;
    const r = b.getBoundingClientRect(), items = []; let grp = null;
    opts.forEach((o, i) => {
      const g = o.dataset.group ?? (o._grp ?? null);
      if (g != null && g !== grp) { if (items.length) items.push({ sep: true }); if (g) items.push({ id: 'dd-h', label: g, heading: true, disabled: true }); grp = g; }
      else if (g == null && grp) { items.push({ sep: true }); grp = null; }
      items.push({ id: 'dd:' + o.value, label: (i === idx ? '✓ ' : '') + o.textContent, cur: i === idx, disabled: o.disabled, hint: o.title || (o.disabled ? 'Not available' : null),
        onclick: () => { if (i === idx) return; idx = i; paint(); b.dispatchEvent(new Event('change', { bubbles: true })); } });
    });
    b.setAttribute('aria-expanded', 'true');
    const m = openCtx(r.left, r.bottom + 2, items, { label: lab, from: b });
    m.classList.add('wwsel-menu'); m.style.minWidth = Math.max(190, r.width) + 'px';
    m.querySelectorAll('.ctx-item').forEach(e => { const it = e._it; if (it?.cur) e.classList.add('cur-val'); if (it?.heading) { e.classList.add('ctx-heading'); e.removeAttribute('title'); } });
    m.querySelector('.ctx-item.cur-val:not([disabled])')?.focus();
    new MutationObserver((_, ob) => { if (!m.isConnected) { b.setAttribute('aria-expanded', 'false'); ob.disconnect(); } }).observe(document.body, { childList: true });
  });
  b.addEventListener('keydown', ev => { if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && ev.altKey === false && b.getAttribute('aria-expanded') !== 'true') { ev.preventDefault(); b.click(); } });
  setOpts(kids, false);
  return b;
}

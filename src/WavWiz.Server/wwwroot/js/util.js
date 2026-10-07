// Element.append/prepend/replaceChildren turn null/false into the text "null"/"false" and arrays into "[object ...]". Make them behave like h().
for (const m of ['append', 'prepend', 'replaceChildren']) { const orig = Element.prototype[m]; Element.prototype[m] = function (...a) { return orig.apply(this, a.flat(Infinity).filter(x => x != null && x !== false)); }; }

// Tiny DOM + fetch helpers. All user/server text goes in through textContent (never innerHTML), so file names, tags and station names cannot inject markup.
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
}

export class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

export async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  if (opts.raw) { init.body = opts.raw; init.headers['Content-Type'] = 'application/octet-stream'; }
  let r;
  try { r = await fetch('/api/v1' + path, init); } catch (e) { throw new ApiError('Cannot reach the WavWiz server. Check that it is running and you are on the home network.', 0); }
  let data = null; const text = await r.text(); try { data = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!r.ok) throw new ApiError((data && data.error) || `Unexpected answer from the server (${r.status}).`, r.status);
  return data;
}

export function toast(msg, bad = false, ms = 4500) {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: bad ? 'alert' : 'status' }, msg);
  document.getElementById('toasts').append(t); setTimeout(() => t.remove(), ms);
}

export const fmtTime = ms => { if (ms == null || !isFinite(ms) || ms < 0) return '--:--'; const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
export const fmtDur = ms => { const s = Math.floor(ms / 1000), hh = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return hh ? `${hh}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };

export function dialog(title, body, buttons = [], opts = {}) {
  const d = h('dialog', { 'aria-label': title, class: opts.cls || '' });
  const close = () => { d.close(); d.remove(); opts.onClose && opts.onClose(); };
  d.append(h('header', null, h('span', { class: 'grow' }, title), h('button', { class: 'iconbtn', 'aria-label': 'Close', onclick: close }, '✕')));
  d.append(h('div', { class: 'body' }, body));
  if (buttons.length) d.append(h('footer', null, buttons.map(b => h('button', { class: 'btn ' + (b.cls || ''), onclick: async ev => { const r = b.onclick ? await b.onclick(ev, d) : null; if (r !== false && !b.keep) close(); } }, b.text))));
  d.addEventListener('cancel', () => { opts.onClose && opts.onClose(); });
  document.body.append(d); d.showModal(); return { el: d, close };
}

export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

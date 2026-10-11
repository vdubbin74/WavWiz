// A tiny DOM for the node tests (no npm packages in this repo): just enough of Element / document / events for devices.js to build, redraw
// and patch real element trees, so a test can check that the SAME nodes stay, focus is kept and a drag is not interrupted.
// Browser rules that matter here are copied: removing a node that holds focus moves focus to <body>; events capture at document, then bubble.
const SEL_TOKEN = /([a-zA-Z][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|(\s+)/g;
function parseCompound(c) {
  const parts = { tag: null, cls: [], id: null, attrs: [] }; let m; SEL_TOKEN.lastIndex = 0;
  while ((m = SEL_TOKEN.exec(c))) { if (m[1]) parts.tag = m[1].toUpperCase(); else if (m[2]) parts.cls.push(m[2]); else if (m[3]) parts.id = m[3]; else if (m[4]) parts.attrs.push([m[4], m[5]]); }
  return parts;
}
const splitDesc = sel => sel.match(/(?:[^\s[]|\[[^\]]*\])+/g) || [];
function matchCompound(el, p) {
  if (el.nodeType !== 1) return false;
  if (p.tag && el.tagName !== p.tag) return false;
  if (p.id && el.getAttribute('id') !== p.id) return false;
  for (const c of p.cls) if (!el.classList.contains(c)) return false;
  for (const [a, v] of p.attrs) { const got = el.getAttribute(a); if (got == null || (v !== undefined && got !== v)) return false; }
  return true;
}
function matches(el, sel) {
  return sel.split(',').some(one => {
    const chain = splitDesc(one.trim()).map(parseCompound);
    if (!matchCompound(el, chain[chain.length - 1])) return false;
    let i = chain.length - 2, cur = el.parentNode;
    while (i >= 0 && cur) { if (cur.nodeType === 1 && matchCompound(cur, chain[i])) i--; cur = cur.parentNode; }
    return i < 0;
  });
}
const dataKey = k => 'data-' + k.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
class Node0 {
  constructor() { this.parentNode = null; this.childNodes = []; this._ls = []; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === doc; }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get firstChild() { return this.childNodes[0] || null; }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  _detach(n) { if (!n.parentNode) return; const p = n.parentNode; if (n.contains(doc.activeElement) && n.isConnected) doc._blurTo(doc.body); p.childNodes.splice(p.childNodes.indexOf(n), 1); n.parentNode = null; }
  insertBefore(n, ref) {
    if (n.nodeType === 11) { for (const c of [...n.childNodes]) this.insertBefore(c, ref); return n; }
    this._detach(n); const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n); n.parentNode = this; return n;
  }
  appendChild(n) { return this.insertBefore(n, null); }
  append(...ns) { for (const n of ns) this.insertBefore(typeof n === 'string' ? doc.createTextNode(n) : n, null); }
  prepend(...ns) { const f = this.firstChild; for (const n of ns) this.insertBefore(typeof n === 'string' ? doc.createTextNode(n) : n, f); }
  removeChild(n) { this._detach(n); return n; }
  remove() { this.parentNode?._detach(this); }
  replaceWith(n) { const p = this.parentNode; if (!p) return; p.insertBefore(n, this); p._detach(this); }
  replaceChildren(...ns) { for (const c of [...this.childNodes]) this._detach(c); this.append(...ns.flat().filter(x => x != null)); }
  get textContent() { return this.nodeType === 3 ? this.data : this.childNodes.map(c => c.textContent).join(''); }
  set textContent(v) { if (this.nodeType === 3) { this.data = String(v); return; } this.replaceChildren(); if (v !== '' && v != null) this.append(doc.createTextNode(String(v))); }
  addEventListener(type, fn, opt) { this._ls.push({ type, fn, capture: opt === true || !!opt?.capture }); }
  removeEventListener(type, fn) { this._ls = this._ls.filter(l => !(l.type === type && l.fn === fn)); }
  dispatchEvent(ev) {
    ev.target ??= this; const path = []; for (let n = this; n; n = n.parentNode) path.push(n);
    let stop = false; ev.stopPropagation = () => { stop = true; }; ev.preventDefault = () => { ev.defaultPrevented = true; };
    for (const n of [...path].reverse()) { if (stop) break; for (const l of n._ls) if (l.type === ev.type && l.capture && n !== this) l.fn.call(n, ev); }
    for (const n of path) { if (stop || (n !== this && ev.bubbles === false)) break; for (const l of n._ls) if (l.type === ev.type && (!l.capture || n === this)) l.fn.call(n, ev); }
    return !ev.defaultPrevented;
  }
  querySelectorAll(sel) { const out = []; const walk = n => { for (const c of n.children) { if (matches(c, sel)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
class Text0 extends Node0 { constructor(d) { super(); this.nodeType = 3; this.data = d; } }
class Frag0 extends Node0 { constructor() { super(); this.nodeType = 11; } }
class El extends Node0 {
  constructor(tag) {
    super(); this.nodeType = 1; this.tagName = tag.toUpperCase(); this._a = new Map(); this._value = ''; this.style = { setProperty() {}, removeProperty() {} };
    const el = this;
    this.classList = {
      _get: () => (el._a.get('class') || '').split(/\s+/).filter(Boolean),
      contains: c => el.classList._get().includes(c),
      add: (...cs) => { const s = new Set(el.classList._get()); cs.forEach(c => s.add(c)); el._a.set('class', [...s].join(' ')); },
      remove: (...cs) => { el._a.set('class', el.classList._get().filter(c => !cs.includes(c)).join(' ')); },
      toggle: (c, on) => { const has = el.classList.contains(c); on = on === undefined ? !has : !!on; on ? el.classList.add(c) : el.classList.remove(c); return on; },
    };
    this.dataset = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? el._a.get(dataKey(k)) : undefined), set: (_, k, v) => { el._a.set(dataKey(k), String(v)); return true; }, has: (_, k) => el._a.has(dataKey(k)) });
  }
  getAttribute(k) { return this._a.has(k) ? this._a.get(k) : null; }
  setAttribute(k, v) { this._a.set(k, String(v)); if (k === 'value') this._value = String(v); }
  removeAttribute(k) { this._a.delete(k); }
  hasAttribute(k) { return this._a.has(k); }
  get className() { return this._a.get('class') || ''; } set className(v) { this._a.set('class', String(v)); }
  get id() { return this._a.get('id') || ''; } set id(v) { this._a.set('id', String(v)); }
  get title() { return this._a.get('title') || ''; } set title(v) { this._a.set('title', String(v)); }
  get type() { return this._a.get('type') || (this.tagName === 'INPUT' ? 'text' : ''); }
  get disabled() { return this._a.has('disabled'); } set disabled(v) { v ? this._a.set('disabled', '') : this._a.delete('disabled'); }
  get checked() { return !!this._checked; } set checked(v) { this._checked = !!v; }
  get selected() { return this._a.has('selected'); } set selected(v) { v ? this._a.set('selected', '') : this._a.delete('selected'); }
  get options() { return this.querySelectorAll('option'); }
  get value() {
    if (this.tagName === 'SELECT') { const o = this.options.find(x => x.selected) || this.options[0]; return o ? o.value : ''; }
    if (this.tagName === 'OPTION') return this._a.has('value') ? this._a.get('value') : this.textContent;
    return this._value;
  }
  set value(v) { if (this.tagName === 'OPTION') this._a.set('value', String(v)); else this._value = String(v); }
  get innerHTML() { return this._html ?? ''; } set innerHTML(v) { this.replaceChildren(); this._html = String(v); }
  get tabIndex() { return +(this._a.get('tabindex') ?? -1); }
  matches(sel) { return matches(this, sel); }
  closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (matches(n, sel)) return n; return null; }
  focus() { if (doc.activeElement === this) return; doc._blurTo(this); }
  blur() { if (doc.activeElement === this) doc._blurTo(doc.body); }
  click() { this.dispatchEvent(ev('click')); }
  scrollIntoView() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
}
export const ev = (type, extra = {}) => ({ type, bubbles: true, defaultPrevented: false, ...extra });
class Doc0 extends Node0 {
  constructor() { super(); this.nodeType = 9; }
  createElement(t) { return new El(t); }
  createElementNS(_, t) { return new El(t); }
  createTextNode(d) { return new Text0(String(d)); }
  createDocumentFragment() { return new Frag0(); }
  getElementById(id) { return this.querySelector(`#${id}`); }
  _blurTo(n) { const prev = this.activeElement; this.activeElement = n; if (prev && prev !== n && prev !== this.body) prev.dispatchEvent(ev('focusout', { relatedTarget: n })); }
}
const doc = new Doc0();
doc.documentElement = doc.createElement('html'); doc.appendChild(doc.documentElement);
doc.body = doc.createElement('body'); doc.documentElement.appendChild(doc.body); doc.activeElement = doc.body;
const toasts = doc.createElement('div'); toasts.id = 'toasts'; doc.body.append(toasts);

/** Install the mini DOM (and storage / fetch stubs) on globalThis. */
export function installDom() {
  const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
  Object.assign(globalThis, { document: doc, Element: El, Node: Node0, sessionStorage: mem(), localStorage: mem() });
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '[]' });
  return doc;
}

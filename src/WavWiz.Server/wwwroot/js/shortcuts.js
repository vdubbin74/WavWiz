// WavWiz 0.3.7 L5 / L8 / L11 / L23: Home + up to FIVE pinned shortcuts. One module for the Now Playing bar, the embedded mini player and the standalone mini player.
// Layout (every size): the Home icon sits in the far RIGHT corner, a separator, then the pins stacking LEFTWARD (first pinned closest to the separator).
// Pins are remembered per device (localStorage, shared by every window of this app, so the standalone mini player shows the same ones).
import { h } from './util.js';
import { icon } from './icons.js';

export const MAX_PINS = 5;
export const PINS_KEY = 'wavwiz.pins.v1';
/** Everything that can be pinned: app destinations only. `go` is the id main.js runs through ONE function (runShortcut) that collapses expanded views and brings the target to the front. */
export const PINNABLE = [
  { id: 'eq', label: 'Sound / EQ', icon: 'eq' }, { id: 'queue', label: 'Queue', icon: 'queue' }, { id: 'library', label: 'Library', icon: 'library' },
  { id: 'devices', label: 'Devices & zones', icon: 'devices' }, { id: 'scenes', label: 'Scenes & Schedules', icon: 'scenes' }, { id: 'alarms', label: 'Alarms', icon: 'alarm' },
  { id: 'sleep', label: 'Sleep timer', icon: 'moon' }, { id: 'settings', label: 'Settings', icon: 'gear' },
];
const KNOWN = new Set(PINNABLE.map(p => p.id));
export const pinInfo = id => PINNABLE.find(p => p.id === id) || null;
/** Pure: keep only known, unique ids, at most MAX_PINS. */
export function cleanPins(v) { const out = []; for (const x of Array.isArray(v) ? v : []) if (KNOWN.has(x) && !out.includes(x)) out.push(x); return out.slice(0, MAX_PINS); }
export function loadPins(store = globalThis.localStorage) { try { return cleanPins(JSON.parse(store.getItem(PINS_KEY) || '[]')); } catch { return []; } }
export function savePins(p, store = globalThis.localStorage) { const c = cleanPins(p); try { store.setItem(PINS_KEY, JSON.stringify(c)); } catch { /* private mode */ } return c; }
/** Pure: pin / unpin. Pinning a 4th returns { pins, full: true } and changes nothing. */
export function togglePin(pins, id) {
  if (!KNOWN.has(id)) return { pins, full: false };
  if (pins.includes(id)) return { pins: pins.filter(x => x !== id), full: false };
  if (pins.length >= MAX_PINS) return { pins, full: true };
  return { pins: [...pins, id], full: false };
}
/** Pure: move a pin to another place in the order (first = closest to Home). */
export function movePin(pins, from, to) { if (from === to || from < 0 || to < 0 || from >= pins.length || to >= pins.length) return pins; const a = pins.slice(); const [x] = a.splice(from, 1); a.splice(to, 0, x); return a; }
/** Pure: DOM order left -> right. Home is last (far right corner); pins stack leftward from the separator, so the first pin is the one nearest Home. */
export const rowOrder = pins => [...pins.slice().reverse().map(id => ({ kind: 'pin', id })), ...(pins.length ? [{ kind: 'sep' }] : []), { kind: 'home' }];

/** The row. `run(id)` runs a pinned destination, `home()` goes Home. Redraws when the pins change (here or in another window). Returns { el, destroy }. */
export function shortcutsRow({ run, home, cls = '', vertical = false } = {}) {
  const el = h('div', { class: 'scrow ' + cls, role: 'toolbar', 'aria-label': 'Shortcuts' });
  let pins = loadPins(), drag = -1;
  const popover = (btn, i) => {
    document.querySelector('.scpop')?.remove();
    const mk = (t, fn, dis) => h('button', { type: 'button', class: 'btn sm', disabled: dis || undefined, onclick: () => { pop.remove(); fn(); } }, t);
    const pop = h('div', { class: 'scpop', role: 'menu' }, mk('Move toward Home', () => set(movePin(pins, i, i - 1)), i === 0), mk('Move away from Home', () => set(movePin(pins, i, i + 1)), i === pins.length - 1), mk('Unpin', () => set(pins.filter((_, k) => k !== i))));
    const r = btn.getBoundingClientRect(); document.body.append(pop);
    pop.style.left = Math.max(4, Math.min(r.left, innerWidth - pop.offsetWidth - 6)) + 'px'; pop.style.top = Math.max(4, r.top - pop.offsetHeight - 6) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', function f(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', f, true); } }, true), 0);
  };
  const set = p => { pins = savePins(p); draw(); };
  /** 0.3.8 L37: in a very narrow window the pins nearest Home stay and the rest move into a 'more' menu. */
  let cap = 99;
  const calcCap = () => { if (vertical) return 99; const w = el.parentElement?.clientWidth || 0; const c = w ? Math.max(2, Math.floor((w - 56) / 32)) : 99; return c >= pins.length ? 99 : c - 1; };
  const more = btn => {
    document.querySelector('.scpop')?.remove();
    const rest = pins.slice(cap).map(id => { const p = pinInfo(id); return h('button', { type: 'button', class: 'btn sm', 'data-sc': id, onclick: () => { pop.remove(); run?.(id); } }, p.label); });
    const pop = h('div', { class: 'scpop', role: 'menu' }, ...rest); const r = btn.getBoundingClientRect(); document.body.append(pop);
    pop.style.left = Math.max(4, Math.min(r.left, innerWidth - pop.offsetWidth - 6)) + 'px'; pop.style.top = Math.max(4, r.top - pop.offsetHeight - 6) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', function f(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', f, true); } }, true), 0);
  };
  function draw() {
    cap = calcCap();
    const vis = cap >= pins.length ? pins : pins.slice(0, cap);
    el.replaceChildren(...rowOrder(vis).map(x => {
      if (x.kind === 'sep' && cap < pins.length) return h('span', { class: 'scsep', 'aria-hidden': 'true' });
      if (x.kind === 'sep') return h('span', { class: 'scsep', 'aria-hidden': 'true' });
      if (x.kind === 'home') return h('button', { type: 'button', class: 'scbtn schome', 'data-sc': 'home', 'aria-label': 'Home', title: 'Home - back to the default screen (Alt+H)', onclick: () => home?.() }, icon('home'));
      const p = pinInfo(x.id), i = pins.indexOf(x.id);
      const b = h('button', { type: 'button', class: 'scbtn scpin', 'data-sc': x.id, 'aria-label': p.label, title: p.label + ' (right-click for order, or drag to rearrange)', draggable: 'true', onclick: () => run?.(x.id) }, icon(p.icon));
      b.addEventListener('contextmenu', ev => { ev.preventDefault(); popover(b, i); });
      b.addEventListener('dragstart', ev => { drag = i; ev.dataTransfer?.setData('text/plain', x.id); });
      b.addEventListener('dragover', ev => { if (drag >= 0) ev.preventDefault(); });
      b.addEventListener('drop', ev => { ev.preventDefault(); if (drag >= 0) set(movePin(pins, drag, i)); drag = -1; });
      return b;
    }));
    if (cap < pins.length) { const mb = h('button', { type: 'button', class: 'scbtn scmore', 'data-sc': 'more', 'aria-label': 'More shortcuts', title: 'More shortcuts', onclick: () => more(mb) }, '…'); el.prepend(mb); }
  }
  let ro = null; try { ro = new ResizeObserver(() => { const c = calcCap(); if (c !== cap) draw(); }); if (el.parentElement) ro.observe(el.parentElement); else setTimeout(() => el.parentElement && ro?.observe(el.parentElement), 0); } catch { /* no ResizeObserver */ }
  const onStore = ev => { if (!ev.key || ev.key === PINS_KEY) { pins = loadPins(); draw(); } };
  const onPins = () => { pins = loadPins(); draw(); };
  window.addEventListener('storage', onStore); window.addEventListener('wavwiz:pins', onPins);
  draw();
  return { el, destroy: () => { ro?.disconnect(); window.removeEventListener('storage', onStore); window.removeEventListener('wavwiz:pins', onPins); } };
}
/** 0.5.0 F130: the Now Playing header shows ONE Shortcuts toggle; it opens a vertical side icon strip (same pins / order / Home as shortcutsRow).
 *  Open state is remembered per device. Returns { toggle, strip, isOpen, setOpen, destroy }. */
export const SCSIDE_KEY = 'wavwiz.scside.v1';
export function shortcutsSide({ run, home, cls = '', onChange } = {}) {
  const row = shortcutsRow({ run, home, cls: 'scside-row', vertical: true });
  row.el.setAttribute('aria-orientation', 'vertical');
  const strip = h('div', { class: 'scside ' + cls, role: 'group', 'aria-label': 'Shortcuts strip', hidden: true }, row.el);
  let open = false; try { open = localStorage.getItem(SCSIDE_KEY) === '1'; } catch { /* ignore */ }
  const toggle = h('button', { type: 'button', class: 'scbtn sctoggle', 'data-sc': 'toggle', 'aria-label': 'Shortcuts', 'aria-haspopup': 'true', title: 'Shortcuts - pins + Home', onclick: () => setOpen(!open) }, icon('pin'));
  function setOpen(v) {
    open = !!v; strip.hidden = !open; toggle.classList.toggle('on', open); toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-pressed', String(open));
    try { localStorage.setItem(SCSIDE_KEY, open ? '1' : '0'); } catch { /* ignore */ }
    onChange?.(open);
  }
  // 0.5.0 F141: hover-dismiss - when a MOUSE leaves both the sleeve and its pin toggle, slide the sleeve shut (short grace so crossing the gap
  // between toggle and strip doesn't close it). Re-entering either cancels. Touch/pen never auto-close; a held button (drag-reorder) never closes.
  let leaveT = 0;
  const cancelLeave = () => { clearTimeout(leaveT); leaveT = 0; };
  const onLeave = ev => {
    if (!open || ev.pointerType !== 'mouse' || ev.buttons) return;
    const to = ev.relatedTarget; if (to && (strip.contains(to) || toggle.contains(to))) return;
    cancelLeave(); leaveT = setTimeout(() => { leaveT = 0; if (open && !strip.matches(':hover') && !toggle.matches(':hover')) setOpen(false); }, 350);
  };
  for (const el of [strip, toggle]) { el.addEventListener('pointerleave', onLeave); el.addEventListener('pointerenter', cancelLeave); }
  setOpen(open);
  return { toggle, strip, isOpen: () => open, setOpen, destroy: () => { cancelLeave(); row.destroy(); } };
}
/** Pin / unpin from a menu row or a title bar. Tells every row in this window; returns the result (full = the 3 slots are taken). */
export function pinToggle(id) {
  const r = togglePin(loadPins(), id); if (!r.full) savePins(r.pins);
  try { window.dispatchEvent(new CustomEvent('wavwiz:pins')); } catch { /* ignore */ }
  return r;
}
/** Cross-window channel: the standalone mini player asks the main app window to run a shortcut or go Home. */
export const SC_CHANNEL = 'wavwiz-shortcuts';
export function sendToMain(msg) { try { const c = new BroadcastChannel(SC_CHANNEL); c.postMessage(msg); c.close(); return true; } catch { return false; } }
export function listenFromMini(fn) { try { const c = new BroadcastChannel(SC_CHANNEL); c.onmessage = ev => fn(ev.data || {}); return () => c.close(); } catch { return () => {}; } }

/** 0.3.8 L34: one click from the standalone mini player. The target travels with the host 'full' message, over BroadcastChannel, and as a localStorage 'pending' note
 *  (the main page may be hidden / throttled while it is brought forward). The main page runs it as soon as it is visible; a note older than 15 s is ignored. */
export const PENDING_KEY = 'wavwiz.sc.pending';
export function writePending(msg, store = globalThis.localStorage) { try { store.setItem(PENDING_KEY, JSON.stringify({ ...msg, ts: Date.now() })); } catch { /* ignore */ } }
export function takePending(now = Date.now(), store = globalThis.localStorage) {
  try { const v = JSON.parse(store.getItem(PENDING_KEY) || 'null'); store.removeItem(PENDING_KEY); if (v && now - v.ts < 15000 && (v.home || v.run)) return { home: !!v.home, run: v.run }; } catch { /* ignore */ }
  return null;
}
/** Main window: run a target now when the page is visible, otherwise queue it until it is. Returns a stop function. */
export function installMiniTargets(exec, doc = globalThis.document) {
  let queued = null;
  const vis = () => !doc || doc.visibilityState === 'visible';
  const flush = () => { if (!vis()) return; const m = queued || takePending(); queued = null; if (m) { try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } exec(m); } };
  const stop1 = listenFromMini(msg => { if (!(msg.home || msg.run)) return; queued = msg; if (vis()) setTimeout(flush, 0); });
  const onVis = () => flush(); const onSt = ev => { if (ev.key === PENDING_KEY) flush(); };
  doc?.addEventListener?.('visibilitychange', onVis); globalThis.addEventListener?.('focus', onVis); globalThis.addEventListener?.('storage', onSt);
  setTimeout(flush, 300);
  return () => { stop1(); doc?.removeEventListener?.('visibilitychange', onVis); globalThis.removeEventListener?.('focus', onVis); globalThis.removeEventListener?.('storage', onSt); };
}

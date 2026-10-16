// WavWiz 0.3.7 L5 / L8 / L11 / L23: Home + up to THREE pinned shortcuts. One module for the Now Playing bar, the embedded mini player and the standalone mini player.
// Layout (every size): the Home icon sits in the far RIGHT corner, a separator, then the pins stacking LEFTWARD (first pinned closest to the separator).
// Pins are remembered per device (localStorage, shared by every window of this app, so the standalone mini player shows the same ones).
import { h } from './util.js';
import { icon } from './icons.js';

export const MAX_PINS = 3;
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
export function shortcutsRow({ run, home, cls = '' } = {}) {
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
  function draw() {
    el.replaceChildren(...rowOrder(pins).map(x => {
      if (x.kind === 'sep') return h('span', { class: 'scsep', 'aria-hidden': 'true' });
      if (x.kind === 'home') return h('button', { type: 'button', class: 'scbtn schome', 'data-sc': 'home', 'aria-label': 'Home', title: 'Home - back to the default screen', onclick: () => home?.() }, icon('home'));
      const p = pinInfo(x.id), i = pins.indexOf(x.id);
      const b = h('button', { type: 'button', class: 'scbtn scpin', 'data-sc': x.id, 'aria-label': p.label, title: p.label + ' (right-click or drag to rearrange)', draggable: 'true', onclick: () => run?.(x.id) }, icon(p.icon));
      b.addEventListener('contextmenu', ev => { ev.preventDefault(); popover(b, i); });
      b.addEventListener('dragstart', ev => { drag = i; ev.dataTransfer?.setData('text/plain', x.id); });
      b.addEventListener('dragover', ev => { if (drag >= 0) ev.preventDefault(); });
      b.addEventListener('drop', ev => { ev.preventDefault(); if (drag >= 0) set(movePin(pins, drag, i)); drag = -1; });
      return b;
    }));
  }
  const onStore = ev => { if (!ev.key || ev.key === PINS_KEY) { pins = loadPins(); draw(); } };
  const onPins = () => { pins = loadPins(); draw(); };
  window.addEventListener('storage', onStore); window.addEventListener('wavwiz:pins', onPins);
  draw();
  return { el, destroy: () => { window.removeEventListener('storage', onStore); window.removeEventListener('wavwiz:pins', onPins); } };
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

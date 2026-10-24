// WavWiz 0.3.8 L44: the keyboard shortcuts - ONE table that drives the key handler, the menu hints, the tooltips and Help > Keyboard shortcuts.
// Active only when you are not typing, no dialog / sheet is open and the Jukebox kiosk is not showing. Alt chords use ev.code (layout independent), ignore Ctrl/Meta (AltGr) and key repeat.
export const SHORTCUTS = [
  { id: 'playpause', keys: 'Space', label: 'Play / Pause', group: 'Playback', note: 'when no button or field has focus' },
  { id: 'next', keys: 'Ctrl+Right', label: 'Next song', group: 'Playback' },
  { id: 'prev', keys: 'Ctrl+Left', label: 'Previous song', group: 'Playback' },
  { id: 'mute', keys: 'M', label: 'Mute / unmute', group: 'Playback' },
  { id: 'mini', keys: 'Alt+M', label: 'Mini player on / off', group: 'Windows' },
  { id: 'home', keys: 'Alt+H', label: 'Home (default screen)', group: 'Windows' },
  { id: 'eq', keys: 'Alt+E', label: 'Sound / EQ', group: 'Windows' },
  { id: 'queue', keys: 'Alt+Q', label: 'Queue', group: 'Windows' },
  { id: 'mixer', keys: 'Alt+V', label: 'Master volume (every zone and speaker)', group: 'Windows' },
  { id: 'settings', keys: 'Ctrl+,', label: 'Settings', group: 'Windows' },
  { id: 'new-zone', keys: 'Ctrl+Shift+Z', label: 'New zone', group: 'Create' },
  { id: 'new-scene', keys: 'Ctrl+Shift+S', label: 'New scene', group: 'Create' },
  { id: 'new-alarm', keys: 'Ctrl+Shift+A', label: 'New alarm', group: 'Create' },
  { id: 'new-schedule', keys: 'Ctrl+Shift+H', label: 'New schedule', group: 'Create' },
];
export const keysFor = id => SHORTCUTS.find(s => s.id === id)?.keys || '';
export const hint = (label, id) => { const k = keysFor(id); return k ? `${label} (${k})` : label; };
const BY_CODE = { Space: 'playpause', KeyM: 'mute' };
const ALT_CODE = { KeyM: 'mini', KeyH: 'home', KeyE: 'eq', KeyQ: 'queue', KeyV: 'mixer' };
/** Pure: which shortcut id a keydown asks for (the four Ctrl+Shift "new" chords stay in menusub.js), or null. */
export function matchShortcut(ev) {
  if (!ev || ev.repeat) return null;
  const { ctrlKey: c, metaKey: m, altKey: a, shiftKey: s, code } = ev;
  if (a && !c && !m && !s) return ALT_CODE[code] || null;
  if (c && !m && !a && !s) return code === 'ArrowRight' ? 'next' : code === 'ArrowLeft' ? 'prev' : code === 'Comma' ? 'settings' : null;
  if (!c && !m && !a && !s) return BY_CODE[code] || null;
  return null;
}
const FIELD = /^(INPUT|TEXTAREA|SELECT)$/;
export const isTyping = t => !!t && (t.isContentEditable || FIELD.test(t.tagName || ''));
const ACTIVATES = 'button,a[href],summary,[role=button],[role=switch],[role=menuitem],[role=tab]';
/** Pure-ish: is the event from a place where shortcuts must stay quiet? */
export function blocked(ev, doc = globalThis.document) {
  if (isTyping(ev.target)) return true;
  if (doc?.querySelector?.('dialog[open],.sheet,.dlg,.jb')) return true;
  if (ev.code === 'Space' && ev.target?.closest?.(ACTIVATES)) return true;
  return false;
}
/** Install the handler on window (capture phase). exec(id) runs the action. Returns a stop function. */
export function installHotkeys(exec, win = globalThis.window) {
  const on = ev => { const id = matchShortcut(ev); if (!id || blocked(ev)) return; ev.preventDefault(); ev.stopPropagation(); exec(id); };
  win.addEventListener('keydown', on, true); return () => win.removeEventListener('keydown', on, true);
}
/** Help > Keyboard shortcuts (built from the table). */
export function shortcutsBody(h) {
  const groups = [...new Set(SHORTCUTS.map(s => s.group))];
  return h('div', { class: 'kbdlist' }, groups.map(g => h('section', null, h('h4', null, g), h('table', { class: 'kbdtbl' }, SHORTCUTS.filter(s => s.group === g).map(s => h('tr', null, h('td', null, s.label, s.note ? h('span', { class: 'small dim' }, ` - ${s.note}`) : null), h('td', null, h('span', { class: 'kbd' }, s.keys))))))),
    h('p', { class: 'small dim' }, 'Shortcuts are off while you type in a field, while a window is open, and in the Jukebox.'));
}

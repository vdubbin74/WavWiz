// Keep playing (queue header control), server-side queue Undo toast and Recent queues.
import { h, api, toast, undoToast, dialog } from './util.js';
const zp = (p, zid) => zid ? p + (p.includes('?') ? '&' : '?') + 'zoneId=' + encodeURIComponent(zid) : p;

/** Pure: the <select> value for a Keep playing setting. */
export const keepValue = k => !k || !k.mode || k.mode === 'off' ? 'off' : k.mode === 'similar' ? 'similar' : `${k.mode}:${k.id}`;
/** Pure: the PUT body for a <select> value. */
export const keepBody = v => { if (!v || v === 'off') return { mode: 'off' }; if (v === 'similar') return { mode: 'similar' }; const [mode, id] = v.split(':'); return { mode, id: Number(id) }; };

/** Compact Keep playing control: quiet "Keep playing ▾" when off, "Keep playing: [mode ▾]" when on. zid() = the zone being shown (null = this player's zone); can() = Control role.
 *  Opens a small popover: the modes first (Off / Similar / Smart… / Playlist… / Radio…), then a type-to-filter list of at most KEEP_MAX items for that kind. */
export const KEEP_MAX = 12;
/** Pure: the items of one kind matching a filter, at most `max` (name order kept). */
export const keepFilter = (xs, q, max = KEEP_MAX) => { const t = String(q || '').trim().toLocaleLowerCase(); const m = t ? xs.filter(x => String(x.name || '').toLocaleLowerCase().includes(t)) : xs; return { shown: m.slice(0, max), more: Math.max(0, m.length - max) }; };
const KINDS = [['smart', 'Smart playlist', 'sm'], ['playlist', 'Playlist', 'pl'], ['radio', 'Radio', 'rd']];
export function keepControl({ zid = () => null, can = () => true } = {}) {
  let val = 'off', name = '';
  const sel = h('button', { type: 'button', class: 'qkeep-sel', 'aria-label': 'Keep playing when the queue runs out', title: 'When the queue runs out, keep adding music', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    onclick: ev => { ev.preventDefault(); ev.stopPropagation(); if (document.querySelector('.qkeeppop')) close(); else open(); } }, 'Keep playing ▾');
  const lbl = h('span', { class: 'qkeep-lbl dim' }, 'Keep playing:');
  const el = h('span', { class: 'qkeep row small qkeep-off', 'data-act': 'keepplaying' }, lbl, sel);
  // Off = one quiet "Keep playing ▾" control; on = "Keep playing: <mode>" so autofill is easy to spot.
  const mark = () => { const on = val !== 'off'; el.classList.toggle('qkeep-on', on); el.classList.toggle('qkeep-off', !on); lbl.hidden = !on; sel.textContent = (on ? (val === 'similar' ? 'Similar music' : name || 'On') : 'Keep playing') + ' ▾'; sel.dataset.value = val; };
  let lists = null, at = 0;
  async function loadLists() {
    if (lists && performance.now() - at < 30000) return lists;
    const [pl, rd, sm] = await Promise.all([api('/playlists').catch(() => []), api('/radio').catch(() => []), api('/smart').catch(() => [])]);
    at = performance.now(); return (lists = { pl: pl || [], rd: rd || [], sm: sm || [] });
  }
  async function choose(v, label) {
    close(); const was = [val, name]; val = v; name = label || ''; mark();
    try { await api(zp('/queue/keep', zid()), { method: 'PUT', body: keepBody(v) }); toast(v === 'off' ? 'Keep playing is off' : `Keep playing: ${v === 'similar' ? 'Similar music' : name}`); }
    catch (e) { [val, name] = was; mark(); toast(e.message, true); refresh(); }
  }
  let box = null;
  const out = ev => { if (!ev.target.closest?.('.qkeeppop') && ev.target !== sel) close(); };
  const esc = ev => { if (ev.key === 'Escape') { close(); sel.focus(); } };
  function close() { box?.remove(); box = null; sel.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', out, true); document.removeEventListener('keydown', esc, true); }
  const item = (text, on, onclick, extra = {}) => h('button', { type: 'button', class: 'plp-sort qkeepi' + (on ? ' on' : ''), role: 'menuitem', onclick, ...extra }, text);
  const place = () => { const a = sel.getBoundingClientRect(), r = box.getBoundingClientRect(); box.style.left = Math.max(4, Math.min(a.left, innerWidth - r.width - 6)) + 'px'; box.style.top = Math.max(4, a.bottom + r.height + 4 > innerHeight ? a.top - r.height - 4 : a.bottom + 4) + 'px'; };
  const paint = kids => { box.replaceChildren(...kids); place(); box.querySelector('input, .qkeepi')?.focus(); };
  async function open() {
    if (!can()) return; close();
    box = h('div', { class: 'plpicker qkeeppop', role: 'menu', 'aria-label': 'Keep playing' });
    box.addEventListener('keydown', ev => { if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return; const it = [...box.querySelectorAll('input, .qkeepi:not(:disabled)')], i = it.indexOf(document.activeElement); ev.preventDefault(); it[(i + (ev.key === 'ArrowDown' ? 1 : it.length - 1)) % it.length]?.focus(); });
    document.body.append(box); sel.setAttribute('aria-expanded', 'true');
    setTimeout(() => { document.addEventListener('pointerdown', out, true); document.addEventListener('keydown', esc, true); }, 0);
    const L = await loadLists().catch(() => ({ pl: [], rd: [], sm: [] })); if (!box) return;
    const modes = () => paint([h('div', { class: 'plp-h' }, 'KEEP PLAYING'),
      item('Off — stop when empty', val === 'off', () => choose('off')),
      item('Similar music', val === 'similar', () => choose('similar')),
      ...KINDS.map(([k, label, key]) => item(`${label}…`, val.startsWith(k + ':'), () => pick(k, label, L[key]), { disabled: !L[key].length, title: L[key].length ? `Pick a ${label.toLowerCase()} (${L[key].length})` : `No ${label.toLowerCase()}s yet` })),
      h('div', { class: 'plp-note' }, 'When the queue runs out, keep adding music.')]);
    const pick = (k, label, xs) => {
      const q = h('input', { type: 'search', class: 'qkeepq', placeholder: `Find a ${label.toLowerCase()}`, 'aria-label': `Find a ${label.toLowerCase()}` });
      const list = h('div', { class: 'qkeepl' }), note = h('div', { class: 'plp-note' });
      const draw = () => { const r = keepFilter(xs, q.value); list.replaceChildren(...(r.shown.length ? r.shown.map(x => item(x.name, val === `${k}:${x.id}`, () => choose(`${k}:${x.id}`, x.name), { title: x.name })) : [h('div', { class: 'plp-note' }, 'Nothing matches.')])); note.textContent = r.more ? `${r.more} more — type to find them` : ''; note.hidden = !r.more; };
      q.addEventListener('input', draw);
      q.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); list.querySelector('.qkeepi')?.click(); } });
      draw();
      paint([h('div', { class: 'plp-h' }, h('button', { type: 'button', class: 'plp-sort qkeepi qkeepback', role: 'menuitem', 'aria-label': 'Back', onclick: modes }, '‹'), label.toUpperCase()), xs.length > KEEP_MAX ? q : null, list, note]);
    };
    modes();
  }
  async function refresh() {
    let k = null; try { k = await api(zp('/queue/keep', zid())); } catch { /* older server */ }
    val = keepValue(k); name = k?.name || '';
    if (!name && val.includes(':')) { const L = await loadLists().catch(() => null), [m, id] = val.split(':'), xs = L ? (m === 'smart' ? L.sm : m === 'radio' ? L.rd : L.pl) : []; name = xs.find(x => String(x.id) === id)?.name || ''; }
    sel.disabled = !can(); mark();
  }
  el.refresh = () => { lists = null; return refresh(); }; refresh();
  if (typeof window !== 'undefined') window.addEventListener('wavwiz:playlists', () => el.refresh());
  return el;
}

/** Pure: the zoneId carried by an API path (null = this player's zone). */
export const zoneOfPath = p => { const m = /[?&]zoneId=([^&]+)/.exec(p || ''); return m ? decodeURIComponent(m[1]) : null; };
/** Pure: toast text for the action that replaced / emptied the queue. */
export const undoMsg = p => /\/queue\/clear/.test(p) ? 'Cleared the queue' : /\/queue\/send/.test(p) ? 'Moved the queue' : /\/queue\/(undo|recent)/.test(p) ? 'Queue restored' : 'Replaced the queue';
export const UNDO_MS = 10000;
const refresh = () => window.dispatchEvent(new CustomEvent('wavwiz:queuechanged'));
/** Server-side Undo: put back the snapshot taken just before (Control role; the newest change wins). */
export function showQueueUndo({ path, token }) {
  const zid = zoneOfPath(path);
  undoToast(undoMsg(path), async () => {
    const r = await api(zp('/queue/undo', zid), { method: 'POST', body: { token }, noUndo: true });
    refresh(); undoToast(`Put back ${r.restored} item${r.restored === 1 ? '' : 's'}`, async () => { await api(zp('/queue/undo', zid), { method: 'POST', body: { token: r.queueUndo }, noUndo: true }); refresh(); }, UNDO_MS, 'Undo');
  }, UNDO_MS);
}
if (typeof window !== 'undefined' && !window.__wwQueueUndo) { window.__wwQueueUndo = true; window.addEventListener('wavwiz:queueundo', ev => showQueueUndo(ev.detail || {})); }

const ago = t => { const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleString(); };
/** Recent queues… dialog: time + first titles -> Restore (replaces the queue; Undo via the same toast). */
export async function openRecentQueues({ zid = null, can = true } = {}) {
  let list = []; try { list = await api(zp('/queue/recent', zid)) || []; } catch (e) { toast(e.message, true); return; }
  const body = list.length ? h('ul', { class: 'list qrecent' }, list.map(x => h('li', { class: 'item row' },
    h('div', { class: 'grow' }, h('div', null, h('b', null, `${x.count} item${x.count === 1 ? '' : 's'}`), h('span', { class: 'dim small' }, ` • ${ago(x.at)} • ${x.reason}`)), h('div', { class: 'dim small ell' }, (x.titles || []).join(', '))),
    can ? h('button', { class: 'btn sm', 'data-act': 'restorequeue', onclick: async () => { try { const r = await api(zp('/queue/recent/restore', zid), { method: 'POST', body: { id: x.id }, noUndo: true }); d.close(); refresh(); if (r.queueUndo) showQueueUndo({ path: zp('/queue/recent', zid), token: r.queueUndo }); } catch (e) { toast(e.message, true); } } }, 'Restore') : null)))
    : h('p', { class: 'dim' }, 'No recent queues yet. When you clear or replace a queue, it is kept here so you can bring it back.');
  const d = dialog('Recent queues', body, [{ text: 'Close' }]);
}

// WavWiz 0.3.6 K20: File > Import settings / Restore backup / Export settings / Back up now - ONE in-panel flow (no pop-up window).
// What already existed (0.3.0 section 7.1): export (/backup), preview (/backup/preview) and import (/backup/import) behind Settings > General > Backup.
// Built here: the in-panel summary with Restore / Cancel, Back up now (a snapshot on the server), Restore from a saved backup, and the Undo restore toast
// (the server saves a "before restore" snapshot first, so Undo is one call).
import { h, api, toast } from './util.js';
import { undoToast } from './settingsui.js';
import { pulse } from './motion.js';

let panel = null;
const closePanel = () => { panel?.remove(); panel = null; };
const showPanel = (title, ...kids) => {
  const was = !!panel; closePanel();
  panel = h('section', { class: 'bkpanel' + (was ? '' : ' in'), role: 'region', 'aria-label': title },
    h('div', { class: 'bk-h' }, h('b', null, title), h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn sm', 'aria-label': 'Close', onclick: closePanel }, '✕')), ...kids);
  document.body.append(panel); return panel;
};
const when = iso => { try { return new Date(iso).toLocaleString(); } catch { return iso || ''; } };
const summary = pv => h('div', { class: 'bk-sum' },
  h('p', { class: 'small' }, `Backup from WavWiz ${pv.appVersion || '?'}${pv.createdAt ? ', ' + when(pv.createdAt) : ''}. These parts are replaced:`),
  h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['', 'Now', 'In the backup'].map(t => h('th', null, t)))),
    h('tbody', null, (pv.sections || []).map(x => h('tr', { class: x.current !== x.incoming ? 'chg' : '' }, h('td', null, x.label), h('td', null, String(x.current)), h('td', null, String(x.incoming)))))),
  pv.songsNotInLibrary ? h('p', { class: 'warn-t small' }, `${pv.songsNotInLibrary} playlist song(s) are not in this library yet; they are skipped.`) : null,
  h('p', { class: 'small dim' }, 'Passwords, certificates and paired devices are never in a backup, so you keep the ones on this server.'));

const PENDING = 'wavwiz.undoRestore';
/** After a restore the page reloads once (theme, devices, scenes... all come from the restored data); the Undo toast is shown right after. */
async function afterRestore(r, done) {
  closePanel(); done?.();
  const msg = `Restored.${r.songsNotInLibrary ? ` ${r.songsNotInLibrary} song(s) skipped.` : ''}`;
  try { sessionStorage.setItem(PENDING, JSON.stringify({ msg, undo: r.undo || null })); } catch { /* private mode */ }
  location.reload();
}
export function showPendingUndo() {
  let p = null; try { p = JSON.parse(sessionStorage.getItem(PENDING) || 'null'); sessionStorage.removeItem(PENDING); } catch { /* none */ }
  if (!p) return false;
  if (!p.undo) { toast(p.msg); return true; }
  undoToast(p.msg, async () => { await api('/backup/restore-saved', { method: 'POST', body: { name: p.undo } }); try { sessionStorage.setItem(PENDING, JSON.stringify({ msg: 'Restore undone.', undo: null })); } catch { /* ignore */ } location.reload(); });
  return true;
}
function confirmPanel(title, pv, restoreFn, done) {
  const err = h('p', { class: 'small err', role: 'status' });
  const go = h('button', { type: 'button', class: 'btn primary', 'data-act': 'bk-restore', onclick: async () => { go.disabled = true; try { await afterRestore(await restoreFn(), done); } catch (e) { go.disabled = false; err.textContent = 'Restore failed. ' + e.message; } } }, 'Restore');
  showPanel(title, summary(pv), err, h('div', { class: 'row bk-bar' }, h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn', 'data-act': 'bk-cancel', onclick: closePanel }, 'Cancel'), go));
}
const adminOnlyToast = S => { if (S.auth?.role === 'admin') return false; toast('Only an administrator can do this.', true); return true; };

/** Import settings: choose a .wavwizbackup file; the panel shows what changes; Restore / Cancel. */
export function importSettings(S, done) {
  if (adminOnlyToast(S)) return;
  const file = h('input', { type: 'file', accept: '.wavwizbackup', hidden: true });
  document.body.append(file);
  file.addEventListener('change', async () => {
    const f = file.files?.[0]; file.remove(); if (!f) return;
    const raw = await f.arrayBuffer();
    let pv; try { pv = await api('/backup/preview', { method: 'POST', raw }); } catch (e) { showPanel('Import settings', h('p', { class: 'small err' }, 'This file can’t be used. ' + e.message), h('div', { class: 'row bk-bar' }, h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn', onclick: closePanel }, 'Close'))); return; }
    confirmPanel('Import settings', pv, () => api('/backup/import', { method: 'POST', raw }), done);
  });
  file.click();
}
/** Restore backup: the backups saved on this server (Back up now makes them), newest first; pick one, see the summary, Restore / Cancel. */
export async function restoreBackup(S, done) {
  if (adminOnlyToast(S)) return;
  let list = []; try { list = await api('/backup/list'); } catch (e) { return toast(e.message, true); }
  const rows = list.length ? list.map(b => h('button', { type: 'button', class: 'bk-row', 'data-name': b.name, onclick: async () => {
    try { const pv = await api('/backup/preview-saved', { method: 'POST', body: { name: b.name } }); confirmPanel('Restore backup', pv, () => api('/backup/restore-saved', { method: 'POST', body: { name: b.name } }), done); } catch (e) { toast(e.message, true); }
  } }, h('b', null, when(b.createdAt)), h('span', { class: 'small dim' }, ` ${b.kind === 'before-restore' ? '· saved before a restore' : ''} · ${Math.max(1, Math.round(b.size / 1024))} KB`)))
    : [h('p', { class: 'small dim' }, 'No saved backups yet. Use File > Back up now first, or Import settings to use a file.')];
  showPanel('Restore backup', h('p', { class: 'small dim' }, 'Pick a backup saved on this server:'), h('div', { class: 'bk-list' }, rows),
    h('div', { class: 'row bk-bar' }, h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn', onclick: closePanel }, 'Cancel')));
}
/** Export settings: downloads one .wavwizbackup file (the browser's own download). */
export function exportSettings(S) {
  if (adminOnlyToast(S)) return;
  const a = h('a', { href: '/api/v1/backup', download: '' }); document.body.append(a); a.click(); a.remove(); toast('Exporting your settings…');
}
/** Back up now: saves a snapshot on the server (the last 10 are kept). */
export async function backUpNow(S) {
  if (adminOnlyToast(S)) return;
  try { const b = await api('/backup/now', { method: 'POST' }); toast(`Backed up ${when(b.createdAt)}. Restore it from File > Restore backup.`); } catch (e) { toast(e.message, true); }
}
export { closePanel as closeBackupPanel, pulse };

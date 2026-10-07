import { h, api, toast } from './util.js';
import { canControl } from './ui.js';

export function tagsView(S) {
  const root = h('div');
  async function draw() {
    if (!canControl(S)) { root.replaceChildren(h('p', { class: 'dim' }, 'Tag fixing needs Control access.')); return; }
    let jobs = []; try { jobs = await api('/tags/jobs'); } catch (e) { root.replaceChildren(h('p', { class: 'err' }, e.message)); return; }
    root.replaceChildren(
      h('div', { class: 'row wrap' }, h('h2', { class: 'grow', style: 'margin:0' }, 'Tag & cover auto-fill'),
        h('button', { class: 'btn primary', onclick: scan }, 'Scan library')),
      h('p', { class: 'dim small' }, 'Looks up missing tags and covers via MusicBrainz and Cover Art Archive. You approve every change before it is written. Undo is available. Writing into the music files is optional (default: database only).'),
      jobs.length ? jobs.map(j => h('div', { class: 'card' },
        h('div', { class: 'row wrap' }, h('b', { class: 'grow' }, `Job #${j.id} — ${j.status}`), h('span', { class: 'small dim' }, j.createdAt),
          h('button', { class: 'btn', onclick: () => openJob(j.id) }, 'Open')),
        h('div', { class: 'small dim' }, j.summary || ''))) : h('p', { class: 'dim' }, 'No jobs yet.'));
  }
  async function scan() {
    toast('Scanning… (MusicBrainz is rate-limited; this can take a minute)');
    try { const j = await api('/tags/scan', { method: 'POST', body: { limit: 30, writeFiles: false } }); toast('Ready for approval'); openJob(j.id); draw(); }
    catch (e) { toast(e.message, true); }
  }
  async function openJob(id) {
    let j; try { j = await api(`/tags/jobs/${id}`); } catch (e) { return toast(e.message, true); }
    const box = h('div');
    const paint = () => {
      box.replaceChildren(
        h('p', { class: 'small dim' }, j.summary || ''),
        h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: j.writeFiles, onchange: async ev => { await api(`/tags/jobs/${id}/approvals`, { method: 'POST', body: { writeFiles: ev.target.checked } }); j.writeFiles = ev.target.checked; } }), 'Also write tags into the music files (undo restores the database; re-tag files manually if needed)'),
        h('div', { class: 'row wrap', style: 'margin:8px 0' },
          h('button', { class: 'btn', onclick: async () => { await api(`/tags/jobs/${id}/approvals`, { method: 'POST', body: { all: true } }); j = await api(`/tags/jobs/${id}`); paint(); } }, 'Approve all'),
          h('button', { class: 'btn', onclick: async () => { await api(`/tags/jobs/${id}/approvals`, { method: 'POST', body: { all: false } }); j = await api(`/tags/jobs/${id}`); paint(); } }, 'Approve none'),
          j.status !== 'applied' ? h('button', { class: 'btn primary', onclick: async () => { try { await api(`/tags/jobs/${id}/apply`, { method: 'POST' }); toast('Applied'); j = await api(`/tags/jobs/${id}`); paint(); draw(); } catch (e) { toast(e.message, true); } } }, 'Apply approved') : null,
          j.status === 'applied' ? h('button', { class: 'btn', onclick: async () => { try { await api(`/tags/jobs/${id}/undo`, { method: 'POST' }); toast('Undone'); j = await api(`/tags/jobs/${id}`); paint(); draw(); } catch (e) { toast(e.message, true); } } }, 'Undo') : null),
        h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['', 'Track', 'Field', 'Old', 'New'].map(x => h('th', null, x)))),
          h('tbody', null, (j.items || []).map(it => h('tr', null,
            h('td', null, h('input', { type: 'checkbox', checked: it.approved, disabled: it.applied, onchange: async ev => { await api(`/tags/jobs/${id}/approvals`, { method: 'POST', body: { items: [{ id: it.id, approved: ev.target.checked }] } }); } })),
            h('td', null, it.trackId), h('td', null, it.field), h('td', { class: 'small' }, it.oldValue || '—'), h('td', { class: 'small' }, it.newValue || it.artUrl || '—'))))));
    };
    paint();
    const { dialog } = await import('./util.js');
    dialog(`Tag fix #${id}`, box, [{ text: 'Close' }], { cls: 'page' });
  }
  draw(); return { el: root, reload: draw };
}

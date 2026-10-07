import { h, api, toast } from './util.js';

export function ripView(S) {
  const root = h('div');
  async function draw() {
    if (S.auth.role !== 'admin') { root.replaceChildren(h('p', { class: 'dim' }, 'CD ripping needs administrator access.')); return; }
    let drives = { drives: [] }, formats = { formats: [] }, jobs = [];
    try { [drives, formats, jobs] = await Promise.all([api('/rip/drives'), api('/rip/formats'), api('/rip/jobs')]); } catch (e) { root.replaceChildren(h('p', { class: 'err' }, e.message)); return; }
    const drive = h('select', null, (drives.drives || []).map(d => h('option', { value: d.letter }, `${d.letter} ${d.ready ? (d.label || 'ready') : '(no disc)'}`)));
    if (!(drives.drives || []).length) drive.append(h('option', { value: '' }, 'No optical drive detected'));
    const format = h('select', null, (formats.formats || []).map(f => h('option', { value: f.id, disabled: !f.available, selected: f.id === (formats.defaultFormat || 'flac') }, `${f.name}${f.available ? '' : ' — unavailable'}`)));
    const artist = h('input', { type: 'text', placeholder: 'Artist', maxlength: 120 });
    const album = h('input', { type: 'text', placeholder: 'Album', maxlength: 120 });
    root.replaceChildren(
      h('h2', { style: 'margin:0 0 8px' }, 'CD ripper'),
      h('p', { class: 'dim small' }, 'Rip an audio CD from this server PC\'s disc drive into your music library. FLAC is the default (lossless, LGPL). AAC uses FFmpeg\'s native LGPL encoder. MP3 is not bundled (LAME not shipped). libcdio CDDA is used when the bundled FFmpeg includes it.'),
      drives.note ? h('p', { class: 'warnc small' }, drives.note) : null,
      formats.libcdio ? h('p', { class: 'okc small' }, 'CDDA via the LGPL wavwiz-cdda (libcdio) helper is available.') : h('p', { class: 'warnc small' }, 'wavwiz-cdda helper missing — reinstall WavWiz 0.0.6+ for optical ripping.'),
      h('div', { class: 'card' },
        h('div', { class: 'field' }, h('label', null, 'Drive'), drive),
        h('div', { class: 'field' }, h('label', null, 'Format'), format),
        h('div', { class: 'field' }, h('label', null, 'Artist'), artist),
        h('div', { class: 'field' }, h('label', null, 'Album'), album),
        h('button', { class: 'btn primary', onclick: async () => {
          try { const r = await api('/rip/start', { method: 'POST', body: { drive: drive.value, format: format.value, artist: artist.value, album: album.value } }); toast('Rip job #' + r.id + ' started'); draw(); }
          catch (e) { toast(e.message, true); }
        } }, 'Start rip'),
        h('div', { class: 'small dim', style: 'margin-top:8px' }, (formats.formats || []).map(f => `${f.id}: ${f.note}`).join(' · '))),
      h('h3', null, 'Recent jobs'),
      jobs.length ? jobs.map(j => h('div', { class: 'card' }, h('b', null, `#${j.id} ${j.status}`), h('div', { class: 'small dim' }, `${j.drive} → ${j.format} • ${Math.round((j.progress || 0) * 100)}%`), j.error ? h('div', { class: 'err small' }, j.error) : null, j.dest ? h('div', { class: 'mono small' }, j.dest) : null))
        : h('p', { class: 'dim' }, 'No rips yet.'));
  }
  draw(); return { el: root, reload: draw };
}

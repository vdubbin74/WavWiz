import { wsel } from './wwselect.js';
import { h, api, toast, fmtDur } from './util.js';

/** Look up licensing details (moved off the main ripper page). */
export const RIP_INFO = 'Audio CDs are read with the bundled wavwiz-cdda helper (libcdio, LGPL). Encoding uses WavWiz’s LGPL FFmpeg build: FLAC and AAC are built in, and MP3 uses bundled LAME (also LGPL). Details are in Settings › About.';

export function formatPayload(format, quality) {
  const f = String(format || 'flac').toLowerCase();
  if (f !== 'mp3') return { format: f };
  const q = String(quality || 'v0').toLowerCase();
  return { format: 'mp3', quality: (q === 'v2' || q === 'cbr320') ? q : 'v0' };
}

export function jobPercent(j) {
  // Live rips send trackProgress (0–1 within the current track). Overall progress on a
  // 16-track disc is only ~6% at the end of track 1, so rounding it hides the bar.
  const raw = (j && (j.status === 'ripping' || j.status === 'queued') && j.trackProgress != null)
    ? j.trackProgress : j?.progress;
  return Math.round(Math.max(0, Math.min(1, Number(raw) || 0)) * 100);
}
export function isLiveJob(j) { return !!j && (j.status === 'ripping' || j.status === 'queued'); }
export function isTerminalJob(j) { return !!j && ['done', 'error', 'cancelled', 'interrupted'].includes(j.status); }
/** Featured status card: a live rip, or a terminal job this page actually followed. Never promote an old jobs[0] just because it is the latest. */
export function featuredJob(jobs, { followId, dismissedIds } = {}) {
  const list = jobs || [];
  const live = list.find(isLiveJob);
  if (live) return live;
  if (followId == null || followId === '') return null;
  if (dismissedIds && (dismissedIds.has?.(followId) || dismissedIds.has?.(String(followId)) || (Array.isArray(dismissedIds) && dismissedIds.map(String).includes(String(followId))))) return null;
  const j = list.find(x => String(x.id) === String(followId));
  return (j && isTerminalJob(j)) ? j : null;
}
export function jobStatusLabel(j) {
  const s = j?.status;
  if (s === 'ripping' || s === 'queued') return 'Ripping';
  if (s === 'done') return 'Finished';
  if (s === 'cancelled') return 'Cancelled';
  if (s === 'interrupted') return 'Interrupted';
  return 'Couldn’t finish';
}
export function jobLine(j) {
  if (!j) return '';
  if (j.status === 'interrupted') return j.error || j.detail || 'Interrupted — the server stopped before this rip finished.';
  if (j.detail) return j.detail;
  if (j.status === 'ripping') return `${jobPercent(j)}%`;
  return j.status || '';
}
export function liveLockTitle(job) {
  if (!isLiveJob(job)) return '';
  return job.drive ? `A rip is in progress on ${job.drive}` : 'A rip is in progress';
}

/** Pure page from a model (used by the live view and the preview). */
export function ripPage(model, act = {}) {
  const m = model || {};
  const admin = m.admin !== false;
  if (!admin) return h('div', { class: 'rip-page' }, h('p', { class: 'dim' }, 'CD ripping needs administrator access.'));
  const ripping = isLiveJob(m.job);
  const ready = !!(m.disc && m.disc.ready);
  const tracks = (m.tracks || []).slice();
  const matches = m.matches || [];
  const fmt = m.format || 'flac';
  const cover = m.cover || null;
  const lockTitle = liveLockTitle(m.job);
  const noDrive = !(m.drives || []).length;
  const driveOff = ripping || noDrive;
  const driveTitle = ripping ? lockTitle : (noDrive ? 'No optical drive detected on the server PC' : '');
  const startWhy = ripping ? lockTitle
    : (!ready ? 'Insert an audio CD to start a rip' : (!tracks.some(t => t.selected !== false) ? 'No audio tracks are selected' : ''));

  const drive = wsel({ 'aria-label': 'Disc drive', disabled: driveOff, title: driveTitle, onchange: ev => act.onDrive && act.onDrive(ev.target.value) },
    (m.drives || []).length
      ? (m.drives || []).map(d => h('option', { value: d.letter, selected: d.letter === m.drive }, `${d.letter} ${d.ready ? (d.label || 'disc ready') : '(no disc)'}`))
      : [h('option', { value: '' }, 'No optical drive detected')]);

  const format = wsel({ 'aria-label': 'File format', disabled: ripping, title: ripping ? lockTitle : '', onchange: ev => act.onFormat && act.onFormat(ev.target.value) },
    (m.formats || []).map(f => h('option', { value: f.id, disabled: !f.available, selected: f.id === fmt }, `${f.name}${f.available ? '' : ' — unavailable'}`)));

  const quality = wsel({ 'aria-label': 'MP3 quality', disabled: ripping, title: ripping ? lockTitle : '', onchange: ev => act.onQuality && act.onQuality(ev.target.value) },
    (m.qualities || [{ id: 'v0', name: 'VBR V0 (best)' }, { id: 'v2', name: 'VBR V2' }, { id: 'cbr320', name: 'CBR 320 kbps' }]).map(q =>
      h('option', { value: q.id, selected: q.id === (m.quality || 'v0') }, q.name)));

  const artist = h('input', { type: 'text', class: 'rip-artist', placeholder: 'Artist', maxlength: 120, value: m.artist || '', disabled: ripping, title: ripping ? lockTitle : '', oninput: ev => act.onArtist && act.onArtist(ev.target.value) });
  const album = h('input', { type: 'text', class: 'rip-album', placeholder: 'Album', maxlength: 120, value: m.album || '', disabled: ripping, title: ripping ? lockTitle : '', oninput: ev => act.onAlbum && act.onAlbum(ev.target.value) });
  const year = h('input', { type: 'text', class: 'rip-year', placeholder: 'Year', maxlength: 4, inputmode: 'numeric', value: m.year || '', disabled: ripping, title: ripping ? lockTitle : '', oninput: ev => act.onYear && act.onYear(ev.target.value) });

  const coverEl = h('div', { class: 'rip-cover' + (cover ? '' : ' empty'), 'aria-hidden': cover ? null : 'true' },
    cover ? h('img', { src: cover, alt: '' }) : h('span', { class: 'rip-cover-ph' }, '♪'));

  const matchPick = matches.length > 1 ? wsel({ 'aria-label': 'Matching album', disabled: ripping, title: ripping ? lockTitle : '', onchange: ev => act.onMatch && act.onMatch(ev.target.value) },
    matches.map(x => h('option', { value: x.id, selected: x.id === m.matchId }, [x.artist, x.album, x.year].filter(Boolean).join(' — ')))) : null;

  const trackRows = tracks.length ? h('ul', { class: 'rip-tracks', 'aria-label': 'Tracks to rip' }, tracks.map((tr, i) => {
    const on = tr.selected !== false;
    const title = h('input', { type: 'text', class: 'rip-tt', value: tr.title || `Track ${tr.n || i + 1}`, disabled: ripping, title: ripping ? lockTitle : '', maxlength: 200, 'aria-label': `Title for track ${tr.n || i + 1}`,
      oninput: ev => act.onTrackTitle && act.onTrackTitle(i, ev.target.value) });
    return h('li', { class: 'rip-tr' + (on ? '' : ' off') },
      h('label', { class: 'rip-check' }, h('input', { type: 'checkbox', checked: on, disabled: ripping, title: ripping ? lockTitle : '', onchange: ev => act.onTrackSel && act.onTrackSel(i, ev.target.checked) })),
      h('span', { class: 'rip-num' }, String(tr.n || i + 1).padStart(2, '0')),
      title,
      h('span', { class: 'rip-dur dim small' }, tr.durationMs ? fmtDur(tr.durationMs) : ''));
  })) : h('p', { class: 'dim small rip-empty' }, ready ? 'No audio tracks found on this disc. If it just went in, tap Retry.' : 'Insert an audio CD. The album and track names fill in automatically when the disc is recognised.');

  const infoBtn = h('button', { type: 'button', class: 'rip-info', title: RIP_INFO, 'aria-label': 'About CD ripping' });
  infoBtn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="5.1" r="1" fill="currentColor"/><path d="M8 7.25v4.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>';

  const startBtn = h('button', { type: 'button', class: 'btn primary', disabled: ripping || !ready || !tracks.some(tr => tr.selected !== false), title: startWhy,
    onclick: () => act.onStart && act.onStart({
      drive: drive.value, ...formatPayload(format.value, quality.value),
      artist: artist.value, album: album.value, year: year.value, coverMbid: m.coverMbid || null,
      tracks: tracks.filter(tr => tr.selected !== false).map(tr => ({ n: tr.n, title: tr.title, artist: tr.artist }))
    }) }, 'Start rip');

  const retryBtn = h('button', { type: 'button', class: 'btn', disabled: ripping || noDrive, title: ripping ? lockTitle : 'Read the disc again',
    onclick: () => act.onRetry && act.onRetry() }, 'Retry');

  const cancelBtn = ripping ? h('button', { type: 'button', class: 'btn', onclick: () => act.onCancel && act.onCancel(m.job.id) }, 'Cancel') : null;

  const job = m.job;
  const canClear = !!(job && !isLiveJob(job));
  const fmtTag = job ? `${job.drive || ''} → ${(job.format || '').toUpperCase()}${job.quality ? ' ' + String(job.quality).toUpperCase() : ''}`.trim() : '';
  const jobCard = job ? h('div', { class: 'card rip-job ' + (job.status || ''), 'data-id': String(job.id) },
    h('div', { class: 'rip-job-h' }, h('b', null, jobStatusLabel(job)),
      h('span', { class: 'rip-job-h-r' },
        h('span', { class: 'dim small' }, fmtTag),
        canClear ? h('button', { type: 'button', class: 'btn sm rip-job-clear', 'aria-label': 'Clear job status', title: 'Clear this job from the status bar', onclick: () => act.onDismiss && act.onDismiss(job.id) }, 'Clear') : null)),
    h('div', { class: 'rip-prog', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(jobPercent(job)) },
      h('span', { style: `width:${jobPercent(job)}%` })),
    h('div', { class: 'small' }, jobLine(job) + (job.speed ? ` · ${Number(job.speed).toFixed(1)}×` : '')),
    job.error && job.error !== jobLine(job) ? h('div', { class: 'err small' }, job.error) : null,
    job.dest ? h('div', { class: 'mono small dim' }, job.dest) : null,
    isLiveJob(job) ? h('button', { type: 'button', class: 'btn sm', onclick: () => act.onCancel && act.onCancel(job.id) }, 'Cancel') : null)
    : null;

  const looking = !!(m.looking && ready === false && (m.drives || []).some(d => d.ready));
  const status = m.note ? h('p', { class: 'small dim rip-note' }, m.note)
    : (!ready ? h('p', { class: 'small dim rip-note' }, looking ? 'Looking up this disc…' : 'Insert an audio CD in the server PC’s drive. The page updates when a disc goes in or comes out.') : null);

  return h('div', { class: 'rip-page' },
    h('div', { class: 'rip-head' }, h('h2', { class: 'rip-title' }, 'CD ripper', infoBtn)),
    status,
    m.drivesNote ? h('p', { class: 'warnc small' }, m.drivesNote) : null,
    h('div', { class: 'rip-layout' },
      h('div', { class: 'card rip-disc' },
        h('div', { class: 'rip-disc-main' },
          coverEl,
          h('div', { class: 'rip-meta' },
            h('div', { class: 'field' }, h('label', null, 'Drive'), drive),
            matchPick ? h('div', { class: 'field' }, h('label', null, 'Matching album'), matchPick) : null,
            h('div', { class: 'field' }, h('label', null, 'Artist'), artist),
            h('div', { class: 'field' }, h('label', null, 'Album'), album),
            h('div', { class: 'rip-meta-row' },
              h('div', { class: 'field' }, h('label', null, 'Year'), year),
              h('div', { class: 'field' }, h('label', null, 'Format'), format),
              fmt === 'mp3' ? h('div', { class: 'field rip-qual' }, h('label', null, 'MP3 quality'), quality) : null)))),
      h('div', { class: 'card rip-trackcard' },
        h('h3', { class: 'rip-track-h' }, 'Tracks'),
        trackRows,
        h('div', { class: 'rip-actions' }, startBtn, retryBtn, cancelBtn))),
    h('div', { class: 'rip-jobs' },
      jobCard,
      (m.jobs || []).filter(j => !job || j.id !== job.id).length
        ? h('div', { class: 'rip-recent' }, h('h3', null, 'Recent jobs'), (m.jobs || []).filter(j => !job || j.id !== job.id).slice(0, 8).map(j =>
          h('div', { class: 'card rip-job past ' + (j.status || '') }, h('b', null, `#${j.id} ${jobStatusLabel(j)}`), h('div', { class: 'small dim' }, `${j.drive || ''} → ${(j.format || '').toUpperCase()} · ${jobPercent(j)}%`), j.error ? h('div', { class: 'err small' }, j.error) : null, j.dest ? h('div', { class: 'mono small' }, j.dest) : null,
            isLiveJob(j) ? h('button', { type: 'button', class: 'btn sm', onclick: () => act.onCancel && act.onCancel(j.id) }, 'Cancel') : null)))
        : null));
}

export function ripView(S) {
  const root = h('div', { class: 'rip-page' });
  const state = {
    admin: S.auth.role === 'admin',
    drives: [], formats: [], qualities: [], format: 'flac', quality: 'v0',
    drive: '', artist: '', album: '', year: '', cover: null, coverMbid: null,
    tracks: [], matches: [], matchId: null, disc: null, job: null, jobs: [], note: '', looking: false,
    followJobId: null, dismissedJobIds: new Set()
  };
  let dirty = false, poll = 0, looking = false;

  const applyMatch = m => {
    if (!m) return;
    state.matchId = m.id;
    state.artist = m.artist || state.artist;
    state.album = m.album || state.album;
    state.year = m.year || state.year;
    state.cover = m.cover || null;
    state.coverMbid = m.id || null;
    if (Array.isArray(m.tracks) && m.tracks.length) state.tracks = m.tracks.map(t => ({ ...t, selected: t.selected !== false }));
  };

  const acts = {
    onDrive: v => { state.drive = v; dirty = false; loadDisc(); },
    onFormat: v => { state.format = v; paint(); },
    onQuality: v => { state.quality = v; },
    onArtist: v => { state.artist = v; dirty = true; },
    onAlbum: v => { state.album = v; dirty = true; },
    onYear: v => { state.year = v; dirty = true; },
    onMatch: id => { const m = state.matches.find(x => x.id === id); if (m) { applyMatch(m); paint(); } },
    onTrackTitle: (i, v) => { if (state.tracks[i]) { state.tracks[i].title = v; dirty = true; } },
    onTrackSel: (i, on) => { if (state.tracks[i]) state.tracks[i].selected = on; paint(); },
    onStart: async body => {
      try {
        const r = await api('/rip/start', { method: 'POST', body });
        if (r && r.id != null) state.followJobId = r.id;
        // else paint() in loadJobs follows the live job
        toast('Rip started');
        await loadJobs();
      }
      catch (e) { toast(e.message, true); }
    },
    onRetry: () => { dirty = false; loadDisc(true); },
    onCancel: async id => {
      const cur = (state.jobs || []).find(j => j.id === id);
      if (cur && isLiveJob(cur)) {
        cur.status = 'cancelled';
        cur.detail = 'Cancelled';
        cur.error = cur.error || 'Cancelled.';
        state.followJobId = cur.id;
        paint();
      }
      try { await api(`/rip/jobs/${id}/cancel`, { method: 'POST', body: {} }); toast('Cancelled'); await loadJobs(); }
      catch (e) { toast(e.message, true); await loadJobs(); }
    },
    onDismiss: id => {
      if (id == null) return;
      state.dismissedJobIds.add(id);
      state.dismissedJobIds.add(String(id));
      if (String(state.followJobId) === String(id)) state.followJobId = null;
      paint();
    }
  };

  function paint() {
    const live = (state.jobs || []).find(isLiveJob);
    if (live) state.followJobId = live.id;
    state.job = featuredJob(state.jobs, { followId: state.followJobId, dismissedIds: state.dismissedJobIds });
    root.replaceChildren(ripPage(state, acts));
  }

  async function loadJobs() {
    try { state.jobs = await api('/rip/jobs') || []; } catch { /* leave last */ }
    const live = (state.jobs || []).some(j => isLiveJob(j));
    if (live && !poll) poll = setInterval(() => { if (root.isConnected) loadJobs(); }, 1000);
    if (!live && poll) { clearInterval(poll); poll = 0; }
    paint();
  }

  async function loadDisc(force) {
    if (looking) return;
    looking = true; state.looking = true; paint();
    try {
      const q = [];
      if (state.drive) q.push('drive=' + encodeURIComponent(state.drive));
      if (force) q.push('refresh=true');
      const d = await api('/rip/disc' + (q.length ? '?' + q.join('&') : ''));
      const wasReady = !!(state.disc && state.disc.ready);
      state.disc = d;
      state.drive = d.drive || state.drive;
      state.note = d.note || '';
      state.matches = d.matches || [];
      // A newly ready disc (or a disc after none) must not keep an old failed/cancelled job as the current status.
      if (d.ready && !wasReady && !(state.jobs || []).some(isLiveJob)) state.followJobId = null;
      if (!dirty) {
        if (d.ready && state.matches[0]) applyMatch(state.matches[0]);
        else if (d.ready) {
          state.artist = d.artist || state.artist;
          state.album = d.album || state.album;
          state.year = d.year || state.year;
          state.tracks = (d.tracks || []).map(t => ({ ...t, selected: t.selected !== false }));
          state.cover = d.cover || null;
        } else {
          state.tracks = []; state.matches = []; state.cover = null; state.coverMbid = null;
          if (!dirty) { state.artist = ''; state.album = ''; state.year = ''; }
        }
      } else if (!d.ready) {
        /* disc ejected mid-edit: clear only if not ripping */
        if (!state.jobs.some(j => isLiveJob(j))) {
          dirty = false; state.tracks = []; state.matches = []; state.cover = null; state.artist = ''; state.album = ''; state.year = '';
        }
      }
    } catch (e) { state.note = e.message; }
    finally { looking = false; state.looking = false; paint(); }
  }

  async function draw() {
    if (S.auth.role !== 'admin') { state.admin = false; paint(); return; }
    state.admin = true;
    try {
      const [drives, formats, jobs] = await Promise.all([api('/rip/drives'), api('/rip/formats'), api('/rip/jobs')]);
      state.drives = drives.drives || [];
      state.drivesNote = drives.note || '';
      state.formats = formats.formats || [];
      state.qualities = formats.qualities || [];
      if (!state.format) state.format = formats.defaultFormat || 'flac';
      if (!state.quality) state.quality = formats.defaultQuality || 'v0';
      state.jobs = jobs || [];
      if (!state.drive) {
        const ready = state.drives.find(d => d.ready);
        state.drive = (ready || state.drives[0] || {}).letter || '';
      }
    } catch (e) { root.replaceChildren(h('p', { class: 'err' }, e.message)); return; }
    paint();
    await loadDisc();
    await loadJobs();
  }

  const onRip = ev => {
    const d = ev.detail || {};
    if (d.disc === 'inserted' || d.disc === 'changed') {
      if (!(state.jobs || []).some(isLiveJob)) state.followJobId = null;
      dirty = false; loadDisc();
    }
    else if (d.disc === 'ejected') {
      const live = (state.jobs || []).some(j => isLiveJob(j));
      if (!live) { dirty = false; state.disc = { ready: false }; state.tracks = []; state.matches = []; state.cover = null; state.artist = ''; state.album = ''; state.year = ''; state.note = ''; paint(); }
    }
    if (d.job) loadJobs();
  };
  if (typeof window !== 'undefined') window.addEventListener('wavwiz:rip', onRip);
  draw();
  return { el: root, reload: draw, destroy: () => { clearInterval(poll); if (typeof window !== 'undefined') window.removeEventListener('wavwiz:rip', onRip); } };
}

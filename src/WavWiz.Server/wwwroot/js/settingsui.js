// WavWiz 0.3.0 §7: Settings polish helpers - inline "Saved ✓", "Learn more", Admin tags, Reset this section, the header search, friendly role
// names, Backup and restore, the Calibration sub-tab extras and the Jukebox tab.
import { h, api, toast, dialog, ask } from './util.js';
import { adminOnly } from './ui.js';
import { jbPreview } from './jukebox-preview.js';

export const THEME_RESET_KEYS = ['wavwiz.theme.v1', 'wavwiz.viz.v1', 'wavwiz.npstyle.v1', 'wavwiz.eqstyle.v1', 'wavwiz.uiscale', 'wavwiz.appsub'];
export const ROLE_NAMES = [['view', 'View', 'can browse and see what plays'], ['control', 'Control', 'can play, pause and change volume'], ['admin', 'Admin', 'can change every setting']];

/** §7.4: "Saved ✓" right beside the changed control, fading after ~1.5 s. */
export function savedMark(el) {
  if (!el || !el.isConnected || el === document.body) return;
  const host = el.closest('label,.row,.setrow,.field') || el.parentElement; if (!host) return;
  host.querySelector(':scope > .savedok')?.remove();
  const m = h('span', { class: 'savedok', role: 'status', 'aria-live': 'polite' }, 'Saved ✓'); host.append(m);
  setTimeout(() => m.classList.add('fade'), 1100); setTimeout(() => m.remove(), 1600);
}
/** §7.7: one or two lines of help, the detail behind "Learn more". */
/** 0.3.2 F16: one dim line; the long help sits behind an (i) button (tooltip + click to show it in place, still found by Search). */
export const learn = (short, long) => {
  const more = long ? h('p', { class: 'dim small learnmore', hidden: true }, long) : null;
  const i = long ? h('button', { type: 'button', class: 'infoi', title: long, 'aria-label': 'More about this', 'aria-expanded': 'false', onclick: () => { more.hidden = !more.hidden; i.setAttribute('aria-expanded', String(!more.hidden)); } }, 'i') : null;
  return h('div', { class: 'help' }, h('p', { class: 'dim small' }, short, i ? ' ' : null, i), more);
};
/** §7.5: admin options are shown disabled with this tag for everyone else - never hidden. */
export const adminTag = () => h('span', { class: 'tag admintag', title: 'Only an administrator can change this.' }, 'Admin');

/** §7.6: "Reset this section" - same style and position on every section, with a confirm. */
export function resetBar(S, label, { admin, server = {}, local = null, done } = {}) {
  const keys = Object.keys(server || {}); const serverOnly = keys.length > 0 && !local;
  if (!keys.length && !local && label !== 'Jukebox') return h('div', { class: 'secbar empty' });   // 0.3.5: sections with nothing to reset (Access, Diagnostics, About)
  // 0.3.5 J9 #15: resets at once, with Undo (no confirm popup)
  const b = h('button', { class: 'btn sm resetsec', type: 'button', onclick: async () => {
    try {
      const keep = {}; if (local) for (const k of local) try { keep[k] = localStorage.getItem(k); } catch { /* private mode */ }
      let before = null; try { before = keys.length ? await api('/settings') : null; } catch { /* no undo for server keys */ }
      let jbBefore = null; if (label === 'Jukebox') try { jbBefore = await api('/jukebox/config'); } catch { /* none */ }
      if (local) for (const k of local) try { localStorage.removeItem(k); } catch { /* private mode */ }
      const body = {}; for (const k of keys) if (server[k] !== null) body[k] = server[k];
      if (Object.keys(body).length) await api('/settings', { method: 'PUT', body });
      if (label === 'Jukebox') await api('/jukebox/config', { method: 'PUT', body: { reset: true } });
      undoToast(`${label} options are back to their defaults.`, async () => {
        if (local) for (const [k, v] of Object.entries(keep)) try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ }
        if (before) { const back = {}; for (const k of Object.keys(body)) if (k in before) back[k] = before[k]; if (Object.keys(back).length) await api('/settings', { method: 'PUT', body: back }); }
        if (jbBefore) { const { hasPin, ...cfg } = jbBefore; void hasPin; await api('/jukebox/config', { method: 'PUT', body: cfg }).catch(() => {}); }
        done?.();
      });
      done?.();
    } catch (e) { toast('Could not reset. ' + e.message, true); }
  } }, 'Reset this section');
  if (serverOnly || label === 'Jukebox') adminOnly(S, b, admin);
  return h('div', { class: 'secbar' }, h('span', { class: 'grow' }), b);
}
/** 0.3.5 J9: a toast with an Undo button (replaces "are you sure" popups for things that are easy to put back). */
export function undoToast(text, undo, ms = 8000) {
  document.querySelector('.undotoast')?.remove();
  const t = h('div', { class: 'undotoast', role: 'status' }, h('span', null, text), h('button', { class: 'btn sm', type: 'button', onclick: async () => { t.remove(); try { await undo(); } catch (e) { toast(e.message, true); } } }, 'Undo'));
  document.body.append(t); setTimeout(() => t.remove(), ms); return t;
}

/** §7.3: search in the Settings header - filters / jumps to matching options across tabs and sub-tabs and highlights the hit. */
export function settingsSearch(body, { show, showSub }) {
  const input = h('input', { type: 'search', class: 'setsearch', placeholder: 'Search settings', 'aria-label': 'Search settings' });
  const out = h('span', { class: 'small dim setsearch-n', 'aria-live': 'polite' });
  let idx = [];
  const reindex = () => { idx = [...body.querySelectorAll('.settings-sec .card, .settings-sec .appsec, .settings-sec details.advanced')].map(el => ({ el, g: el.closest('.settings-sec')?.dataset.g, sub: el.closest('.devsubsec')?.dataset.sub, text: el.textContent.toLowerCase() })); };
  const run = jump => {
    body.querySelectorAll('.sethit').forEach(x => x.classList.remove('sethit'));
    const q = input.value.trim().toLowerCase(); if (q.length < 2) { out.textContent = ''; return; }
    if (!idx.length) reindex();
    const hits = idx.filter(x => q.split(/\s+/).every(w => x.text.includes(w)));
    out.textContent = hits.length ? `${hits.length} found` : 'Nothing found';
    hits.forEach(x => x.el.classList.add('sethit'));
    if (hits[0] && jump !== false) { show(hits[0].g); if (hits[0].sub) showSub(hits[0].sub); const d = hits[0].el.closest('details'); if (d) d.open = true; requestAnimationFrame(() => hits[0].el.scrollIntoView({ block: 'center', behavior: 'smooth' })); }
  };
  input.addEventListener('input', () => run(true)); input.addEventListener('keydown', ev => { if (ev.key === 'Enter') run(true); });
  return { el: h('span', { class: 'row setsearch-w' }, input, out), reindex, run };
}

/** §7.1: Settings > General > Backup. Export one file; Import shows what will change, then asks. Admin only. */
export function backupCard(S, { admin, done } = {}) {
  const file = h('input', { type: 'file', accept: '.wavwizbackup', hidden: true });
  const info = h('div', { class: 'small', 'aria-live': 'polite' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0]; file.value = ''; if (!f) return; const raw = await f.arrayBuffer();
    let pv; try { pv = await api('/backup/preview', { method: 'POST', raw }); } catch (e) { info.textContent = 'This file can’t be used. ' + e.message; return; }
    const rows = h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['', 'Now', 'In the file'].map(t => h('th', null, t)))), h('tbody', null, pv.sections.map(x => h('tr', null, h('td', null, x.label), h('td', null, String(x.current)), h('td', null, String(x.incoming))))));
    dialog('Import a backup', [h('p', null, `Backup from WavWiz ${pv.appVersion || '?'}${pv.createdAt ? ', ' + new Date(pv.createdAt).toLocaleString() : ''}. These parts are replaced:`), rows,
      pv.songsNotInLibrary ? h('p', { class: 'warn-t small' }, `${pv.songsNotInLibrary} playlist song(s) are not in this library yet. Add the music folders and let the scan finish, then import again to keep them.`) : null,
      h('p', { class: 'small dim' }, 'Passwords, certificates and paired devices are never in a backup, so you keep the ones on this server.')],
      [{ text: 'Import', cls: 'primary', onclick: async () => { try { const r = await api('/backup/import', { method: 'POST', raw }); info.textContent = `Imported. ${r.songsNotInLibrary ? r.songsNotInLibrary + ' song(s) skipped.' : ''}`; done?.(); } catch (e) { toast('Import failed. ' + e.message, true); return false; } } }, { text: 'Cancel' }]);
  });
  return h('div', { class: 'card', id: 'sec-backup' }, h('h3', null, 'Backup ', admin ? null : adminTag()),
    learn('Save your settings, playlists, scenes, schedules, alarms, EQ presets and device names and delays in one file.', 'The file never holds passwords, certificates, private keys or paired-device tokens. The Jukebox PIN is kept only as a hash. Import shows what will change before anything is replaced.'),
    h('div', { class: 'row wrap' }, adminOnly(S, h('a', { class: 'btn primary', href: '/api/v1/backup', download: '', role: 'button', 'aria-disabled': String(!admin), onclick: ev => { if (!admin) ev.preventDefault(); } }, 'Export backup…'), admin),
      adminOnly(S, h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, 'Import backup…'), admin), file), info);
}

/** §7.2: Calibration sub-tab - mic choice, test level and a Calibrate button, plain labels. */
export function calibrationExtras(S, settings, { admin, put, go }) {
  const mic = settings['calibration.micDefault'] || 'pc';
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Microphone' }, [['pc', 'This PC’s microphone (recommended)'], ['phone', 'A phone'], ['ear', 'By ear']].map(([v, t]) =>
    adminOnly(S, h('button', { type: 'button', role: 'radio', 'aria-checked': String(mic === v), class: mic === v ? 'on' : '', onclick: ev => { seg.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b === ev.currentTarget); b.setAttribute('aria-checked', String(b === ev.currentTarget)); }); put({ 'calibration.micDefault': v }, ev.currentTarget); } }, t), admin)));
  const lv = Number.isFinite(settings['calibration.testLevelDb']) ? settings['calibration.testLevelDb'] : -20;
  const lvOut = h('span', { class: 'mono' }, `${lv} dB`);
  const lvR = adminOnly(S, h('input', { type: 'range', min: -40, max: -6, step: 1, 'data-coarse': 5, value: lv, class: 'grow', 'aria-label': 'Test sound level', oninput: ev => { lvOut.textContent = `${ev.target.value} dB`; }, onchange: ev => put({ 'calibration.testLevelDb': +ev.target.value }, ev.target) }), admin);
  return [h('div', { class: 'card', id: 'sec-calibration' }, h('h3', null, 'Calibration ', admin ? null : adminTag()),
    learn('Lines up the delay of every speaker so they play in sync.', 'A USB or built-in microphone on a PC is the most exact and works without HTTPS. A phone needs the one-time HTTPS set-up below. By ear needs no microphone.'),
    h('div', { class: 'field' }, h('label', null, 'Microphone to start with'), seg),
    h('div', { class: 'field' }, h('label', null, 'Test sound level'), h('div', { class: 'row' }, lvR, lvOut)),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', disabled: S?.auth?.role === 'view', onclick: () => go('calibrate') }, 'Calibrate speakers…')))];
}

// ---------------------------------------------------------------- §1.7 Jukebox tab (admin)
export const JB_DEFAULTS = { style: 'modern', folders: [], playlists: [], perGuest: 3, voteSkip: true, votesNeeded: 3, explicitFilter: false, artistCooldownMin: 0, autofill: { kind: 'playlist', id: null, genre: '' }, beat: 50, cdSound: false, hasPin: false };
export function jukeboxPane(S, settings, { admin }) {
  const box = h('div', { class: 'jbset' });
  let cfg = { ...JB_DEFAULTS }, roots = [], playlists = [];
  const save = async (patch, el) => { cfg = { ...cfg, ...patch }; try { await api('/jukebox/config', { method: 'PUT', body: patch }); savedMark(el); paintPreview(); } catch (e) { toast('Not saved. ' + e.message, true); } };
  // 0.3.4 H4b: one preview card per style (true layout, scaled); picking a card switches the style
  const cards = h('div', { class: 'jbcards', role: 'radiogroup', 'aria-label': 'Display style' });
  function paintPreview() { cards.querySelectorAll('.jbcard').forEach(c => { const on = c.dataset.style === cfg.style; c.classList.toggle('on', on); c.setAttribute('aria-checked', String(on)); }); }
  async function load() {
    try { [cfg, roots, playlists] = await Promise.all([api('/jukebox/config'), api('/library/roots').catch(() => []), api('/playlists').catch(() => [])]); cfg = { ...JB_DEFAULTS, ...cfg }; } catch (e) { box.replaceChildren(h('p', { class: 'err' }, 'Jukebox settings could not be loaded. ', h('button', { class: 'btn sm', onclick: load }, 'Retry'))); return; }
    const A = el => adminOnly(S, el, admin);
    const card = (v, t, sub) => A(h('button', { type: 'button', role: 'radio', class: 'jbcard' + (cfg.style === v ? ' on' : ''), 'data-style': v, 'aria-checked': String(cfg.style === v), 'aria-label': `${t} style`, onclick: ev => { if (cfg.style !== v) save({ style: v }, ev.currentTarget); } },
      jbPreview(v), h('span', { class: 'jbcard-l' }, h('span', { class: 'jbradio', 'aria-hidden': 'true' }), h('span', { class: 'grow' }, h('b', null, t), h('small', null, sub)), h('span', { class: 'jbcard-live' }, 'LIVE PREVIEW'))));
    const num = (k, min, max, l) => A(h('input', { type: 'number', min, max, value: cfg[k], style: 'width:80px', 'aria-label': l, onchange: ev => save({ [k]: Math.max(min, Math.min(max, +ev.target.value || min)) }, ev.target) }));
    const tog = (k, l) => h('label', { class: 'row' }, h('span', { class: 'switch' }, A(h('input', { type: 'checkbox', role: 'switch', checked: !!cfg[k], 'aria-label': l, onchange: ev => save({ [k]: ev.target.checked }, ev.target) })), h('span', { 'aria-hidden': 'true' })), l);
    const multi = (list, key, label, val, txt) => h('div', { class: 'jbsrc', role: 'group', 'aria-label': label }, list.length ? list.map(x => h('label', { class: 'row small' }, A(h('input', { type: 'checkbox', checked: (cfg[key] || []).includes(val(x)), onchange: ev => { const set = new Set(cfg[key] || []); ev.target.checked ? set.add(val(x)) : set.delete(val(x)); save({ [key]: [...set] }, ev.target); } })), txt(x))) : h('span', { class: 'small dim' }, 'None yet.'));
    const pin = A(h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'new-password', maxlength: 8, placeholder: cfg.hasPin ? '•••• (set)' : '4-8 digits', 'aria-label': 'Host PIN', style: 'width:120px' }));
    const fillSel = A(h('select', { 'aria-label': 'Auto-fill from', onchange: ev => save({ autofill: { ...cfg.autofill, kind: 'playlist', id: +ev.target.value || null } }, ev.target) }, h('option', { value: '' }, 'Off'), playlists.map(p => h('option', { value: p.id, selected: cfg.autofill?.id === p.id }, p.name))));
    box.replaceChildren(
      h('div', { class: 'card jbstyle', id: 'sec-jbstyle' }, h('h3', null, 'Display style ', admin ? null : adminTag()), h('p', { class: 'small dim' }, 'How the guest TV screen looks. Guests’ phones follow the same style.'),
        (cards.replaceChildren(card('modern', 'Modern (default)', 'Clean, follows your theme'), card('retro', 'Retro CD', 'Chrome-and-neon CD jukebox')), cards),
        h('p', { class: 'small dim jbcards-hint' }, 'Click a card to switch · example data'),
        h('div', { class: 'jbretro-opts' }, h('div', { class: 'jbsub' }, 'RETRO CD OPTIONS'),
          h('div', { class: 'setrow' }, h('div', { class: 'grow' }, h('div', null, 'Bubble light pulse'), h('div', { class: 'small dim' }, 'Lights pulse with the beat. 50% default, 100% max.')),
            (() => { const out = h('span', { class: 'jbbeatv' }, (cfg.beat ?? 50) + '%'); return [A(h('input', { type: 'range', min: 0, max: 100, step: 1, value: cfg.beat ?? 50, class: 'jbbeat', 'aria-label': 'Bubble light pulse', oninput: ev => { out.textContent = ev.target.value + '%'; }, onchange: ev => save({ beat: +ev.target.value }, ev.target) })), out]; })()),
          h('div', { class: 'setrow' }, h('div', { class: 'grow' }, h('div', null, 'CD-changer sound'), h('div', { class: 'small dim' }, 'A soft click and whirr between songs. Off by default.')), h('span', { class: 'switch' }, A(h('input', { type: 'checkbox', role: 'switch', checked: !!cfg.cdSound, 'aria-label': 'CD-changer sound', onchange: ev => save({ cdSound: ev.target.checked }, ev.target) })), h('span', { 'aria-hidden': 'true' })))),
        h('p', { class: 'small dim' }, 'The big screen and the guest page use this style and your theme colors.')),
      h('div', { class: 'card', id: 'sec-jbsources' }, h('h3', null, 'Allowed music ', admin ? null : adminTag()), learn('Guests can only search and add songs from these folders and playlists. Nothing ticked means the whole library.'),
        h('div', { class: 'row wrap', style: 'align-items:flex-start;gap:20px' }, h('div', null, h('b', { class: 'small' }, 'Folders'), multi(roots, 'folders', 'Folders', r => r.path, r => r.path)), h('div', null, h('b', { class: 'small' }, 'Playlists'), multi(playlists, 'playlists', 'Playlists', p => p.id, p => p.name)))),
      h('div', { class: 'card', id: 'sec-jbrules' }, h('h3', null, 'Rules ', admin ? null : adminTag()),
        h('div', { class: 'setrow' }, h('div', { class: 'grow' }, 'Songs per guest in the queue'), num('perGuest', 1, 20, 'Songs per guest')),
        h('div', { class: 'setrow' }, h('div', { class: 'grow' }, tog('voteSkip', 'Vote to skip')), h('span', { class: 'small dim' }, 'Votes needed '), num('votesNeeded', 1, 50, 'Votes needed to skip')),
        h('div', { class: 'setrow' }, tog('explicitFilter', 'Hide songs marked explicit')),
        h('div', { class: 'setrow' }, h('div', { class: 'grow' }, 'Same artist again after (minutes, 0 = off)'), num('artistCooldownMin', 0, 240, 'Artist cooldown')),
        h('div', { class: 'setrow' }, h('div', { class: 'grow' }, 'When the queue runs dry, play from'), fillSel)),
      h('div', { class: 'card', id: 'sec-jbpin' }, h('h3', null, 'Host PIN ', admin ? null : adminTag()), learn('Needed to leave the Jukebox screen.', 'Long-press the corner logo or press Ctrl+Shift+J, then type the PIN. For a fully locked PC also set up Windows Assigned Access (WavWiz can’t block Ctrl+Alt+Del or the Windows key).'),
        h('div', { class: 'row' }, pin, A(h('button', { class: 'btn', type: 'button', onclick: async ev => { if (!/^\d{4,8}$/.test(pin.value)) return toast('The PIN must be 4 to 8 digits.', true); await save({ pin: pin.value }, ev.currentTarget); pin.value = ''; pin.placeholder = '•••• (set)'; } }, 'Set PIN')))));
    paintPreview();
  }
  load(); return box;
}

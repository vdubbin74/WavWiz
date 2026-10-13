// WavWiz 0.3.0 §5: ONE "Scenes & Schedules" window (replaces the separate Scenes and Schedules pages). Same dialog shell and size as Settings
// (up to 1200 px); a full-screen sheet on phones (< 900 px). Roles: View = read-only with disabled buttons + ADMIN tag; Control = Run scenes,
// Run now / Skip next / Snooze / Stop; Admin = everything. The UI checks isAdmin before offering edit actions (the API requires Admin for them).
import { h, api, toast, dialog, ask } from './util.js';
import { canControl, isAdmin, adminOnly } from './ui.js';

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const ACTIONS = [['play', 'Play something'], ['scene', 'Apply a scene'], ['volumes', 'Set volumes'], ['stop', 'Stop playback'], ['all_off', 'All off']];
export const LABELS = { play: 'Play something', play_radio: 'Play radio', scene: 'Apply a scene', volumes: 'Set volumes', stop: 'Stop playback', all_off: 'All off' };
export const SLEEP = [['off', 'Off'], [15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '60 min'], [90, '90 min'], ['song', 'End of song'], ['album', 'End of album'], ['custom', 'Custom…']];
const SEG_KEY = 'wavwiz.ss.seg';
const phone = () => typeof window !== 'undefined' && window.innerWidth < 900;

/** "7:00 AM" or "07:00" depending on the locale (12/24 h follows the locale). */
export function fmtHm(hm, locale) {
  const [H, M] = String(hm || '0:0').split(':').map(Number); const d = new Date(2000, 0, 1, H, M);
  try { return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }); } catch { return hm; }
}
/** Save allowed? At least one day, or a once-only date. */
export const canSave = (days, onceDate) => !!onceDate || !!(days && days.length > 0);
/** Plain one-line summary of what a schedule does. */
export function summary(r, { scenes = [], stations = [], zones = [] } = {}) {
  const p = r.payload || {}; const sc = id => scenes.find(s => s.id === id)?.name; const st = id => stations.find(s => s.id === id)?.name;
  const where = p.sceneId ? ` · scene ${sc(p.sceneId) || '(deleted)'}` : (p.deviceIds || []).length ? ' · ' + p.deviceIds.map(id => zones.find(z => z.id === id)?.name || 'speaker').join(' + ') : '';
  switch (r.action) {
    case 'play': { const what = { playlist: 'playlist', album: 'album', track: 'song', radio: 'radio' }[p.source] || 'radio';
      return `Play ${what}: ${p.name || (p.source === 'radio' ? st(p.id) : '') || '…'}${where}${p.fadeMin ? ` · fade ${p.fadeMin} min` : ''}`; }
    case 'play_radio': return `Play radio: ${st(p.radioId) || '…'}${where}`;
    case 'scene': return `Apply scene: ${sc(p.sceneId) || '(deleted)'}`;
    case 'volumes': return `Set volumes on ${(p.devices || []).length} speaker(s)`;
    case 'stop': return 'Stop playback';
    case 'all_off': return 'All off · everything stops and speakers turn off';
  }
  return LABELS[r.action] || 'Schedule';
}
/** "Today 6:00 PM", "Tue 6:30 AM" relative to the server clock. */
export function whenLabel(iso, nowIso, locale) {
  if (!iso) return 'Paused';
  const d = new Date(iso), n = new Date(nowIso || Date.now()); const dd = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5);
  const day = dd === 0 ? 'Today' : dd === 1 ? 'Tomorrow' : DAYS[d.getDay()];
  return `${day} ${fmtHm(`${d.getHours()}:${d.getMinutes()}`, locale)}`;
}
export function countdown(iso, nowIso) {
  const ms = new Date(iso) - new Date(nowIso || Date.now()); if (!(ms > 0)) return 'now';
  const m = Math.round(ms / 60000), hh = Math.floor(m / 60); return hh ? `in ${hh} h ${m % 60} m` : `in ${m} m`;
}

function sw(on, label, onchange, disabled) {
  const i = h('input', { type: 'checkbox', role: 'switch', checked: on, 'aria-label': label, disabled, onchange });
  return h('label', { class: 'switch ss-sw' }, i, h('span', { 'aria-hidden': 'true' }));
}
function moreMenu(items) {
  const btn = h('button', { class: 'btn sm iconsq', type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'More', title: 'More' }, '⋯');
  btn.addEventListener('click', ev => {
    ev.stopPropagation(); document.querySelectorAll('.ss-menu').forEach(m => m.remove());
    const m = h('div', { class: 'ss-menu menu-pop', role: 'menu' }, items.filter(Boolean).map(([t, fn, dis]) => h('button', { role: 'menuitem', type: 'button', disabled: dis, onclick: () => { m.remove(); fn(); } }, t)));
    btn.after(m); const off = e => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } }; document.addEventListener('pointerdown', off, true);
    m.querySelector('button:not([disabled])')?.focus();
  });
  return btn;
}
const adminTag = () => h('span', { class: 'tag admintag', title: 'Only an administrator can change this.' }, 'ADMIN');

export function openScenesSchedules(S, refresh, { at } = {}) {
  const admin = isAdmin(S), ctlOk = canControl(S), locale = navigator.language;
  const body = h('div', { class: 'ss' });
  const clock = h('span', { class: 'small dim ss-clock' }, 'Server clock…');
  const sleepBtn = h('button', { class: 'btn sm', type: 'button', 'aria-haspopup': 'menu' }, '☾ Sleep timer: Off');
  const d = dialog('Scenes & Schedules', body, [{ text: 'Close' }], { cls: 'settings-dlg ss-dlg' + (phone() ? ' ss-phone' : ''), onClose: () => { clearInterval(iv); refresh?.(); } });
  d.el.querySelector('header .grow').after(clock, sleepBtn);
  let data = { scenes: [], rows: [], stations: [], playlists: [], now: null, sleep: null, active: null };
  const seg = { v: (() => { try { return localStorage.getItem(SEG_KEY) || 'scenes'; } catch { return 'scenes'; } })() };

  async function load() {
    try {
      const [scenes, rows, ck, sl, stations] = await Promise.all([api('/scenes'), api('/schedules'), api('/schedules/clock'), api('/sleep'), api('/radio').catch(() => [])]);
      data = { ...data, scenes, rows, now: ck.now, server: ck.server, sleep: sl, stations };
    } catch (e) { body.replaceChildren(h('p', { class: 'err' }, 'Scenes and schedules could not be loaded. ', h('button', { class: 'btn sm', onclick: load }, 'Retry'))); return; }
    draw();
  }
  function drawHead() {
    clock.textContent = `Times use the server PC’s clock (${data.server || 'server'}, ${data.now ? fmtHm(data.now.slice(11, 16), locale) : '—'})`;
    const s = data.sleep; sleepBtn.textContent = s && s.mode !== 'off' ? `☾ Sleep: ${Math.ceil(s.remainingSec / 60)} min` : '☾ Sleep timer: Off';
    if (!ctlOk) { sleepBtn.disabled = true; sleepBtn.title = 'View-only access.'; }
  }
  sleepBtn.addEventListener('click', () => openSleep(S, () => load()));

  function draw() {
    drawHead();
    const next = data.rows.find(r => r.enabled && r.nextRunAt);
    const nextStrip = next ? h('div', { class: 'ss-next' }, h('span', { 'aria-hidden': 'true' }, next.alarm ? '⏰' : '🗓'),
      h('div', { class: 'grow' }, h('b', null, 'Next up: '), `${next.name}, ${whenLabel(next.nextRunAt, data.now, locale)} (${countdown(next.nextRunAt, data.now)})`, h('div', { class: 'small dim' }, summary(next, data))),
      h('button', { class: 'btn sm', type: 'button', disabled: !ctlOk, onclick: () => skip(next) }, 'Skip next'),
      admin ? h('button', { class: 'btn sm', type: 'button', onclick: () => edit(next) }, 'Edit') : adminOnly(S, h('button', { class: 'btn sm', type: 'button' }, 'Edit'))) : null;
    const scenesCol = h('section', { class: 'ss-col', 'data-col': 'scenes', 'aria-label': 'Scenes' },
      h('div', { class: 'ss-ch' }, h('span', { class: 'ss-t' }, 'SCENES'), h('span', { class: 'dim' }, String(data.scenes.length)), h('span', { class: 'grow' }), admin ? null : adminTag(),
        adminOnly(S, h('button', { class: 'btn sm', type: 'button', onclick: capture }, '+ From current setup')), adminOnly(S, h('button', { class: 'btn sm', type: 'button', onclick: () => editScene(null) }, '+ New'))),
      data.scenes.length ? h('div', { class: 'ss-cards' }, data.scenes.map(sceneCard)) : h('p', { class: 'dim small' }, 'No scenes yet. A scene remembers which speakers are on and how loud they are.'));
    const schedCol = h('section', { class: 'ss-col', 'data-col': 'schedules', 'aria-label': 'Schedules and alarms' },
      h('div', { class: 'ss-ch' }, h('span', { class: 'ss-t' }, 'SCHEDULES & ALARMS'), h('span', { class: 'dim' }, String(data.rows.length)), h('span', { class: 'grow' }), admin ? null : adminTag(),
        adminOnly(S, h('button', { class: 'btn sm primary', type: 'button', onclick: () => edit(null, 'play') }, '+ Alarm')), adminOnly(S, h('button', { class: 'btn sm', type: 'button', onclick: () => edit(null, 'scene') }, '+ Schedule'))),
      data.rows.length ? h('div', { class: 'ss-rows' }, h('div', { class: 'ss-grp small dim' }, 'SORTED BY NEXT RUN'), data.rows.map(schedRow)) : h('p', { class: 'dim small' }, 'No schedules yet. Add an alarm to wake up to music, or a schedule to switch scenes.'),
      lastRun());
    const segBar = h('div', { class: 'seg ss-seg', role: 'tablist' }, [['scenes', `Scenes (${data.scenes.length})`], ['schedules', `Schedules & alarms (${data.rows.length})`]].map(([k, t]) =>
      h('button', { role: 'tab', type: 'button', 'aria-selected': String(seg.v === k), class: seg.v === k ? 'on' : '', onclick: () => { seg.v = k; try { localStorage.setItem(SEG_KEY, k); } catch { /* ok */ } draw(); } }, t)));
    const fab = admin ? h('button', { class: 'btn primary ss-fab', type: 'button', 'aria-label': 'Add', onclick: () => seg.v === 'scenes' ? fabMenu([['From current setup', capture], ['New scene', () => editScene(null)]]) : fabMenu([['Alarm', () => edit(null, 'play')], ['Schedule', () => edit(null, 'scene')]]) }, '+') : null;
    body.replaceChildren(nextStrip, segBar, h('div', { class: 'ss-cols', 'data-seg': seg.v }, scenesCol, schedCol), fab);
  }
  function fabMenu(items) { const m = h('div', { class: 'ss-menu ss-fabmenu', role: 'menu' }, items.map(([t, fn]) => h('button', { role: 'menuitem', type: 'button', onclick: () => { m.remove(); fn(); } }, t))); body.append(m); const off = e => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } }; setTimeout(() => document.addEventListener('pointerdown', off, true)); }
  function lastRun() {
    const last = data.rows.filter(r => r.lastRunAt).sort((a, b) => b.lastRunAt.localeCompare(a.lastRunAt))[0];
    return last ? h('div', { class: 'small dim ss-foot' }, `Last ran: ${last.name}, ${whenLabel(last.lastRunAt, data.now, locale)} · ${last.lastResult === 'OK' ? '✓' : (last.lastResult || '')}`) : null;
  }
  function sceneCard(sc) {
    const zones = S.zones || []; const on = (sc.members || []).filter(m => m.enabled); const vols = on.map(m => Math.round(m.volume));
    const used = data.rows.filter(r => r.payload?.sceneId === sc.id).length;
    return h('div', { class: 'card ss-card' + (sc.active ? ' on' : ''), 'data-scene': sc.id },
      h('div', { class: 'ss-n' }, h('span', { 'aria-hidden': 'true' }, sc.icon || '🎛'), h('b', null, sc.name), h('span', { class: 'grow' }), sc.active ? h('span', { class: 'tag c' }, 'ACTIVE') : null),
      h('div', { class: 'ss-dots', 'aria-label': `${on.length} of ${zones.length} speakers on` }, zones.map(z => h('i', { class: on.some(m => m.deviceId === z.id) ? '' : 'o', title: z.name }))),
      h('div', { class: 'small dim' }, `${on.length} speaker${on.length === 1 ? '' : 's'}${vols.length ? ' · ' + (Math.min(...vols) === Math.max(...vols) ? `${vols[0]}%` : `${Math.min(...vols)}–${Math.max(...vols)}%`) : ''}${used ? ` · used by ${used} schedule${used === 1 ? '' : 's'}` : ''}`),
      h('div', { class: 'row ss-a' }, h('button', { class: 'btn sm primary', type: 'button', disabled: !ctlOk, onclick: () => runScene(sc) }, 'Run'),
        adminOnly(S, h('button', { class: 'btn sm', type: 'button', onclick: () => editScene(sc) }, 'Edit')),
        moreMenu([['Update from current setup', () => captureInto(sc), !admin], ['Duplicate', () => dupScene(sc), !admin], ['Delete…', () => delScene(sc), !admin]])));
  }
  function schedRow(r) {
    const days = h('span', { class: 'ss-days', 'aria-label': r.onceDate ? 'Once' : 'Days: ' + [...r.days].map(x => DAYS[+x]).join(', ') }, r.onceDate ? h('b', null, 'Once ' + r.onceDate) : DAYS.map((t, i) => r.days.includes(String(i)) ? h('b', null, t[0]) : h('span', null, t[0])));
    const nxt = !r.enabled ? 'Paused' : r.skippedRunAt && r.skippedRunAt !== r.nextRunAt ? `Skipped ${whenLabel(r.skippedRunAt, data.now, locale).split(' ')[0]} · Next ${whenLabel(r.nextRunAt, data.now, locale)}` : r.nextRunAt ? 'Next: ' + whenLabel(r.nextRunAt, data.now, locale) : 'Done';
    return h('div', { class: 'ss-row' + (r.enabled ? '' : ' off'), 'data-sched': r.id },
      h('span', { class: 'ss-tm' }, fmtHm(r.time, locale)),
      h('div', { class: 'grow ss-mid' }, h('b', null, r.name), ' ', h('span', { class: 'tag' + (r.alarm ? ' al' : '') }, r.alarm ? 'ALARM' : 'SCHEDULE'), h('div', { class: 'small dim' }, summary(r, { ...data, zones: S.zones || [] }))),
      h('div', { class: 'ss-when' }, days, h('div', { class: 'small dim' }, nxt)),
      adminOnly(S, sw(r.enabled, `${r.name} on or off`, async ev => { try { await api(`/schedules/${r.id}`, { method: 'PUT', body: { enabled: ev.target.checked } }); load(); } catch (e) { ev.target.checked = !ev.target.checked; toast('Could not switch it. ' + e.message, true); } }).querySelector('input')).closest?.('label') || null,
      moreMenu([['Edit', () => edit(r), !admin], ['Run now', () => runNow(r), !ctlOk], [r.skippedRunAt && r.skippedRunAt !== r.nextRunAt ? 'Don’t skip' : 'Skip next', () => skip(r), !ctlOk || !r.enabled], ['Duplicate', () => dup(r), !admin], ['Delete…', () => del(r), !admin]]));
  }

  async function runScene(sc) { try { await api(`/scenes/${sc.id}/apply`, { method: 'POST' }); toast(`${sc.name} is on`); load(); refresh?.(); } catch (e) { toast('The scene could not run. ' + e.message, true); } }
  async function capture() { const n = h('input', { type: 'text', maxlength: 60, value: 'Party', 'aria-label': 'Scene name' });
    dialog('New scene from current setup', h('div', { class: 'field' }, h('label', null, 'Name'), n), [{ text: 'Save', cls: 'primary', onclick: async () => { try { await api('/scenes/capture', { method: 'POST', body: { name: n.value } }); load(); } catch (e) { toast(e.message, true); return false; } } }, { text: 'Cancel' }]); }
  async function captureInto(sc) { if (!(await ask('Update scene', `Replace “${sc.name}” with the speakers and volumes playing now?`, { ok: 'Update' }))) return; try { await api('/scenes/capture', { method: 'POST', body: { name: sc.name, id: sc.id } }); load(); } catch (e) { toast(e.message, true); } }
  async function dupScene(sc) { try { await api('/scenes', { method: 'POST', body: { name: (sc.name + ' copy').slice(0, 60), icon: sc.icon, members: sc.members } }); load(); } catch (e) { toast(e.message, true); } }
  async function delScene(sc) {
    if (!(await ask('Delete scene', `Delete the scene “${sc.name}”?`, { ok: 'Delete', danger: true }))) return;
    try { await api(`/scenes/${sc.id}`, { method: 'DELETE' }); load(); }
    catch (e) {
      if (e.status !== 409) return toast(e.message, true);
      if (await ask('Scene in use', `${e.message} Delete it anyway? Those schedules will stop applying a scene.`, { ok: 'Delete anyway', danger: true })) { try { await api(`/scenes/${sc.id}?force=true`, { method: 'DELETE' }); load(); } catch (e2) { toast(e2.message, true); } }
    }
  }
  function editScene(sc) {
    const name = h('input', { type: 'text', maxlength: 60, value: sc?.name || '', 'aria-label': 'Scene name' });
    const iconIn = h('input', { type: 'text', maxlength: 4, value: sc?.icon || '🎛', 'aria-label': 'Icon', style: 'width:56px' });
    const members = (S.zones || []).map(z => { const ex = (sc?.members || []).find(m => m.deviceId === z.id);
      const en = h('input', { type: 'checkbox', checked: ex ? ex.enabled : z.enabled, 'aria-label': `${z.name} on` });
      const out = h('span', { class: 'mono small', style: 'width:40px;text-align:right' }, `${Math.round(ex ? ex.volume : z.volume)}%`);
      const vol = h('input', { type: 'range', min: 0, max: 100, step: 1, 'data-coarse': 5, value: Math.round(ex ? ex.volume : z.volume), class: 'grow', 'aria-label': `${z.name} volume`, oninput: ev => { out.textContent = ev.target.value + '%'; } });
      return { z, en, vol, row: h('label', { class: 'row ss-mem' }, en, h('span', { style: 'width:130px' }, z.name), vol, out) }; });
    dialog(sc ? 'Edit scene' : 'New scene', [h('div', { class: 'row' }, h('div', { class: 'field grow' }, h('label', null, 'Name'), name), h('div', { class: 'field' }, h('label', null, 'Icon'), iconIn)), h('p', { class: 'small dim' }, 'Speakers and volumes (mouse wheel ±1, Shift ±5)'), members.map(m => m.row)],
      [{ text: 'Save', cls: 'primary', onclick: async () => { const b = { name: name.value, icon: iconIn.value, members: members.map(m => ({ deviceId: m.z.id, enabled: m.en.checked, volume: +m.vol.value })) };
        try { if (sc) await api(`/scenes/${sc.id}`, { method: 'PUT', body: b }); else await api('/scenes', { method: 'POST', body: b }); load(); } catch (e) { toast(e.message, true); return false; } } }, { text: 'Cancel' }]);
  }
  async function skip(r) { try { const x = await api(`/schedules/${r.id}/skip`, { method: 'POST' }); toast(x.skipped ? `Skipping the next “${r.name}”` : `“${r.name}” runs as usual`); load(); } catch (e) { toast(e.message, true); } }
  async function runNow(r) { try { await api(`/schedules/${r.id}/run`, { method: 'POST' }); toast(`Ran “${r.name}”`); load(); } catch (e) { toast(e.message, true); } }
  async function dup(r) { try { await api('/schedules', { method: 'POST', body: { name: (r.name + ' copy').slice(0, 60), time: r.time, days: r.days || '0123456', onceDate: r.onceDate || '', action: r.action, payload: r.payload, enabled: false } }); load(); } catch (e) { toast(e.message, true); } }
  async function del(r) { if (!(await ask('Delete', `Delete “${r.name}”?`, { ok: 'Delete', danger: true }))) return; try { await api(`/schedules/${r.id}`, { method: 'DELETE' }); load(); } catch (e) { toast(e.message, true); } }
  function edit(r, kind) { openScheduleEditor(S, r, kind, data, load); }

  const iv = setInterval(() => { if (d.el.isConnected) load(); }, 30000);
  const onWs = () => { if (d.el.isConnected) load(); };
  window.addEventListener('wavwiz:schedules', onWs); window.addEventListener('wavwiz:sleep', onWs);
  load(); if (at === 'alarm') setTimeout(() => edit(null, 'play'), 50);
  return d;
}

/** The single editor for alarms and schedules ("What should happen?"). */
export function openScheduleEditor(S, r, kind, data, done) {
  const p = r?.payload || {}; let action = r?.action === 'play_radio' ? 'play' : r?.action || kind || 'play';
  const name = h('input', { type: 'text', maxlength: 60, value: r?.name || (action === 'play' ? 'Wake up' : ''), 'aria-label': 'Name' });
  const time = h('input', { type: 'time', value: r?.time || '07:00', step: 60, 'aria-label': 'Time (server clock)' });
  time.addEventListener('wheel', ev => { ev.preventDefault(); const [H, M] = time.value.split(':').map(Number); let m = (H * 60 + M + (ev.deltaY < 0 ? 1 : -1) * (ev.shiftKey ? 15 : 1) + 1440) % 1440; time.value = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; preview(); }, { passive: false });
  let days = new Set((r?.days ?? (action === 'play' ? '12345' : '0123456')).split('').filter(Boolean)); let once = r?.onceDate || '';
  const onceIn = h('input', { type: 'date', value: once, 'aria-label': 'Date (once)', hidden: !once, oninput: () => { once = onceIn.value; sync(); } });
  const dayBtns = DAYS.map((t, i) => h('button', { type: 'button', class: 'ss-day', 'aria-pressed': 'false', 'aria-label': t, onclick: () => { once = ''; onceIn.hidden = true; days.has(String(i)) ? days.delete(String(i)) : days.add(String(i)); sync(); } }, t.slice(0, 2)));
  const short = (t, fn) => h('button', { type: 'button', class: 'btn sm', onclick: () => { fn(); sync(); } }, t);
  const hint = h('span', { class: 'small warn-t ss-hint', role: 'status' });
  const save = h('button', { class: 'btn primary', type: 'button' }, 'Save');
  const segA = h('div', { class: 'seg ss-what', role: 'radiogroup', 'aria-label': 'What should happen?' });
  const src = h('select', { 'aria-label': 'Source' }, [['playlist', 'Playlist'], ['album', 'Album'], ['track', 'Song'], ['radio', 'Radio']].map(([v, t]) => h('option', { value: v, selected: (p.source || (r?.action === 'play_radio' ? 'radio' : 'playlist')) === v }, t)));
  const pick = h('select', { 'aria-label': 'What to play' }); const pickQ = h('input', { type: 'search', placeholder: 'Search…', 'aria-label': 'Search what to play' });
  const sceneSel = h('select', { 'aria-label': 'Scene' }, h('option', { value: '' }, '—'), (data.scenes || []).map(x => h('option', { value: x.id, selected: (p.sceneId) === x.id }, x.name)));
  const onWhat = h('select', { 'aria-label': 'Play on' }, h('option', { value: 'speakers', selected: !p.sceneId }, 'Speakers'), h('option', { value: 'scene', selected: !!p.sceneId }, 'A scene'));
  const chosen = new Set(p.deviceIds || []);
  const chips = h('div', { class: 'row wrap ss-chips' }, (S.zones || []).map(z => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(chosen.has(z.id)), onclick: ev => { chosen.has(z.id) ? chosen.delete(z.id) : chosen.add(z.id); ev.currentTarget.setAttribute('aria-pressed', String(chosen.has(z.id))); preview(); } }, z.name)));
  const rng = (v, l) => h('input', { type: 'range', min: 0, max: 100, step: 1, 'data-coarse': 5, value: v, 'aria-label': l, oninput: () => preview() });
  const sv = rng(p.startVol ?? 10, 'Start volume'), ev2 = rng(p.endVol ?? 40, 'End volume');
  const fade = h('input', { type: 'range', min: 0, max: 30, step: 1, 'data-coarse': 5, value: p.fadeMin ?? 5, 'aria-label': 'Fade in over (minutes)', oninput: () => preview() });
  const fadeOut = h('span', { class: 'small mono' }, `${p.fadeMin ?? 5} min`); fade.addEventListener('input', () => { fadeOut.textContent = `${fade.value} min`; });
  const snooze = h('select', { 'aria-label': 'Snooze' }, [5, 9, 15].map(m => h('option', { value: m, selected: (p.snoozeMin ?? 9) === m }, `${m} min`)));
  const autoStop = h('select', { 'aria-label': 'Stop by itself' }, [[30, 'after 30 min'], [60, 'after 1 h'], [0, 'never']].map(([m, t]) => h('option', { value: m, selected: (p.autoStopMin ?? 30) === m }, t)));
  const vols = (S.zones || []).map(z => { const ex = (p.devices || []).find(x => x.deviceId === z.id); return { z, r: rng(Math.round(ex?.volume ?? z.volume), `${z.name} volume`) }; });
  const items = { playlist: [], album: [], track: [], radio: data.stations || [] };
  const sentence = h('p', { class: 'ss-sentence', 'aria-live': 'polite' });
  const fields = h('div', { class: 'ss-fields' });

  async function loadPick() {
    const s = src.value, q = pickQ.value.trim();
    try {
      if (s === 'playlist' && !items.playlist.length) items.playlist = (await api('/playlists')).map(x => ({ id: x.id, name: x.name }));
      if ((s === 'album' || s === 'track') && q.length >= 2) { const res = await api('/library/search?q=' + encodeURIComponent(q) + '&limit=40');
        const rows = Array.isArray(res) ? res : (res.tracks || []); const seen = new Map();
        for (const t of rows) { const ar = t.albumArtist || t.artist, k = `${ar}\u001f${t.album}`; if (t.album && !seen.has(k)) seen.set(k, { ref: k, name: `${t.album} · ${ar}` }); }
        items.album = [...seen.values()]; items.track = rows.map(t => ({ id: t.id, name: `${t.title} · ${t.artist}` })); }
    } catch { /* offline */ }
    const list = items[s] || []; const cur = p.source === s ? (p.id ?? p.ref) : null;
    pick.replaceChildren(list.length ? list.map(x => h('option', { value: x.ref ?? x.id, selected: String(x.ref ?? x.id) === String(cur) }, x.name)) : h('option', { value: '' }, s === 'album' || s === 'track' ? 'Type 2+ letters to search' : 'Nothing here yet'));
    if (!list.length && p.source === s && p.name) pick.replaceChildren(h('option', { value: p.id ?? p.ref, selected: true }, p.name));
    pickQ.hidden = !(s === 'album' || s === 'track'); preview();
  }
  src.addEventListener('change', loadPick); pickQ.addEventListener('input', () => { clearTimeout(pickQ._t); pickQ._t = setTimeout(loadPick, 250); }); pick.addEventListener('change', preview);

  const fld = (l, ...c) => h('div', { class: 'field' }, h('label', null, l), ...c);
  function drawFields() {
    segA.replaceChildren(ACTIONS.map(([k, t]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(action === k), class: action === k ? 'on' : '', onclick: () => { action = k; drawFields(); } }, t)));
    fields.replaceChildren(
      action === 'play' ? [fld('Source', h('div', { class: 'row' }, src, pickQ, pick)), fld('On', h('div', { class: 'row' }, onWhat, onWhat.value === 'scene' ? sceneSel : chips)),
        fld('Volume: start → end', h('div', { class: 'row' }, sv, h('span', null, '→'), ev2)), fld('Fade in over', h('div', { class: 'row' }, fade, fadeOut)),
        h('div', { class: 'row wrap' }, fld('Snooze', snooze), fld('Stop by itself', autoStop))] : null,
      action === 'scene' ? fld('Scene', sceneSel) : null,
      action === 'volumes' ? [h('p', { class: 'small dim' }, 'Mouse wheel ±1, Shift ±5'), vols.map(v => h('label', { class: 'row ss-mem' }, h('span', { style: 'width:130px' }, v.z.name), v.r))] : null);
    onWhat.onchange = drawFields; preview();
  }
  function sync() {
    dayBtns.forEach((b, i) => { const on = !once && days.has(String(i)); b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); });
    const ok = canSave([...days].join(''), once); save.disabled = !ok; hint.textContent = ok ? '' : 'Pick at least one day (or Once with a date).'; preview();
  }
  function payload() {
    if (action === 'play') { const opt = pick.selectedOptions[0]; const pl = { source: src.value, name: opt?.textContent || '', startVol: +sv.value, endVol: +ev2.value, fadeMin: +fade.value, snoozeMin: +snooze.value, autoStopMin: +autoStop.value };
      if (src.value === 'album') pl.ref = pick.value; else pl.id = +pick.value || undefined;
      if (onWhat.value === 'scene' && sceneSel.value) pl.sceneId = +sceneSel.value; else pl.deviceIds = [...chosen]; return pl; }
    if (action === 'scene') return { sceneId: +sceneSel.value || undefined };
    if (action === 'volumes') return { devices: vols.map(v => ({ deviceId: v.z.id, volume: +v.r.value })) };
    return {};
  }
  function preview() {
    const when = once ? `on ${once}` : days.size === 7 ? 'every day' : [...days].sort().join('') === '12345' ? 'on weekdays' : [...days].sort().join('') === '06' ? 'on weekends' : 'on ' + [...days].sort().map(x => DAYS[+x]).join(', ');
    sentence.textContent = `At ${fmtHm(time.value, navigator.language)} ${when}: ${summary({ action, payload: payload() }, { ...data, zones: S.zones || [] })}.`;
  }
  const testBtn = h('button', { class: 'btn sm', type: 'button', disabled: !r, title: r ? 'Runs it once now with a 10 s fade' : 'Save first, then Test now', onclick: async () => { try { await api(`/schedules/${r.id}/run?testFadeSec=10`, { method: 'POST' }); toast('Testing (10 s fade)…'); } catch (e) { toast(e.message, true); } } }, 'Test now');
  const form = h('div', { class: 'ss-editor' },
    fld('What should happen?', segA), fld('Name', name),
    h('div', { class: 'row wrap' }, fld('Time (server clock)', time), fld('Repeat', h('div', { class: 'row wrap' }, short('Weekdays', () => { once = ''; onceIn.hidden = true; days = new Set('12345'); }), short('Every day', () => { once = ''; onceIn.hidden = true; days = new Set('0123456'); }), short('Once', () => { onceIn.hidden = false; if (!onceIn.value) { const t = new Date(Date.now() + 864e5); onceIn.value = t.toISOString().slice(0, 10); } once = onceIn.value; }), onceIn))),
    h('div', { class: 'ss-daygrid', role: 'group', 'aria-label': 'Days' }, dayBtns), hint, fields, sentence);
  const dd = dialog(r ? (r.alarm ? 'Edit alarm' : 'Edit schedule') : action === 'play' ? 'New alarm' : 'New schedule', form, [], { cls: 'settings-dlg ss-dlg ss-edit' + (phone() ? ' ss-phone' : '') });
  dd.el.querySelector('header .grow').after(testBtn);
  const cancel = h('button', { class: 'btn', type: 'button', onclick: () => dd.close() }, 'Cancel');
  save.addEventListener('click', async () => {
    const b = { name: name.value, time: time.value, days: once ? '' : [...days].sort().join(''), onceDate: once || '', action, payload: payload() };
    try { if (r) await api(`/schedules/${r.id}`, { method: 'PUT', body: b }); else await api('/schedules', { method: 'POST', body: b }); dd.close(); done?.(); }
    catch (e) { hint.textContent = 'Not saved: ' + e.message; }
  });
  dd.el.append(h('footer', { class: 'ss-savebar' }, cancel, save));
  name.addEventListener('input', preview); time.addEventListener('input', preview);
  drawFields(); sync(); loadPick();
  return dd;
}

/** Sleep timer picker. 0.3.5 J8/J9 #7: a small menu of times under the Now Playing Sleep button (no window). */
export function openSleep(S, done, anchor = null) {
  document.querySelector('.sleepmenu')?.remove();
  anchor = anchor || document.querySelector('.npsleep:not([hidden])') || document.getElementById('sleepchip');
  const zones = S.zones || []; const zoneSel = h('select', { 'aria-label': 'Which speakers' }, h('option', { value: '' }, 'All speakers'), zones.map(z => h('option', { value: z.id }, z.name)));
  const custom = h('input', { type: 'number', min: 1, max: 1440, value: 20, 'aria-label': 'Minutes', style: 'width:72px', hidden: true, onkeydown: ev => { if (ev.key === 'Enter') set('custom'); } });
  const close = () => { menu.remove(); document.removeEventListener('pointerdown', out, true); document.removeEventListener('keydown', esc, true); };
  const out = ev => { if (!menu.contains(ev.target) && ev.target !== anchor && !anchor?.contains?.(ev.target)) close(); }, esc = ev => { if (ev.key === 'Escape') close(); };
  const set = async v => {
    const body = { zoneIds: zoneSel.value ? [+zoneSel.value] : [] };
    if (v === 'off' || v === 'song' || v === 'album') body.mode = v; else body.minutes = v === 'custom' ? +custom.value : v;
    try { const st = await api('/sleep', { method: 'POST', body }); close(); sleepChip(S, st); done?.(); } catch (e) { toast(e.message, true); }
  };
  const menu = h('div', { class: 'sleepmenu mpanel', role: 'menu', 'aria-label': 'Sleep timer' },
    h('div', { class: 'small dim sm-h' }, 'Sleep timer · fades out over the last 30 s'), zoneSel,
    ...SLEEP.map(([v, t]) => h('button', { type: 'button', role: 'menuitem', 'data-sleep': String(v), onclick: () => { if (v === 'custom' && custom.hidden) { custom.hidden = false; custom.focus(); return; } set(v); } }, t)), custom);
  document.body.append(menu);
  const z = Number(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1, r = anchor?.getBoundingClientRect?.(), mr = menu.getBoundingClientRect();
  const vw = innerWidth / z, vh = innerHeight / z;
  const x = r ? r.left / z : vw / 2 - mr.width / 2, y = r ? (r.top / z - mr.height - 6 > 4 ? r.top / z - mr.height - 6 : r.bottom / z + 6) : vh / 2 - mr.height / 2;
  menu.style.left = Math.max(4, Math.min(x, vw - mr.width - 4)) + 'px'; menu.style.top = Math.max(4, Math.min(y, vh - mr.height - 4)) + 'px';
  setTimeout(() => { document.addEventListener('pointerdown', out, true); document.addEventListener('keydown', esc, true); }, 0);
  return { el: menu, close };
}

/** Full-screen alarm takeover (every phone) / banner on Now Playing (desktop). Control and up can Snooze / Stop. */
let alarmEl = null;
export function showAlarm(S, a) {
  alarmEl?.remove(); alarmEl = null;
  if (!a || a.stopped || !a.ringing) return;
  const can = canControl(S), full = phone();
  const btn = (t, path, cls) => h('button', { class: 'btn ' + cls, type: 'button', disabled: !can, onclick: async () => { try { await api(path, { method: 'POST' }); alarmEl?.remove(); } catch (e) { toast(e.message, true); } } }, t);
  alarmEl = h('div', { class: full ? 'alarm-take' : 'alarm-banner', role: 'alertdialog', 'aria-label': 'Alarm' },
    h('div', { class: 'alarm-time' }, new Date().toLocaleTimeString(navigator.language, { hour: 'numeric', minute: '2-digit' })), h('div', { class: 'alarm-name' }, a.name),
    h('div', { class: 'alarm-fade small dim' }, `Fading in · ${Math.round((a.progress || 0) * 100)}%`),
    h('div', { class: 'alarm-btns' }, btn(`Snooze (${a.snoozeMin || 9} min)`, '/alarm/snooze', 'primary'), btn('Stop', '/alarm/stop', '')));
  document.body.append(alarmEl);
}

/** Small countdown chip on Now Playing while the sleep timer runs. */
export function sleepChip(S, st) {
  let c = document.getElementById('sleepchip');
  if ((!st || st.mode === 'off') && !document.querySelector('.npsleep')) { c?.remove(); return; }
  // 0.3.5 J8: the permanent Now Playing Sleep buttons show the countdown too
  document.querySelectorAll('.npsleep').forEach(b => { b.classList.toggle('on', !!st && st.mode !== 'off'); b._st = st; });
  if (!st || st.mode === 'off') { document.querySelectorAll('.npsleep').forEach(b => { clearInterval(b._iv); b.textContent = 'Sleep'; }); }
  else document.querySelectorAll('.npsleep').forEach(b => { const end = Date.now() + st.remainingSec * 1000; clearInterval(b._iv); const tick = () => { const s2 = Math.max(0, Math.round((end - Date.now()) / 1000)); b.textContent = st.mode === 'song' && !st.remainingSec ? 'Sleep: song' : s2 > 90 ? `Sleep ${Math.ceil(s2 / 60)} min` : `Sleep ${s2} s`; if (!s2) clearInterval(b._iv); }; tick(); b._iv = setInterval(tick, 1000); });
  if (document.querySelector('.npsleep')) { c?.remove(); return; }
  if (!c) { c = h('button', { id: 'sleepchip', class: 'chip sleepchip', type: 'button', onclick: () => openSleep(S) }); (document.querySelector('.np-title,.nowtop,#now') || document.body).append(c); }
  const end = Date.now() + st.remainingSec * 1000; c._end = end; c.textContent = `☾ ${Math.ceil(st.remainingSec / 60)} min`;
  clearInterval(c._iv); c._iv = setInterval(() => { const s = Math.max(0, Math.round((c._end - Date.now()) / 1000)); c.textContent = s > 90 ? `☾ ${Math.ceil(s / 60)} min` : `☾ ${s} s`; if (!s) clearInterval(c._iv); }, 1000);
}

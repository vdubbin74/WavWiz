import { h, api, toast, dialog } from './util.js';
import { isAdmin, thisDevice, ADMIN_HINT } from './ui.js';
import { isPhoneUa, isPlayerUa } from './phonejoin.js';
import { guideGroups, guideText, countdownOn, setCountdown, COUNTDOWN_S } from './calmic-core.js';

// Calibrate speakers (0.2.5: calibration that just works). One screen, three ways, in this order:
//   1. Use this PC's microphone - the WavWiz Player on a Windows PC records with its own microphone (WASAPI, no browser, no HTTPS, no prompt);
//      the SERVER runs the whole measurement (reference x3, each speaker x3, the reference again, retry on low confidence) and this page only
//      shows the mic picker (remembered), a live input level, the Bluetooth warning, the progress and the results with Save all.
//   2. Use your phone - a QR code opens the phone's mic-only page (/calmic.html): it never joins as a speaker or plays sound, asks for the
//      microphone first and measures from the listening spot. This page shows "Phone connected", the live progress and the results.
//   3. By ear - no microphone at all.
// 0.2.0 item 29: the server pauses the music for the whole session and resumes it when the session ENDS (finish, cancel or failure all call
// /calibration/sessions/{id}/end). 0.2.0 items 28 + 30: the house reference is pre-selected; a regular user calibrates only their own speaker.
export async function openCalibration(S, refresh, presetZoneId, opts = {}) {
  // a phone is a microphone, never the place that runs the wizard: it goes to the mic-only page (which makes its own link when signed in)
  if (isPhoneUa() && !isPlayerUa()) { location.href = '/calmic.html'; return; }
  const zones = S.zones.filter(z => z.connected && z.outputs.some(o => o.active));
  const body = h('div', { class: 'calx' }); let sessionId = null, phoneCard = null, pcCard = null, runView = null;
  const endSession = () => { const id = sessionId; sessionId = null; if (id) api(`/calibration/sessions/${id}/end`, { method: 'POST' }).then(r => { if (r?.resumed) toast('Calibration ended - the music is playing again'); }).catch(() => {}); };
  const cleanup = () => { runView?.stop(); runView = null; pcCard?.stop(); phoneCard?.stop(); endSession(); };
  const d = dialog('Calibrate speakers', body, [], { onClose: () => { cleanup(); opts.onClose?.(); refresh && refresh(); } });
  if (zones.length < 2) { body.replaceChildren(h('p', null, 'You need at least two connected speakers: one is the reference (the one you leave alone) and the others are measured against it.'), h('p', { class: 'dim' }, 'You can still type a delay by hand: open a speaker’s Settings and use Delay.')); return; }

  const admin = isAdmin(S) || !!opts.linkAdmin, house = S.zones.find(z => z.reference) || null, mine = thisDevice(S);
  const hold = !!(house && !house.connected);
  if (hold) {
    body.replaceChildren(h('div', { class: 'card', role: 'alert' }, h('h3', { class: 'amber' }, `The reference speaker “${house.name}” is offline`),
      h('p', null, 'Calibration measures every speaker against the house reference speaker, so it must be on and connected.'),
      h('p', { class: 'small' }, admin ? 'Turn it on, or pick another reference: Devices > Expanded > Settings > More > Set as reference.' : 'Turn it on, or ask an administrator to pick another reference.'),
      admin ? h('div', { class: 'field' }, h('label', null, 'Use another reference for this calibration'), h('select', { onchange: ev => { st.ref = +ev.target.value; st.sel.delete(st.ref); intro(); } }, h('option', { value: '' }, 'Pick a speaker…'), zones.map(z => h('option', { value: z.id }, z.name)))) : null));
  }
  if (hold && !admin) return;
  if (!admin && (!mine || !zones.some(z => z.id === mine.id))) { body.replaceChildren(h('p', null, 'You can calibrate the speaker you are using. This browser is not playing as a speaker yet (or it is offline).'), h('p', { class: 'small dim' }, ADMIN_HINT.replace('change this', 'calibrate other speakers'))); return; }
  const defRef = house?.connected ? house.id : (zones.find(z => z.outputs.find(o => o.active)?.kind === 'wired')?.id ?? zones[0].id);
  const st = { ref: defRef, sel: new Set(!admin ? [mine.id] : presetZoneId ? [presetZoneId] : zones.filter(z => z.id !== defRef).map(z => z.id)), level: -20 };
  api('/settings').then(x => { const v = x?.['calibration.testLevelDb']; if (Number.isFinite(v)) st.level = v; }).catch(() => {});   // 0.3.0 §7.2: default from Settings > Devices > Calibration
  if (presetZoneId && presetZoneId === st.ref) { const other = zones.find(z => z.id !== presetZoneId); if (admin && other) st.ref = other.id; }
  if (!admin && mine && st.ref === mine.id) { body.replaceChildren(h('p', null, `${mine.name} is the house reference speaker, so it is the one the others are measured against - there is nothing to calibrate on it.`)); return; }

  function speakersBox() {
    const refZ = zones.find(z => z.id === st.ref);
    const refSel = h('select', { 'aria-label': 'Reference speaker', onchange: ev => { st.ref = +ev.target.value; st.sel.delete(st.ref); intro(); } }, zones.map(z => h('option', { value: z.id, selected: z.id === st.ref }, z.name + (z.reference ? ' (house reference)' : '') + (z.outputs.find(o => o.active)?.kind === 'bluetooth' ? ' (Bluetooth)' : ''))));
    if (!admin) { refSel.disabled = true; refSel.title = 'Only an administrator can change the reference speaker.'; }
    const names = zones.filter(z => st.sel.has(z.id) && z.id !== st.ref).map(z => z.name);
    return h('details', { class: 'card calspk' }, h('summary', null, h('b', null, 'Speakers: '), `reference ${refZ?.name ?? '?'} · measures ${names.length ? names.join(', ') : 'nothing yet'}`),
      h('div', { class: 'field' }, h('label', null, 'Reference speaker (left as it is)'), refSel,
        refZ && refZ.outputs.find(o => o.active)?.kind === 'bluetooth' ? h('p', { class: 'small amber calbtref' }, 'This reference plays over Bluetooth, whose delay can change when it reconnects. A wired speaker makes a steadier reference.') : null),
      h('div', { class: 'field' }, h('label', null, 'Speakers to calibrate'), zones.filter(z => z.id !== st.ref).map(z => { const own = admin || z.id === mine?.id; return h('label', { class: 'row' + (own ? '' : ' ro'), title: own ? '' : 'Only an administrator can calibrate other speakers.' }, h('input', { type: 'checkbox', checked: st.sel.has(z.id), disabled: !own, onchange: ev => { ev.target.checked ? st.sel.add(z.id) : st.sel.delete(z.id); } }), z.name, h('span', { class: 'small dim' }, z.outputs.find(o => o.active)?.label ?? '')); }),
        admin ? null : h('p', { class: 'small dim' }, 'You can calibrate the speaker you are using; the result is saved only to it.')),
      h('div', { class: 'field' }, h('label', null, 'Test sound level'), h('input', { type: 'range', min: -40, max: -6, value: st.level, oninput: ev => st.level = +ev.target.value, 'aria-label': 'Test sound level' })));
  }
  const picked = () => { st.sel.delete(st.ref); return [...st.sel]; };

  function intro() {
    runView?.stop(); runView = null;
    pcCard ??= pcMicCard(S, admin, { start: (pc, mic) => startPcMic(pc, mic) });
    const usePhone = !opts.link;
    if (usePhone) phoneCard ??= phoneMicCard(S, admin, { onSession: id => watchPhone(id) });
    const earCard = h('div', { class: 'card calway', 'aria-label': 'By ear' }, h('div', { class: 'calway-h' }, h('span', { class: 'calnum' }, '3'), h('h3', null, 'By ear')),
      h('p', { class: 'small dim' }, 'No microphone? Listen to two speakers at once and move a slider until they sound like one.'),
      h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: () => { if (!picked().length) return toast('Choose at least one speaker to calibrate.', true); ear(); } }, 'Line up by ear')));
    body.replaceChildren(speakersBox(), pcCard.el, usePhone ? phoneCard.el : null, earCard,
      h('p', { class: 'small dim' }, 'The music pauses while calibrating and plays again when you finish or cancel.'));
    pcCard.refresh();
  }

  // ------------------------------------------------------------ 1. this PC's microphone (the server runs the measurement)
  async function startPcMic(pc, mic) {
    const zs = picked(); if (!zs.length) return toast('Choose at least one speaker to calibrate.', true);
    let sess;
    try { sess = await api('/calibration/sessions', { method: 'POST', body: { mode: 'pc-mic', micPlayerId: pc.playerId, micId: mic.id, referenceZoneId: st.ref, zoneIds: zs, levelDb: st.level } }); }
    catch (e) { toast(e.message, true); return; }
    sessionId = sess.id; pcCard.stop(); pcCard = null; showRun(sess.id, { title: `Listening with ${sess.micName || mic.name}`, warn: sess.bluetoothWarning });
  }
  // ------------------------------------------------------------ 2. the phone: it runs its own steps and reports them here
  function watchPhone(id) { if (runView || !id) return; showRun(id, { title: 'Phone connected - measuring', phone: true }); }

  /** Live progress of a server-side (PC mic) or phone-run session, then the results with Save all. */
  function showRun(id, { title, warn, phone }) {
    let timer = 0, gone = false;
    const head = h('h3', null, title), label = h('div', { class: 'calnow', 'aria-live': 'polite' }, 'Starting…'), bar = h('div', { class: 'calbar' }, h('i')), steps = h('div', { class: 'small dim' });
    const logEl = h('ul', { class: 'small dim callog' }), guide = h('div', { class: 'calguide', hidden: true });
    let promptKey = '', cdTimer = 0;
    const cancel = h('button', { class: 'btn', onclick: () => { endSession(); stop(); intro(); } }, 'Cancel');
    body.replaceChildren(h('div', { class: 'card calrun' }, head, warn ? h('p', { class: 'small amber' }, warn) : null, label, guide, bar, steps, logEl, h('div', { class: 'row' }, h('span', { class: 'grow' }), cancel)));
    const paint = p => {
      if (gone) return;
      if (p.step && p.steps) { bar.firstChild.style.width = `${Math.round(p.step / p.steps * 100)}%`; steps.textContent = `Step ${p.step} of ${p.steps}`; }
      if (p.label) label.textContent = p.label;
      if (p.log) logEl.replaceChildren(...p.log.slice(-6).map(t => h('li', null, t)));
      paintGuide(p);
      if (p.phase === 'failed') { stop(); failed(p.error || 'The measurement failed.'); return; }
      if (p.proposals && (p.phase === 'done' || phone)) { stop(); results(id, p.proposals, p.messages || [], phone); }
    };
    const poll = async () => { clearTimeout(timer); if (gone) return; try { paint(await api(`/calibration/sessions/${id}`)); } catch (e) { if (e.status === 404) { stop(); if (phone) { body.replaceChildren(h('div', { class: 'card' }, h('h3', null, 'Finished on the phone'), h('p', null, 'The phone saved, canceled or stopped the calibration. Check the phone for details.'), h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { class: 'btn primary', onclick: () => d.close() }, 'Close')))); refresh && refresh(); } else intro(); return; } } timer = setTimeout(poll, 1000); };
    const onRun = ev => { if (ev.detail?.id === id) poll(); };
    window.addEventListener('wavwiz:calrun', onRun);
    // 0.3.1 B3: the guided stop - "Step X of N", the speaker, where to stand; Ready / Skip and an optional 5 s countdown
    function paintGuide(p) {
      const pr = p.phase === 'waiting' ? p.prompt : null;
      if (!pr) { guide.hidden = true; promptKey = ''; clearInterval(cdTimer); return; }
      const key = `${pr.step}:${pr.zoneId}`; if (key === promptKey) return; promptKey = key; clearInterval(cdTimer);
      const send = async action => { clearInterval(cdTimer); guide.querySelectorAll('button').forEach(b => { b.disabled = true; }); try { await api(`/calibration/sessions/${id}/guide`, { method: 'POST', body: { action, zoneId: pr.zoneId } }); } catch (e) { toast(e.message, true); } poll(); };
      const readyBtn = h('button', { class: 'btn primary calready', onclick: () => send('ready') }, 'Ready');
      const cd = h('input', { type: 'checkbox', checked: countdownOn(localStorage), onchange: ev => setCountdown(localStorage, ev.target.checked) });
      guide.replaceChildren(h('div', { class: 'small dim calstep' }, `Step ${pr.step} of ${pr.steps}`), h('div', { class: 'calspk' }, pr.name), h('p', null, pr.text),
        h('div', { class: 'row wrap' }, readyBtn, pr.canSkip ? h('button', { class: 'btn calskip', onclick: () => send('skip') }, 'Skip') : null, h('span', { class: 'grow' }),
          h('label', { class: 'small' }, cd, ` ${COUNTDOWN_S} s countdown after Ready`)));
      readyBtn.onclick = () => {
        if (!cd.checked) { send('ready'); return; }
        let n = COUNTDOWN_S; readyBtn.disabled = true; readyBtn.textContent = `Starting in ${n}…`;
        cdTimer = setInterval(() => { n--; if (n <= 0) { send('ready'); } else readyBtn.textContent = `Starting in ${n}…`; }, 1000);
      };
      guide.hidden = false; readyBtn.focus?.();
    }
    function stop() { gone = true; clearTimeout(timer); clearInterval(cdTimer); window.removeEventListener('wavwiz:calrun', onRun); }
    function failed(msg) {
      endSession();
      body.replaceChildren(h('div', { class: 'card', role: 'alert', style: 'border-color:#8a2b26' }, h('h3', { class: 'err' }, 'Calibration did not finish'), h('p', null, msg),
        h('ul', { class: 'small' }, h('li', null, 'Turn the speakers up a little and keep the room quiet.'), h('li', null, 'Put the microphone at your listening spot, not right next to one speaker.'), h('li', null, 'A wired or USB mic works best.')),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: () => intro() }, 'Try again'), h('button', { class: 'btn', onclick: () => ear() }, 'Use “by ear” instead'))));
    }
    runView = { stop }; poll();
  }

  function results(sid, props, messages, phone) {
    sessionId = sid;
    const checks = new Map(props.map(p => [p.zoneId, p.commit]));
    body.replaceChildren(h('div', { class: 'card' }, h('h3', null, 'Results'),
      props.length ? h('table', { class: 'tbl caltbl' }, h('thead', null, h('tr', null, ['Save', 'Speaker', 'Measured delay', 'Confidence', 'Note', ''].map(x => h('th', null, x)))), h('tbody', null, props.map(p =>
        h('tr', null, h('td', null, h('input', { type: 'checkbox', checked: p.commit, disabled: !p.commit, 'aria-label': 'Save ' + p.zoneName, onchange: ev => checks.set(p.zoneId, ev.target.checked) })), h('td', null, p.zoneName), h('td', { class: 'amber mono' }, `${Math.round(p.proposedLatencyMs)} ms`),
          h('td', null, `${Math.round(p.confidence * 100)}%`), h('td', { style: 'white-space:normal' }, p.warning ?? ''),
          h('td', null, phone || p.isReference ? null : h('button', { class: 'btn small calretry', title: `Measure ${p.zoneName} again`, onclick: async () => { try { await api(`/calibration/sessions/${sid}/retry`, { method: 'POST', body: { zoneId: p.zoneId } }); showRun(sid, { title: `Measuring ${p.zoneName} again` }); } catch (e) { toast(e.message, true); } } }, 'Retry'))))))
        : h('p', { class: 'err' }, 'Nothing could be measured.'),
      messages.length ? h('ul', { class: 'small amber' }, messages.map(m => h('li', null, m))) : null,
      phone ? h('p', { class: 'small dim' }, 'You can also save on the phone.') : null,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { endSession(); intro(); } }, 'Redo'), h('span', { class: 'grow' }),
        h('button', { class: 'btn primary', disabled: !props.some(p => p.commit), onclick: async () => { try { const r = await api(`/calibration/sessions/${sid}/commit`, { method: 'POST', body: { zoneIds: [...checks].filter(([, v]) => v).map(([k]) => k) } }); toast(`Saved ${r.saved} speaker(s).${r.skipped ? ` ${r.skipped} skipped (only your own speaker is saved).` : ''}`); sessionId = null; d.close(); } catch (e) { toast(e.message, true); } } }, 'Save all'))));
  }

  // ------------------------------------------------------------ by ear (no microphone, works on http)
  async function ear() {
    runView?.stop(); runView = null; pcCard?.stop(); pcCard = null;
    const zs = zones.filter(z => st.sel.has(z.id) && z.id !== st.ref && (admin || z.id === mine?.id)); const refZ = zones.find(z => z.id === st.ref); let i = 0;
    try { const sess = await api('/calibration/sessions', { method: 'POST', body: { mode: 'ear', referenceZoneId: st.ref, linkToken: opts.link } }); sessionId = sess.id; } catch (e) { toast(e.message, true); }   // pauses the music
    const show = () => {
      const z = zs[i]; if (!z) { endSession(); d.close(); return; }
      const base = refZ.outputs.find(o => o.active)?.latencyMs ?? 0, out = z.outputs.find(o => o.active);
      const ms = h('input', { type: 'range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': 'Extra delay', oninput: ev => { n.value = ev.target.value; } });
      const n = h('input', { type: 'number', min: 0, max: 1000, value: 0, style: 'width:90px', oninput: ev => { ms.value = ev.target.value; } });
      body.replaceChildren(h('h3', null, `${z.name} (${i + 1}/${zs.length})`), h('p', { class: 'dim' }, `Press “Play”. You hear a short tick pattern from ${refZ.name} and from ${z.name}. Move the slider until both sound like a single sound, with no echo.`),
        h('div', { class: 'row' }, ms, n, 'ms'), h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: async () => { try { await api('/calibration/ear/play', { method: 'POST', body: { referenceZoneId: st.ref, deviceZoneId: z.id, candidateMs: +n.value, sessionId } }); } catch (e) { toast(e.message, true); } } }, '▶ Play'),
          h('button', { class: 'btn', onclick: async () => { try { await api(`/outputs/${encodeURIComponent(out.deviceId)}/latency`, { method: 'PUT', body: { latencyMs: base + +n.value, playerId: z.playerId, method: 'ear' } }); toast(`${z.name}: ${Math.round(base + +n.value)} ms saved`); i++; show(); } catch (e) { toast(e.message, true); } } }, 'Save & next'),
          h('button', { class: 'btn', onclick: () => { i++; show(); } }, 'Skip')));
    };
    show();
  }
  if (!hold) intro();
}

/** 0.2.5 "Use this PC's microphone": the Player PCs with a microphone (a regular user sees only the PC they are on), a remembered mic picker with
 *  kind labels, the Bluetooth warning, a live input level, and Start. No microphone: says so plainly and points at the phone. */
export function micLevelPct(db) { if (db == null || !isFinite(db)) return 0; return Math.max(0, Math.min(100, Math.round((db + 60) / 60 * 100))); }
export function pickPc(pcs) { const ok = (pcs || []).filter(p => p.supportsMic); return ok.find(p => p.mine && p.mics.length) || ok.find(p => p.mics.length) || ok[0] || null; }
function pcMicCard(S, admin, { start }) {
  let pcs = [], pc = null, mic = null, levelTimer = 0, closed = false;
  const el = h('div', { class: 'card calway calpc', 'aria-label': 'Use this PC\'s microphone' });
  const meterBar = h('i'), meterTxt = h('span', { class: 'small dim mono' }, '');
  const meter = h('div', { class: 'calmeter', role: 'meter', 'aria-label': 'Microphone level', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, meterBar);
  const onLevel = ev => { const x = ev.detail; if (!pc || !mic || x?.playerId !== pc.playerId || x?.micId !== mic.id) return; const v = micLevelPct(x.db); meterBar.style.width = v + '%'; meter.setAttribute('aria-valuenow', v); meterTxt.textContent = x.db > -90 ? `${Math.round(x.db)} dB` : 'silent'; };
  const onMics = () => { if (!closed && el.isConnected) refresh(true); };
  window.addEventListener('wavwiz:miclevel', onLevel); window.addEventListener('wavwiz:calmics', onMics);
  const head = (primary) => h('div', { class: 'calway-h' }, h('span', { class: 'calnum' }, '1'), h('h3', null, 'Use this PC’s microphone'), primary ? h('span', { class: 'tag-rec' }, 'Recommended') : null);
  const levelOn = on => { clearTimeout(levelTimer); if (!pc || !mic) return; api('/calibration/pc-mics/level', { method: 'POST', body: { playerId: pc.playerId, micId: mic.id, on } }).catch(() => {}); if (on) levelTimer = setTimeout(() => { if (!closed && el.isConnected) levelOn(true); }, 45000); };
  function paint() {
    if (!pc || !pc.mics.length) {
      const none = !pcs.some(p => p.supportsMic);
      el.className = 'card calway calpc none';
      el.replaceChildren(head(false), h('p', { class: 'small' }, none
          ? 'No WavWiz Player PC with a microphone is connected. Start WavWiz Player on a Windows PC with a mic (0.2.5 or newer), or use your phone below.'
          : 'No microphone found on this PC. Plug in a USB or headset mic (or use your phone instead).'),
        h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: async () => { for (const p of pcs) await api('/calibration/pc-mics/refresh', { method: 'POST', body: { playerId: p.playerId } }).catch(() => {}); setTimeout(() => refresh(), 1200); } }, 'Check again')));
      return;
    }
    el.className = 'card calway calpc';
    const pcSel = pcs.filter(p => p.supportsMic).length > 1 ? h('select', { 'aria-label': 'PC', onchange: ev => { levelOn(false); pc = pcs.find(p => p.playerId === ev.target.value); mic = pc.mics.find(m => m.id === pc.selected) || pc.mics[0]; paint(); levelOn(true); } },
      pcs.filter(p => p.supportsMic).map(p => h('option', { value: p.playerId, selected: p === pc }, p.name + (p.mine ? ' (this PC)' : '')))) : null;
    const micSel = h('select', { 'aria-label': 'Microphone', onchange: ev => { levelOn(false); mic = pc.mics.find(m => m.id === ev.target.value); api('/calibration/pc-mics/level', { method: 'POST', body: { playerId: pc.playerId, micId: mic.id, on: true, remember: true } }).catch(() => {}); pc.selected = mic.id; paint(); levelOn(true); } },
      pc.mics.map(m => h('option', { value: m.id, selected: m.id === mic.id }, `${m.name} · ${m.label}`)));
    const startBtn = h('button', { class: 'btn primary', onclick: () => { levelOn(false); start(pc, mic); } }, 'Start');
    el.replaceChildren(head(true),
      pcSel ? h('div', { class: 'field' }, h('label', null, 'PC'), pcSel) : null,
      h('div', { class: 'field' }, h('label', null, 'Microphone'), micSel),
      mic.bluetooth ? h('p', { class: 'small amber calbt', role: 'note' }, '⚠ ', BT_WARNING) : null,
      h('div', { class: 'row calmeter-row' }, h('span', { class: 'small' }, 'Level'), meter, meterTxt),
      h('p', { class: 'small' }, h('b', null, 'Place this PC (or mic) at your listening spot'), ', keep the room quiet, then press Start. WavWiz plays short chirps on each speaker in turn, reference first.'),
      h('div', { class: 'row' }, h('span', { class: 'small dim' }, 'Takes about 30 seconds per speaker.'), h('span', { class: 'grow' }), startBtn));
  }
  async function refresh(quiet) {
    let r; try { r = await api('/calibration/pc-mics'); } catch (e) { if (!quiet) el.replaceChildren(head(false), h('p', { class: 'small err' }, e.message)); return; }
    BT_WARNING = r.bluetoothWarning || BT_WARNING; pcs = r.pcs || [];
    const keep = pc && pcs.find(p => p.playerId === pc.playerId && p.mics.length);
    const was = pc && mic ? `${pc.playerId}/${mic.id}` : null;
    pc = keep || pickPc(pcs); mic = pc ? (pc.mics.find(m => m.id === mic?.id) || pc.mics.find(m => m.id === pc.selected) || pc.mics[0] || null) : null;
    paint(); if (pc && mic && (`${pc.playerId}/${mic.id}` !== was || !quiet)) levelOn(true);
  }
  el.replaceChildren(head(false), h('p', { class: 'small dim' }, 'Looking for microphones…'));
  return { el, refresh, stop: () => { closed = true; levelOn(false); clearTimeout(levelTimer); window.removeEventListener('wavwiz:miclevel', onLevel); window.removeEventListener('wavwiz:calmics', onMics); } };
}
let BT_WARNING = 'Bluetooth mics add their own delay, so results may be off. A wired or USB mic is recommended.';

/** "Use your phone": QR code + short link to the phone's mic-only page (through the one-time certificate step when needed), the steps, and
 *  a live Phone connected / measuring line (pushed "calphone" events + a light poll). When the phone starts measuring, the progress shows here. */
export const PHONE_STEPS = ['Scan the QR code with your phone.', 'If asked, install the WavWiz certificate (one time). The page shows how.', 'Tap Start and allow the microphone.', 'Stand at your listening spot and keep still (music pauses automatically).'];
export function phoneStatusText(st) {
  if (!st) return ['wait', 'Waiting for your phone…'];
  if (st.expired) return ['bad', 'This QR code has expired. Make a new one.'];
  if (st.state === 'stopped') return ['wait', 'Stopped. Make a new QR code to use a phone again.'];
  if (!st.connected) return st.state === 'left' ? ['wait', `${st.device || 'The phone'} left. Waiting for your phone…`] : ['wait', 'Waiting for your phone…'];
  const what = { opened: 'tap Start on the phone', measuring: 'measuring - keep the house quiet', done: 'measured - save the results here or on the phone' }[st.state] || 'connected';
  return ['ok', `Phone connected: ${st.device || 'phone'} - ${what}`];
}
function phoneMicCard(S, admin, { onSession } = {}) {
  let link = null, timer = null, stopped = false;
  const qr = h('div', { class: 'pm-qr' }, h('span', { class: 'small dim' }, 'Making a QR code…'));
  const short = h('code', { class: 'pm-link' }, '…');
  const dot = h('span', { class: 'dot' }), stTxt = h('span', null, 'Waiting for your phone…');
  const status = h('div', { class: 'pm-status', role: 'status', 'aria-live': 'polite' }, dot, stTxt);
  const notes = h('div');
  const el = h('div', { class: 'card calway pm-card', 'aria-label': 'Use your phone' }, h('div', { class: 'calway-h' }, h('span', { class: 'calnum' }, '2'), h('h3', null, 'Use your phone')),
    h('div', { class: 'pm-row' }, qr, h('div', { class: 'pm-steps' }, h('ol', null, PHONE_STEPS.map(t => h('li', null, t))),
      h('p', { class: 'small dim' }, 'No camera? On the phone type ', short), status)), notes,
    h('p', { class: 'small dim' }, 'The phone only listens. It does not join as a speaker or play music.'));
  const paint = st => { const [k, t] = phoneStatusText(st); dot.className = 'dot ' + (k === 'ok' ? 'ok' : k === 'bad' ? 'bad' : 'wait'); stTxt.textContent = t; if (st?.sessionId && st.state === 'measuring') onSession?.(st.sessionId); };
  async function make() {
    try { link = await api('/calibration/phone-link', { method: 'POST', body: {} }); }
    catch (e) { qr.replaceChildren(h('p', { class: 'small err' }, e.message)); return; }
    qr.replaceChildren(h('img', { src: `/api/v1/calibration/phone-link/${link.token}/qr.svg`, alt: 'QR code that opens the calibration mic page on your phone', width: 168, height: 168 }));
    short.textContent = link.shortUrl.replace(/^http:\/\//, '');
    notes.replaceChildren(
      !link.https ? h('p', { class: 'small amber' }, 'HTTPS is not set up on this PC yet, so the phone cannot use its microphone. ',
        admin ? h('button', { class: 'btn sm', onclick: async () => { try { await api('/tls/enable', { method: 'POST', body: {} }); toast('HTTPS is set up'); make(); } catch (e) { toast(e.message, true); } } }, 'Set up HTTPS')
          : 'Ask the administrator to set it up (Settings > Devices > Phone & HTTPS).') : null,
      !link.allSpeakers ? h('p', { class: 'small dim' }, 'With your QR code the phone calibrates only your own speaker. An administrator’s QR code calibrates every speaker.') : null);
    paint(null); poll();
  }
  async function poll() {
    clearTimeout(timer); if (stopped || !link) return;
    if (!el.isConnected) { timer = setTimeout(poll, 3000); return; }
    try { paint(await api(`/calibration/phone-link/${link.token}`)); } catch (e) { if (e.status === 404) { paint({ expired: true }); return; } }
    timer = setTimeout(poll, 3000);
  }
  const onPush = ev => { if (link && ev.detail?.token === link.token) poll(); };
  window.addEventListener('wavwiz:calphone', onPush);
  make();
  return { el, stop: () => { stopped = true; clearTimeout(timer); window.removeEventListener('wavwiz:calphone', onPush); } };
}

import { h, api, toast, dialog, undoToast } from './util.js';
import { isAdmin, thisDevice, ADMIN_HINT } from './ui.js';
import { isPhoneUa, isPlayerUa } from './phonejoin.js';
import { CAL_STEPS, EAR_LINES, GUIDE_TITLE, GUIDE_SECTIONS, stepLabel, calFix } from './calguide.js';
import { guideGroups, guideText, countdownOn, setCountdown, COUNTDOWN_S } from './calmic-core.js';

/** 0.4.4 F22: web/phone/TV speakers play chirps via FrameScheduler; still need a tap to unlock audio. */
export const isWebSpeaker = z => !!z?.isWeb;
export const webSpeakerKind = z => {
  if (!z) return 'Browser';
  const n = `${z.name || ''} ${z.playerId || ''}`;
  if (/\bTV\b|Smart.?TV|BRAVIA|webOS|Tizen|Android TV|AFT[A-Z]/i.test(n)) return 'TV';
  if (/iPhone|iPad|iPod|Android|phone|tablet/i.test(n)) return 'Phone';
  return 'Browser';
};
export const webNeedsUnlock = z => !!z?.isWeb && !!z.connected && z.room?.state !== 'ok' && z.room?.state !== 'buffering';
export const webIsBluetooth = z => !!z && (/bluetooth/i.test(z.link || '') || !!z.outputs?.some(o => o.active && o.kind === 'bluetooth'));
/** Confidence below this (0..1) → offer By ear instead of saving a weak mic result. */
export const LOW_CONF = 0.4;
export const isLowConfidence = p => !(Number.isFinite(p?.confidence) && p.confidence >= LOW_CONF && p.commit);

// Calibrate speakers (0.2.5: calibration that just works). One screen, three ways, in this order:
//   1. Use this PC's microphone - the WavWiz Player on a Windows PC records with its own microphone (WASAPI, no browser, no HTTPS, no prompt);
//      the SERVER runs the whole measurement (reference x3, each speaker x3, the reference again, retry on low confidence) and this page only
//      shows the mic picker (remembered), a live input level, the Bluetooth warning, the progress and the results with Save all.
//   2. Use your phone - a QR code opens the phone's mic-only page (/calmic.html): it never joins as a speaker or plays sound, asks for the
//      microphone first and measures from the listening spot. This page shows "Phone connected", the live progress and the results.
//   3. By ear - no microphone at all.
// 0.2.0 item 29: the server pauses the music for the whole session and resumes it when the session ENDS (finish, cancel or failure all call
// /calibration/sessions/{id}/end). 0.2.0 items 28 + 30: the house reference is pre-selected; a regular user calibrates only their own speaker.
/** 0.3.7 L21: calibration keeps the music paused for the whole run and, when it ends, OFFERS Resume (it never starts it by itself). */
export function offerResume(groups) {
  // 0.4.0 Stage 4: only the zones calibration paused (the measured speakers' groups) are offered back; other zones never stopped
  const ids = Array.isArray(groups) && groups.length ? groups : null;
  undoToast('Calibration ended - the music is paused', () => ids ? Promise.all(ids.map(g => api('/stream/resume?zoneId=' + encodeURIComponent(g), { method: 'POST' }))) : api('/stream/resume', { method: 'POST' }), 30000, 'Resume');
}
export async function openCalibration(S, refresh, presetZoneId, opts = {}) {
  // a phone is a microphone, never the place that runs the wizard: it goes to the mic-only page (which makes its own link when signed in)
  if (isPhoneUa() && !isPlayerUa()) { location.href = '/calmic.html'; return; }
  const zones = S.zones.filter(z => z.connected && z.outputs.some(o => o.active));
  // 0.4.5 F29: the numbered step strip + '? How calibration works' sit above every view of the window
  const body = h('div', { class: 'calview' }), strip = calStrip(1), outer = h('div', { class: 'calx' }, h('div', { class: 'row calguide-top' }, h('span', { class: 'grow' }), calHelpLink()), strip.el, body); let sessionId = null, phoneCard = null, pcCard = null, runView = null;
  const endSession = () => { const id = sessionId; sessionId = null; if (id) api(`/calibration/sessions/${id}/end`, { method: 'POST' }).then(r => { if (r?.canResume) offerResume(r.resumeGroups); }).catch(() => {}); };
  const cleanup = () => { runView?.stop(); runView = null; pcCard?.stop(); phoneCard?.stop(); endSession(); };
  const d = dialog('Calibrate speakers', outer, [], { onClose: () => { cleanup(); opts.onClose?.(); refresh && refresh(); } });
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
  const st = { ref: defRef, sel: new Set(!admin ? [mine.id] : presetZoneId ? [presetZoneId] : zones.filter(z => z.id !== defRef).map(z => z.id)), level: -12, testVolume: 100, quality: 'quick' };
  api('/settings').then(x => { const v = x?.['calibration.testLevelDb']; if (Number.isFinite(v)) st.level = v; }).catch(() => {});   // 0.3.0 §7.2: default from Settings > Devices > Calibration
  if (presetZoneId && presetZoneId === st.ref) { const other = zones.find(z => z.id !== presetZoneId); if (admin && other) st.ref = other.id; }
  if (!admin && mine && st.ref === mine.id) { body.replaceChildren(h('p', null, `${mine.name} is the house reference speaker, so it is the one the others are measured against - there is nothing to calibrate on it.`)); return; }

  const vv = h('span', { class: 'small mono' }, st.testVolume + '%'), capEl = h('p', { class: 'small amber calcap', hidden: true });
  // 0.4.9 F71: the max-volume lock no longer limits the test sound (it is bypassed for the sound only, then everything is restored)
  const capNote = () => { capEl.hidden = false; capEl.textContent = st.testVolume >= 100 ? 'Calibration plays at full volume. Max-volume locks are bypassed for the test sound only; your volume settings come back afterward.' : `The test sound plays at ${st.testVolume}%. Max-volume locks are bypassed for the test sound only; your volume settings come back afterward.`; }; capNote();
  function speakersBox() {
    queueMicrotask(capNote);
    const refZ = zones.find(z => z.id === st.ref);
    const refSel = h('select', { 'aria-label': 'Reference speaker', onchange: ev => { st.ref = +ev.target.value; st.sel.delete(st.ref); intro(); } }, zones.map(z => h('option', { value: z.id, selected: z.id === st.ref }, z.name + (z.reference ? ' (house reference)' : '') + (z.outputs.find(o => o.active)?.kind === 'bluetooth' ? ' (Bluetooth)' : ''))));
    if (!admin) { refSel.disabled = true; refSel.title = 'Only an administrator can change the reference speaker.'; }
    const names = zones.filter(z => st.sel.has(z.id) && z.id !== st.ref).map(z => z.name);
    const anyWeb = zones.some(z => st.sel.has(z.id) && isWebSpeaker(z));
    return h('details', { class: 'card calspk', open: anyWeb || undefined }, h('summary', null, h('b', null, 'Speakers: '), `reference ${refZ?.name ?? '?'} · measures ${names.length ? names.join(', ') : 'nothing yet'}`),
      h('div', { class: 'field' }, h('label', null, 'Reference speaker (left as it is)'), refSel,
        refZ && refZ.outputs.find(o => o.active)?.kind === 'bluetooth' ? h('p', { class: 'small amber calbtref' }, 'This reference plays over Bluetooth, whose delay can change when it reconnects. A wired speaker makes a steadier reference.') : null),
      h('div', { class: 'field' }, h('label', null, 'Speakers to calibrate'), zones.filter(z => z.id !== st.ref).map(z => { const own = admin || z.id === mine?.id; const web = isWebSpeaker(z); return h('label', { class: 'row' + (own ? '' : ' ro'), title: web ? `${webSpeakerKind(z)} plays chirps in sync (tap to unlock sound first)` : (own ? '' : 'Only an administrator can calibrate other speakers.') }, h('input', { type: 'checkbox', checked: st.sel.has(z.id), disabled: !own, onchange: ev => { ev.target.checked ? st.sel.add(z.id) : st.sel.delete(z.id); intro(); } }), z.name, h('span', { class: 'small dim' }, web ? `${webSpeakerKind(z)} · chirps OK` : (z.outputs.find(o => o.active)?.label ?? ''))); }),
        admin ? null : h('p', { class: 'small dim' }, 'You can calibrate the speaker you are using; the result is saved only to it.')),
      h('div', { class: 'field calquality' }, h('label', { class: 'row calthorough' }, h('input', { type: 'checkbox', 'data-act': 'thorough', 'aria-label': 'Thorough', checked: st.quality === 'thorough', onchange: ev => { st.quality = ev.target.checked ? 'thorough' : 'quick'; } }), h('b', null, 'Thorough'), h('span', { class: 'small dim' }, ' three tests per speaker, with a drift check. Off = Quick: one test per speaker.'))),
      h('div', { class: 'field' }, h('label', null, 'Test sound level'), h('input', { type: 'range', min: -40, max: -6, value: st.level, oninput: ev => st.level = +ev.target.value, 'aria-label': 'Test sound level' })),
      // 0.3.7 L20: the test sound has its own volume (a speaker's own, maybe tiny, volume no longer scales it); a speaker's locked max volume still caps it
      h('div', { class: 'field caltestvol' }, h('label', null, 'Test volume'), h('div', { class: 'row' }, h('input', { type: 'range', min: 0, max: 100, step: 1, value: st.testVolume, class: 'grow', 'aria-label': 'Test volume', oninput: ev => { st.testVolume = +ev.target.value; vv.textContent = st.testVolume + '%'; capNote(); } }), vv),
        capEl));
  }
  const picked = () => { st.sel.delete(st.ref); return [...st.sel]; };

  function intro() {
    runView?.stop(); runView = null; strip.set(1);
    pcCard ??= pcMicCard(S, admin, { start: (pc, mic) => startPcMic(pc, mic) });  // 0.4.4 F21: always show PC+mic pickers + Start (no auto-start)
    const usePhone = !opts.link;
    if (usePhone) phoneCard ??= phoneMicCard(S, admin, { onSession: id => watchPhone(id) });
    const earCard = h('div', { class: 'card calway', 'aria-label': 'By ear' }, h('div', { class: 'calway-h' }, h('span', { class: 'calnum' }, '3'), h('h3', null, 'By ear')),
      h('p', { class: 'small dim' }, 'No microphone? Line them up by listening. Also used when a mic measurement is not confident enough.'), earList(),
      h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: () => { if (!picked().length) return toast(calFix('Choose at least one speaker to calibrate.'), true); ear(); } }, 'Line up by ear')));
    const webSel = zones.filter(z => st.sel.has(z.id) && isWebSpeaker(z));
    const unlockZs = webSel.filter(webNeedsUnlock);
    const btZs = webSel.filter(webIsBluetooth);
    const unlockNote = unlockZs.length || webSel.length
      ? h('p', { class: 'amber cal-unlock', role: 'status' }, unlockZs.length
        ? 'Tap the phone to unlock sound — calibration chirps will not play until audio is unlocked.'
        : 'Phone and browser speakers play calibration chirps in sync. Tap each one first if you hear nothing.')
      : null;
    const btNote = btZs.length ? h('p', { class: 'small amber' }, 'Bluetooth on the phone adds its own delay — the mic measurement includes it (often ~150–300 ms).') : null;
    body.replaceChildren(speakersBox(), unlockNote, btNote, pcCard.el, usePhone ? phoneCard.el : null, earCard,
      h('p', { class: 'small dim' }, 'The music pauses while calibrating and plays again when you finish or cancel.'));
    pcCard.refresh();
  }

  // ------------------------------------------------------------ 1. this PC's microphone (the server runs the measurement)
  async function startPcMic(pc, mic) {
    const zs = picked(); if (!zs.length) return toast(calFix('Choose at least one speaker to calibrate.'), true);
    let sess;
    try { sess = await api('/calibration/sessions', { method: 'POST', body: { mode: 'pc-mic', micPlayerId: pc.playerId, micId: mic.id, referenceZoneId: st.ref, zoneIds: zs, levelDb: st.level, testVolume: st.testVolume, quality: st.quality } }); }
    catch (e) { toast(calFix(e.message), true); return; }
    sessionId = sess.id; pcCard.stop(); pcCard = null; showRun(sess.id, { title: `Listening with ${sess.micName || mic.name} on ${pc.name}`, warn: sess.bluetoothWarning });
  }
  // ------------------------------------------------------------ 2. the phone: it runs its own steps and reports them here
  function watchPhone(id) { if (runView || !id) return; showRun(id, { title: 'Phone connected - measuring', phone: true }); }

  /** Live progress of a server-side (PC mic) or phone-run session, then the results with Save all. */
  function showRun(id, { title, warn, phone }) {
    let timer = 0, gone = false;
    const head = h('h3', null, title), label = h('div', { class: 'calnow', 'aria-live': 'polite' }, 'Starting…'), bar = h('div', { class: 'calbar' }, h('i')), steps = h('div', { class: 'small dim' });
    const logEl = h('ul', { class: 'small dim callog' }), guide = h('div', { class: 'calguide', hidden: true });
    // 0.3.7 L22: the live mic level stays on screen during the pre-check AND the measurement, with the current spot's name and the last rating (good / weak / too quiet)
    const mBar = h('i'), mTxt = h('span', { class: 'small dim mono' }, ''), mSpot = h('span', { class: 'small calspot' }, ''), mRate = h('span', { class: 'calrate small', 'data-rating': '', hidden: true });
    const mEl = h('div', { class: 'row calmeter-row calrun-meter' }, h('span', { class: 'small' }, 'Mic level'), h('div', { class: 'calmeter', role: 'meter', 'aria-label': 'Microphone level', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, mBar), mTxt, mSpot, mRate);
    const onLvl = ev => { const x = ev.detail; if (x?.db == null) return; const v = micLevelPct(x.db); mBar.style.width = v + '%'; mBar.parentNode.setAttribute('aria-valuenow', v); mTxt.textContent = x.db > -90 ? `${Math.round(x.db)} dB` : 'silent'; };
    window.addEventListener('wavwiz:miclevel', onLvl);
    let promptKey = '', cdTimer = 0;
    const cancel = h('button', { class: 'btn', onclick: () => { endSession(); stop(); intro(); } }, 'Cancel');
    body.replaceChildren(h('div', { class: 'card calrun' }, head, warn ? h('p', { class: 'small amber' }, warn) : null, label, mEl, guide, bar, steps, logEl, h('div', { class: 'row' }, h('span', { class: 'grow' }), cancel)));
    const paint = p => {
      if (gone) return;
      if (p.step && p.steps) { bar.firstChild.style.width = `${Math.round(p.step / p.steps * 100)}%`; steps.textContent = `Step ${p.step} of ${p.steps}`; }
      if (p.label) label.textContent = p.label;
      if (p.log) logEl.replaceChildren(...p.log.slice(-6).map(t => h('li', null, t)));
      if (!phone) { mSpot.textContent = p.label ? `· ${p.label}` : ''; const a = (p.attempts || []).slice(-1)[0]; if (a) { mRate.hidden = false; mRate.dataset.rating = a.rating; mRate.textContent = `${a.check ? 'Check' : 'Last try'}: ${RATE_WORD[a.rating] || a.rating} (${Math.round(a.snrDb)} dB over noise, peak ${Math.round(a.peakDb)} dBFS)`; } }
      strip.set(p.phase === 'waiting' ? 3 : 4); paintGuide(p);
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
      const key = `${pr.step}:${pr.zoneId}:${pr.kind}`; if (key === promptKey) return; promptKey = key; clearInterval(cdTimer);
      const send = async action => { clearInterval(cdTimer); guide.querySelectorAll('button').forEach(b => { b.disabled = true; }); try { await api(`/calibration/sessions/${id}/guide`, { method: 'POST', body: { action, zoneId: pr.zoneId } }); } catch (e) { toast(calFix(e.message), true); } poll(); };
      const readyBtn = h('button', { class: 'btn primary calready', onclick: () => send('ready') }, 'Ready');
      const cd = h('input', { type: 'checkbox', checked: countdownOn(localStorage), onchange: ev => setCountdown(localStorage, ev.target.checked) });
      const problem = ['quiet', 'weak', 'silent'].includes(pr.kind);
      if (problem) {   // 0.3.7 L22 / L24: the pre-check rated this spot weak / too quiet, or the speaker stayed silent: say what to do; Retry / Continue anyway / Skip
        const tv = h('input', { type: 'range', min: 0, max: 100, value: p.testVolume ?? 100, 'aria-label': 'Test volume', class: 'grow', onchange: ev => api(`/calibration/sessions/${id}/testvolume`, { method: 'PUT', body: { testVolume: +ev.target.value } }).catch(() => {}) });
        const retry = h('button', { class: 'btn primary calretrycheck', onclick: () => send('ready') }, pr.kind === 'silent' ? 'Retry this speaker' : 'Check again');
        guide.replaceChildren(h('div', { class: 'small dim calstep' }, `Step ${pr.step} of ${pr.steps}`), h('div', { class: 'calspk' }, pr.name), h('div', { class: `calrate-big`, 'data-rating': pr.kind }, RATE_WORD[pr.kind] || pr.kind), h('p', { class: 'calwhy' }, pr.text),
          pr.kind === 'silent' ? null : h('div', { class: 'row calvol' }, h('span', { class: 'small' }, 'Test volume'), tv),
          h('div', { class: 'row wrap' }, retry, pr.kind === 'silent' ? null : h('button', { class: 'btn calcontinue', onclick: () => send('continue') }, 'Continue anyway'), pr.canSkip ? h('button', { class: 'btn calskip', onclick: () => send('skip') }, 'Skip this speaker') : null));
        guide.hidden = false; retry.focus?.(); return;
      }
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
    function stop() { gone = true; window.removeEventListener('wavwiz:miclevel', onLvl); clearTimeout(timer); clearInterval(cdTimer); window.removeEventListener('wavwiz:calrun', onRun); }
    function failed(msg) {
      endSession(); msg = calFix(msg);
      body.replaceChildren(h('div', { class: 'card', role: 'alert', style: 'border-color:#8a2b26' }, h('h3', { class: 'err' }, 'Calibration did not finish'), h('p', null, msg),
        h('ul', { class: 'small' }, h('li', null, 'Turn the speakers up a little and keep the room quiet.'), h('li', null, 'Put the microphone at your listening spot, not right next to one speaker.'), h('li', null, 'A wired or USB mic works best.')),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: () => intro() }, 'Try again'), h('button', { class: 'btn', onclick: () => ear() }, 'Use “by ear” instead'))));
    }
    runView = { stop }; poll();
  }

  function results(sid, props, messages, phone) {
    sessionId = sid;
    const checks = new Map(props.map(p => [p.zoneId, p.commit]));
    const low = props.filter(p => !p.isReference && isLowConfidence(p));
    body.replaceChildren(h('div', { class: 'card' }, h('h3', null, 'Results'),
      props.length ? h('table', { class: 'tbl caltbl' }, h('thead', null, h('tr', null, ['Save', 'Speaker', 'Measured delay', 'Confidence', 'Note', ''].map(x => h('th', null, x)))), h('tbody', null, props.map(p =>
        h('tr', null, h('td', null, h('input', { type: 'checkbox', checked: p.commit, disabled: !p.commit, 'aria-label': 'Save ' + p.zoneName, onchange: ev => checks.set(p.zoneId, ev.target.checked) })), h('td', null, p.zoneName), h('td', { class: 'amber mono' }, `${Math.round(p.proposedLatencyMs)} ms`),
          h('td', null, confText(p.confidence)), h('td', { style: 'white-space:normal' }, p.warning ?? ''),
          h('td', { class: 'row wrap' },
            phone || p.isReference ? null : h('button', { class: 'btn small calretry', title: `Measure ${p.zoneName} again`, onclick: async () => { try { await api(`/calibration/sessions/${sid}/retry`, { method: 'POST', body: { zoneId: p.zoneId } }); showRun(sid, { title: `Measuring ${p.zoneName} again` }); } catch (e) { toast(calFix(e.message), true); } } }, 'Retry'),
            // 0.4.4 F22: low-confidence mic result → By ear for that speaker
            !p.isReference && isLowConfidence(p) ? h('button', { class: 'btn small calbyear', 'data-act': 'f22-byear', title: 'Mic confidence is too low — line up by ear', onclick: () => { st.sel = new Set([p.zoneId]); ear(); } }, 'By ear') : null)))))
        : h('p', { class: 'err' }, 'Nothing could be measured.'),
      messages.length ? h('ul', { class: 'small amber' }, messages.map(m => h('li', null, m))) : null,
      low.length ? h('p', { class: 'amber', role: 'status' }, 'Low confidence on ', low.map(p => p.zoneName).join(', '), ' — use By ear for those speakers instead of saving a weak result.') : null,
      phone ? h('p', { class: 'small dim' }, 'You can also save on the phone.') : null,
      h('div', { class: 'row' }, h('button', { class: 'btn', 'data-act': 'calretry', onclick: () => { endSession(); intro(); } }, 'Retry'),
        low.length ? h('button', { class: 'btn', 'data-act': 'f22-byear-all', onclick: () => { st.sel = new Set(low.map(p => p.zoneId)); ear(); } }, 'By ear for low-confidence') : null,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn primary', disabled: !props.some(p => p.commit), onclick: async () => { try { const r = await api(`/calibration/sessions/${sid}/commit`, { method: 'POST', body: { zoneIds: [...checks].filter(([, v]) => v).map(([k]) => k) } }); toast(`Saved ${r.saved} speaker(s).${r.skipped ? ` ${r.skipped} skipped (only your own speaker is saved).` : ''}`); sessionId = null; if (r.canResume) offerResume(r.resumeGroups); d.close(); } catch (e) { toast(calFix(e.message), true); } } }, 'Apply'))));
  }

  // ------------------------------------------------------------ by ear (no microphone, works on http)
  async function ear() {
    runView?.stop(); runView = null; pcCard?.stop(); pcCard = null;
    const zs = zones.filter(z => st.sel.has(z.id) && z.id !== st.ref && (admin || z.id === mine?.id)); const refZ = zones.find(z => z.id === st.ref); let i = 0;
    try { const sess = await api('/calibration/sessions', { method: 'POST', body: { mode: 'ear', referenceZoneId: st.ref, linkToken: opts.link } }); sessionId = sess.id; } catch (e) { toast(calFix(e.message), true); }   // pauses the music
    const show = () => {
      const z = zs[i]; if (!z) { endSession(); d.close(); return; }
      const base = refZ.outputs.find(o => o.active)?.latencyMs ?? 0, out = z.outputs.find(o => o.active);
      const ms = h('input', { type: 'range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': 'Extra delay', oninput: ev => { n.value = ev.target.value; } });
      const n = h('input', { type: 'number', min: 0, max: 1000, value: 0, style: 'width:90px', oninput: ev => { ms.value = ev.target.value; } });
      const unlock = webNeedsUnlock(z) || webNeedsUnlock(refZ);
      const bt = webIsBluetooth(z) || webIsBluetooth(refZ);
      body.replaceChildren(h('h3', null, `${z.name} (${i + 1}/${zs.length})`),
        unlock ? h('p', { class: 'amber cal-unlock', role: 'status' }, 'Tap the phone to unlock sound — then press Play again.') : null,
        bt ? h('p', { class: 'small amber' }, 'Bluetooth adds its own delay on the phone. Line up by ear; the offset will be larger than on Wi-Fi.') : null,
        h('p', { class: 'dim' }, `Press “Play”, then:`), earList(),
        h('div', { class: 'row' }, ms, n, 'ms'), h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: async () => { try { await api('/calibration/ear/play', { method: 'POST', body: { referenceZoneId: st.ref, deviceZoneId: z.id, candidateMs: +n.value, sessionId } }); } catch (e) { toast(calFix(e.message), true); } } }, '▶ Play'),
          h('button', { class: 'btn', onclick: async () => { try { await api(`/outputs/${encodeURIComponent(out.deviceId)}/latency`, { method: 'PUT', body: { latencyMs: base + +n.value, playerId: z.playerId, method: 'ear' } }); toast(`${z.name}: ${Math.round(base + +n.value)} ms saved`); i++; show(); } catch (e) { toast(calFix(e.message), true); } } }, 'Save & next'),
          h('button', { class: 'btn', onclick: () => { i++; show(); } }, 'Skip')));
    };
    show();
  }
  if (!hold) intro();
}

/** 0.2.5 "Use this PC's microphone": the Player PCs with a microphone (a regular user sees only the PC they are on), a remembered mic picker with
 *  kind labels, the Bluetooth warning, a live input level, and Start. No microphone: says so plainly and points at the phone. */
/** 0.3.7 L26: a confidence is shown only when it is a real 0-1 number, always as 0-100 %. */
export const confPct = c => (Number.isFinite(c) ? Math.max(0, Math.min(100, Math.round(c * 100))) : null);
export const confText = c => { const v = confPct(c); return v == null ? '—' : v + '%'; };
export const RATE_WORD = { good: 'Good', weak: 'Weak', quiet: 'Too quiet', silent: 'Silent speaker' };
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
    // 0.4.4 F21: always show the PC picker when any other Player PC has a mic (label "(this PC)")
    const pcsWithMic = pcs.filter(p => p.supportsMic && (p.mics || []).length);
    const pcSel = pcsWithMic.length > 1 ? h('select', { 'aria-label': 'PC', onchange: ev => { levelOn(false); pc = pcs.find(p => p.playerId === ev.target.value); mic = pc.mics.find(m => m.id === pc.selected) || pc.mics[0]; paint(); levelOn(true); } },
      pcsWithMic.map(p => h('option', { value: p.playerId, selected: p === pc }, p.name + (p.mine ? ' (this PC)' : '')))) : null;
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
    // 0.4.4 F21: no auto-start — user picks PC/mic and presses Start (remembered selection is still prefilled)
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
        admin ? h('button', { class: 'btn sm', onclick: async () => { try { await api('/tls/enable', { method: 'POST', body: {} }); toast('HTTPS is set up'); make(); } catch (e) { toast(calFix(e.message), true); } } }, 'Set up HTTPS')
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

// ------------------------------------------------------------ 0.4.5 F29: the step strip, By ear lines, the help sheet
/** "Step 1 of 4" strip: four numbered steps with their short instructions inline; the current one in the theme accent. */
export function calStrip(active = 1) {
  const items = CAL_STEPS.map(s => h('li', { class: 'calst', 'data-step': s.n }, h('span', { class: 'calst-n', 'aria-hidden': 'true' }, String(s.n)), h('div', { class: 'calst-b' }, h('b', null, s.title), h('span', { class: 'small dim' }, s.text))));
  const lbl = h('div', { class: 'calst-lbl small', 'aria-live': 'polite' }), el = h('div', { class: 'calsteps', role: 'group', 'aria-label': 'Calibration steps' }, lbl, h('ol', { class: 'calst-list' }, items));
  const set = n => { lbl.textContent = stepLabel(n); items.forEach((li, i) => { li.classList.toggle('on', i + 1 === n); li.classList.toggle('done', i + 1 < n); if (i + 1 === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); }); };
  set(active); return { el, set };
}
export const earList = () => h('ol', { class: 'calear small' }, EAR_LINES.map(t => h('li', null, t)));
/** The '? How calibration works' link (calibrate window + next to every Calibrate button on the speaker pages). */
export function calHelpLink(extra = '') {
  return h('button', { type: 'button', class: 'linkbtn calhelp ' + extra, 'data-act': 'calhelp', title: GUIDE_TITLE, onclick: ev => { ev.stopPropagation(); ev.preventDefault?.(); openCalGuide(); } }, h('span', { class: 'calhelp-q', 'aria-hidden': 'true' }, '?'), ' ' + GUIDE_TITLE);
}
/** One themed, scrollable screen: the four steps, By ear, Bluetooth and phone notes, what to do when it fails. */
export function openCalGuide() {
  const sec = s => h('section', { class: 'calg-sec' }, h('h4', null, s.h),
    s.steps ? h('ol', { class: 'calg-steps' }, CAL_STEPS.map(x => h('li', null, h('b', null, x.title + ': '), x.text))) : null,
    s.ear ? earList() : null, s.p ? h('ul', { class: 'small' }, s.p.map(t => h('li', null, t))) : null);
  const g = dialog(GUIDE_TITLE, h('div', { class: 'calguide-sheet' }, GUIDE_SECTIONS.map(sec)), [{ text: 'Got it', cls: 'primary' }], { cls: 'calguide-dlg' });
  return g;
}

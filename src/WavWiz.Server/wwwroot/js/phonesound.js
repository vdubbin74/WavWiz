// F250-P7: phone-only composition of the existing EQ and detailed sound controls.
// No audio owner, F246 DOM transplant, desktop editor change or DSP parameters.
import { h, api } from './util.js';
import { wsel } from './wwselect.js';
import { closeCtx } from './ctxmenu.js';
import { eqArea, eqLockBox } from './eqview.js';
import { soundSettings, LOCK_HINT } from './eqsettings.js';
import { flatEq } from './eq.js';
import { pickerOutputs } from './centerview.js';
import { controllingTarget, eqTarget, loadEqPrefs, loadEqLock, saveEqLock, ownEqName } from './eqstyle.js';
import { canTune, thisDevice, isAdmin } from './ui.js';
import { flag } from './flags.js';
import { spectrumTap } from './viz.js';
import * as Z from './zones40.js';

// A late preview/revert from a closed sheet must precede a reopened editor's
// writes, even for A -> B -> A. Never look up a mutable target inside a timer.
const lanes = new Map();
function onDevice(id, task) {
  const next = (lanes.get(id) || Promise.resolve()).catch(() => {}).then(task);
  lanes.set(id, next);
  next.finally(() => { if (lanes.get(id) === next) lanes.delete(id); }).catch(() => {});
  return next;
}
const copy = v => structuredClone(v);
export function phoneSound(S, host, { refreshAll = async () => {} } = {}) {
  let gone = false, chosen = null, session = null, epoch = 0, holding = null;
  const speaker = id => (S.zones || []).find(z => z.id === id);
  const controlling = () => controllingTarget(S.zones, S.groups, Z.current());
  const outputs = () => pickerOutputs(S.zones, thisDevice(S), controlling());
  const resolve = () => chosen ? outputs().find(o => o.deviceId === chosen) : controlling() || eqTarget(S.zones, thisDevice(S));
  const root = h('div', { class: 'phone-sound' }); host.replaceChildren(root);
  const identity = h('p', { class: 'sound-identity' }), pickHost = h('div', { class: 'sound-targets' });
  const status = h('p', { class: 'small sound-status', role: 'status', 'aria-live': 'polite' });
  const editor = h('div', { class: 'sound-editor' }), outputHost = h('section', { class: 'sound-output', 'aria-label': 'Physical output' });
  const lock = eqLockBox(loadEqLock(), saveEqLock);
  const help = h('p', { class: 'small dim sound-help' }, 'Changes preview live on the named EQ target. Save & use keeps a new snapshot without changing shared presets. Close, changing target or Revert discards unsaved previews. Output switches the physical device, not the EQ target selector.');
  const save = h('button', { type: 'button', class: 'btn primary sound-save', onclick: () => persist(session) }, 'Save & use');
  const reload = h('button', { type: 'button', class: 'btn sound-reload', onclick: () => load(resolve()) }, 'Reload saved sound');
  root.append(identity, pickHost, h('div', { class: 'row wrap sound-lock' }, lock.el), help, status, editor, outputHost, h('div', { class: 'row wrap sound-footer' }, reload, save));
  const live = r => !!r && !gone && r === session && r.active && resolve()?.deviceId === r.out.deviceId && !!speaker(r.out.zoneId)?.outputs?.some(o => o.deviceId === r.out.deviceId && (o.connected || o.active));
  const permitted = r => live(r) && (!chosen || (isAdmin(S) && flag('ui.eqOutputPicker'))) && canTune(S, speaker(r.out.zoneId));
  const editable = r => permitted(r) && !loadEqLock() && !r.busy;
  const say = (text, bad = false) => { if (!gone) { status.textContent = text; status.classList.toggle('bad', bad); } };
  const stop = () => {
    const r = session; session = null; if (root.closest('dialog')?.querySelector('.ctxmenu')) closeCtx(); if (!r) return Promise.resolve();
    r.active = false; clearTimeout(r.timer); r.area?.destroy();
    // Cleanup is intentionally bound to the OLD device, even after close/removal.
    return onDevice(r.out.deviceId, async () => { if (r.previewed) { await api('/dsp/revert', { method: 'POST', body: { deviceId: r.out.deviceId } }); r.previewed = false; } }).catch(e => say('Could not discard preview: ' + e.message, true));
  };
  function policy() {
    const r = session, ok = editable(r);
    const targetPicker = pickHost.querySelector('.wwsel'); if (targetPicker) targetPicker.disabled = !!r?.busy;
    lock.set(loadEqLock()); r?.area?.setLocked(!ok); r?.lower?.setLocked(!ok);
    const note = r?.lower?.el.querySelector('.eqall-lock'); if (note) note.textContent = permitted(r) ? LOCK_HINT : 'Read-only — only this speaker’s owner or an admin can change sound.';
    save.disabled = !ok || !r?.dirty; reload.disabled = !!r?.busy;
    root.classList.toggle('sound-readonly', !!r && !permitted(r));
    if (r && !permitted(r)) say('Read-only: only this speaker’s owner or an admin can tune it.');
    paintOutput();
  }
  function paintTargets(o) {
    const outs = outputs(), ctl = controlling();
    const source = chosen ? 'Selected EQ target' : ctl ? 'Controlling zone speaker' : 'Fallback EQ target (no active speaker in controlling zone)';
    identity.textContent = o ? `${source}: ${o.zone} — ${o.name}${o.active ? ' (active output)' : ' (not the active output)'}` : chosen ? 'Selected EQ output is unavailable. Choose another target or reopen Sound.' : 'No connected speaker/output to adjust.';
    const sig = JSON.stringify([outs, o?.deviceId, isAdmin(S), flag('ui.eqOutputPicker')]);
    if (pickHost._sig === sig) return; pickHost._sig = sig;
    if (pickHost.querySelector('[aria-expanded=true]')) closeCtx();
    pickHost.replaceChildren(flag('ui.eqOutputPicker') && isAdmin(S) && (outs.length > 1 || (chosen && !o && outs.length)) ? h('label', { class: 'sound-target-label' }, 'EQ target (does not switch playback)', wsel({ 'aria-label': 'EQ target (does not switch playback)', onchange: e => {
      if (!isAdmin(S) || !flag('ui.eqOutputPicker') || session?.busy) return;
      chosen = e.target.value; load(resolve());
    } }, !o ? h('option', { value: '', selected: true, disabled: true }, 'Choose an EQ target') : null, outs.map(x => h('option', { value: x.deviceId, selected: x.deviceId === o?.deviceId }, `${x.zone} — ${x.name}`)))) : null);
  }
  function paintOutput() {
    const r = session, z = speaker(r?.out.zoneId);
    if (!z) { outputHost._sig = null; outputHost.replaceChildren(); return; }
    const outs = (z.outputs || []).filter(o => o.connected || o.active || o.deviceId === z.chosenDeviceId);
    const active = outs.find(o => o.active) || outs.find(o => o.deviceId === z.chosenDeviceId);
    const b = wsel({ 'aria-label': 'Physical output for ' + z.name, disabled: !permitted(r) || r.busy || !outs.some(o => o.connected && Number.isFinite(o.endpointDbId) && o.deviceId !== active?.deviceId),
      title: z.isWeb && outs.length < 2 ? 'This browser uses its default output.' : !canTune(S, z) ? 'Only this speaker’s owner or an admin can switch its output.' : 'Switch the physical output of this speaker',
      onchange: e => switchOutput(r, +e.target.value) },
      !active ? h('option', { value: '', selected: true, disabled: true }, 'Output unavailable') : null,
      outs.map(o => h('option', { value: o.endpointDbId, selected: o === active, disabled: !o.connected || !Number.isFinite(o.endpointDbId) }, `${o.name}${o.connected ? '' : ' (unplugged)'}`)));
    // Keep the trigger and any nested picker intact on harmless live refreshes.
    const sig = JSON.stringify([z.id, z.name, outs, b.disabled]);
    if (outputHost._sig === sig) return; outputHost._sig = sig;
    outputHost.replaceChildren(h('h3', {}, 'Output'), h('p', { class: 'small dim' }, `Active physical output · ${z.name}: ${active?.name || 'unavailable'}`), b);
  }
  async function switchOutput(r, endpointId) {
    const z = speaker(r?.out.zoneId), endpoint = z?.outputs?.find(o => o.endpointDbId === endpointId && o.connected);
    if (!permitted(r) || r.busy || !endpoint || !Number.isFinite(endpointId)) return;
    // Hold the current EQ target across stop()'s session=null window so an
    // ordinary unchanged-target zones refresh cannot bump epoch and silently
    // drop this Output POST. Genuine target/permission loss still cancels.
    const ticket = ++epoch, id = z.id, holdDevice = r.out.deviceId; r.busy = true; policy();
    holding = { ticket, deviceId: holdDevice, zoneId: id };
    try {
      await stop();
      if (gone || ticket !== epoch || !canTune(S, speaker(id)) || !speaker(id)?.outputs?.some(o => o.endpointDbId === endpointId && o.connected)) return;
      try {
        await api(`/zones/${id}/output`, { method: 'POST', body: { endpointId } });
        if (gone || ticket !== epoch) return;
        if (chosen) chosen = endpoint.deviceId;
        await refreshAll(); if (!gone && ticket === epoch) { await load(resolve()); say('Output switched — now editing its own sound.'); }
      } catch (e) { if (!gone && ticket === epoch) { await load(resolve()); say(e.message, true); } }
    } finally {
      if (holding?.ticket === ticket) {
        holding = null;
        // A canceled Output ticket may have been replaced by a real target
        // change while holding lingered. Reconcile the now-current target so
        // a returned/recovered speaker does not keep foreign controls.
        if (!gone && ticket !== epoch) {
          const cur = resolve(), liveSession = session;
          if (cur?.deviceId !== liveSession?.out.deviceId || (!!cur && !liveSession)) load(cur);
        }
      }
    }
  }
  function changed(r) {
    if (!editable(r)) return;
    r.dirty = true; r.presetId = null; const presetPicker = r.lower?.el.querySelector('.eqall-preset'); if (presetPicker) presetPicker.value = ''; ++r.rev; save.disabled = false;
    clearTimeout(r.timer); const preset = copy(r.cur), rev = r.rev;
    r.timer = setTimeout(() => {
      onDevice(r.out.deviceId, async () => {
        if (!editable(r) || r.rev !== rev) return;
        r.previewed = true;
        await api('/dsp/preview', { method: 'POST', body: { deviceId: r.out.deviceId, preset, bypass: preset.bypass } });
        if (live(r) && r.rev === rev) say('Previewing live — not saved.');
      }).catch(e => { if (live(r)) say(e.message, true); });
    }, 120);
  }
  async function persist(r, name) {
    if (!editable(r) || (!r.dirty && !name)) return;
    clearTimeout(r.timer); const preset = copy(r.cur), rev = r.rev;
    name = (name || ownEqName(r.out.zone)).trim().slice(0, 40); if (!name) return;
    r.busy = true; policy();
    try {
      await onDevice(r.out.deviceId, async () => {
        if (!permitted(r) || loadEqLock() || r.rev !== rev) return;
        // Presets are GLOBAL (DspService.Update notifies every assigned output).
        // A friendly speaker name cannot prove exclusive ownership, including
        // two outputs on the same speaker. Save an isolated snapshot; never PUT
        // an existing preset here. The standalone preset editor remains intact.
        const base = name; let suffix = 1;
        while (r.presets.some(p => p.name.toLowerCase() === name.toLowerCase())) {
          const tail = ` (${++suffix})`; name = base.slice(0, 40 - tail.length) + tail;
        }
        const body = { name, preset: { ...preset, name } };
        const result = await api('/dsp/presets', { method: 'POST', body });
        if (!permitted(r) || loadEqLock() || r.rev !== rev) return;
        const id = result.id;
        await api(`/dsp/assignments/${encodeURIComponent(r.out.deviceId)}`, { method: 'PUT', body: { presetId: id, enabled: true, bypass: preset.bypass } });
        r.previewed = false;
        // Announce even when this editor is already closed/replaced: a same-
        // output reopen that read before this PUT settled must not keep the
        // pre-commit saved baseline (and later overwrite Bass with stale 0).
        window.dispatchEvent(new CustomEvent('wavwiz:eqchanged', { detail: { deviceId: r.out.deviceId } }));
        if (!live(r)) return;
        r.dirty = false; r.saved = copy(preset); r.presetId = id;
        r.presets = await api('/dsp/presets');
        if (!live(r)) return;
        r.lower.repaint(); say('Saved and using this sound.');
      });
    } catch (e) { if (live(r)) say(e.message, true); }
    finally { if (live(r)) { r.busy = false; policy(); } }
  }
  function draw(r) {
    if (!live(r)) return;
    const prefs = loadEqPrefs(); r.area?.destroy();
    r.area = eqArea({ style: prefs.style, glow: prefs.glow, gains: r.cur.graphicDb, interactive: true, locked: !editable(r), onChange: (i, db) => { if (editable(r)) { r.cur.graphicDb[i] = db; changed(r); } } });
    r.area.startLive(spectrumTap);
    r.lower = soundSettings({ cur: () => r.cur, changed: () => changed(r), presets: () => r.presets, presetId: () => r.presetId,
      pick: p => { if (!editable(r)) return; r.cur = { ...flatEq(), ...copy(p.json), bypass: r.cur.bypass }; changed(r); r.presetId = p.id; draw(r); },
      saveAs: name => persist(r, name),
      flat: () => { if (!editable(r)) return; r.cur = flatEq(); changed(r); draw(r); },
      revert: () => { if (editable(r)) load(resolve()); } });
    editor.replaceChildren(r.area.el, r.lower.el); policy();
    const rev = r.rev;
    api('/dsp/response', { method: 'POST', body: { preset: copy(r.cur) } }).then(resp => { if (live(r) && r.rev === rev) r.area.setResponse(resp); }).catch(() => {});
  }
  async function load(o) {
    const ticket = ++epoch, cleanup = stop(); editor.replaceChildren(); paintTargets(o); paintOutput(); save.disabled = true;
    if (!o) { say(chosen ? 'EQ target removed. No fallback has been selected for edits.' : 'Connect a speaker to adjust sound.'); return; }
    say('Loading sound…');
    await cleanup;
    if (gone || epoch !== ticket) return;
    const r = { out: copy(o), cur: flatEq(), active: true, rev: 0, dirty: false, busy: false, previewed: false }; session = r;
    try {
      const [presets, a] = await Promise.all([api('/dsp/presets'), api(`/dsp/assignments/${encodeURIComponent(o.deviceId)}`)]);
      if (!live(r) || ticket !== epoch) return;
      const p = presets.find(p => p.id === a?.presetId);
      r.presets = presets; r.cur = { ...flatEq(), ...(p ? copy(p.json) : {}), bypass: a?.enabled === false || !!a?.bypass }; r.saved = copy(r.cur); r.presetId = p?.id ?? null;
      draw(r); say(permitted(r) ? 'Live preview · Save & use to keep changes.' : 'Read-only: only this speaker’s owner or an admin can tune it.');
    } catch (e) { if (live(r)) { r.active = false; editor.replaceChildren(); say('Could not read sound: ' + e.message, true); } }
  }
  function refresh() {
    if (gone) return;
    // Revoking picker permission never leaves a hidden explicit fallback target.
    if (chosen && (!isAdmin(S) || !flag('ui.eqOutputPicker'))) { chosen = null; load(resolve()); return; }
    const o = resolve(), r = session;
    // Pending Output cleanup owns epoch only while its ticket is still current
    // for this unchanged target; an invalidated earlier ticket must not suppress
    // a genuine return/recovery load.
    if (holding && holding.ticket === epoch && o?.deviceId === holding.deviceId && canTune(S, speaker(holding.zoneId))) {
      paintTargets(o);
      return;
    }
    if (o?.deviceId !== r?.out.deviceId || (!!o && !r)) { load(o); return; }
    paintTargets(o);
    if (r && !permitted(r) && r.previewed) { load(o); return; }
    policy();
  }
  const style = () => { if (session?.presets) draw(session); };
  const locked = () => { if (loadEqLock() && session) clearTimeout(session.timer); policy(); };
  const externalEq = e => { const r = session; if (r && e.detail?.deviceId === r.out.deviceId && !r.busy) { if (!r.dirty) load(resolve()); else say('Saved sound changed elsewhere. Reload saved sound or Save & use this preview.'); } };
  const glow = e => session?.area?.setGlow(+e.detail);
  const events = [['wavwiz:eqchanged', externalEq], ['wavwiz:eqglow', glow], ['wavwiz:zone', refresh], ['wavwiz:zonesync', refresh], ['wavwiz:zonesdata', refresh], ['wavwiz:eqlock', locked], ['wavwiz:eqstyle', style]];
  events.forEach(([e, fn]) => window.addEventListener(e, fn));
  const gate = e => { if (e.type === 'keydown' && ['Tab', 'Escape'].includes(e.key)) return; if (e.target.closest('.sound-editor') && !editable(session)) { e.preventDefault(); e.stopImmediatePropagation(); policy(); } };
  for (const e of ['click', 'input', 'change', 'keydown', 'pointerdown', 'wheel']) root.addEventListener(e, gate, true);
  // wsel uses viewport coordinates; this modal is also used with CSS Display
  // zoom and a shortened visual viewport. Correct ONLY our owned popup geometry.
  const fitPicker = () => {
    if (gone) return;
    const m = root.closest('dialog')?.querySelector('.ctxmenu'); if (!m) return;
    const v = window.visualViewport, z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const width = v?.width || innerWidth, height = v?.height || innerHeight, x = v?.offsetLeft || 0, y = v?.offsetTop || 0;
    m.style.minWidth = Math.min(190, (width - 16) / z) + 'px'; m.style.maxWidth = (width - 16) / z + 'px';
    m.style.maxHeight = (height - 16) / z + 'px'; m.style.overflowY = 'auto';
    const r = m.getBoundingClientRect(), left = Math.max(x + 8, Math.min(x + width - r.width - 8, r.left)), top = Math.max(y + 8, Math.min(y + height - r.height - 8, r.top));
    m.style.left = ((parseFloat(m.style.left) || 0) + (left - r.left) / z) + 'px';
    m.style.top = ((parseFloat(m.style.top) || 0) + (top - r.top) / z) + 'px';
  };
  const popupObserver = new MutationObserver(records => { if (records.some(r => [...r.addedNodes].some(n => n.nodeType === 1 && n.matches('.ctxmenu')))) fitPicker(); });
  popupObserver.observe(root.closest('dialog') || root, { childList: true, subtree: true });
  load(resolve());
  return { el: root, refresh, reload: () => load(resolve()), destroy() { if (gone) return; gone = true; ++epoch; popupObserver.disconnect(); events.forEach(([e, fn]) => window.removeEventListener(e, fn)); stop(); root.remove(); } };
}

export function openPhoneSound(S, { from = document.activeElement, refreshAll, mount = el => document.body.append(el), onClose = () => {} } = {}) {
  if (!matchMedia('(max-width:900px)').matches || S.view !== 'now') return null;
  let closed = false;
  const locks = [document.documentElement, document.body, document.getElementById('desk')].filter(Boolean).map(el => ({ el, overflow: el.style.overflow, top: el.scrollTop }));
  const x = h('button', { type: 'button', class: 'iconbtn eqsheet-x ww-close', 'aria-label': 'Close Sound', onclick: () => close() }, '✕');
  const body = h('div', { class: 'eqsheet-b' });
  const el = h('dialog', { class: 'eqsheet open npeqsheet', 'aria-label': 'Sound', 'aria-modal': 'true' }, h('header', { class: 'eqsheet-h' }, h('b', {}, 'Sound'), x), body);
  const close = () => {
    if (closed) return; closed = true;
    if (el.querySelector('.ctxmenu')) closeCtx(); eq.destroy(); observer.disconnect();
    document.removeEventListener('keydown', key, true); window.removeEventListener('resize', check);
    window.visualViewport?.removeEventListener('resize', viewport); window.visualViewport?.removeEventListener('scroll', viewport);
    el.close(); el.remove(); document.documentElement.classList.remove('eqsheet-lock');
    locks.forEach(s => { s.el.style.overflow = s.overflow; s.el.scrollTop = s.top; });
    if (from?.isConnected && from.getClientRects().length && !from.closest('[inert]')) from.focus({ preventScroll: true });
    onClose();
  };
  const check = () => { if ([...document.querySelectorAll('dialog[open],.pd42-sheet')].some(d => d !== el && !el.contains(d)) || !el.isConnected || !matchMedia('(max-width:900px)').matches || S.view !== 'now' || (from && !from.isConnected)) close(); };
  const viewport = () => { const v = window.visualViewport; el.style.setProperty('--sound-vh', (v?.height || innerHeight) + 'px'); el.style.setProperty('--sound-vtop', (v?.offsetTop || 0) + 'px'); };
  const key = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (el.querySelector('.ctxmenu')) closeCtx(); else close(); }
    if (e.key === 'Tab') {
      const scope = el.querySelector('.ctxmenu') || el;
      const stops = [...scope.querySelectorAll('button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(e => e.getClientRects().length && !e.closest('[inert]'));
      const at = document.activeElement;
      if (!stops.includes(at) || (e.shiftKey ? at === stops[0] : at === stops.at(-1))) { e.preventDefault(); (e.shiftKey ? stops.at(-1) : stops[0])?.focus(); }
    }
  };
  el.addEventListener('cancel', e => { e.preventDefault(); if (el.querySelector('.ctxmenu')) closeCtx(); else close(); }); el.addEventListener('close', close);
  el.addEventListener('click', e => { const r = el.getBoundingClientRect(); if (e.target === el && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) close(); });
  const observer = new MutationObserver(check);
  mount(el); locks.forEach(s => s.el.style.overflow = 'hidden'); document.documentElement.classList.add('eqsheet-lock');
  viewport(); el.showModal(); const eq = phoneSound(S, body, { refreshAll }); x.focus({ preventScroll: true });
  document.addEventListener('keydown', key, true); window.addEventListener('resize', check);
  window.visualViewport?.addEventListener('resize', viewport); window.visualViewport?.addEventListener('scroll', viewport);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-view'] });
  return { el, x, body, eq, close };
}

// 0.7.2 (t2145u / t2148u): the Volume Mixer is a MODE of the Devices panel, not a window. The Master volume button (player bars, Devices MASTER row,
// mini player), Alt+V, Menu > Master volume and the pinned shortcut open the Devices panel straight into it. In the mode the zones and speakers keep
// the Devices order (the same tree, the same cards); tags, now-playing lines and zone switches step aside and every speaker is ONE line:
// green dot + name, volume bar + %, mute, and a chevron the size of the zone card's that opens Max volume + Delay / sync offset under the row.
// A Volume Mixer bar (Done, or Esc) stays on screen at the top. Replaces the 0.4.8 F49 separate mixer window (nothing is shown twice).
// Kept from F49 / DIG: Max volume before Delay (Max = admin, PUT volcap; Delay = canTune, 0-600 ms, the speaker's active output, live),
// the drawer rows' rails (label | track | value) and the wheel gate (slider.js: in the mode the wheel only moves sliders in the zone box you touched last).
import { h, api, toast } from './util.js';
import { icon, setChev } from './icons.js';
import { canControl, canTune, isAdmin } from './ui.js';
import { clamp } from './mixer-core.js';

let on = false, ctlKey = null;
const openDr = new Set();
const fire = (n, detail) => { try { window.dispatchEvent(new CustomEvent(n, detail ? { detail } : undefined)); } catch { /* node */ } };
export const isMixerOpen = () => on;
/** The zone box (leader id) the wheel may move sliders in (DIG §11 focus, kept from the window). */
export const mixerCtlKey = () => ctlKey;
export const isDrawerOpen = id => on && openDr.has(String(id));
/** Turns the mode on / off; the Devices panel (and the phone page) redraw from it. Off forgets the open drawers and the wheel focus. */
export function setMixer(v) {
  v = !!v; if (v === on) return on; on = v;
  if (!on) { openDr.clear(); ctlKey = null; }
  try { document.documentElement.classList.toggle('mx-open', on); } catch { /* node */ }
  fire('wavwiz:mixermode', { on }); fire('wavwiz:devredraw');
  return on;
}
export function mixerButton(cls = '') {
  return h('button', { type: 'button', class: 'mixbtn ' + cls, 'data-act': 'mixer', 'aria-label': 'Volume mixer', title: 'Volume mixer: every zone and speaker in Devices (Alt+V)', onclick: ev => { ev.stopPropagation(); fire('wavwiz:mixer'); } }, icon('mixer'));
}
/** The Volume Mixer bar at the top of the Devices panel (sticky on PC, pinned under the header on the phone). */
export function mixerBar() {
  return h('div', { class: 'mx-bar', role: 'region', 'aria-label': 'Volume mixer' },
    h('b', { class: 'mx-bar-t' }, 'Volume mixer'), h('span', { class: 'small dim mx-bar-hint' }, 'Esc or Done to go back'), h('span', { class: 'grow' }),
    h('button', { type: 'button', class: 'btn sm primary mx-done', 'data-act': 'mixer-done', onclick: ev => { ev.stopPropagation(); setMixer(false); } }, 'Done'));
}

// ---- one speaker row's mixer parts: volume (+ %), chevron and the Max volume / Delay drawer
const sendT = new Map();
const sendVol = (id, v) => { clearTimeout(sendT.get(id)); sendT.set(id, setTimeout(() => { sendT.delete(id); api(`/zones/${id}`, { method: 'PATCH', body: { volume: v } }).catch(e => toast(e.message, true)); }, 90)); };
const fill = r => r.style.setProperty('--v', (+r.value - +(r.min || 0)) / ((+r.max || 100) - +(r.min || 0)) * 100 + '%');
/** z = the live S.zones object (the value is set on it at once, so a redraw right after the drag shows the new level). */
export function mixVol(S, z) {
  const off = !z.connected, pct = h('span', { class: 'mx-pct' }, off ? '—' : Math.round(z.volume) + '%');
  const r = h('input', { type: 'range', class: 'mx-r', min: 0, max: 100, step: 1, value: Math.round(z.volume), 'aria-label': `${z.name} volume`, disabled: off || !canControl(S) || undefined });
  fill(r);
  r.addEventListener('input', () => { const v = +r.value; fill(r); pct.textContent = v + '%'; z.volume = v; sendVol(z.id, v); });
  return h('span', { class: 'mx-vol', 'data-mx-id': z.id }, r, pct);
}
export function mixChev(z, drawer) {
  const open = isDrawerOpen(z.id), off = !z.connected;
  const b = h('button', { type: 'button', class: 'plus chv zfold42-t mx-chev' + (open ? ' open' : ''), 'data-act': 'mx-drawer', 'aria-expanded': String(open), 'aria-label': `Delay and max volume for ${z.name}`, title: 'Delay and max volume', disabled: off || undefined,
    onclick: ev => { ev.stopPropagation(); ev.preventDefault(); const o = !openDr.has(String(z.id)); o ? openDr.add(String(z.id)) : openDr.delete(String(z.id)); b.classList.toggle('open', o); b.setAttribute('aria-expanded', String(o)); setChev(b, o ? 'u' : 'd'); drawer.hidden = !o; } });
  setChev(b, open ? 'u' : 'd');
  return b;
}
/** Max volume first (matches Speaker settings / Devices), then Delay (length free). Same API calls as the F49 window drawer. */
export function mixDrawer(S, ctl, z) {
  const o = (z.outputs || []).find(x => x.active) || (z.outputs || []).find(x => x.deviceId === z.chosenDeviceId) || (z.outputs || [])[0], tune = !!o && canTune(S, z), admin = isAdmin(S);
  const lat = Math.round(o?.latencyMs ?? 0), cap = z.volCap ?? 100;
  const dRange = h('input', { type: 'range', class: 'mv-s mv-delay', min: 0, max: 600, step: 1, value: lat, 'aria-label': `${z.name} delay`, disabled: !tune || undefined }); fill(dRange);
  const num = h('input', { type: 'text', class: 'spk-num mono mv-dnum', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', 'aria-label': `${z.name} delay in milliseconds`, value: String(lat), disabled: !tune || undefined });
  let t = 0; const send = v => { clearTimeout(t); t = setTimeout(() => { const c = (z.outputs || []).find(x => x.deviceId === o.deviceId) || o; api(`/outputs/${encodeURIComponent(c.deviceId)}/latency`, { method: 'PUT', body: { latencyMs: v, playerId: z.playerId, live: true, method: 'manual' } }).then(() => ctl.refreshAll?.()).catch(e => toast(e.message, true)); }, 300); };
  const setD = (v, from) => { v = Math.round(clamp(v, 0, 600)); if (from !== dRange) dRange.value = String(v); fill(dRange); if (from !== num) num.value = String(v); if (o) o.latencyMs = v; send(v); };
  dRange.addEventListener('input', () => setD(+dRange.value, dRange));
  const apply = () => { const v = parseInt(num.value, 10); if (Number.isFinite(v)) setD(v, null); else num.value = dRange.value; };
  num.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); apply(); } else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') { ev.preventDefault(); setD(+dRange.value + (ev.key === 'ArrowUp' ? 1 : -1), null); } });
  num.addEventListener('blur', apply);
  const fine = (d, txt) => h('button', { type: 'button', class: 'spk-fine', 'data-fine': d > 0 ? 'up' : 'down', 'aria-label': `Delay 1 ms ${d > 0 ? 'more' : 'less'}`, disabled: !tune || undefined, onclick: () => setD(+dRange.value + d, null) }, txt);
  const cPct = h('span', { class: 'mv-pct' }, cap + '%');
  const cRange = h('input', { type: 'range', class: 'mv-s mv-cap', min: 0, max: 100, step: 1, value: cap, 'aria-label': `${z.name} max volume`, disabled: !admin || undefined }); fill(cRange);
  cRange.addEventListener('input', () => { const v = +cRange.value; fill(cRange); cPct.textContent = v + '%'; clearTimeout(cRange._t); cRange._t = setTimeout(() => api(`/zones/${z.id}/volcap`, { method: 'PUT', body: { cap: v, locked: v < 100 } }).then(() => ctl.refreshAll?.()).catch(e => toast(e.message, true)), 250); });
  const dr = h('div', { class: 'mv-drawer mx-drawer', 'data-id': z.id },
    h('div', { class: 'mv-drow mv-caprow' }, h('span', { class: 'n' }, 'Max volume'), cRange, cPct),
    h('div', { class: 'mv-drow mv-delayrow' }, h('span', { class: 'n' }, 'Delay / sync offset'), dRange, h('span', { class: 'mv-numw' }, fine(-1, '−'), num, h('span', { class: 'small dim' }, 'ms'), fine(1, '+'))),
    h('div', { class: 'small dim' }, 'Same settings as Speaker settings.'));
  dr.hidden = !isDrawerOpen(z.id) || !z.connected;
  return dr;
}

// ---- Esc leaves the mode; touching a zone box gives it the wheel (DIG §11)
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('keydown', ev => {
    if (!on || ev.key !== 'Escape' || ev.defaultPrevented) return;
    if (document.querySelector('dialog[open], .ctxmenu, .pd42-sheet') || ev.target?.closest?.('input[type=text], textarea, [contenteditable=true]')) return;
    ev.preventDefault(); setMixer(false);
  });
  document.addEventListener('pointerdown', ev => {
    if (!on) return; const box = ev.target?.closest?.('.tree42.mx-on section.qb42[data-leader-id]'); if (!box) return;
    const k = box.dataset.leaderId; if (k === ctlKey) return; ctlKey = k;
    box.closest('.tree42').querySelectorAll('section.qb42.mx-ctl').forEach(e => e.classList.remove('mx-ctl')); box.classList.add('mx-ctl');
  }, true);
}

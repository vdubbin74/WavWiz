// 0.4.8 F49: the Master Volume mixer - every zone and speaker volume on one screen. Opens from the mixer button beside the player bar
// volume, beside the Devices MASTER slider, or Alt+V. PC: a Settings-sized window; phone: full screen with Done.
// DIG pile: one-click drawer (paint guard), Max-before-Delay, master+Max+speaker rail, zone-style All-zones chrome,
// mixer-local .ctl focus + wheel only on focused column (slider.js gate).
import { h, api, toast, dialog } from './util.js';
import { icon } from './icons.js';
import { canControl, canTune, isAdmin } from './ui.js';
import { scaleTo, changed, groupLevel, members, unassigned, tags, clamp } from './mixer-core.js';

let open = null;
export const isMixerOpen = () => !!open;
export function mixerButton(cls = '') { return h('button', { type: 'button', class: 'mixbtn ' + cls, 'data-act': 'mixer', 'aria-label': 'Master volume', title: 'Master volume (Alt+V)', onclick: ev => { ev.stopPropagation(); window.dispatchEvent(new CustomEvent('wavwiz:mixer')); } }, icon('mixer')); }

export function openMixer(S, ctl) {
  if (open) { open.el.querySelector('.mv-body')?.focus?.(); return open; }
  const can = canControl(S), admin = isAdmin(S);
  let dragging = 0, base = null, sendT = 0, uiHold = 0, focusKey = 'all', paintQueued = 0; const pend = new Map();
  const patch = (id, body) => { pend.set(id, { ...(pend.get(id) || {}), ...body }); clearTimeout(sendT); sendT = setTimeout(flush, 90); };
  const flush = () => { for (const [id, b] of pend) api(`/zones/${id}`, { method: 'PATCH', body: b }).catch(e => toast(e.message, true)); pend.clear(); };
  const zoneById = id => (S.zones || []).find(z => z.id === id);
  const enabledOn = () => (S.zones || []).filter(z => z.enabled !== false && z.connected);
  const body = h('div', { class: 'mv-body', tabindex: -1 });
  const pctTxt = (z, v) => (z && !z.connected ? '—' : Math.round(v) + '%');
  const fill = (r) => r.style.setProperty('--v', r.value + '%');
  // drag guard: incoming refreshes are paused while any slider in the mixer is held
  body.addEventListener('pointerdown', ev => {
    if (ev.target.matches?.('input[type=range]')) dragging++;
    // DIG §11: interacting with a column focuses it (wheel then only moves that column)
    const box = ev.target.closest?.('.mv-master, .mv-card');
    if (box) {
      const k = box.classList.contains('mv-master') ? 'all' : (box.dataset.group || 'un');
      if (k !== focusKey) { focusKey = k; body.querySelectorAll('.mv-master.ctl, .mv-card.ctl').forEach(e => { e.classList.remove('ctl'); e.removeAttribute('aria-selected'); }); box.classList.add('ctl'); box.setAttribute('aria-selected', 'true'); }
    }
    // DIG §A: chevron paint-guard so zonesync between pointerdown and click cannot kill the toggle
    if (ev.target.closest?.('.mv-chev')) { uiHold++; }
  });
  const up = () => {
    if (uiHold) { uiHold = 0; }
    if (!dragging) return; dragging = 0; base = null; flush(); setTimeout(() => { if (!dragging && !uiHold) paint(); }, 350);
  };
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  const slider = (label, value, onInput, { disabled = false, cls = '' } = {}) => {
    const r = h('input', { type: 'range', class: 'mv-s ' + cls, min: 0, max: 100, step: 1, value: Math.round(value), 'aria-label': label, disabled });
    fill(r); r.addEventListener('input', () => { fill(r); onInput(+r.value, r); }); r.addEventListener('keydown', () => { base = null; }); return r; };
  const muteBtn = (label, muted, onclick, disabled) => h('button', { type: 'button', class: 'mutebtn mv-m' + (muted ? ' on' : ''), 'aria-label': (muted ? 'Unmute ' : 'Mute ') + label, 'aria-pressed': String(!!muted), title: muted ? 'Unmute' : 'Mute', disabled, onclick }, icon(muted ? 'mute' : 'volume'));
  const tagEl = t => h('span', { class: 'mv-tag t-' + t.toLowerCase() }, t);
  const tagRow = ts => ts.length ? h('span', { class: 'mv-tags' }, ...ts.map(tagEl)) : null;   // 0.4.9 F79: status tags on their own small row under the name, never beside the slider

  // a group (all zones or zone) slider: scale the snapshot taken at drag start
  const groupInput = (ids, pctEl) => (v) => { const zs = ids.map(zoneById).filter(Boolean); if (!base || base.key !== ids.join()) base = { key: ids.join(), vols: zs.map(z => z.volume), ids: zs.map(z => z.id) };
    const caps = base.ids.map(id => zoneById(id)?.volCap ?? 100), next = scaleTo(base.vols, v, caps);
    for (const [i, nv] of changed(base.vols, next)) { const z = zoneById(base.ids[i]); if (z) { z.volume = nv; patch(z.id, { volume: nv }); } }
    for (const [i, nv] of next.entries()) { const r = body.querySelector(`.mv-spk[data-id="${base.ids[i]}"] input.mv-vol`); if (r && r !== document.activeElement) { r.value = String(Math.round(nv)); fill(r); r.closest('.mv-row').querySelector('.mv-pct').textContent = pctTxt(zoneById(base.ids[i]), nv); } }
    pctEl.textContent = Math.round(v) + '%'; };

  function spkRow(z, zoneMuted) {
    const off = !z.connected, row = h('div', { class: 'mv-row mv-spk' + (off ? ' mv-off' : '') + (zoneMuted ? ' mv-zmuted' : ''), 'data-id': z.id });
    const pct = h('span', { class: 'mv-pct' }, pctTxt(z, z.volume));
    const r = slider(`${z.name} volume`, z.volume, v => { z.volume = v; pct.textContent = pctTxt(z, v); patch(z.id, { volume: v }); }, { disabled: off || !can, cls: 'mv-vol' });
    const chev = h('button', { type: 'button', class: 'mv-chev', 'aria-expanded': 'false', 'aria-label': `Delay and max volume for ${z.name}`, title: 'Delay and max volume', disabled: off,
      onclick: () => { const o = chev.getAttribute('aria-expanded') !== 'true'; chev.setAttribute('aria-expanded', String(o)); openDrawers[o ? 'add' : 'delete'](z.id); dr.hidden = !o; } }, icon('chevD'));
    // also toggle on pointerdown so open state commits before a same-tick refresh (DIG §A.3)
    chev.addEventListener('pointerdown', ev => { if (ev.button > 0 || chev.disabled) return; /* uiHold set on body */; });
    const dr = drawer(z); dr.hidden = !openDrawers.has(z.id) || off; chev.setAttribute('aria-expanded', String(!dr.hidden));
    row.append(h('span', { class: 'n', title: z.name }, h('span', { class: 'ell' }, z.name), tagRow(tags(z))), r, pct,
      muteBtn(z.name, z.muted, () => { z.muted = !z.muted; patch(z.id, { muted: z.muted }); paint(); }, off || !can), chev);
    return [row, dr];
  }
  // speaker drawer: Max volume first (matches Speaker settings / Devices), then Delay (length free)
  function drawer(z) {
    const o = (z.outputs || []).find(x => x.active) || (z.outputs || []).find(x => x.deviceId === z.chosenDeviceId) || (z.outputs || [])[0], tune = !!o && canTune(S, z);
    const lat = Math.round(o?.latencyMs ?? 0), cap = z.volCap ?? 100;
    const dRange = h('input', { type: 'range', class: 'mv-s mv-delay', min: 0, max: 600, step: 1, value: lat, 'aria-label': `${z.name} delay`, disabled: !tune }); dRange.style.setProperty('--v', (lat / 6) + '%');
    const num = h('input', { type: 'text', class: 'spk-num mono mv-dnum', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', 'aria-label': `${z.name} delay in milliseconds`, value: String(lat), disabled: !tune });
    let t = 0; const send = v => { clearTimeout(t); t = setTimeout(() => { const c = (z.outputs || []).find(x => x.deviceId === o.deviceId) || o; api(`/outputs/${encodeURIComponent(c.deviceId)}/latency`, { method: 'PUT', body: { latencyMs: v, playerId: z.playerId, live: true, method: 'manual' } }).then(() => ctl.refreshAll?.()).catch(e => toast(e.message, true)); }, 300); };
    const setD = (v, from) => { v = Math.round(clamp(v, 0, 600)); if (from !== dRange) dRange.value = String(v); dRange.style.setProperty('--v', (v / 6) + '%'); if (from !== num) num.value = String(v); if (o) o.latencyMs = v; send(v); };
    dRange.addEventListener('input', () => setD(+dRange.value, dRange));
    const apply = () => { const v = parseInt(num.value, 10); if (Number.isFinite(v)) setD(v, null); else num.value = dRange.value; };
    num.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); apply(); } else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') { ev.preventDefault(); setD(+dRange.value + (ev.key === 'ArrowUp' ? 1 : -1), null); } });
    num.addEventListener('blur', apply);
    const fine = (d, txt) => h('button', { type: 'button', class: 'spk-fine', 'data-fine': d > 0 ? 'up' : 'down', 'aria-label': `Delay 1 ms ${d > 0 ? 'more' : 'less'}`, disabled: !tune, onclick: () => setD(+dRange.value + d, null) }, txt);
    const cPct = h('span', { class: 'mv-pct' }, cap + '%');
    const cRange = slider(`${z.name} max volume`, cap, v => { cPct.textContent = v + '%'; clearTimeout(cRange._t); cRange._t = setTimeout(() => api(`/zones/${z.id}/volcap`, { method: 'PUT', body: { cap: v, locked: v < 100 } }).then(() => ctl.refreshAll?.()).catch(e => toast(e.message, true)), 250); }, { disabled: !admin, cls: 'mv-cap' });
    return h('div', { class: 'mv-drawer', 'data-id': z.id },
      h('div', { class: 'mv-drow mv-caprow' }, h('span', { class: 'n' }, 'Max volume'), cRange, cPct, h('span', { class: 'mv-ph', 'aria-hidden': 'true' }), h('span', { class: 'mv-ph mv-ph-chev', 'aria-hidden': 'true' })),
      h('div', { class: 'mv-drow mv-delayrow' }, h('span', { class: 'n' }, 'Delay / sync offset'), dRange, h('span', { class: 'mv-numw' }, fine(-1, '−'), num, h('span', { class: 'small dim' }, 'ms'), fine(1, '+'))),
      h('div', { class: 'small dim' }, 'Same settings as Speaker settings.'));
  }
  const openDrawers = new Set();
  function paint() {
    if (dragging || uiHold || (body.contains(document.activeElement) && document.activeElement.matches?.('input[type=text]'))) return;
    // DIG §A.2: skip paint while a chevron is hovered/active (pointer still over it)
    if (body.querySelector('.mv-chev:hover, .mv-chev:active, .mv-chev:focus')) return;
    const zs = S.zones || [], gs = S.groups || [], on = enabledOn(), shown = on.length ? on : zs.filter(z => z.enabled !== false);
    const mPct = h('span', { class: 'mv-pct' }, Math.round(groupLevel(shown.map(z => z.volume))) + '%');
    const mR = slider('All zones volume', groupLevel(shown.map(z => z.volume)), groupInput(on.map(z => z.id), mPct), { disabled: !can || !on.length, cls: 'mv-master-s' });
    const all = m => () => { for (const z of zs) if (!!z.muted !== m) { z.muted = m; patch(z.id, { muted: m }); } paint(); };
    // DIG §8/§10/§11: All zones uses zone-card chrome + F66 5-col spacers + selectable .ctl (default focus)
    const masterCtl = focusKey === 'all';
    const master = h('div', { class: 'mv-master' + (masterCtl ? ' ctl' : ''), 'aria-selected': String(masterCtl), role: 'group', 'aria-label': 'All zones' },
      h('div', { class: 'mv-row mv-mrow' }, h('span', { class: 'n' }, 'All zones'), mR, mPct, h('span', { class: 'mv-ph', 'aria-hidden': 'true' }), h('span', { class: 'mv-ph', 'aria-hidden': 'true' })),
      h('div', { class: 'mv-btns' }, h('button', { type: 'button', class: 'btn sm', 'data-act': 'muteall', disabled: !can, onclick: all(true) }, 'Mute all'), h('button', { type: 'button', class: 'btn sm', 'data-act': 'unmuteall', disabled: !can, onclick: all(false) }, 'Unmute all')));
    master.addEventListener('click', ev => { if (ev.target.closest('button,input')) return; focusKey = 'all'; paint(); });
    const card = (title, list, g) => { const live = list.filter(z => z.connected), lv = (live.length ? live : list).map(z => z.volume), muted = !!list.length && list.every(z => z.muted);
      const key = g ? String(g.id) : 'un', cCtl = focusKey === key;
      const c = h('div', { class: 'mv-card' + (cCtl ? ' ctl' : ''), 'data-group': key, 'aria-selected': String(cCtl) });
      c.addEventListener('click', ev => { if (ev.target.closest('button.mv-chev, button.mv-m, button.spk-fine')) return; if (focusKey !== key) { focusKey = key; /* light update without full rebuild of drawers */ body.querySelectorAll('.mv-master.ctl, .mv-card.ctl').forEach(e => { e.classList.remove('ctl'); e.removeAttribute('aria-selected'); }); c.classList.add('ctl'); c.setAttribute('aria-selected', 'true'); } });
      if (g) { const zp = h('span', { class: 'mv-pct' }, Math.round(groupLevel(lv)) + '%');
        c.append(h('div', { class: 'mv-row mv-zrow' }, h('span', { class: 'n', title: g.name }, h('span', { class: 'ell' }, g.name), tagRow(muted ? ['MUTED'] : [])),
          slider(`${g.name} zone volume`, groupLevel(lv), groupInput(live.map(z => z.id), zp), { disabled: !can || !live.length, cls: 'mv-zone-s' }), zp,
          muteBtn(g.name, muted, () => { const m = !muted; for (const z of list) z.muted = m; api(`/groups/${g.id}/mute`, { method: 'POST', body: { muted: m } }).catch(e => toast(e.message, true)); paint(); }, !can || !list.length))); }
      else c.append(h('div', { class: 'mv-grp' }, title));
      const sub = h('div', { class: 'mv-sub' + (g ? '' : ' flat') }); for (const z of list) sub.append(...spkRow(z, g && muted)); if (!list.length) sub.append(h('div', { class: 'small dim' }, 'No speakers')); c.append(sub); return c; };
    const grid = h('div', { class: 'mv-grid' }, ...gs.filter(g => !g.jukebox).map(g => card(g.name, members(zs, g), g)));
    const un = unassigned(zs, gs); if (un.length) grid.append(card('UNASSIGNED SPEAKERS', un, null));
    // F251: dialog.mixer-dlg > .body is the sheet scroller — hold scrollTop across replaceChildren (F233-style); paint() already returns early while dragging
    const sc = body.closest('dialog.mixer-dlg')?.querySelector(':scope > .body');
    const top = sc ? sc.scrollTop : 0;
    body.replaceChildren(master, grid);
    if (sc) { sc.scrollTop = top; requestAnimationFrame(() => { sc.scrollTop = top; }); }
  }
  // DIG §A.2: coalesce zonesync+zonesdata into one paint
  const onSync = () => { if (paintQueued) return; paintQueued = 1; queueMicrotask(() => { paintQueued = 0; paint(); }); };
  window.addEventListener('wavwiz:zonesync', onSync); window.addEventListener('wavwiz:zonesdata', onSync); const poll = setInterval(() => { if (!document.body.contains(body)) return clearInterval(poll); if (!dragging && !uiHold) ctl.refreshAll?.(); }, 1500);
  paint();
  const d = dialog('Master volume', body, [{ text: 'Done', cls: 'primary' }], { cls: 'settings-dlg mixer-dlg', onClose: () => { window.removeEventListener('wavwiz:zonesync', onSync); window.removeEventListener('wavwiz:zonesdata', onSync); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); flush(); const el = open?.el; open = null; setTimeout(() => el?.remove(), 0); } });
  const close0 = d.close; d.close = () => close0(); d.el.querySelector('footer .btn')?.addEventListener('click', () => { window.removeEventListener('wavwiz:zonesync', onSync); window.removeEventListener('wavwiz:zonesdata', onSync); flush(); open = null; });
  d.el.addEventListener('close', () => { if (open && open.el === d.el) { window.removeEventListener('wavwiz:zonesync', onSync); window.removeEventListener('wavwiz:zonesdata', onSync); flush(); open = null; } setTimeout(() => d.el.remove(), 0); });
  open = d; open.paint = paint; return d;
}

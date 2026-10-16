// Top menu: File / Library / Playback / Devices / Help. 0.2.1 F8: menus DO things, Settings SETS things - every item has exactly one home.
// The View menu is gone: Theme, Visualizer, Now Playing style and Display size all live on Settings > Appearance. Phone hamburger reuses the same tree.
import { h, api, toast, dialog } from './util.js';
import { openSettings } from './settings.js';
import { openWhatsNew } from './about.js';
import { openCalibration } from './calibrate.js';
import { canControl, ADMIN_HINT } from './ui.js';
import { signInAsAdmin, leaveAdmin } from './elevate.js';
import { changePhoneRole } from './room.js';
import { isPhoneUa, isPlayerUa } from './phonejoin.js';
import { NEW_KEYS, sleepSpec, eqSpec, playlistsSpec, zonesSpec, scenesSpec, deviceListSpec, runSpec } from './menusub.js';
import { icon } from './icons.js';
import { keysFor, shortcutsBody } from './hotkeys.js';
import { pinToggle, loadPins, pinInfo, MAX_PINS } from './shortcuts.js';
import { importSettings, restoreBackup, exportSettings, backUpNow } from './backupflow.js';


/** 0.3.7 L8: a small pin on a menu row pins / unpins that destination as a shortcut (max 3; Home + pins live in the Now Playing bar and the mini player). */
function pinSpan(id) {
  const on = () => loadPins().includes(id);
  const s = h('span', { class: 'mpin', role: 'button', tabindex: '-1', 'data-pin': id });
  const paint = () => { const p = on(); s.classList.toggle('on', p); s.title = p ? 'Unpin from shortcuts' : 'Pin to shortcuts'; s.setAttribute('aria-label', s.title); s.setAttribute('aria-pressed', String(p)); if (!s.firstChild) s.append(icon('pin')); };
  s.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); const r = pinToggle(id); if (r.full) toast(`All ${MAX_PINS} shortcut slots are taken - unpin one first.`, true); else toast(r.pins.includes(id) ? `Pinned: ${pinInfo(id).label}` : `Unpinned: ${pinInfo(id).label}`); paint(); });
  window.addEventListener('wavwiz:pins', paint); paint(); return s;
}
function menuActions(S, ctl, desktop = false) {
  const { go, refreshAll, act } = ctl;
  // 0.0.8: on the desktop layout "Browse library" and "Devices & zones" slide their side panel in or out (no separate page);
  // the phone hamburger keeps opening the full-screen pages (too narrow for side panels).
  const wideNow = () => { try { return !matchMedia('(max-width:900px)').matches; } catch { return true; } };
  // 0.2.1 F2: "Browse library" always opens the Expanded Library (no separate "Expanded library" item); the phone opens the full Library page.
  const browseLib = () => (desktop && wideNow() && ctl.toggleLibExpanded ? ctl.toggleLibExpanded(true) : go('library'));
  // 0.2.2 T8: "Devices & zones" always opens the EXPANDED Devices view on the desktop, from any state (like Browse library); the phone keeps its page.
  const devPanel = () => (desktop && wideNow() && ctl.toggleDevExpanded ? ctl.toggleDevExpanded(true) : go('devices'));
  const listPanel = () => (desktop && wideNow() && ctl.openQueue ? ctl.openQueue() : go('queue'));   // 0.3.6 K22: always opens the playlist expanded (pulses if it already is)      // 0.1.1: desktop slides the bottom Playlist; phone opens the full page
  const admin = () => S.auth?.role === 'admin';
  const control = () => canControl(S);
  return {
    go, refreshAll, act, admin, control,
    // 0.2.0 item 31: elevate in place (same pairing, same speaker), and drop back again - no sign-out, no new pairing code
    // 0.3.5 J16 (next-menus-*.png): menus open the inline homes from J8 / J9 - no page popups any more
    file: [
      ['Settings', () => openSettings(S, refreshAll, go), null, null, { pin: 'settings', kbd: keysFor('settings') }],
      'hr',
      // 0.3.6 K17 / K19: New ▸ (zone, scene, alarm, schedule) and Run ▸ (scenes, schedules, alarms - the only place to start them)
      ['New', null, null, null, { sub: () => [
        ['Zone', () => ctl.openNew('zone'), () => !admin(), null, { kbd: NEW_KEYS.zone }], ['Scene', () => ctl.openNew('scene'), () => !admin(), null, { kbd: NEW_KEYS.scene }],
        ['Alarm', () => ctl.openNew('alarm'), () => !admin(), null, { kbd: NEW_KEYS.alarm }], ['Schedule', () => ctl.openNew('schedule'), () => !admin(), null, { kbd: NEW_KEYS.schedule }]] }],
      ['Run', null, () => !control(), null, { sub: () => runSpec(S, ctl) }],
      'hr',
      // 0.3.6 K20
      ['Import settings…', () => importSettings(S, refreshAll), () => !admin()],
      ['Restore backup…', () => restoreBackup(S, refreshAll), () => !admin()],
      ['Export settings', () => exportSettings(S), () => !admin()],
      ['Back up now', () => backUpNow(S), () => !admin()],
      'hr',
      ['Sign in as admin…', () => signInAsAdmin(S), null, () => admin()],
      ['Leave admin mode', () => leaveAdmin(S), null, () => !S.auth?.elevated],
      ['Sign out', async () => { try { await api('/auth/logout', { method: 'POST' }); location.reload(); } catch (e) { toast(e.message, true); } }],
    ],
    library: [
      ['Browse library', browseLib, null, null, { pin: 'library' }],
      ['Playlists…', () => go('playlists'), null, null, { sub: () => playlistsSpec(S, ctl) }],
      ['Radio', () => go('radio')],
      ['Queue', listPanel, null, null, { pin: 'queue', kbd: keysFor('queue') }],
      'hr',
      ['Rescan folders', async () => { try { await api('/library/rescan', { method: 'POST' }); toast('Scanning…'); } catch (e) { toast(e.message, true); } }],
      ['CD ripper', () => go('rip'), () => !admin()],
      ['Tag & cover fix', () => go('tags'), () => !admin()],
      ['Tidy up library', () => go('cleanup'), () => !admin()],
    ],
    playback: [
      ['Play / Pause', () => { if (S.now?.state === 'playing') act('/stream/pause'); else act('/stream/play', {}); }, null, null, { kbd: keysFor('playpause') }],
      ['Next', () => act('/stream/next'), null, null, { kbd: keysFor('next') }],
      ['Previous', () => act('/stream/prev'), null, null, { kbd: keysFor('prev') }],
      'hr',
      ['Sound / EQ', () => go('eq'), null, null, { sub: () => eqSpec(S, ctl) , pin: 'eq', kbd: keysFor('eq') }],
      ['Sleep timer', () => go('sleep'), null, null, { sub: () => sleepSpec(S) , pin: 'sleep' }],
      'hr',
      ['Start Jukebox…', () => go('jukebox'), () => !admin()],   // 0.3.0 §1 (beta): admin only, read-only for others
    ],
    devices: [
      ['Devices & zones', devPanel, null, null, { pin: 'devices' }],
      // 0.3.6 K18: hover submenus listing devices, zones and scenes (click jumps to it), each ending with New… (no Start buttons: File > Run is the one place to start)
      ['Devices', devPanel, null, null, { sub: () => deviceListSpec(S, { ...ctl, canAdmin: admin }) }],
      ['Zones', devPanel, null, null, { sub: () => zonesSpec(S, { ...ctl, canAdmin: admin }) }],
      ['Scenes', () => go('scenes'), null, null, { sub: () => scenesSpec(S, { ...ctl, canAdmin: admin }) , pin: 'scenes' }],
      ['Schedules & alarms', () => go('schedules'), null, null, { pin: 'alarms' }],
      ['Calibrate speakers…', () => openCalibration(S, refreshAll), () => !control()],
      ['Phone role…', () => changePhoneRole(), null, () => !isPhoneUa() || isPlayerUa()],      // 0.2.5: speaker or calibration mic (phones only)
      ['Mini player', () => ctl.openMini?.(), null, null, { kbd: keysFor('mini') }],
      'hr',
      ['Pair a player', () => openSettings(S, refreshAll, go, 'players'), () => !admin()],
      ['Away-from-home access', () => go('remote'), () => !admin()],
    ],
    help: [
      ['Getting started', () => (ctl.openSetup ? ctl.openSetup(true) : go('diag'))],
      ["What's new", () => openWhatsNew()],
      ['Keyboard shortcuts', () => dialog('Keyboard shortcuts', shortcutsBody(h), [{ text: 'Close', cls: 'primary' }])],
      ['Diagnostics', () => go('diag')],
      ['About WavWiz', () => go('about')],
    ],
  };
}

export function createMenuBar(S, ctl) {
  const A = menuActions(S, ctl, true);
  let openGroup = null;
  const bar = h('nav', { class: 'menubar', 'aria-label': 'Main menu' });

  const closeAll = () => {
    bar.querySelectorAll('.mgroup.open,.msub.open').forEach(el => el.classList.remove('open'));
    bar.querySelectorAll('[aria-expanded=true]').forEach(el => el.setAttribute('aria-expanded', 'false'));
    openGroup = null;
  };
  const toggle = (group, btn) => {
    const was = group.classList.contains('open');
    closeAll();
    if (!was) { group.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); openGroup = group; }
  };

  function item(label, onclick, opts = {}) {
    return h('button', {
      type: 'button',
      class: opts.check ? 'check' : (opts.nocheck ? 'nocheck' : ''),
      disabled: opts.disabled || undefined,
      onclick: ev => { ev.stopPropagation(); closeAll(); onclick?.(); },
    }, label);
  }
  /** 0.3.6 K16: a choice-list item opens a flyout on hover (or Right arrow / click); it opens toward the free side of the screen and fills asynchronously. */
  function flyout(label, fn, subFn, disabled) {
    const sub = h('div', { class: 'msub flyout' + (disabled ? ' dis' : '') }), panel = h('div', { class: 'mpanel', role: 'menu', 'aria-label': label });
    let loaded = 0;
    const place = () => {
      sub.classList.remove('flip', 'up'); panel.style.top = '';
      const r = panel.getBoundingClientRect(), z = Number(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1;
      if (r.right > innerWidth - 6) sub.classList.add('flip');
      const over = r.bottom - (innerHeight - 6); if (over > 0) panel.style.top = -Math.min(over / z, panel.offsetHeight - 30) + 'px';
    };
    const fill = async () => {
      const tok = ++loaded; panel.replaceChildren(h('div', { class: 'mloading' }, 'Loading…')); place();
      let spec = []; try { spec = await subFn(); } catch { spec = []; }
      if (tok !== loaded) return; panel.replaceChildren(...fromSpec(spec)); place();
    };
    const open = () => { if (disabled) return; sub.parentElement?.querySelectorAll(':scope>.msub.open').forEach(x => { if (x !== sub) x.classList.remove('open'); }); if (!sub.classList.contains('open')) { sub.classList.add('open'); fill(); } };
    const btn = h('button', { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', disabled: disabled || undefined,
      onclick: ev => { ev.stopPropagation(); if (fn) { closeAll(); fn(); } else open(); },
      onmouseenter: open, onfocus: () => {},
      onkeydown: ev => { if (ev.key === 'ArrowRight') { ev.preventDefault(); open(); panel.querySelector('button')?.focus(); } } }, label);
    if (disabled) btn.title = ADMIN_HINT;
    panel.addEventListener('keydown', ev => { if (ev.key === 'ArrowLeft') { ev.preventDefault(); sub.classList.remove('open'); btn.focus(); } });
    sub.addEventListener('mouseleave', () => sub.classList.remove('open'));
    sub.append(btn, panel);
    new MutationObserver(() => btn.setAttribute('aria-expanded', String(sub.classList.contains('open')))).observe(sub, { attributes: true, attributeFilter: ['class'] });
    return sub;
  }
  function top(label, ...kids) {
    const group = h('div', { class: 'mgroup' });
    // 0.2.1 F6: Windows-style - one click opens a menu; while any menu is open, hovering another top-level menu switches to it (no click);
    // a click outside or Esc closes; Left / Right move between open menus.
    const btn = h('button', { class: 'mtop', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: ev => { ev.stopPropagation(); toggle(group, btn); },
      onmouseenter: () => { if (openGroup && openGroup !== group) toggle(group, btn); },
      onkeydown: ev => { if (!openGroup || (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft')) return; ev.preventDefault(); const tops = [...bar.querySelectorAll('.mtop')], i = tops.indexOf(btn), n = tops[(i + (ev.key === 'ArrowRight' ? 1 : tops.length - 1)) % tops.length]; n.focus(); toggle(n.parentElement, n); } }, label);
    const panel = h('div', { class: 'mpanel', role: 'menu' }, ...kids.filter(Boolean));
    group.append(btn, panel);
    bar.append(group);
    return panel;
  }
  function fromSpec(spec) {
    return spec.map(s => {
      if (s === 'hr') return h('hr');
      const [label, fn, dis, hide, o] = s;
      if (hide?.()) return null;
      if (o?.sub) { const f = flyout(label, fn, o.sub, !!dis?.()); if (o.kbd) f.querySelector(':scope > button')?.append(h('span', { class: 'kbd' }, o.kbd)); if (o.pin) f.querySelector(':scope > button')?.append(pinSpan(o.pin)); return f; }
      const b = item(label, fn, { disabled: !!dis?.() || !fn }); if (dis?.()) b.title = ADMIN_HINT;     // 0.2.0 item 28: read-only, never hidden
      if (o?.pin) b.append(pinSpan(o.pin));
      if (o?.kbd) b.append(h('span', { class: 'kbd' }, o.kbd)); if (o?.heading) b.classList.add('mheading');
      return b;
    }).filter(Boolean);
  }

  // 0.2.0 item 31: the menus refill when the role changes (Sign in as admin / Leave admin mode) - no page reload, so the sound keeps playing
  const topSpec = (label, key) => { const panel = top(label, ...fromSpec(A[key])); window.addEventListener('wavwiz:auth', () => panel.replaceChildren(...fromSpec(A[key]))); return panel; };
  topSpec('File', 'file');
  topSpec('Library', 'library');
  topSpec('Playback', 'playback');
  topSpec('Devices', 'devices');

  topSpec('Help', 'help');

  document.addEventListener('click', () => closeAll());
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeAll(); });
  return bar;
}

/** Phone hamburger: same top-level items as the PC menu bar, accordion submenus, large tap targets. */
export function createPhoneDrawerNav(S, ctl, { onClose, versionLabel } = {}) {
  const A = menuActions(S, ctl);
  const nav = h('nav', { 'aria-label': 'Menu' });
  nav.append(h('div', { class: 'row', style: 'padding:4px 8px 10px;gap:8px' },
    h('b', null, 'WavWiz'), h('span', { class: 'beta' }, versionLabel || 'BETA')));

  function close() { onClose?.(); }
  function leaf(label, run, opts = {}) {
    return h('button', {
      type: 'button',
      class: opts.check ? 'check' : (opts.nocheck ? 'nocheck' : ''),
      disabled: opts.disabled || undefined,
      onclick: () => { close(); run?.(); },
    }, label);
  }
  function fromSpec(spec) {
    return spec.map(s => {
      if (s === 'hr') return h('hr');
      const [label, fn, dis, hide, o] = s;
      if (hide?.()) return null;
      if (o?.sub) return nestedAsync(label, o.sub);
      const b = leaf(label, fn, { disabled: !!dis?.() || !fn }); if (dis?.()) b.title = ADMIN_HINT;
      if (o?.kbd) b.append(h('span', { class: 'kbd' }, o.kbd)); if (o?.heading) b.classList.add('mheading');
      return b;
    }).filter(Boolean);
  }
  function accordion(label, kidsBuilder) {
    const box = h('div', { class: 'macc' });
    const panel = h('div', { class: 'mpanel' });
    const btn = h('button', { type: 'button', onclick: () => {
      const open = box.classList.toggle('open');
      if (open) { panel.replaceChildren(...kidsBuilder()); nav.querySelectorAll('.macc.open').forEach(x => { if (x !== box) x.classList.remove('open'); }); }
    } }, label);
    box.append(btn, panel);
    return box;
  }
  /** 0.3.6: the same choice lists as the PC flyouts, as tap-to-open accordions on the phone. */
  function nestedAsync(label, subFn) {
    const sub = h('div', { class: 'msub' }), panel = h('div', { class: 'mpanel' });
    const btn = h('button', { type: 'button', onclick: async ev => { ev.stopPropagation(); const open = sub.classList.toggle('open'); if (!open) return; panel.replaceChildren(h('div', { class: 'mloading' }, 'Loading…')); let spec = []; try { spec = await subFn(); } catch { spec = []; } panel.replaceChildren(...fromSpec(spec)); } }, label);
    sub.append(btn, panel); return sub;
  }
  function nested(label, kids) {
    const sub = h('div', { class: 'msub' });
    const panel = h('div', { class: 'mpanel' }, ...kids);
    const btn = h('button', { type: 'button', onclick: ev => { ev.stopPropagation(); sub.classList.toggle('open'); } }, label);
    sub.append(btn, panel);
    return sub;
  }

  nav.append(
    accordion('File', () => fromSpec(A.file)),
    accordion('Library', () => fromSpec(A.library)),
    accordion('Playback', () => fromSpec(A.playback)),
    accordion('Devices', () => fromSpec(A.devices)),
    accordion('Help', () => fromSpec(A.help)),
  );
  return nav;
}

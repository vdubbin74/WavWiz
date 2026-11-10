import { toggleAppFull } from './fullscreen.js';
import { ripAllowed } from './library.js';
// Top menu: File / Library / Playback / Devices / Help. 0.2.1 F8: menus DO things, Settings SETS things - every item has exactly one home.
// The View menu is gone: Theme, Visualizer, Now Playing style and Display size all live on Settings > Appearance. Phone hamburger reuses the same tree.
import { h, api, toast, dialog } from './util.js';
import { openSettings, GROUPS } from './settings.js';
import { openWhatsNew } from './about.js';
import { openCalibration } from './calibrate.js';
import { canControl, ADMIN_HINT } from './ui.js';
import { signInAsAdmin, leaveAdmin } from './elevate.js';
import { changePhoneRole } from './room.js';
import { isPhoneUa, isPlayerUa, isHandset } from './phonejoin.js';
import { NEW_KEYS, sleepSpec, eqSpec, playlistsSpec, zonesSpec, scenesSpec, deviceListSpec, runSpec } from './menusub.js';
import { icon } from './icons.js';
import { shouldOffer, a2hsCard, rememberedNote, boot as a2hsBoot } from './a2hs.js';
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
const mlbl = t => h('span', { class: 'mlbl' }, t);
function adorn(btn, o, pins = true) {
  if (o?.pin && pins) btn.append(pinSpan(o.pin));
  if (o?.kbd) btn.append(h('span', { class: 'kbd' }, o.kbd));
  if (o?.heading) btn.classList.add('mheading');
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
      // F117: click opens Settings as before; the flyout lists the nine sections in tab order
      ['Settings', () => openSettings(S, refreshAll, go), null, null, { pin: 'settings', kbd: keysFor('settings'), sub: () => GROUPS.map(([id, label]) => [label, () => openSettings(S, refreshAll, go, id)]) }],
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
      ...(ripAllowed() ? [['CD ripper', () => go('rip'), () => !admin()]] : []),   // 0.4.8 F57: PC app only
      ['Tag & cover fix', () => go('tags'), () => !admin()],
      ['Tidy up library', () => go('cleanup'), () => !admin()],
    ],
    playback: [
      ['Now Playing', () => go('now')],   // 0.6.8: reachable from standard menus (narrow PC drops the views half)
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
      ['Master volume', () => window.dispatchEvent(new CustomEvent('wavwiz:mixer')), null, null, { pin: 'mixer', kbd: keysFor('mixer') }],   // F149
      // 0.3.6 K18: hover submenus listing devices, zones and scenes (click jumps to it), each ending with New… (no Start buttons: File > Run is the one place to start)
      ['Speakers', devPanel, null, null, { sub: () => deviceListSpec(S, { ...ctl, canAdmin: admin }) }],
      ['Zones', devPanel, null, null, { sub: () => zonesSpec(S, { ...ctl, canAdmin: admin }) }],
      ['Scenes', () => go('scenes'), null, null, { sub: () => scenesSpec(S, { ...ctl, canAdmin: admin }) , pin: 'scenes' }],
      ['Schedules & alarms', () => go('schedules'), null, null, { pin: 'alarms' }],
      ['Calibrate speakers…', () => openCalibration(S, refreshAll), () => !control()],
      ['Phone role…', () => changePhoneRole(), null, () => !isPhoneUa() || isPlayerUa()],      // 0.5.0: speaker, remote, or calibration mic (phones only)
      ['Mini player', () => ctl.openMini?.(), null, null, { kbd: keysFor('mini') }],
      ['Fullscreen', () => toggleAppFull(), null, () => isPhoneUa() && !isPlayerUa(), { kbd: keysFor('fullscreen') }],   // 0.5.0 F120: borderless whole-window
      'hr',
      ['Pair a player', () => openSettings(S, refreshAll, go, 'players'), () => !admin()],
      ['Away-from-home access', () => openSettings(S, refreshAll, go, 'remote'), () => !admin()],   // F117: Settings > Network (Tailscale card)
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
    }, mlbl(label));
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
      onkeydown: ev => { if (ev.key === 'ArrowRight') { ev.preventDefault(); open(); panel.querySelector('button')?.focus(); } } }, mlbl(label));
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
      if (o?.sub) { const f = flyout(label, fn, o.sub, !!dis?.()); adorn(f.querySelector(':scope > button'), o); return f; }
      const b = item(label, fn, { disabled: !!dis?.() || !fn }); if (dis?.()) b.title = ADMIN_HINT;     // 0.2.0 item 28: read-only, never hidden
      adorn(b, o);
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
  // 0.6.8: a narrow PC / desktop Player window gets the standard File / Library / Playback / Devices / Help
  // menus (flyout when there is room, accordion when not). No views half / "All menus" / Done. Real phones keep the short F67 list.
  if (!isPhoneUa()) return createCompactPcNav(S, ctl, { onClose, versionLabel });
  const A = menuActions(S, ctl);
  const nav = h('nav', { 'aria-label': 'Menu' });
  nav.append(h('div', { class: 'row', style: 'padding:4px 8px 10px;gap:8px' },
    h('b', null, 'WavWiz'), h('span', { class: 'beta', 'data-wwv': 'BETA {v}' }, versionLabel || 'BETA'), h('span', { class: 'grow' }),
    h('button', { type: 'button', class: 'drawer-close', 'data-act': 'drawer-close', 'aria-label': 'Close the menu', onclick: () => onClose?.() }, 'Done')));   // 0.4.6 F43: a clear way out

  function close() { onClose?.(); }
  function leaf(label, run, opts = {}) {
    return h('button', {
      type: 'button',
      class: opts.check ? 'check' : (opts.nocheck ? 'nocheck' : ''),
      disabled: opts.disabled || undefined,
      onclick: () => { close(); run?.(); },
    }, mlbl(label));
  }
  function fromSpec(spec) {
    return spec.map(s => {
      if (s === 'hr') return h('hr');
      const [label, fn, dis, hide, o] = s;
      if (hide?.()) return null;
      if (o?.sub) { const n = nestedAsync(label, o.sub); adorn(n.querySelector(':scope > button'), o, !isPhoneUa()); return n; }   // 0.6.8-#5
      const b = leaf(label, fn, { disabled: !!dis?.() || !fn }); if (dis?.()) b.title = ADMIN_HINT;
      adorn(b, o, !isPhoneUa());   // 0.6.8-#5: pins are a desktop feature - kept in a narrow PC window
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
    const btn = h('button', { type: 'button', onclick: async ev => { ev.stopPropagation(); const open = sub.classList.toggle('open'); if (!open) return; panel.replaceChildren(h('div', { class: 'mloading' }, 'Loading…')); let spec = []; try { spec = await subFn(); } catch { spec = []; } panel.replaceChildren(...fromSpec(spec)); } }, mlbl(label));
    sub.append(btn, panel); return sub;
  }
  function nested(label, kids) {
    const sub = h('div', { class: 'msub' });
    const panel = h('div', { class: 'mpanel' }, ...kids);
    const btn = h('button', { type: 'button', onclick: ev => { ev.stopPropagation(); sub.classList.toggle('open'); } }, mlbl(label));
    sub.append(btn, panel);
    return sub;
  }

  a2hsBoot();
  if (shouldOffer({})) nav.append(h('button', { type: 'button', class: 'a2hs-entry', onclick: () => { close(); dialog('Add to Home Screen', a2hsCard(), [{ text: 'Close', cls: 'primary' }]); } }, 'Add to Home Screen'), h('hr'));
  // 0.4.9 F67: the phone menu is plain items (no submenus, no File / Playback / Mini player, no shortcut labels), each opening an existing view:
  // Devices & Zones holds devices, zones, pairing and calibrate; Settings holds EQ / sound, away-from-home access and help / about.
  // 0.5.0 F127: Phone role… (speaker / remote / calibration mic) has its own drawer row so phones can find it; skipped in the Player WebView.
  nav.append(
    leaf('Now Playing', () => ctl.go?.('now')),
    leaf('Queue', () => (ctl.openQueue ? ctl.openQueue() : ctl.go?.('queue'))),
    (() => { const b = leaf('Volume Mixer', () => window.dispatchEvent(new CustomEvent('wavwiz:mixer'))); if (!isHandset()) b.append(pinSpan('mixer')); return b; })(),   // F149: pinnable; 0.6.8-#11d: no pins on actual phones
    leaf('Library', () => ctl.go?.('library')),
    leaf('Devices & Zones', () => ctl.go?.('devices')),
    ...(isPhoneUa() && !isPlayerUa() ? [leaf('Phone role…', () => changePhoneRole())] : []),
    leaf('Scenes & Alarms', () => ctl.go?.('scenes')),
    leaf('Settings', () => openSettings(S, ctl.refreshAll, ctl.go)),
  );
  return nav;
}

/** 0.6.8: narrow desktop Player hamburger — standard File / Library / Playback / Devices / Help.
 *  Same items / pins / shortcuts as the wide menubar. When ~220px+ is free to the right of the menu
 *  panel, submenus hover-fly out; otherwise they accordion (slide down inline). Views that used to sit
 *  in the top half stay reachable here (Now Playing under Playback; Queue / Library / Mixer / Devices /
 *  Scenes / Alarms / Settings already lived in these menus). Pins use the themed SVG icon (no emoji). */
function createCompactPcNav(S, ctl, { onClose } = {}) {
  const A = menuActions(S, ctl, true);
  const nav = h('nav', { class: 'desk-menus desk-fly', 'aria-label': 'Main menu' });
  const FLYOUT_MIN_W = 220;   // submenu needs roughly this much free width to the right of the panel
  let openGroup = null;
  let mode = 'flyout';   // 'flyout' | 'accordion'

  const isAcc = () => mode === 'accordion';
  /** Prefer opening to the right of the menu panel; accordion when that would clip or leave < ~220px. */
  function flyoutFits() {
    const r = nav.getBoundingClientRect();
    if (!r.width) {
      const est = Math.min(200, Math.round(innerWidth * 0.72));
      return innerWidth - est - 6 >= FLYOUT_MIN_W;
    }
    return innerWidth - r.right - 6 >= FLYOUT_MIN_W;
  }
  function applyMode() {
    const next = flyoutFits() ? 'flyout' : 'accordion';
    if (next === mode) {
      nav.classList.toggle('desk-acc', mode === 'accordion');
      nav.classList.toggle('desk-fly', mode === 'flyout');
      return;
    }
    mode = next;
    nav.classList.toggle('desk-acc', mode === 'accordion');
    nav.classList.toggle('desk-fly', mode === 'flyout');
    closeAll();
  }

  const closeAll = () => {
    nav.querySelectorAll('.mgroup.open,.msub.open').forEach(el => el.classList.remove('open'));
    nav.querySelectorAll('[aria-expanded=true]').forEach(el => el.setAttribute('aria-expanded', 'false'));
    nav.querySelectorAll('.mpanel').forEach(p => {
      p.style.top = p.style.left = p.style.right = p.style.maxHeight = p.style.position = '';
      p.classList.remove('flip');
    });
    openGroup = null;
  };
  const closeDrawer = () => { closeAll(); onClose?.(); };
  const toggle = (group, btn) => {
    const was = group.classList.contains('open');
    closeAll();
    if (!was) {
      group.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      openGroup = group;
      if (!isAcc()) placePanel(group);
    }
  };
  /** Keep a flyout panel inside the window: prefer to the right of its button; flip / clamp when needed. */
  function placePanel(groupOrSub) {
    if (isAcc()) return;
    const panel = groupOrSub.querySelector(':scope > .mpanel');
    const btn = groupOrSub.querySelector(':scope > button');
    if (!panel || !btn) return;
    panel.classList.remove('flip'); panel.style.top = ''; panel.style.left = ''; panel.style.right = ''; panel.style.maxHeight = '';
    const br = btn.getBoundingClientRect(), z = Number(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1;
    let left = br.right + 2, top = br.top;
    panel.style.position = 'fixed';
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.right = 'auto';
    const r = panel.getBoundingClientRect();
    if (r.right > innerWidth - 6) {
      left = br.left - r.width - 2;
      if (left < 6) left = Math.max(6, innerWidth - r.width - 6);
      panel.style.left = left + 'px';
      panel.classList.add('flip');
    }
    const over = panel.getBoundingClientRect().bottom - (innerHeight - 6);
    if (over > 0) panel.style.top = Math.max(6, top - Math.min(over / z, panel.offsetHeight - 30)) + 'px';
    panel.style.maxHeight = Math.max(120, innerHeight - 12) + 'px';
  }

  function item(label, onclick, opts = {}) {
    return h('button', {
      type: 'button',
      class: opts.check ? 'check' : (opts.nocheck ? 'nocheck' : ''),
      disabled: opts.disabled || undefined,
      onclick: ev => { ev.stopPropagation(); closeDrawer(); onclick?.(); },
    }, mlbl(label));
  }
  function flyout(label, fn, subFn, disabled) {
    const sub = h('div', { class: 'msub flyout' + (disabled ? ' dis' : '') }), panel = h('div', { class: 'mpanel', role: 'menu', 'aria-label': label });
    let loaded = 0;
    const fill = async () => {
      const tok = ++loaded; panel.replaceChildren(h('div', { class: 'mloading' }, 'Loading…')); if (!isAcc()) placePanel(sub);
      let spec = []; try { spec = await subFn(); } catch { spec = []; }
      if (tok !== loaded) return; panel.replaceChildren(...fromSpec(spec)); if (!isAcc()) placePanel(sub);
    };
    const openFly = () => {
      if (disabled || isAcc()) return;
      sub.parentElement?.querySelectorAll(':scope > .msub.open').forEach(x => { if (x !== sub) x.classList.remove('open'); });
      if (!sub.classList.contains('open')) { sub.classList.add('open'); fill(); }
    };
    const toggleAcc = () => {
      if (disabled) return;
      const was = sub.classList.contains('open');
      sub.parentElement?.querySelectorAll(':scope > .msub.open').forEach(x => { if (x !== sub) x.classList.remove('open'); });
      if (was) { sub.classList.remove('open'); return; }
      sub.classList.add('open'); fill();
    };
    const btn = h('button', { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', disabled: disabled || undefined,
      onclick: ev => {
        ev.stopPropagation();
        if (isAcc()) { toggleAcc(); return; }
        if (fn) { closeDrawer(); fn(); } else openFly();
      },
      onmouseenter: () => { if (!isAcc()) openFly(); },
      onkeydown: ev => {
        if (ev.key === 'ArrowRight' || (isAcc() && (ev.key === 'Enter' || ev.key === ' '))) {
          ev.preventDefault();
          if (isAcc()) toggleAcc();
          else { openFly(); panel.querySelector('button')?.focus(); }
        }
      } }, mlbl(label));
    if (disabled) btn.title = ADMIN_HINT;
    panel.addEventListener('keydown', ev => { if (ev.key === 'ArrowLeft') { ev.preventDefault(); sub.classList.remove('open'); btn.focus(); } });
    sub.addEventListener('mouseleave', () => { if (!isAcc()) sub.classList.remove('open'); });
    sub.append(btn, panel);
    new MutationObserver(() => btn.setAttribute('aria-expanded', String(sub.classList.contains('open')))).observe(sub, { attributes: true, attributeFilter: ['class'] });
    return sub;
  }
  function top(label, ...kids) {
    const group = h('div', { class: 'mgroup' });
    const btn = h('button', { class: 'mtop', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false',
      onclick: ev => { ev.stopPropagation(); toggle(group, btn); },
      onmouseenter: () => { if (!isAcc() && openGroup && openGroup !== group) toggle(group, btn); },
      onkeydown: ev => {
        if (isAcc()) {
          if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'ArrowRight') {
            ev.preventDefault();
            toggle(group, btn);
            if (group.classList.contains('open')) group.querySelector(':scope > .mpanel button')?.focus();
            return;
          }
          if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
            ev.preventDefault();
            const tops = [...nav.querySelectorAll('.mtop')], i = tops.indexOf(btn);
            const n = tops[(i + (ev.key === 'ArrowDown' ? 1 : tops.length - 1)) % tops.length];
            n.focus();
            return;
          }
          return;
        }
        if (!openGroup || (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp' && ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft')) return;
        ev.preventDefault();
        const tops = [...nav.querySelectorAll('.mtop')], i = tops.indexOf(btn);
        if (ev.key === 'ArrowRight') { group.querySelector(':scope > .mpanel button')?.focus(); return; }
        const n = tops[(i + (ev.key === 'ArrowDown' ? 1 : tops.length - 1)) % tops.length];
        n.focus(); toggle(n.parentElement, n);
      } }, label);
    const panel = h('div', { class: 'mpanel', role: 'menu' }, ...kids.filter(Boolean));
    group.append(btn, panel);
    nav.append(group);
    return panel;
  }
  function fromSpec(spec) {
    return spec.map(s => {
      if (s === 'hr') return h('hr');
      const [label, fn, dis, hide, o] = s;
      if (hide?.()) return null;
      if (o?.sub) { const f = flyout(label, fn, o.sub, !!dis?.()); adorn(f.querySelector(':scope > button'), o); return f; }
      const b = item(label, fn, { disabled: !!dis?.() || !fn }); if (dis?.()) b.title = ADMIN_HINT;
      adorn(b, o);
      return b;
    }).filter(Boolean);
  }

  const topSpec = (label, key) => { const panel = top(label, ...fromSpec(A[key])); window.addEventListener('wavwiz:auth', () => { panel.replaceChildren(...fromSpec(A[key])); if (openGroup && !isAcc()) placePanel(openGroup); }); return panel; };
  topSpec('File', 'file');
  topSpec('Library', 'library');
  topSpec('Playback', 'playback');
  topSpec('Devices', 'devices');
  topSpec('Help', 'help');

  applyMode();
  window.addEventListener('resize', applyMode);
  // Re-measure once laid out in the drawer (nav width is CSS-driven).
  try { new ResizeObserver(applyMode).observe(nav); } catch { /* older engines: resize listener is enough */ }

  // Click outside a panel (on the scrim) closes; Escape is handled by main.js toggleDrawer.
  nav.addEventListener('keydown', ev => { if (ev.key === 'Escape') { if (openGroup || nav.querySelector('.msub.open')) { closeAll(); ev.stopPropagation(); } } });
  return nav;
}

// Top menu: File / Library / Playback / Devices / Help. 0.2.1 F8: menus DO things, Settings SETS things - every item has exactly one home.
// The View menu is gone: Theme, Visualizer, Now Playing style and Display size all live on Settings > Appearance. Phone hamburger reuses the same tree.
import { h, api, toast } from './util.js';
import { openSettings } from './settings.js';
import { openAbout, openWhatsNew } from './about.js';
import { openEq } from './eq.js';
import { openCalibration } from './calibrate.js';
import { canControl, ADMIN_HINT } from './ui.js';
import { signInAsAdmin, leaveAdmin } from './elevate.js';


function menuActions(S, ctl, desktop = false) {
  const { go, refreshAll, act } = ctl;
  // 0.0.8: on the desktop layout "Browse library" and "Devices & zones" slide their side panel in or out (no separate page);
  // the phone hamburger keeps opening the full-screen pages (too narrow for side panels).
  const wideNow = () => { try { return !matchMedia('(max-width:900px)').matches; } catch { return true; } };
  // 0.2.1 F2: "Browse library" always opens the Expanded Library (no separate "Expanded library" item); the phone opens the full Library page.
  const browseLib = () => (desktop && wideNow() && ctl.toggleLibExpanded ? ctl.toggleLibExpanded(true) : go('library'));
  // 0.2.2 T8: "Devices & zones" always opens the EXPANDED Devices view on the desktop, from any state (like Browse library); the phone keeps its page.
  const devPanel = () => (desktop && wideNow() && ctl.toggleDevExpanded ? ctl.toggleDevExpanded(true) : go('devices'));
  const listPanel = () => (desktop && wideNow() && ctl.toggleList ? ctl.toggleList() : go('queue'));      // 0.1.1: desktop slides the bottom Playlist; phone opens the full page
  const admin = () => S.auth?.role === 'admin';
  const control = () => canControl(S);
  return {
    go, refreshAll, act, admin, control,
    // 0.2.0 item 31: elevate in place (same pairing, same speaker), and drop back again - no sign-out, no new pairing code
    file: [
      ['Settings…', () => openSettings(S, refreshAll, go)],
      'hr',
      ['Sign in as admin…', () => signInAsAdmin(S), null, () => admin()],
      ['Leave admin mode', () => leaveAdmin(S), null, () => !S.auth?.elevated],
      ['Sign out', async () => { try { await api('/auth/logout', { method: 'POST' }); location.reload(); } catch (e) { toast(e.message, true); } }],
    ],
    // 0.2.1 F8: one "Queue" (the separate "Playlist" item is gone - on the desktop Queue still slides the bottom panel)
    library: [
      ['Browse library', browseLib],
      ['Playlists', () => go('playlists')],
      ['Queue', listPanel],
      'hr',
      ['Rescan folders', async () => { try { await api('/library/rescan', { method: 'POST' }); toast('Scanning…'); } catch (e) { toast(e.message, true); } }],
      ['Tidy up library', () => go('cleanup'), () => !admin()],
      ['Tag & cover fix…', () => go('tags'), () => !admin()],
      ['CD ripper…', () => go('rip'), () => !admin()],
    ],
    // 0.2.1 F8: Radio finder is a tab inside Internet radio; Scenes, Schedules and Calibrate moved to Devices
    playback: [
      ['Play / Pause', () => { if (S.now?.state === 'playing') act('/stream/pause'); else act('/stream/play', {}); }],
      ['Next', () => act('/stream/next')],
      ['Previous', () => act('/stream/prev')],
      'hr',
      ['Internet radio', () => go('radio')],
      ['Sound / EQ…', () => openEq(S, refreshAll)],
    ],
    // 0.2.0 item 2: no "This phone as a device" anywhere - every browser joins as a speaker by itself.
    devices: [
      ['Devices & zones', devPanel],
      ['Scenes', () => go('scenes')],
      ['Schedules', () => go('schedules')],
      ['Calibrate speakers…', () => openCalibration(S, refreshAll), () => !control()],
      'hr',
      ['Pair a player…', () => openSettings(S, refreshAll, go, 'players'), () => !admin()],
      ['Away-from-home…', () => go('remote'), () => !admin()],
    ],
    help: [
      ['Getting started', () => (ctl.openSetup ? ctl.openSetup(true) : go('diag'))],      // 0.2.0 item 11: the Getting started dialog, not Diagnostics
      ['Diagnostics', () => go('diag')],      // 0.2.1 F8: the Status card lives here now (moved from Settings)
      ["What's new", () => openWhatsNew()],
      ['About WavWiz…', () => openAbout(S)],
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
      const [label, fn, dis, hide] = s;
      if (hide?.()) return null;
      const b = item(label, fn, { disabled: !!dis?.() }); if (dis?.()) b.title = ADMIN_HINT;     // 0.2.0 item 28: read-only, never hidden
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
      const [label, fn, dis, hide] = s;
      if (hide?.()) return null;
      const b = leaf(label, fn, { disabled: !!dis?.() }); if (dis?.()) b.title = ADMIN_HINT;
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

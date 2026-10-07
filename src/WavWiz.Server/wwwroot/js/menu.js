// Nested top menu (0.0.6): File / Library / Playback / Devices / View / Help.
// View: Theme… and Visualizer… open their own pages (0.0.7); Display size stays a submenu. Phone hamburger reuses the same tree.
import { h, api, toast } from './util.js';
import { openSettings } from './settings.js';
import { openAbout, openWhatsNew } from './about.js';
import { openEq } from './eq.js';
import { openCalibration } from './calibrate.js';
import { canControl } from './ui.js';
import { SCALES, loadScale, applyScale } from './uiscale.js';


function menuActions(S, ctl, desktop = false) {
  const { go, refreshAll, act } = ctl;
  // 0.0.8: on the desktop layout "Browse library" and "Devices & zones" slide their side panel in or out (no separate page);
  // the phone hamburger keeps opening the full-screen pages (too narrow for side panels).
  const wideNow = () => { try { return !matchMedia('(max-width:900px)').matches; } catch { return true; } };
  const browseLib = () => (desktop && wideNow() && ctl.toggleLib ? ctl.toggleLib() : go('library'));
  const devPanel = () => (desktop && wideNow() && ctl.toggleDev ? ctl.toggleDev() : go('devices'));
  const listPanel = () => (desktop && wideNow() && ctl.toggleList ? ctl.toggleList() : go('queue'));      // 0.1.1: desktop slides the bottom Playlist; phone opens the full page
  const admin = () => S.auth?.role === 'admin';
  const control = () => canControl(S);
  return {
    go, refreshAll, act, admin, control,
    file: [
      ['Settings…', () => openSettings(S, refreshAll, go)],
      ['Sign out', async () => { try { await api('/auth/logout', { method: 'POST' }); location.reload(); } catch (e) { toast(e.message, true); } }],
    ],
    library: [
      ['Browse library', browseLib],
      ['Playlist', listPanel, () => !desktop],
      ['Playlists', () => go('playlists')],
      ['Queue', () => go('queue')],
      ['Tidy up library', () => go('cleanup'), () => !control()],
      'hr',
      ['Tag & cover fix…', () => go('tags'), () => !control()],
      ['CD ripper…', () => go('rip'), () => !admin()],
      ['Rescan folders', async () => { try { await api('/library/rescan', { method: 'POST' }); toast('Scanning…'); } catch (e) { toast(e.message, true); } }],
    ],
    playback: [
      ['Play / Pause', () => { if (S.now?.state === 'playing') act('/stream/pause'); else act('/stream/play', {}); }],
      ['Next', () => act('/stream/next')],
      ['Previous', () => act('/stream/prev')],
      'hr',
      ['Internet radio', () => go('radio')],
      ['Radio finder', () => go('finder')],
      ['Scenes', () => go('scenes')],
      ['Schedules', () => go('schedules')],
      'hr',
      ['Sound / EQ…', () => openEq(S, refreshAll)],
      ['Calibrate speakers…', () => openCalibration(S, refreshAll), () => !control()],
    ],
    // PC menus: no "This phone as a device" (phone hamburger adds it under Devices).
    devices: [
      ['Devices & zones', devPanel],
      ['Away-from-home…', () => go('remote'), () => !admin()],
      'hr',
      ['Pair a player…', () => openSettings(S, refreshAll, go, 'players'), () => !admin()],
    ],
    devicesPhone: [
      ['Devices & zones', () => go('devices')],
      ['This phone as a device', () => go('phone')],
      ['Away-from-home…', () => go('remote'), () => !admin()],
      'hr',
      ['Pair a player…', () => openSettings(S, refreshAll, go, 'players'), () => !admin()],
    ],
    help: [
      ['Getting started', () => go('diag')],
      ['Diagnostics', () => go('diag')],
      ["What's new", () => openWhatsNew()],
      ['About WavWiz…', () => openAbout(S)],
    ],
  };
}

function scaleKids(onPick) {
  const cur = loadScale();
  return SCALES.map(([id, name]) => ({ label: name, check: cur === id, run: () => { applyScale(id); onPick?.(); } }));
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
  function submenu(label, children) {
    const sub = h('div', { class: 'msub' });
    const btn = h('button', {
      type: 'button',
      onclick: ev => {
        ev.stopPropagation();
        const o = sub.classList.contains('open');
        bar.querySelectorAll('.msub.open').forEach(x => { if (x !== sub) x.classList.remove('open'); });
        sub.classList.toggle('open', !o);
      },
    }, label);
    sub.append(btn, h('div', { class: 'mpanel', role: 'menu' }, ...children));
    return sub;
  }
  function top(label, ...kids) {
    const group = h('div', { class: 'mgroup' });
    const btn = h('button', { class: 'mtop', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: ev => { ev.stopPropagation(); toggle(group, btn); } }, label);
    const panel = h('div', { class: 'mpanel', role: 'menu' }, ...kids.filter(Boolean));
    group.append(btn, panel);
    bar.append(group);
    return panel;
  }
  function fromSpec(spec) {
    return spec.map(s => {
      if (s === 'hr') return h('hr');
      const [label, fn, dis] = s;
      if (dis?.()) return null;
      return item(label, fn);
    }).filter(Boolean);
  }

  top('File', ...fromSpec(A.file));
  top('Library', ...fromSpec(A.library));
  top('Playback', ...fromSpec(A.playback));
  top('Devices', ...fromSpec(A.devices));

  let viewPanel = top('View');
  function fillView() {
    viewPanel.replaceChildren(
      item('Theme…', () => A.go('themes')),
      submenu('Display size', scaleKids(fillView).map(x => item(x.label, x.run, { check: x.check, nocheck: !x.check }))),
      item('Visualizer…', () => A.go('visualizer')),
      h('hr'),
      item('Settings…', () => openSettings(S, A.refreshAll, A.go, 'appearance')),
    );
  }
  fillView();
  window.addEventListener('wavwiz:viz', fillView);
  window.addEventListener('wavwiz:theme', fillView);

  top('Help', ...fromSpec(A.help));

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
      const [label, fn, dis] = s;
      if (dis?.()) return null;
      return leaf(label, fn);
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
    accordion('Devices', () => fromSpec(A.devicesPhone)),
    accordion('View', () => [
      leaf('Theme…', () => A.go('themes')),
      nested('Display size', scaleKids(() => {}).map(x => leaf(x.label, () => { x.run(); }, { check: x.check, nocheck: !x.check }))),
      leaf('Visualizer…', () => A.go('visualizer')),
      h('hr'),
      leaf('Settings…', () => openSettings(S, A.refreshAll, A.go, 'appearance')),
    ]),
    accordion('Help', () => fromSpec(A.help)),
  );
  return nav;
}

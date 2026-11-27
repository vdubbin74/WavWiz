// 0.7.1: one Add speaker sheet (WavWiz, Browser, AirPlay, Cast) instead of the AirPlay / Cast cards in the Devices list.
import { h, api, toast, dialog } from './util.js';
import { movePlan, applyMovePlan, createZone } from './tree42.js';
import { apRow, apBadge, apStatus, apProblem, apScanView, TV_STEPS, SCAN_MS, apSheetAttach, apSheetDetach } from './airplaysetup.js';
import { csRow, csBadge, csStatus, csScanView, csByIpBody, SYNC_NOTE, CS_SCAN_MS, csSheetAttach, csSheetDetach } from './castsetup.js';

const isAdmin = S => S?.auth?.role === 'admin';
export const TABS = ['wavwiz', 'browser', 'airplay', 'cast'];
export const TAB_LABEL = { wavwiz: 'WavWiz', browser: 'Browser', airplay: 'AirPlay', cast: 'Cast' };

/** Kind of a speaker already in Devices (pure). */
export function speakerKind(z) {
  const pid = String(z?.playerId || '');
  if (pid.startsWith('airplay:')) return 'airplay';
  if (pid.startsWith('cast:')) return 'cast';
  if (z?.isWeb) return 'browser';
  return 'wavwiz';
}
export const inAZone = (z, groups) => !!(groups || []).some(g => (g.deviceIds || []).includes(z.id));
export const zonesOf = (z, groups) => (groups || []).filter(g => (g.deviceIds || []).includes(z.id));

/** WavWiz Player PCs already known to this server (not browsers, not AirPlay/Cast). Pure. */
export const wavwizPlayers = (zones) => (zones || []).filter(z => speakerKind(z) === 'wavwiz');
/** Browser / phone speakers already connected (or remembered) as isWeb. Pure. */
export const browserPlayers = (zones, { connectedOnly = true } = {}) =>
  (zones || []).filter(z => speakerKind(z) === 'browser' && (!connectedOnly || z.connected));

/** A found AirPlay/Cast device counts as "new" when it is not already added (blocked / unsupported still count: they are found, not added). Pure. */
export const isFoundNew = d => !!d && !d.added && !d.self;

export function tabNewCount(tab, { zones, groups, apDevs, csDevs } = {}) {
  if (tab === 'wavwiz') return wavwizPlayers(zones).filter(z => !inAZone(z, groups)).length;
  if (tab === 'browser') return browserPlayers(zones).filter(z => !inAZone(z, groups)).length;
  if (tab === 'airplay') return (apDevs || []).filter(isFoundNew).length;
  if (tab === 'cast') return (csDevs || []).filter(isFoundNew).length;
  return 0;
}

export function filterLocalList(list, groups, showAdded) {
  return (list || []).filter(z => showAdded || !inAZone(z, groups));
}
export function filterFoundList(list, showAdded) {
  return (list || []).filter(d => d && !d.self && (showAdded || isFoundNew(d)));
}

// ---------------------------------------------------------------- sheet state (survives tree rebuilds; one sheet at a time)
let tab = 'wavwiz', showAdded = false, Sref = null, ctlRef = null, dlg = null, host = null, lan = null;
const localUi = Object.create(null);
const localSt = id => localUi[id] || (localUi[id] = { zonePick: 'none', newName: '', busy: '', problem: null });

function closeSheet() {
  apSheetDetach();
  csSheetDetach();
  try { window.removeEventListener('resize', syncSheetDock); } catch { /* node */ }
  try { dlg?.el?.style?.removeProperty('--addspk-dock'); } catch { /* */ }
  dlg = null; host = null;
}
function sheetShouldHold(ev) {
  const byIpOpen = !!(typeof window !== 'undefined' && window.__wwCsSnap?.()?.byIp?.open);
  // Intentional AirPlay/Cast paints (test, add, rescan, Add-by-IP submit) must update the sheet even if a field is focused.
  // An AirPlay poll must not rebuild an open Add-by-IP form.
  if (ev?.type === 'wavwiz:cssetup-paint') return false;
  if (ev?.type === 'wavwiz:apsetup-paint') return byIpOpen;
  const root = dlg?.el;
  if (!root) return false;
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (el && root.contains(el) && el.closest?.('select,input,textarea')) return true;
  if (byIpOpen) return true;
  return false;
}
function paint() {
  if (!host || !host.isConnected || !Sref) return;
  const { ap, cs } = snapshots();
  host.replaceChildren(sheetBody(Sref, ctlRef, ap, cs));
  syncSheetDock();
}
function snapshots() {
  const ap = window.__wwApSnap ? window.__wwApSnap() : { devs: [], phase: 'idle', problem: null, ap2: false };
  const cs = window.__wwCsSnap ? window.__wwCsSnap() : { devs: [], phase: 'idle', problem: null, byIp: { open: false } };
  return { ap, cs };
}


/** Room taken by the in-flow phone mini player + tab bar: html.phonelook (a phone, or a narrow PC window - 0.7.3 t2225u: it has the same bars). */
function sheetDockPx() {
  try {
    if (typeof document === 'undefined' || !document.documentElement.classList.contains('phonelook')) return 0;
    const vis = el => {
      if (!el) return false;
      const st = getComputedStyle(el), r = el.getBoundingClientRect();
      return st.display !== 'none' && st.visibility !== 'hidden' && r.height > 0;
    };
    let h = 0;
    const mini = document.querySelector('#app > .mini');
    if (vis(mini)) {
      const st = getComputedStyle(mini);
      h += mini.getBoundingClientRect().height + (parseFloat(st.marginTop) || 0) + (parseFloat(st.marginBottom) || 0);
    }
    const tabs = document.querySelector('#app > .tabbar');
    if (vis(tabs)) h += tabs.getBoundingClientRect().height;
    return Math.max(0, Math.round(h));
  } catch { return 0; }
}
function syncSheetDock() {
  const el = dlg?.el;
  if (!el || typeof el.style?.setProperty !== 'function') return;
  const px = sheetDockPx();
  if (px) el.style.setProperty('--addspk-dock', px + 'px');
  else el.style.removeProperty('--addspk-dock');
}

/** Open the Add speaker sheet. `initialTab` is one of TABS. Admin only. */
export function openAddSpeaker(S, ctl, initialTab) {
  if (!S) return null;
  if (!isAdmin(S)) { toast('Only an administrator can add speakers.', true); return null; }
  Sref = S; ctlRef = ctl;
  if (initialTab && TABS.includes(initialTab)) tab = initialTab;
  if (dlg?.el?.isConnected) { paint(); try { dlg.el.querySelector(`[data-addspk-tab="${tab}"]`)?.focus?.(); } catch { /* */ } return dlg; }
  host = h('div', { class: 'addspk-root', 'data-addspk': '1' });
  dlg = dialog('Add speaker', host, [], { cls: 'addspk-dlg', onClose: closeSheet });
  syncSheetDock();
  try { window.addEventListener('resize', syncSheetDock); } catch { /* node */ }
  attachModules(S, ctl);
  listen();
  fetchLan();
  paint();
  return dlg;
}
export function openAirPlayTab(S, ctl) { return openAddSpeaker(S, ctl, 'airplay'); }
export function openCastTab(S, ctl) { return openAddSpeaker(S, ctl, 'cast'); }

function attachModules(S, ctl) {
  apSheetAttach(S, ctl);
  csSheetAttach(S, ctl);
}
function listen() {
  if (listen._on) return;
  listen._on = ev => { if (!dlg?.el?.isConnected) return; if (ev.type === 'wavwiz:zones-changed') ctlRef?.refreshAll?.(); if (sheetShouldHold(ev)) return; paint(); };
  try {
    window.addEventListener('wavwiz:apsetup-paint', listen._on);
    window.addEventListener('wavwiz:cssetup-paint', listen._on);
    window.addEventListener('wavwiz:zones-changed', listen._on);
    window.addEventListener('wavwiz:airplay-outputs', listen._on);
  } catch { /* node */ }
}
function fetchLan() {
  lan = { url: (typeof location !== 'undefined' ? location.origin : '') + '/', host: '', ready: false };
  try {
    fetch('/tls/info').then(r => r.json()).then(i => {
      if (i && i.host) lan = { url: `http://${i.host}:${i.httpPort}/`, host: i.host, port: i.httpPort, ready: true };
      if (dlg?.el?.isConnected) paint();
    }).catch(() => {});
  } catch { /* node / offline */ }
}

function sheetBody(S, ctl, ap, cs) {
  const groups = (S.groups || []).filter(g => !g.jukebox);
  const zones = S.zones || [];
  const counts = Object.fromEntries(TABS.map(t => [t, tabNewCount(t, { zones, groups, apDevs: ap.devs, csDevs: cs.devs })]));
  const tabs = h('div', { class: 'addspk-tabs', role: 'tablist', 'aria-label': 'Speaker type' },
    ...TABS.map(t => h('button', { type: 'button', role: 'tab', class: 'addspk-tab' + (tab === t ? ' on' : ''),
      'data-addspk-tab': t, 'aria-selected': String(tab === t), id: 'addspk-tab-' + t,
      onclick: () => { tab = t; paint(); } },
      TAB_LABEL[t], h('span', { class: 'addspk-n', 'aria-label': `${counts[t]} new` }, String(counts[t])))));
  const status = statusLine(tab, { zones, groups, ap, cs, counts });
  const bar = h('div', { class: 'addspk-bar' },
    h('div', { class: 'addspk-status small', role: 'status' }, status),
    h('div', { class: 'addspk-bar-acts' },
      h('label', { class: 'addspk-show small' },
        h('input', { type: 'checkbox', 'data-act': 'addspk-show-added', checked: showAdded, onchange: ev => { showAdded = ev.target.checked; paint(); } }),
        'Show added'),
      h('button', { type: 'button', class: 'btn sm apsetup-again', 'data-act': 'addspk-again',
        onclick: () => searchAgain(tab), disabled: (tab === 'airplay' && ap.phase === 'searching') || (tab === 'cast' && cs.phase === 'searching') },
        (tab === 'airplay' && ap.phase === 'searching') || (tab === 'cast' && cs.phase === 'searching') ? 'Searching…' : 'Search again')));

  let panel;
  if (tab === 'wavwiz') panel = wavwizPanel(S, ctl, groups, zones);
  else if (tab === 'browser') panel = browserPanel(S, ctl, groups, zones);
  else if (tab === 'airplay') panel = foundPanel('airplay', S, ctl, ap);
  else panel = foundPanel('cast', S, ctl, cs);

  return h('div', { class: 'addspk-body' }, tabs, bar, h('div', { class: 'addspk-panel', role: 'tabpanel', 'aria-labelledby': 'addspk-tab-' + tab }, panel));
}

function statusLine(tab, { zones, groups, ap, cs, counts }) {
  if (tab === 'wavwiz') {
    const n = wavwizPlayers(zones).length, neu = counts.wavwiz;
    return neu ? `${neu} waiting to be added to a zone` : (n ? 'All paired WavWiz players are in a zone' : 'No WavWiz players paired yet');
  }
  if (tab === 'browser') {
    const n = browserPlayers(zones).length, neu = counts.browser;
    return neu ? `${neu} connected in a browser, not in a zone` : (n ? 'All connected browsers are in a zone' : 'No browser is connected as a speaker yet');
  }
  if (tab === 'airplay') {
    const view = apScanView({ phase: ap.phase === 'idle' ? 'searching' : ap.phase, n: (ap.devs || []).length, problem: ap.problem });
    if (view.kind === 'busy') return view.note || 'Looking…';
    if (view.kind === 'err') return view.note || 'Couldn’t search';
    if (view.kind === 'none') return view.note || 'None found';
    return counts.airplay ? `${counts.airplay} new on this network` : (view.note || 'On this network');
  }
  const view = csScanView({ phase: cs.phase === 'idle' ? 'searching' : cs.phase, n: (cs.devs || []).length, problem: cs.problem });
  if (view.kind === 'busy') return view.note || 'Looking…';
  if (view.kind === 'err') return view.note || 'Couldn’t search';
  if (view.kind === 'none') return view.note || 'None found';
  return counts.cast ? `${counts.cast} new on this network` : (view.note || 'On this network');
}

function searchAgain(which) {
  if (which === 'airplay') { window.__wwApRescan?.(); return; }
  if (which === 'cast') { window.__wwCsRescan?.(); return; }
  ctlRef?.refreshAll?.();
  paint();
}

function zoneSelect(s, act) {
  const gs = (Sref?.groups || []).filter(g => !g.jukebox);
  return h('select', { class: 'apsetup-zone', 'aria-label': 'Add to zone', 'data-act': act,
    onchange: ev => { s.zonePick = ev.target.value; paint(); } },
    h('option', { value: 'none', selected: s.zonePick === 'none' }, 'Unassigned (no zone)'),
    ...gs.map(g => h('option', { value: String(g.id), selected: s.zonePick === String(g.id) }, g.name)),
    h('option', { value: 'new', selected: s.zonePick === 'new' }, 'New zone…'));
}

async function assignLocal(z, s) {
  s.busy = 'Adding…'; s.problem = null; paint();
  try {
    if (s.zonePick === 'new') {
      const name = (s.newName || z.name).trim(); if (!name) throw new Error('Type a name for the new zone.');
      await createZone(name, [z.id]);
    } else {
      const toId = s.zonePick === 'none' ? null : Number(s.zonePick);
      const plan = movePlan(Sref.groups, z.id, toId);
      applyMovePlan(Sref, plan);
      for (const op of plan) await api(`/groups/${op.id}`, { method: 'PATCH', body: { name: op.name, deviceIds: op.deviceIds } });
    }
    s.busy = '';
    toast(`${z.name} ${s.zonePick === 'none' ? 'is unassigned' : 'was added to a zone'}`);
    window.dispatchEvent(new CustomEvent('wavwiz:zones-changed'));
    ctlRef?.refreshAll?.();
    paint();
  } catch (e) { s.busy = ''; s.problem = e.message || String(e); toast(s.problem, true); paint(); }
}

async function testLocal(z, s) {
  s.busy = 'Testing…'; s.problem = null; paint();
  try {
    await api(`/zones/${z.id}/test-sound`, { method: 'POST', body: {} });
    s.busy = ''; toast(`Test sound sent to ${z.name}`);
  } catch (e) { s.busy = ''; s.problem = e.message || String(e); toast(s.problem, true); }
  paint();
}

function localRow(z, groups, kind) {
  const s = localSt(kind + ':' + z.id), added = inAZone(z, groups), zs = zonesOf(z, groups);
  const note = added ? `In ${zs.map(g => g.name).join(', ')}` : (z.connected ? 'Online · not in a zone' : 'Remembered · Offline');
  const acts = [];
  if (!added && z.connected) {
    acts.push(h('div', { class: 'addspk-rowacts' },
      h('button', { type: 'button', class: 'btn sm', 'data-act': 'addspk-test', disabled: !!s.busy, onclick: () => testLocal(z, s) }, s.busy === 'Testing…' ? 'Testing…' : 'Test'),
      h('label', { class: 'apsetup-addto' }, h('span', { class: 'small dim' }, 'Add to:'), zoneSelect(s, 'addspk-zone')),
      s.zonePick === 'new' ? h('input', { type: 'text', class: 'apsetup-name', value: s.newName, 'aria-label': 'New zone name', maxlength: 40, oninput: ev => { s.newName = ev.target.value; } }) : null,
      h('button', { type: 'button', class: 'btn sm primary', 'data-act': 'addspk-add', disabled: !!s.busy, onclick: () => assignLocal(z, s) }, s.busy === 'Adding…' ? 'Adding…' : 'Add')));
  } else if (!added && !z.connected) {
    acts.push(h('p', { class: 'small dim' }, 'This player is offline. It can be added to a zone once it is connected.'));
  }
  if (s.problem) acts.push(h('div', { class: 'apsetup-prob other', role: 'alert' }, h('p', { class: 'small' }, s.problem)));
  return h('div', { class: 'apsetup-row' + (added ? ' added' : ''), 'data-id': String(z.id), 'data-kind': kind, role: 'listitem' },
    h('div', { class: 'apsetup-rowhead' },
      h('div', { class: 'apsetup-rname' }, h('span', { class: 'apsetup-n' }, z.name), h('span', { class: 'small dim' }, note)),
      h('span', { class: 'apsetup-badge ap1' }, kind === 'browser' ? 'Browser' : 'WavWiz player'),
      added ? h('span', { class: 'apsetup-st ok' }, 'Added') : (z.connected ? null : h('span', { class: 'apsetup-st dim' }, 'Offline'))),
    acts.length ? h('div', { class: 'apsetup-rowbody' }, ...acts) : null);
}

function wavwizPanel(S, ctl, groups, zones) {
  const list = filterLocalList(wavwizPlayers(zones), groups, showAdded);
  const rows = list.length
    ? list.map(z => localRow(z, groups, 'wavwiz'))
    : h('div', { class: 'small dim apsetup-empty', role: 'status' }, showAdded ? 'No WavWiz players are paired on this server.' : 'No unassigned WavWiz players. Pair a new one below, or turn on Show added.');
  const pair = h('div', { class: 'addspk-pair' },
    h('b', { class: 'addspk-sec-h' }, 'Pair a new WavWiz Player'),
    h('p', { class: 'small dim' }, 'On that PC, open WavWiz Player and connect. If it asks for approval, an approval card appears on this screen for an administrator. You can also show a pairing code in Settings.'),
    h('button', { type: 'button', class: 'btn sm', 'data-act': 'addspk-opensettings',
      onclick: () => import('./settings.js').then(({ openSettings }) => openSettings(S, ctl?.refreshAll, ctl?.go, 'players')).catch(e => toast(e.message, true)) },
      'Open pairing in Settings'));
  return h('div', { class: 'addspk-sec' }, h('div', { class: 'apsetup-list', role: 'list', 'aria-label': 'WavWiz players' }, rows), pair);
}

function browserPanel(S, ctl, groups, zones) {
  const list = filterLocalList(browserPlayers(zones), groups, showAdded);
  const rows = list.length
    ? list.map(z => localRow(z, groups, 'browser'))
    : h('div', { class: 'small dim apsetup-empty', role: 'status' }, showAdded ? 'No browser is connected as a speaker.' : 'No connected browser is waiting to be added to a zone. Open the web app below, or turn on Show added.');
  const url = (lan && lan.url) || ((typeof location !== 'undefined' ? location.origin : '') + '/');
  const qrSrc = '/tls/qr.svg?to=app';
  const connect = h('div', { class: 'addspk-connect' },
    h('b', { class: 'addspk-sec-h' }, 'Connect a browser'),
    h('p', { class: 'small dim' }, 'Open this address on another phone or PC (same network). It joins as a speaker after you sign in or pair.'),
    h('div', { class: 'addspk-connect-row' },
      h('img', { class: 'addspk-qr', src: qrSrc, alt: 'QR code for the WavWiz web app', width: 120, height: 120 }),
      h('div', { class: 'addspk-urlbox' },
        h('code', { class: 'addspk-url' }, url),
        h('button', { type: 'button', class: 'btn sm', 'data-act': 'addspk-copy',
          onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Address copied'); } catch { toast(url); } } }, 'Copy address'))));
  return h('div', { class: 'addspk-sec' }, h('div', { class: 'apsetup-list', role: 'list', 'aria-label': 'Browser speakers' }, rows), connect);
}

function foundEmpty(kind, view, againInBody) {
  const again = () => h('button', { type: 'button', class: 'btn sm apsetup-again', 'data-act': 'addspk-again', onclick: () => searchAgain(kind) }, 'Search again');
  if (view.kind === 'busy') return h('div', { class: 'small dim apsetup-empty', role: 'status' }, view.text);
  if (view.kind === 'err') return h('div', { class: 'small apsetup-empty apsetup-err', role: 'alert' }, h('b', null, view.title), h('p', { class: 'small' }, view.text), againInBody ? again() : null);
  if (view.kind === 'none') {
    const tips = kind === 'airplay'
      ? [h('li', null, 'Check the speaker is switched on and on the same network as this PC (VPN off).'),
        h('li', null, 'Windows Firewall can block the speakers’ answers. Settings › Network › AirPlay speakers has the firewall rules.')]
      : [h('li', null, 'Check the device is switched on and on the same network as this PC (VPN off). A Cast group needs its speakers on too.'),
        h('li', null, 'Windows Firewall or the router can block the devices’ answers. Not listed? Add it by its IP address below.')];
    return h('div', { class: 'small apsetup-empty apsetup-none', role: 'status' }, h('b', null, view.title), h('ul', { class: 'small dim' }, ...tips), againInBody ? again() : null);
  }
  return null;
}

function foundPanel(kind, S, ctl, snap) {
  const devs = snap.devs || [];
  const view = (kind === 'airplay' ? apScanView : csScanView)({
    phase: snap.phase === 'idle' ? 'searching' : snap.phase,
    n: devs.length, problem: snap.problem
  });
  const shown = filterFoundList(devs, showAdded);
  const empty = !devs.length ? foundEmpty(kind, view, false) : (!shown.length ? h('div', { class: 'small dim apsetup-empty', role: 'status' }, 'Already-added devices are hidden. Turn on Show added to see them.') : null);
  const list = h('div', { class: 'apsetup-list', role: 'list', 'aria-label': kind === 'airplay' ? 'AirPlay speakers' : 'Cast speakers', 'aria-busy': snap.phase === 'searching' ? 'true' : null },
    shown.length ? shown.map(d => foundRow(kind, d, snap)) : empty);
  const foot = [];
  if (kind === 'airplay') {
    foot.push(h('p', { class: 'small dim apsetup-note' }, 'AirPlay 2 support is experimental. Speakers that need a PIN aren’t supported yet.'));
    if (!snap.ap2) foot.push(h('p', { class: 'small dim apsetup-ap2' }, 'AirPlay 2 speakers (Sonos, WiiM…) are experimental and off. ',
      h('button', { type: 'button', class: 'linkbtn', 'data-act': 'apsetup-settings',
        onclick: () => import('./settings.js').then(({ openSettings }) => openSettings(S, ctl?.refreshAll, ctl?.go, 'airplay')).catch(e => toast(e.message, true)) },
        'Turn them on in Settings')));
  } else {
    foot.push(h('p', { class: 'small dim apsetup-note' }, SYNC_NOTE));
    if (snap.byIp?.open) foot.push(window.__wwCsByIpForm ? window.__wwCsByIpForm() : null);
    else foot.push(h('div', { class: 'castsetup-byip-link small' }, h('span', { class: 'dim' }, 'Not listed? '),
      h('button', { type: 'button', class: 'linkbtn', 'data-act': 'castsetup-byip', onclick: () => window.__wwCsOpenByIp?.() }, 'Add by IP address')));
  }
  return h('div', { class: 'addspk-sec' }, list, h('div', { class: 'addspk-found-foot' }, ...foot.filter(Boolean)));
}

function foundRow(kind, d, snap) {
  const ui = (kind === 'airplay' ? window.__wwApUi : window.__wwCsUi)?.(d.id) || { heard: null, problem: null, busy: '', added: false, zonePick: 'new', newName: '' };
  const row = kind === 'airplay' ? apRow(d) : csRow(d);
  const badge = kind === 'airplay' ? apBadge(d) : csBadge(d);
  const status = kind === 'airplay' ? apStatus(d, ui) : csStatus(d, ui);
  const extras = [];
  if (ui.busy) extras.push(h('div', { class: 'apsetup-prog', role: 'progressbar', 'aria-label': ui.busy }, h('span', { class: 'apsetup-prog-fill' })));
  if (kind === 'airplay' && d.tv && !ui.heard && !ui.problem) extras.push(h('ul', { class: 'small apsetup-tv' }, TV_STEPS.slice(0, 1).map(t => h('li', null, t))));
  if (ui.problem) extras.push(h('div', { class: 'apsetup-prob ' + (ui.problem.code || 'other'), role: 'alert' },
    h('b', null, ui.problem.title), h('p', { class: 'small' }, ui.problem.text),
    kind === 'airplay' && ui.problem.code === 'denied' && d.tv ? h('ul', { class: 'small' }, TV_STEPS.slice(1).map(t => h('li', null, t))) : null,
    ui.problem.retry ? h('button', { type: 'button', class: 'btn sm primary', 'data-act': kind + '-retry', onclick: () => (kind === 'airplay' ? window.__wwApTest : window.__wwCsTest)?.(d) }, 'Retry') : null));
  if (ui.heard === 'ask') extras.push(h('div', { class: 'apsetup-ask' },
    h('b', null, 'Did you hear it?'), h('span', { class: 'small dim' }, kind === 'cast' ? ' It can take a few seconds on a Cast device.' : (ui.tested?.kind ? ` ${ui.tested.kind}` : '')),
    h('div', { class: 'row apsetup-yn' },
      h('button', { type: 'button', class: 'btn sm primary', 'data-act': kind + '-heard', onclick: () => { ui.heard = 'yes'; ui.newName = ui.newName || d.name; paint(); } }, 'Yes'),
      h('button', { type: 'button', class: 'btn sm', 'data-act': kind + '-notheard', onclick: () => { ui.heard = 'no'; paint(); } }, 'No'))));
  if (ui.heard === 'no') extras.push(h('div', { class: 'apsetup-prob other' }, h('b', null, 'No chime?'), h('ul', { class: 'small' },
    kind === 'airplay'
      ? [h('li', null, 'Turn the speaker’s own volume up and check it isn’t playing something else.'),
        h('li', null, 'It can take a couple of seconds the first time. Play it again.'),
        h('li', null, 'Still silent: the PC firewall may block AirPlay audio. Settings › Network › AirPlay speakers has the rules (the installer can add them).')]
      : [h('li', null, 'Turn the device’s own volume up. A TV may need its input switched to the Chromecast.'),
        h('li', null, 'Cast devices buffer a few seconds before they start. Play it again.'),
        h('li', null, 'Still silent: the PC firewall may block the device from fetching WavWiz’s audio. Allow WavWiz on the private network.')])));
  const canAct = row.pick && !ui.added && !d.added;
  const canAdd = canAct && ui.heard === 'yes';   // same safety step as the old AirPlay / Cast cards
  if (canAct) {
    const acts = [
      h('button', { type: 'button', class: 'btn sm', 'data-act': kind + '-test', disabled: !!ui.busy,
        onclick: () => (kind === 'airplay' ? window.__wwApTest : window.__wwCsTest)?.(d) },
        ui.busy && ui.busy !== 'Adding…' ? ui.busy : (ui.heard ? 'Play again' : 'Test')),
    ];
    if (canAdd) {
      acts.push(
        h('label', { class: 'apsetup-addto' }, h('span', { class: 'small dim' }, 'Add to:'), zoneSelect(ui, kind + '-zone')),
        ui.zonePick === 'new' ? h('input', { type: 'text', class: 'apsetup-name', value: ui.newName || '', 'aria-label': 'New zone name', maxlength: 40, oninput: ev => { ui.newName = ev.target.value; } }) : null,
        h('button', { type: 'button', class: 'btn sm primary', 'data-act': kind + '-add', disabled: !!ui.busy,
          onclick: () => (kind === 'airplay' ? window.__wwApAdd : window.__wwCsAdd)?.(d) },
          ui.busy === 'Adding…' ? 'Adding…' : 'Add'));
    }
    extras.push(h('div', { class: 'addspk-rowacts' }, ...acts));
  }
  return h('div', { class: 'apsetup-row' + (canAct ? '' : '') + (row.pick ? '' : ' blocked') + (d.added || d.remembered || ui.added ? ' added' : ''),
    'data-id': d.id, 'data-kind': kind, role: 'listitem' },
    h('div', { class: 'apsetup-rowhead' },
      h('div', { class: 'apsetup-rname' },
        h('span', { class: 'apsetup-n' }, d.name),
        h('span', { class: 'small dim' }, row.note || ''),
        kind === 'cast' && d.manual && d.address ? h('span', { class: 'small dim castsetup-addr', title: 'Added by IP address' }, d.address) : null),
      h('span', { class: 'apsetup-badge ' + badge.kind }, badge.text),
      status.text ? h('span', { class: 'apsetup-st small ' + status.kind }, status.text) : null),
    extras.length ? h('div', { class: 'apsetup-rowbody' }, ...extras) : null);
}

/** Test helper: reset module state. */
export function _addSpkReset() {
  try { window.removeEventListener('resize', syncSheetDock); } catch { /* node */ }
  try { dlg?.close?.(); } catch { /* already closed */ }
  try { document.querySelectorAll('dialog.addspk-dlg').forEach(el => el.remove()); } catch { /* node */ }
  tab = 'wavwiz'; showAdded = false; Sref = null; ctlRef = null; dlg = null; host = null; lan = null;
  for (const k of Object.keys(localUi)) delete localUi[k];
}
export const _addSpkState = () => ({ tab, showAdded });

import { h, api, toast } from './util.js';

/** 0.6.8-#14b: AirPlay setup as an inline collapsible zone-style card at the bottom of Zones · Speakers (below Unassigned).
 *  Three steps (Find / Test / Add to zone). Only what WavWiz really implements is offered: no PIN / password entry,
 *  HomePod and Apple TV are shown as not supported, AirPlay 2 stays "experimental". Nothing is cleared or retried on
 *  its own: Retry is always a button. Collapsed by default; the card header expands / collapses it, and openAirPlaySetup() expands + scrolls to it (Devices menu). */

// ---------------------------------------------------------------- pure parts (unit-tested)
export const STEPS = ['Find', 'Test', 'Add to zone'];
/** Find list omits this server's own receivers; other WavWiz servers on the LAN stay. */
export const apFindList = devs => (devs || []).filter(d => !d.self);
/** One Find row: can it be picked, and the quiet line under the name. */
export function apRow(d) {
  if (d.self) return { pick: false, kind: 'self', note: 'This server · AirPlay receiver broadcasting' };
  if (d.added) return { pick: false, kind: 'added', note: 'Already added - it is in Devices' };
  if (d.block) return { pick: false, kind: d.blockCode || 'blocked', note: d.block };
  if (d.remembered && !d.online) return { pick: false, kind: 'offline', note: 'Remembered · Offline' };
  const brand = d.manufacturer || d.model || '', proto = d.airplay2 && /^airplay2/.test(d.route || '') ? 'AirPlay 2 (experimental)' : 'AirPlay 1';
  return { pick: true, kind: 'ok', note: [brand, proto, d.tv ? 'TV' : null].filter(Boolean).join(' · ') };
}
/** Protocol badge for a card: accent outline for AirPlay 1, amber for AirPlay 2, dim for blocked. Pure. */
export function apBadge(d) {
  if (d.block || d.blockCode) {
    const t = /HomePod|Apple TV/i.test(d.block || '') ? 'HomePod / Apple TV' : /PIN|password|code/i.test(d.block || '') ? 'Needs PIN' : 'Not supported';
    return { text: t, kind: 'blocked' };
  }
  if (d.airplay2 && /^airplay2/.test(d.route || '')) return { text: 'AirPlay 2 · Experimental', kind: 'ap2' };
  return { text: 'AirPlay 1 · Supported', kind: 'ap1' };
}
/** Right-side status text for a card given per-device UI state. Pure. */
export function apStatus(d, st = {}) {
  if (st.busy) return { text: st.busy === 'Adding…' ? 'Adding…' : 'Testing…', kind: 'busy' };
  if (st.problem) return { text: st.problem.title || 'Couldn’t connect', kind: 'err' };
  if (st.heard === 'yes' || st.added) return { text: st.added ? 'Added' : '✓ Test sound played', kind: 'ok' };
  if (st.heard === 'ask') return { text: '✓ Test sound played', kind: 'ok' };
  if (st.heard === 'no') return { text: 'No chime', kind: 'err' };
  if (d.added) return { text: 'Added', kind: 'ok' };
  if (d.remembered && !d.online) return { text: 'Remembered · Offline', kind: 'dim' };
  if (d.connected) return { text: 'Connected', kind: 'ok' };
  return { text: '', kind: '' };
}
/** Which step tab is current for a selected speaker's UI state (0 Find, 1 Test, 2 Add). Pure. */
export function apStep(st = {}, sel) {
  if (!sel) return 0;
  if (st.heard === 'yes' || st.added) return 2;
  if (st.busy || st.heard === 'ask' || st.heard === 'no' || st.problem || st.tested) return 1;
  return 0;
}
/** Words for a failed Test / Add from the server's error body ({code,title,text,retry}). */
export function apProblem(err, name) {
  const b = err && err.data || {};
  if (b.code) return { code: b.code, title: b.title || 'Couldn’t connect', text: b.text || String(err.message || ''), retry: b.retry !== false };
  return { code: err && err.status === 0 ? 'server' : 'other', title: 'Couldn’t connect', text: (err && err.message) || `Couldn’t connect to ${name}.`, retry: true };
}
/** What to tell a TV owner before / after a TV refuses. */
export const TV_STEPS = [
  'Watch the TV screen: it may ask to allow “WavWiz”. Choose Allow.',
  'No prompt and it still refuses? In the TV’s AirPlay settings set “Allow access” / “Require device approval” to Everyone on the same network (or turn off “Require code”). You can switch it back afterwards.',
  'WavWiz can’t type a PIN shown on the TV yet, so a TV that insists on a code can’t be added.',
];
/** Merge browse results with remembered AirPlay speakers from zones (playerId airplay:…). Pure; does not invent backend fields. */
export function apMergeRemembered(devs, zones) {
  const list = apFindList(devs).map(d => ({ ...d }));
  const seen = new Set(list.map(d => d.id));
  for (const z of zones || []) {
    const pid = String(z.playerId || '');
    if (!pid.startsWith('airplay:')) continue;
    const key = pid.slice('airplay:'.length);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    list.push({ id: key, name: z.name || key, remembered: true, online: !!z.connected, connected: !!z.connected, added: true, route: 'raop', airplay2: false });
  }
  return list;
}

// ---------------------------------------------------------------- module state (survives tree rebuilds)
const OPEN_KEY = 'ww.apsetup.open';
const stOf = () => ({ heard: null, tested: null, problem: null, busy: '', zonePick: 'new', newName: '', added: false });
let open = (() => { try { return sessionStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } })();
let Sref = null, ctlRef = null, devs = [], ap2 = false, selId = null, byId = Object.create(null), timer = 0, closed = true, lastProblem = null;

function sel() { return (devs || []).find(d => d.id === selId) || null; }
function st(id) { if (!id) return stOf(); return byId[id] || (byId[id] = stOf()); }
function setOpen(v) {
  const was = open; open = !!v;
  try { sessionStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* private mode */ }
  if (!open && was) finish();
  if (open && was === false) { closed = false; rescan(); startPoll(); }
  if (!open) stopPoll();
}
async function finish() {
  closed = true; stopPoll();
  for (const id of Object.keys(byId)) {
    const s = byId[id];
    if (s.tested && !s.tested.added && !s.added) {
      try { await api('/airplay/setup/cancel', { method: 'POST', body: { key: s.tested.key } }); } catch { /* stays unconnected */ }
      s.tested = null;
    }
  }
}
function stopPoll() { if (timer) { clearInterval(timer); timer = 0; } }
function startPoll() {
  stopPoll();
  timer = setInterval(async () => {
    if (!open || closed) { stopPoll(); return; }
    const card = document.querySelector('.apsetup-card');
    if (!card || !card.isConnected) return;
    if (!st(selId).busy) { await load(); paintInPlace(); }
  }, 3000);
}

async function load() {
  try {
    const r = await api('/airplay/setup/devices');
    const browsed = r.devices || [];
    ap2 = !!r.airPlay2Experimental;
    devs = apMergeRemembered(browsed, Sref?.zones); lastProblem = null;
  } catch (e) {
    // 0.7.0 item 5a: with no speaker selected st(null) is a throw-away object, so the error was lost and the card sat on "Looking…"
    if (selId) st(selId).problem = apProblem(e, ''); else lastProblem = apProblem(e, '').text;
  }
}
async function rescan() {
  const s = st(selId); s.problem = null; s.heard = null; selId = null; devs = []; paintInPlace();
  try { await api('/dev/airplay/query', { method: 'POST' }); } catch (e) { lastProblem = apProblem(e, '').text; }
  await load(); paintInPlace();
  setTimeout(async () => { if (!closed && open) { await load(); paintInPlace(); } }, 1500);
}

function scrollKeep(fn) {
  // F233: Speakers .tcol42 (or nearest scroller) — hold scrollTop across body rebuilds
  const card = document.querySelector('.apsetup-card');
  let sc = card && card.closest('.tcol42');
  if (!sc) { sc = card; while (sc && sc.scrollHeight <= sc.clientHeight + 1) sc = sc.parentElement; }
  const top = sc ? sc.scrollTop : 0;
  fn();
  const put = () => { if (sc && sc.isConnected) sc.scrollTop = top; };
  put(); requestAnimationFrame(put);
}

function paintInPlace() {
  const card = document.querySelector('.apsetup-card');
  if (!card || !Sref) return;
  scrollKeep(() => {
    const fresh = buildCard(Sref, ctlRef);
    card.replaceWith(fresh);
  });
}

function btn(text, onclick, cls = '', extra = {}) {
  return h('button', { type: 'button', class: 'btn ' + cls, onclick, disabled: !!st(selId).busy, ...extra }, text);
}

function openSet() {
  import('./settings.js').then(({ openSettings }) => openSettings(Sref, ctlRef?.refreshAll, ctlRef?.go, 'airplay')).catch(e => toast(e.message, true));
}

async function test(d) {
  const s = st(d.id); s.busy = 'Connecting…'; s.problem = null; s.heard = null; paintInPlace();
  try {
    const r = await api('/airplay/setup/test', { method: 'POST', body: { key: d.id } });
    s.tested = { key: d.id, kind: r.kind, added: false }; s.busy = ''; s.heard = 'ask';
  } catch (e) { s.busy = ''; s.problem = apProblem(e, d.name); }
  paintInPlace();
}
async function add(d) {
  const s = st(d.id); s.busy = 'Adding…'; s.problem = null; paintInPlace();
  const body = { key: d.id };
  if (s.zonePick === 'new') body.newZone = (s.newName || d.name).trim();
  else if (s.zonePick !== 'none') body.groupId = Number(s.zonePick);
  try {
    const r = await api('/airplay/setup/add', { method: 'POST', body });
    if (s.tested) s.tested.added = true; s.added = true; s.busy = '';
    toast(r.warning ? `Added ${d.name} (zone: ${r.warning})` : `Added ${d.name}`, !!r.warning);
    window.dispatchEvent(new CustomEvent('wavwiz:airplay-outputs'));
    window.dispatchEvent(new CustomEvent('wavwiz:zones-changed'));
    ctlRef?.refreshAll?.();
    await load(); paintInPlace();
  } catch (e) { s.busy = ''; s.problem = apProblem(e, d.name); paintInPlace(); }
}

function cardExpanded(d, s) {
  const out = [];
  if (s.busy) out.push(h('div', { class: 'apsetup-prog', role: 'progressbar', 'aria-label': s.busy }, h('span', { class: 'apsetup-prog-fill' })));
  if (d.tv && !s.heard && !s.problem) out.push(h('ul', { class: 'small apsetup-tv' }, TV_STEPS.slice(0, 1).map(t => h('li', null, t))));
  if (s.problem) out.push(h('div', { class: 'apsetup-prob ' + s.problem.code, role: 'alert' },
    h('b', null, s.problem.title), h('p', { class: 'small' }, s.problem.text),
    s.problem.code === 'denied' && d.tv ? h('ul', { class: 'small' }, TV_STEPS.slice(1).map(t => h('li', null, t))) : null,
    s.problem.retry ? btn('Retry', () => test(d), 'primary', { 'data-act': 'apsetup-retry' }) : null));
  if (s.heard === 'ask') out.push(h('div', { class: 'apsetup-ask' },
    h('b', null, 'Did you hear it?'), h('span', { class: 'small dim' }, s.tested?.kind ? ` ${s.tested.kind}` : ''),
    h('div', { class: 'row apsetup-yn' },
      btn('Yes', () => { s.heard = 'yes'; s.newName = s.newName || d.name; paintInPlace(); }, 'primary', { 'data-act': 'apsetup-heard' }),
      btn('No', () => { s.heard = 'no'; paintInPlace(); }, '', { 'data-act': 'apsetup-notheard' }))));
  if (s.heard === 'no') out.push(h('div', { class: 'apsetup-prob other' }, h('b', null, 'No chime?'), h('ul', { class: 'small' },
    h('li', null, 'Turn the speaker’s own volume up and check it isn’t playing something else.'),
    h('li', null, 'It can take a couple of seconds the first time. Play it again.'),
    h('li', null, 'Still silent: the PC firewall may block AirPlay audio. Settings › Network › AirPlay speakers has the rules (the installer can add them).'))));
  const canTest = apRow(d).pick && !s.added;
  if (canTest && s.heard !== 'yes') {
    out.push(btn(s.busy || (s.heard ? 'Play again' : 'Play test sound'), () => test(d), s.heard ? '' : 'primary apsetup-testbtn', { 'data-act': 'apsetup-test' }));
  }
  if (s.heard === 'yes' && !s.added) {
    const gs = (Sref?.groups || []).filter(g => !g.jukebox);
    const zoneSel = h('select', { class: 'apsetup-zone', 'aria-label': 'Add to zone', 'data-act': 'apsetup-zone',
      onchange: ev => { s.zonePick = ev.target.value; paintInPlace(); } },
      h('option', { value: 'new', selected: s.zonePick === 'new' }, 'New zone…'),
      ...gs.map(g => h('option', { value: String(g.id), selected: s.zonePick === String(g.id) }, g.name)),
      h('option', { value: 'none', selected: s.zonePick === 'none' }, 'Not in a zone (Unassigned)'));
    out.push(h('label', { class: 'apsetup-addto' }, h('span', { class: 'small dim' }, 'Add to:'), zoneSel));
    if (s.zonePick === 'new') out.push(h('input', { type: 'text', class: 'apsetup-name', value: s.newName, 'aria-label': 'New zone name', maxlength: 40,
      oninput: ev => { s.newName = ev.target.value; } }));
    out.push(btn(s.busy || 'Add speaker', () => add(d), 'primary apsetup-addbtn', { 'data-act': 'apsetup-add' }));
  }
  return out;
}

function speakerRow(d) {
  const s = st(d.id), row = apRow(d), badge = apBadge(d), status = apStatus(d, s), on = selId === d.id && open;
  const expand = () => {
    if (!row.pick && !d.added && !d.remembered) return; // blocked: show but don't expand into add flow
    if (d.block && !d.added) { selId = d.id; paintInPlace(); return; } // allow expand to see why
    selId = on ? null : d.id; paintInPlace();
  };
  const head = h('div', { class: 'apsetup-rowhead', role: 'button', tabindex: 0, 'data-id': d.id,
    'aria-expanded': String(!!on), 'aria-disabled': row.pick || d.added || d.remembered || d.block ? null : 'true',
    onclick: ev => { ev.stopPropagation(); expand(); },
    onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); expand(); } } },
    h('span', { class: 'apsetup-rname grow' },
      h('b', { class: 'apsetup-n' }, d.name),
      h('span', { class: 'dtag apsetup-badge ' + badge.kind, title: row.note || badge.text }, badge.text)),
    status.text ? h('span', { class: 'apsetup-st small ' + status.kind }, status.text) : h('span', { class: 'apsetup-st' }));
  const body = on ? h('div', { class: 'apsetup-rowbody' }, ...cardExpanded(d, s)) : null;
  return h('div', { class: 'apsetup-row sp42' + (on ? ' sel' : '') + (row.pick ? '' : ' blocked') + (d.added || d.remembered ? ' added' : ''),
    'data-id': d.id, role: 'listitem' }, head, body);
}

function buildCard(S, ctl) {
  Sref = S; ctlRef = ctl;
  // 0.7.0 item 5a: restored open from sessionStorage after a reload: nothing had started a scan or the poll, so it said "Looking…" forever
  if (open && closed) { closed = false; setTimeout(() => { if (open && !closed) { rescan(); startPoll(); } }, 0); }
  const list = apFindList(devs);
  const n = list.length;
  const note = !open ? (n ? `${n} found` : 'Find, test and add') : (n ? `${n} on this network` : lastProblem ? 'Couldn’t search' : 'Looking…');
  const step = apStep(st(selId), sel());
  const fold = h('button', { type: 'button', class: 'zfold42-t' + (open ? ' open' : ''), 'data-act': 'apsetup-fold',
    'aria-expanded': String(open), 'aria-label': open ? 'Collapse AirPlay speakers' : 'Expand AirPlay speakers',
    title: open ? 'Collapse' : 'Expand',
    onclick: ev => { ev.stopPropagation(); ev.preventDefault(); setOpen(!open); paintInPlace(); if (open) scrollToCard(); } }, open ? '▾' : '▸');
  const title = h('div', { class: 'qb42-t qb42-pick', role: 'button', tabindex: '0', title: 'AirPlay speakers',
    'aria-label': 'AirPlay speakers',
    onclick: ev => { ev.stopPropagation(); if (!open) { setOpen(true); paintInPlace(); scrollToCard(); } },
    onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); if (!open) { setOpen(true); paintInPlace(); scrollToCard(); } } } },
    h('b', { class: 'qb42-name' }, 'AirPlay speakers'), h('span', { class: 'qb42-st dim' }, note));
  const head = h('div', { class: 'qb42-head' }, h('div', { class: 'qb42-trow' }, fold, title));

  const card = h('section', {
    class: 'qb42 solo idle apsetup-card' + (open ? ' open' : ' qb42-folded'),
    'data-leader-id': '__airplay__', 'data-apsetup': '1',
    'aria-label': open ? 'AirPlay speakers (expanded)' : 'AirPlay speakers (collapsed)',
  });

  if (!open) {
    card.append(head);
    return card;
  }

  const steps = h('ol', { class: 'apsetup-steps', 'aria-label': 'Steps' }, STEPS.map((t, i) =>
    h('li', { class: i === step ? 'on' : i < step ? 'done' : '', 'aria-current': i === step ? 'step' : null },
      h('span', { class: 'apsetup-sn' }, String(i + 1)), ' ', t)));

  const rows = list.map(speakerRow);
  const listEl = h('div', { class: 'apsetup-list zsp42', role: 'list', 'aria-label': 'AirPlay speakers' },
    rows.length ? rows : h('div', { class: 'small dim apsetup-empty' + (lastProblem ? ' apsetup-err' : '') }, lastProblem || 'Looking for speakers… answers usually arrive within a few seconds.'));

  const footNote = h('p', { class: 'small dim apsetup-note' },
    'AirPlay 2 support is experimental. Speakers that need a PIN aren’t supported yet.');
  // Wording choice: Wiz mock said "will ask here"; WavWiz cannot type PINs yet, so this is the honest line.
  const ap2line = !ap2 ? h('p', { class: 'small dim apsetup-ap2' }, 'AirPlay 2 speakers (Sonos, WiiM…) are experimental and off. ',
    h('button', { type: 'button', class: 'linkbtn', 'data-act': 'apsetup-settings', onclick: openSet }, 'Turn them on in Settings')) : null;

  const foot = h('div', { class: 'apsetup-foot' },
    h('div', { class: 'apsetup-footnote grow' }, footNote, ap2line),
    h('button', { type: 'button', class: 'linkbtn', 'data-act': 'apsetup-rescan', onclick: () => rescan(), disabled: !!st(selId).busy }, 'Scan again'),
    h('button', { type: 'button', class: 'btn primary', 'data-act': 'apsetup-close', onclick: () => { setOpen(false); paintInPlace(); } }, 'Close'));

  const body = h('div', { class: 'apsetup-body' }, steps, listEl, foot);
  card.append(head, h('div', { class: 'zwrap42 apsetup-wrap' }, body));
  return card;
}

function scrollToCard() {
  requestAnimationFrame(() => {
    const card = document.querySelector('.apsetup-card');
    card?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  });
}

/** Build (or rebuild) the inline card for the zone tree. Admin only; null for everyone else. */
export function airPlaySetupCard(S, ctl) {
  if (!S) return null;
  // isAdmin check deferred to caller (tree42 already gates on admin); still safe if called elsewhere
  return buildCard(S, ctl);
}

/** Programmatic open (Devices menu, etc.): expand the card and scroll it into view. */
export function openAirPlaySetup(S, ctl) {
  Sref = S; ctlRef = ctl;
  setOpen(true);
  // Prefer an in-place expand if the card is already in the tree; else ask Devices to redraw then scroll.
  const existing = document.querySelector('.apsetup-card');
  if (existing) { paintInPlace(); scrollToCard(); }
  else {
    try { window.dispatchEvent(new CustomEvent('wavwiz:devredraw')); } catch { /* node */ }
    setTimeout(scrollToCard, 50);
  }
  if (!devs.length) rescan();
  else startPoll();
  return { el: () => document.querySelector('.apsetup-card'), close: () => { setOpen(false); paintInPlace(); } };
}

/** Test helper: reset module state between unit tests. */
export function _apReset() {
  open = false; Sref = null; ctlRef = null; devs = []; ap2 = false; selId = null; byId = Object.create(null); stopPoll(); closed = true; lastProblem = null;
  try { sessionStorage.removeItem(OPEN_KEY); } catch { /* */ }
}

import { h, api, toast } from './util.js';

/** 0.7.0 F169: Google Cast setup card - same inline zone-style card as the AirPlay one, placed directly BELOW it at the bottom of
 *  Zones · Speakers (order: Unassigned, AirPlay speakers, Cast speakers). Same three steps (Find / Test / Add to zone), same row / badge /
 *  status styling (apsetup-* classes). Its own module state and its own card class (.castsetup-card) so it never touches the AirPlay card.
 *  Nothing is retried on its own: Retry is always a button. Collapsed by default. */

// ---------------------------------------------------------------- pure parts (unit-tested)
export const STEPS = ['Find', 'Test', 'Add to zone'];
const KIND = { speaker: 'Speaker', tv: 'TV', group: 'Group' };
/** One Find row: can it be picked, and the quiet line under the name. */
export function csRow(d) {
  if (d.added) return { pick: false, kind: 'added', note: 'Already added - it is in Devices' };
  if (d.remembered && !d.online) return { pick: false, kind: 'offline', note: 'Remembered · Offline' };
  const note = [d.model, d.group ? 'Cast group (its speakers stay in step with each other)' : null, d.status ? `Now: ${d.status}` : null].filter(Boolean).join(' · ');
  return { pick: true, kind: 'ok', note };
}
/** Protocol badge, same look as the AirPlay badges. Pure. */
export const csBadge = d => ({ text: `Cast · ${KIND[d.kind] || 'Speaker'}`, kind: 'ap1' });
/** Right-side status text for a row given per-device UI state. Pure. */
export function csStatus(d, st = {}) {
  if (st.busy) return { text: st.busy === 'Adding…' ? 'Adding…' : 'Testing…', kind: 'busy' };
  if (st.problem) return { text: st.problem.title || 'Couldn’t connect', kind: 'err' };
  if (st.added) return { text: 'Added', kind: 'ok' };
  if (st.heard === 'ask' || st.heard === 'yes') return { text: '✓ Test sound played', kind: 'ok' };
  if (st.heard === 'no') return { text: 'No chime', kind: 'err' };
  if (d.added) return { text: 'Added', kind: 'ok' };
  if (d.remembered && !d.online) return { text: 'Remembered · Offline', kind: 'dim' };
  if (d.connected) return { text: 'Connected', kind: 'ok' };
  return { text: '', kind: '' };
}
export function csStep(st = {}, sel) {
  if (!sel) return 0;
  if (st.heard === 'yes' || st.added) return 2;
  if (st.busy || st.heard === 'ask' || st.heard === 'no' || st.problem || st.tested) return 1;
  return 0;
}
export function csProblem(err, name) {
  const b = err && err.data || {};
  if (b.code) return { code: b.code, title: b.title || 'Couldn’t connect', text: b.text || String(err.message || ''), retry: b.retry !== false };
  return { code: err && err.status === 0 ? 'server' : 'other', title: 'Couldn’t connect', text: (err && err.message) || `Couldn’t connect to ${name}.`, retry: true };
}
/** Merge browse results with remembered Cast speakers from zones (playerId cast:…). Pure. */
export function csMergeRemembered(devs, zones) {
  const list = (devs || []).map(d => ({ ...d }));
  const seen = new Set(list.map(d => d.id));
  for (const z of zones || []) {
    const pid = String(z.playerId || '');
    if (!pid.startsWith('cast:')) continue;
    const key = pid.slice('cast:'.length);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    list.push({ id: key, name: z.name || key, kind: 'speaker', remembered: true, online: !!z.connected, connected: !!z.connected, added: true });
  }
  return list;
}
/** The honest sync line: Cast devices buffer on their own, so lining them up with other speakers is approximate. */
export const SYNC_NOTE = 'Cast devices keep their own few-second buffer, so with other speakers in the same zone they line up only roughly. Fine-tune with the speaker’s Delay.';

// ---------------------------------------------------------------- module state (survives tree rebuilds)
const OPEN_KEY = 'ww.castsetup.open', SEL = '.castsetup-card';
const stOf = () => ({ heard: null, tested: null, problem: null, busy: '', zonePick: 'new', newName: '', added: false });
let open = (() => { try { return sessionStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } })();
let Sref = null, ctlRef = null, devs = [], selId = null, byId = Object.create(null), timer = 0, closed = true, lastProblem = null;

function st(id) { if (!id) return stOf(); return byId[id] || (byId[id] = stOf()); }
function setOpen(v) {
  const was = open; open = !!v;
  try { sessionStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* private mode */ }
  if (!open && was) finish();
  if (open && !was) { closed = false; rescan(); startPoll(); }
  if (!open) stopPoll();
}
async function finish() {
  closed = true; stopPoll();
  for (const id of Object.keys(byId)) {
    const s = byId[id];
    if (s.tested && !s.tested.added && !s.added) {
      try { await api('/cast/setup/cancel', { method: 'POST', body: { key: s.tested.key } }); } catch { /* stays unconnected */ }
      s.tested = null;
    }
  }
}
function stopPoll() { if (timer) { clearInterval(timer); timer = 0; } }
function startPoll() {
  stopPoll();
  timer = setInterval(async () => {
    if (!open || closed) { stopPoll(); return; }
    const card = document.querySelector(SEL);
    if (!card || !card.isConnected) return;
    if (!st(selId).busy) { await load(); paintInPlace(); }
  }, 3000);
}
async function load() {
  try { const r = await api('/cast/setup/devices'); devs = csMergeRemembered(r.devices || [], Sref?.zones); lastProblem = r.problem || null; }
  catch (e) { lastProblem = csProblem(e, '').text; }
}
async function rescan() {
  selId = null; devs = []; paintInPlace();
  try { await api('/cast/setup/query', { method: 'POST' }); } catch (e) { lastProblem = csProblem(e, '').text; }
  await load(); paintInPlace();
  setTimeout(async () => { if (!closed && open) { await load(); paintInPlace(); } }, 1500);
}
function scrollKeep(fn) {
  const card = document.querySelector(SEL);
  let sc = card && card.closest('.tcol42');
  if (!sc) { sc = card; while (sc && sc.scrollHeight <= sc.clientHeight + 1) sc = sc.parentElement; }
  const top = sc ? sc.scrollTop : 0;
  fn();
  const put = () => { if (sc && sc.isConnected) sc.scrollTop = top; };
  put(); requestAnimationFrame(put);
}
function paintInPlace() {
  const card = document.querySelector(SEL);
  if (!card || !Sref) return;
  scrollKeep(() => card.replaceWith(buildCard(Sref, ctlRef)));
}
function btn(text, onclick, cls = '', extra = {}) {
  return h('button', { type: 'button', class: 'btn ' + cls, onclick, disabled: !!st(selId).busy, ...extra }, text);
}

async function test(d) {
  const s = st(d.id); s.busy = 'Connecting…'; s.problem = null; s.heard = null; paintInPlace();
  try {
    const r = await api('/cast/setup/test', { method: 'POST', body: { key: d.id } });
    s.tested = { key: d.id, kind: r.kind, added: false }; s.busy = ''; s.heard = 'ask';
  } catch (e) { s.busy = ''; s.problem = csProblem(e, d.name); }
  paintInPlace();
}
async function add(d) {
  const s = st(d.id); s.busy = 'Adding…'; s.problem = null; paintInPlace();
  const body = { key: d.id };
  if (s.zonePick === 'new') body.newZone = (s.newName || d.name).trim();
  else if (s.zonePick !== 'none') body.groupId = Number(s.zonePick);
  try {
    const r = await api('/cast/setup/add', { method: 'POST', body });
    if (s.tested) s.tested.added = true; s.added = true; s.busy = '';
    toast(r.warning ? `Added ${d.name} (zone: ${r.warning})` : `Added ${d.name}`, !!r.warning);
    window.dispatchEvent(new CustomEvent('wavwiz:zones-changed'));
    ctlRef?.refreshAll?.();
    await load(); paintInPlace();
  } catch (e) { s.busy = ''; s.problem = csProblem(e, d.name); paintInPlace(); }
}

function cardExpanded(d, s) {
  const out = [];
  if (s.busy) out.push(h('div', { class: 'apsetup-prog', role: 'progressbar', 'aria-label': s.busy }, h('span', { class: 'apsetup-prog-fill' })));
  if (s.problem) out.push(h('div', { class: 'apsetup-prob ' + s.problem.code, role: 'alert' },
    h('b', null, s.problem.title), h('p', { class: 'small' }, s.problem.text),
    s.problem.retry ? btn('Retry', () => test(d), 'primary', { 'data-act': 'castsetup-retry' }) : null));
  if (s.heard === 'ask') out.push(h('div', { class: 'apsetup-ask' },
    h('b', null, 'Did you hear it?'), h('span', { class: 'small dim' }, ' It can take a few seconds on a Cast device.'),
    h('div', { class: 'row apsetup-yn' },
      btn('Yes', () => { s.heard = 'yes'; s.newName = s.newName || d.name; paintInPlace(); }, 'primary', { 'data-act': 'castsetup-heard' }),
      btn('No', () => { s.heard = 'no'; paintInPlace(); }, '', { 'data-act': 'castsetup-notheard' }))));
  if (s.heard === 'no') out.push(h('div', { class: 'apsetup-prob other' }, h('b', null, 'No chime?'), h('ul', { class: 'small' },
    h('li', null, 'Turn the device’s own volume up. A TV may need its input switched to the Chromecast.'),
    h('li', null, 'Cast devices buffer a few seconds before they start. Play it again.'),
    h('li', null, 'Still silent: the PC firewall may block the device from fetching WavWiz’s audio. Allow WavWiz on the private network.'))));
  const canTest = csRow(d).pick && !s.added;
  if (canTest && s.heard !== 'yes') out.push(btn(s.busy || (s.heard ? 'Play again' : 'Play test sound'), () => test(d), s.heard ? '' : 'primary apsetup-testbtn', { 'data-act': 'castsetup-test' }));
  if (s.heard === 'yes' && !s.added) {
    const gs = (Sref?.groups || []).filter(g => !g.jukebox);
    const zoneSel = h('select', { class: 'apsetup-zone', 'aria-label': 'Add to zone', 'data-act': 'castsetup-zone', onchange: ev => { s.zonePick = ev.target.value; paintInPlace(); } },
      h('option', { value: 'new', selected: s.zonePick === 'new' }, 'New zone…'),
      ...gs.map(g => h('option', { value: String(g.id), selected: s.zonePick === String(g.id) }, g.name)),
      h('option', { value: 'none', selected: s.zonePick === 'none' }, 'Not in a zone (Unassigned)'));
    out.push(h('label', { class: 'apsetup-addto' }, h('span', { class: 'small dim' }, 'Add to:'), zoneSel));
    if (s.zonePick === 'new') out.push(h('input', { type: 'text', class: 'apsetup-name', value: s.newName, 'aria-label': 'New zone name', maxlength: 40, oninput: ev => { s.newName = ev.target.value; } }));
    out.push(btn(s.busy || 'Add speaker', () => add(d), 'primary apsetup-addbtn', { 'data-act': 'castsetup-add' }));
  }
  return out;
}

function speakerRow(d) {
  const s = st(d.id), row = csRow(d), badge = csBadge(d), status = csStatus(d, s), on = selId === d.id && open;
  const expand = () => { if (!row.pick && !d.added && !d.remembered) return; selId = on ? null : d.id; paintInPlace(); };
  const head = h('div', { class: 'apsetup-rowhead', role: 'button', tabindex: 0, 'data-id': d.id, 'aria-expanded': String(!!on),
    onclick: ev => { ev.stopPropagation(); expand(); },
    onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); expand(); } } },
    h('span', { class: 'apsetup-rname grow' }, h('b', { class: 'apsetup-n' }, d.name), h('span', { class: 'dtag apsetup-badge ' + badge.kind, title: row.note || badge.text }, badge.text)),
    status.text ? h('span', { class: 'apsetup-st small ' + status.kind }, status.text) : h('span', { class: 'apsetup-st' }));
  const body = on ? h('div', { class: 'apsetup-rowbody' }, ...cardExpanded(d, s)) : null;
  return h('div', { class: 'apsetup-row sp42' + (on ? ' sel' : '') + (row.pick ? '' : ' blocked') + (d.added || d.remembered ? ' added' : ''), 'data-id': d.id, role: 'listitem' }, head, body);
}

function buildCard(S, ctl) {
  Sref = S; ctlRef = ctl;
  const n = devs.length;
  const note = !open ? (n ? `${n} found` : 'Find, test and add') : (n ? `${n} on this network` : 'Looking…');
  const step = csStep(st(selId), devs.find(d => d.id === selId));
  const expandNow = () => { if (!open) { setOpen(true); paintInPlace(); scrollToCard(); } };
  const fold = h('button', { type: 'button', class: 'zfold42-t' + (open ? ' open' : ''), 'data-act': 'castsetup-fold', 'aria-expanded': String(open),
    'aria-label': open ? 'Collapse Cast speakers' : 'Expand Cast speakers', title: open ? 'Collapse' : 'Expand',
    onclick: ev => { ev.stopPropagation(); ev.preventDefault(); setOpen(!open); paintInPlace(); if (open) scrollToCard(); } }, open ? '▾' : '▸');
  const title = h('div', { class: 'qb42-t qb42-pick', role: 'button', tabindex: '0', title: 'Cast speakers', 'aria-label': 'Cast speakers',
    onclick: ev => { ev.stopPropagation(); expandNow(); },
    onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); expandNow(); } } },
    h('b', { class: 'qb42-name' }, 'Cast speakers'), h('span', { class: 'qb42-st dim' }, note));
  const head = h('div', { class: 'qb42-head' }, h('div', { class: 'qb42-trow' }, fold, title));
  const card = h('section', { class: 'qb42 solo idle castsetup-card' + (open ? ' open' : ' qb42-folded'), 'data-leader-id': '__cast__', 'data-castsetup': '1',
    'aria-label': open ? 'Cast speakers (expanded)' : 'Cast speakers (collapsed)' });
  if (!open) { card.append(head); return card; }

  const steps = h('ol', { class: 'apsetup-steps', 'aria-label': 'Steps' }, STEPS.map((t, i) =>
    h('li', { class: i === step ? 'on' : i < step ? 'done' : '', 'aria-current': i === step ? 'step' : null }, h('span', { class: 'apsetup-sn' }, String(i + 1)), ' ', t)));
  const listEl = h('div', { class: 'apsetup-list zsp42', role: 'list', 'aria-label': 'Cast speakers' },
    n ? devs.map(speakerRow) : h('div', { class: 'small dim apsetup-empty' }, lastProblem || 'Looking for Chromecast, Google Nest and Cast-enabled speakers and TVs…'));
  const foot = h('div', { class: 'apsetup-foot' },
    h('div', { class: 'apsetup-footnote grow' }, h('p', { class: 'small dim apsetup-note' }, SYNC_NOTE)),
    h('button', { type: 'button', class: 'linkbtn', 'data-act': 'castsetup-rescan', onclick: () => rescan(), disabled: !!st(selId).busy }, 'Scan again'),
    h('button', { type: 'button', class: 'btn primary', 'data-act': 'castsetup-close', onclick: () => { setOpen(false); paintInPlace(); } }, 'Close'));
  card.append(head, h('div', { class: 'zwrap42 apsetup-wrap' }, h('div', { class: 'apsetup-body' }, steps, listEl, foot)));
  return card;
}

function scrollToCard() { requestAnimationFrame(() => document.querySelector(SEL)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })); }

/** Build (or rebuild) the inline card for the zone tree (admin only; the caller gates). */
export function castSetupCard(S, ctl) { return S ? buildCard(S, ctl) : null; }

/** Programmatic open (Devices menu, etc.). */
export function openCastSetup(S, ctl) {
  Sref = S; ctlRef = ctl; setOpen(true);
  if (document.querySelector(SEL)) { paintInPlace(); scrollToCard(); }
  else { try { window.dispatchEvent(new CustomEvent('wavwiz:devredraw')); } catch { /* node */ } setTimeout(scrollToCard, 50); }
  if (!devs.length) rescan(); else startPoll();
}

/** Test helper. */
export function _csReset() {
  open = false; Sref = null; ctlRef = null; devs = []; selId = null; byId = Object.create(null); stopPoll(); closed = true; lastProblem = null;
  try { sessionStorage.removeItem(OPEN_KEY); } catch { /* */ }
}

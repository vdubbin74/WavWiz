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
/** 0.7.0 item 5b: what the Add by IP form posts; null when the address box is empty (the button stays off). Pure. */
export function csByIpBody(addr, name) {
  const a = String(addr || '').trim(); if (!a) return null;
  const n = String(name || '').trim();
  return n ? { address: a, name: n.slice(0, 40) } : { address: a };
}
/** The honest sync line: Cast devices buffer on their own, so lining them up with other speakers is approximate. */
export const SYNC_NOTE = 'Cast devices keep their own few-second buffer, so with other speakers in the same zone they line up only roughly. Fine-tune with the speaker’s Delay.';

/** 0.7.0 t1901: a search always ends, like the AirPlay card (0.6.9 #22): while it runs (at most CS_SCAN_MS) the card says "Looking…"; after that an
 *  empty list is "None found" with Search again, and a server that cannot search (or does not answer) is "Couldn’t search" with the reason. Pure. */
export const CS_SCAN_MS = 9000;
export function csScanView({ phase = 'idle', n = 0, problem = null } = {}) {
  if (n) return { note: `${n} on this network`, kind: 'list', title: '', text: '' };
  if (problem) return { note: 'Couldn’t search', kind: 'err', title: 'Couldn’t search for Cast speakers', text: problem };
  if (phase === 'searching') return { note: 'Looking…', kind: 'busy', title: '', text: 'Looking for Chromecast, Google Nest and Cast-enabled speakers and TVs… answers usually arrive within a few seconds.' };
  return { note: 'None found', kind: 'none', title: 'No Cast speakers found', text: '' };
}
/** The server's own Cast search problem (it answered, but its search is not running) in plain words, as for AirPlay. Pure. */
export function csBrowseProblem(r) {
  if (!r || r.running !== false) return null;
  const p = String(r.problem || '');
  if (/loopback/i.test(p)) return 'The server is only listening on this PC (127.0.0.1), so it can’t search the home network. Set its network address in Settings › Network, then search again.';
  return p ? `The server couldn’t start its Cast search: ${p.replace(/^Cast search unavailable:\s*/i, '')}` : 'The server’s Cast search isn’t running.';
}
/** Rejects after ms so a request that never comes back still ends the search. */
function within(p, ms) {
  let t = 0;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('The server didn’t answer the Cast search in time.'), { status: 0 })), ms); })]).finally(() => clearTimeout(t));
}

// ---------------------------------------------------------------- module state (survives tree rebuilds)
const OPEN_KEY = 'ww.castsetup.open', SEL = '.castsetup-card';
const stOf = () => ({ heard: null, tested: null, problem: null, busy: '', zonePick: 'new', newName: '', added: false });
let open = (() => { try { return sessionStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } })();
let Sref = null, ctlRef = null, devs = [], selId = null, byId = Object.create(null), timer = 0, closed = true, lastProblem = null;
// 0.7.0 item 5b: "Add by IP address" form (a device discovery can't see: another subnet / VLAN, or the router blocks mDNS)
const ipOf = () => ({ open: false, addr: '', name: '', busy: false, err: null });
let byIp = ipOf();
// t1901: the Devices tree tags the card (data-card="cast") and gives it the ⋮ reorder handle, like the AirPlay card; kept across in-place repaints
let cardDecor = null;
export const setCastCardDecor = fn => { cardDecor = typeof fn === 'function' ? fn : null; };
// t1901: one search at a time; phase 'idle' | 'searching' | 'done' (as the AirPlay card). Module state, so repaints / tree rebuilds never reset it.
let scanPhase = 'idle', scanSeq = 0, scanTimer = 0;
function endScan() { scanSeq++; scanPhase = 'idle'; clearTimeout(scanTimer); scanTimer = 0; }

function st(id) { if (!id) return stOf(); return byId[id] || (byId[id] = stOf()); }
function setOpen(v) {
  const was = open; open = !!v;
  if (!open) byIp = ipOf();
  try { sessionStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* private mode */ }
  if (!open && was) finish();
  if (open && !was) { closed = false; rescan(); startPoll(); }
  if (!open) stopPoll();
}
async function finish() {
  closed = true; stopPoll(); endScan();
  for (const id of Object.keys(byId)) {
    const s = byId[id];
    if (s.tested && !s.tested.added && !s.added) {
      try { await api('/cast/setup/cancel', { method: 'POST', body: { key: s.tested.key } }); } catch { /* stays unconnected */ }
      s.tested = null;
    }
  }
}
function stopPoll() { if (timer) { clearInterval(timer); timer = 0; } }
// t1955u: a background refresh must not replace the card while a select / input inside it is focused
// (step 3 "Add to:" — opening the zone dropdown was closed by the ~3 s poll's paintInPlace).
// 0.7.0 item 5b: still no repaint while the Add-by-IP form is open (that would drop focus in the address box).
function cardEditing(card) {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  return !!(card && el && card.contains(el) && el.closest?.('select,input,textarea'));
}
function syncFields(card) {
  if (!card || !selId) return;
  const s = st(selId);
  const zone = card.querySelector('select.apsetup-zone');
  const name = card.querySelector('input.apsetup-name');
  if (zone) s.zonePick = zone.value;
  if (name) s.newName = name.value;
}
let heldPaint = false;
function armResume(card) {
  if (heldPaint || !card) return;
  heldPaint = true;
  const go = ev => {
    if (ev.type === 'focusout' && ev.relatedTarget && card.contains(ev.relatedTarget)) return;
    heldPaint = false;
    card.removeEventListener('focusout', go);
    card.removeEventListener('change', go);
    setTimeout(() => { if (open && !closed) refreshIfIdle(); }, 0);
  };
  card.addEventListener('focusout', go);
  card.addEventListener('change', go);
}
async function refreshIfIdle() {
  const card = document.querySelector(SEL);
  if (!card || !card.isConnected) return;
  if (st(selId).busy || byIp.open) return;
  if (cardEditing(card)) { armResume(card); return; }
  await load();
  if (!open || closed || st(selId).busy || byIp.open) return;
  const now = document.querySelector(SEL);
  if (cardEditing(now)) { armResume(now); return; }
  paintInPlace();
}
function startPoll() {
  stopPoll();
  timer = setInterval(async () => {
    if (!open || closed) { stopPoll(); return; }
    const card = document.querySelector(SEL);
    if (!card || !card.isConnected) return;
    await refreshIfIdle();
  }, 3000);
}
async function load() {
  // t1901: the server's running:false + problem used to show only as body text while the header said "Looking…" for ever (and a running
  // search's leftover problem text was shown as if it had failed); now it is read like the AirPlay card's (csBrowseProblem)
  try { const r = await within(api('/cast/setup/devices'), CS_SCAN_MS) || {}; devs = csMergeRemembered(r.devices || [], Sref?.zones); lastProblem = csBrowseProblem(r); }
  catch (e) { lastProblem = csProblem(e, '').text; }
}
async function rescan() {
  // t1901 (as AirPlay 0.6.9 #22): a search has a deadline and ends as a list, "No Cast speakers found" or an error; a second call while one runs
  // does not restart it, and the list already shown is kept until the new answer
  if (scanPhase === 'searching') return;
  const seq = ++scanSeq;
  const s = st(selId); s.problem = null; s.heard = null; selId = null; lastProblem = null;
  scanPhase = 'searching'; clearTimeout(scanTimer);
  scanTimer = setTimeout(() => { if (seq === scanSeq && scanPhase === 'searching') { scanPhase = 'done'; if (!byIp.open) paintInPlace(); } }, CS_SCAN_MS);
  paintInPlace();
  let qErr = null;
  try { await within(api('/cast/setup/query', { method: 'POST' }), CS_SCAN_MS); } catch (e) { qErr = csProblem(e, '').text; }
  if (seq !== scanSeq) return;
  await load();
  if (seq !== scanSeq) return;
  if (qErr && !lastProblem && !devs.length) lastProblem = qErr;
  if (lastProblem) { scanPhase = 'done'; clearTimeout(scanTimer); }   // an error ends the search at once
  if (!byIp.open) paintInPlace();
  for (const ms of [1500, 4000]) setTimeout(async () => { if (seq === scanSeq && !closed && open) await refreshIfIdle(); }, ms);   // t1955u / item 5b: background refreshes skip while a field is focused or Add by IP is open
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
  syncFields(card);   // t1955u: keep the chosen zone / new-zone name across a repaint
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
async function findByIp() {
  const body = csByIpBody(byIp.addr, byIp.name); if (!body || byIp.busy) return;
  byIp.busy = true; byIp.err = null; paintInPlace();
  try {
    const r = await api('/cast/setup/byip', { method: 'POST', body });
    byIp = ipOf(); await load();
    selId = r.id; const s = st(r.id); s.problem = null; s.heard = null;   // open its row at "Play test sound": the test is the real connection check
    paintInPlace();
  } catch (e) { byIp.busy = false; byIp.err = (e && e.data && e.data.text) || (e && e.message) || 'Couldn’t add that address.'; paintInPlace(); }
}
function byIpForm() {
  const go = ev => { ev?.preventDefault?.(); findByIp(); };
  return h('form', { class: 'castsetup-byip', 'data-act': 'castsetup-byip-form', onsubmit: go },
    h('b', { class: 'castsetup-byip-t' }, 'Add by IP address'),
    h('p', { class: 'small dim' }, 'For a Cast device that doesn’t show up (another network segment, or the router blocks discovery). Your router’s device list or the Google Home app shows its address.'),
    h('div', { class: 'row castsetup-byip-row' },
      h('input', { type: 'text', class: 'castsetup-ip', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', placeholder: '192.168.1.40', value: byIp.addr,
        'aria-label': 'IP address', 'data-act': 'castsetup-ip', disabled: byIp.busy, oninput: ev => { byIp.addr = ev.target.value; const b = ev.target.closest('form')?.querySelector('[data-act="castsetup-ip-go"]'); if (b) b.disabled = !csByIpBody(byIp.addr); } }),
      h('input', { type: 'text', class: 'castsetup-ipname', autocomplete: 'off', maxlength: 40, placeholder: 'Name (optional)', value: byIp.name,
        'aria-label': 'Name (optional)', 'data-act': 'castsetup-ipname', disabled: byIp.busy, oninput: ev => { byIp.name = ev.target.value; } }),
      h('button', { type: 'submit', class: 'btn sm primary', 'data-act': 'castsetup-ip-go', disabled: byIp.busy || !csByIpBody(byIp.addr) }, byIp.busy ? 'Adding…' : 'Add'),
      h('button', { type: 'button', class: 'btn sm', 'data-act': 'castsetup-ip-cancel', disabled: byIp.busy, onclick: () => { byIp = ipOf(); paintInPlace(); } }, 'Cancel')),
    byIp.err ? h('div', { class: 'apsetup-prob other', role: 'alert' }, h('p', { class: 'small' }, byIp.err)) : null);
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
    h('span', { class: 'apsetup-rname grow' }, h('b', { class: 'apsetup-n' }, d.name), h('span', { class: 'dtag apsetup-badge ' + badge.kind, title: row.note || badge.text }, badge.text),
      d.manual && d.address ? h('span', { class: 'small dim castsetup-addr', title: 'Added by IP address' }, d.address) : null),
    status.text ? h('span', { class: 'apsetup-st small ' + status.kind }, status.text) : h('span', { class: 'apsetup-st' }));
  const body = on ? h('div', { class: 'apsetup-rowbody' }, ...cardExpanded(d, s)) : null;
  return h('div', { class: 'apsetup-row sp42' + (on ? ' sel' : '') + (row.pick ? '' : ' blocked') + (d.added || d.remembered ? ' added' : ''), 'data-id': d.id, role: 'listitem' }, head, body);
}

function buildCard(S, ctl) {
  Sref = S; ctlRef = ctl;
  if (open && closed) { closed = false; setTimeout(() => { if (open && !closed) { rescan(); startPoll(); } }, 0); }   // reopened from this tab's saved state after a reload: scan, don't sit on "Looking…"
  const n = devs.length;
  const view = csScanView({ phase: scanPhase === 'idle' && open ? 'searching' : scanPhase, n, problem: lastProblem });
  const note = !open ? (n ? `${n} found` : 'Find, test and add') : view.note;
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
  if (!open) { card.append(head); try { cardDecor?.(card); } catch { /* decoration is cosmetic */ } return card; }

  const steps = h('ol', { class: 'apsetup-steps', 'aria-label': 'Steps' }, STEPS.map((t, i) =>
    h('li', { class: i === step ? 'on' : i < step ? 'done' : '', 'aria-current': i === step ? 'step' : null }, h('span', { class: 'apsetup-sn' }, String(i + 1)), ' ', t)));
  // t1901: the same empty / error states, compact buttons (btn sm) and single 'Search again' wording as the AirPlay card (0.6.9 #22 / #30)
  const searching = scanPhase === 'searching';
  const again = () => h('button', { type: 'button', class: 'btn sm apsetup-again', 'data-act': 'castsetup-again', onclick: () => rescan() }, 'Search again');
  let empty = null;
  if (view.kind === 'busy') empty = h('div', { class: 'small dim apsetup-empty', role: 'status' }, view.text);
  else if (view.kind === 'err') empty = h('div', { class: 'small apsetup-empty apsetup-err', role: 'alert' }, h('b', null, view.title), h('p', { class: 'small' }, view.text), again());
  else if (view.kind === 'none') empty = h('div', { class: 'small apsetup-empty apsetup-none', role: 'status' }, h('b', null, view.title),
    h('ul', { class: 'small dim' },
      h('li', null, 'Check the device is switched on and on the same network as this PC (VPN off). A Cast group needs its speakers on too.'),
      h('li', null, 'Windows Firewall or the router can block the devices’ answers. Not listed? Add it by its IP address below.')),
    again());
  const bodyAgain = !n && (view.kind === 'err' || view.kind === 'none');   // the body has its own Search again
  const listEl = h('div', { class: 'apsetup-list zsp42', role: 'list', 'aria-label': 'Cast speakers', 'aria-busy': searching ? 'true' : null },
    n ? devs.map(speakerRow) : empty);
  const foot = h('div', { class: 'apsetup-foot' },
    h('div', { class: 'apsetup-footnote grow' }, h('p', { class: 'small dim apsetup-note' }, SYNC_NOTE)),
    bodyAgain ? null : h('button', { type: 'button', class: 'linkbtn', 'data-act': 'castsetup-rescan', onclick: () => rescan(), disabled: !!st(selId).busy || searching }, searching ? 'Searching…' : 'Search again'),
    h('button', { type: 'button', class: 'btn sm', 'data-act': 'castsetup-close', onclick: () => { setOpen(false); paintInPlace(); } }, 'Close'));
  card.append(head, h('div', { class: 'zwrap42 apsetup-wrap' }, h('div', { class: 'apsetup-body' }, steps, listEl,
    byIp.open ? byIpForm() : h('div', { class: 'castsetup-byip-link small' }, h('span', { class: 'dim' }, 'Not listed? '),
      h('button', { type: 'button', class: 'linkbtn', 'data-act': 'castsetup-byip', onclick: () => { byIp.open = true; paintInPlace(); setTimeout(() => document.querySelector('.castsetup-ip')?.focus?.(), 0); } }, 'Add by IP address')),
    foot)));
  try { cardDecor?.(card); } catch { /* decoration is cosmetic */ }
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

/** t1955u / tests: one background refresh (the 3 s poll and the 1.5 s / 4 s follow-ups). Skips while a select or input is focused. */
export const _csRefresh = () => refreshIfIdle();

/** Test helper. */
export function _csReset() {
  open = false; Sref = null; ctlRef = null; devs = []; selId = null; byId = Object.create(null); stopPoll(); closed = true; lastProblem = null; byIp = ipOf(); heldPaint = false; endScan();
  try { sessionStorage.removeItem(OPEN_KEY); } catch { /* */ }
}

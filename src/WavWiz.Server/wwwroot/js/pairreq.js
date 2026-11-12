// 0.6.9 #15: pairing by administrator approval.
//  - Administrators see a card for every PC / Player window that asks to join (bottom right, on every screen) with Approve / Deny and the
//    4-digit match code the asking PC shows, so they can tell which PC it is.
//  - A Player window without a session no longer opens on the sign-in tabs: it asks for approval by itself and waits ("Pair with a code" and
//    "Sign in as administrator" stay one click away). On approval the server sets the window's own session cookie and the page reloads signed in.
import { h, api, toast } from './util.js';

/** Pure: the card stack for a list from GET /pairing/requests. */
export function pairRequestCards(list, decide) {
  return (list || []).map(r => h('div', { class: 'pairreq-card', role: 'alert', 'data-id': r.id },
    h('div', { class: 'pairreq-t' }, r.kind === 'player' ? 'A PC wants to join WavWiz as a speaker' : 'A WavWiz Player window wants to control music'),
    h('div', { class: 'pairreq-n' }, r.name || 'Unnamed PC', r.machine ? h('span', { class: 'dim' }, ' · ' + r.machine) : null, r.from ? h('span', { class: 'dim' }, ' · ' + r.from) : null),
    h('div', { class: 'pairreq-m' }, 'Code on that PC: ', h('b', { class: 'pairreq-code' }, r.match)),
    h('div', { class: 'pairreq-b' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => decide(r.id, 'approve') }, 'Approve'),
      h('button', { class: 'btn', type: 'button', onclick: () => decide(r.id, 'deny') }, 'Deny'))));
}

/** Admin side: keeps the card stack in sync (WebSocket 'pairing' event -> refresh(); also a slow safety poll). */
export function startPairRequests(isAdmin) {
  const box = h('div', { class: 'pairreqs', 'aria-live': 'polite' }); document.body.append(box);
  let busy = false;
  const decide = async (id, d) => {
    try { await api(`/pairing/requests/${encodeURIComponent(id)}/${d}`, { method: 'POST', body: {} }); toast(d === 'approve' ? 'Approved. That PC is joining now.' : 'Denied.'); }
    catch (e) { toast(e.message, true); }
    refresh();
  };
  async function refresh() {
    if (busy) return; if (!isAdmin()) { box.replaceChildren(); return; }
    busy = true;
    try { const r = await api('/pairing/requests'); box.replaceChildren(...pairRequestCards(r?.requests, decide)); }
    catch { /* not admin any more / offline: keep quiet */ }
    finally { busy = false; }
  }
  refresh(); const t = setInterval(refresh, 20000);
  return { refresh, destroy: () => { clearInterval(t); box.remove(); } };
}

const KEY = 'wavwiz.pairreq.v1';
/** Player window side: asks for approval at once, shows the match code, polls every 2 s, reloads signed in on approval. */
export function playerApprovalScreen({ name = 'Player window', other, store = globalThis.sessionStorage, poll = 2000, reload = () => location.reload() } = {}) {
  const status = h('p', { class: 'pairwait-st', role: 'status' }, 'Asking WavWiz for permission…');
  const code = h('div', { class: 'pairwait-code', 'aria-label': 'Match code' }, '····');
  const again = h('button', { class: 'btn primary', type: 'button', hidden: true, onclick: () => { again.hidden = true; ask(); } }, 'Ask again');
  const root = h('div', { class: 'card auth pairwait' },
    h('h2', null, 'Use WavWiz on this PC'),
    h('p', null, 'This PC is asking the WavWiz administrator for permission. On any phone or PC signed in as administrator, a card appears: check that it shows this code, then press Approve.'),
    code, status, again,
    h('p', { class: 'dim small' }, 'Nothing is shared until the administrator approves. ',
      h('a', { href: '#', onclick: ev => { ev.preventDefault(); stop(); other?.('pair'); } }, 'Pair with a code instead'), ' · ',
      h('a', { href: '#', onclick: ev => { ev.preventDefault(); stop(); other?.('admin'); } }, 'Sign in as administrator')));
  let timer = 0, live = true;
  const stop = () => { live = false; clearTimeout(timer); };
  const save = r => { try { store?.setItem(KEY, JSON.stringify(r)); } catch { /* private mode */ } };
  const load = () => { try { return JSON.parse(store?.getItem(KEY) || 'null'); } catch { return null; } };
  async function ask() {
    status.textContent = 'Asking WavWiz for permission…';
    try { const r = await api('/auth/pair-request', { method: 'POST', body: { kind: 'window', name } }); save({ id: r.id, secret: r.secret, match: r.match }); code.textContent = r.match; status.textContent = 'Waiting for the administrator to approve…'; tick(); }
    catch (e) { status.textContent = e.message; timer = setTimeout(() => live && ask(), 10000); }
  }
  async function tick() {
    if (!live) return; const cur = load(); if (!cur) return ask();
    let r; try { r = await api(`/auth/pair-request/${encodeURIComponent(cur.id)}/poll`, { method: 'POST', body: { secret: cur.secret } }); }
    catch (e) { if (e.status === 404) { save(null); return ask(); } status.textContent = 'Waiting for the WavWiz server…'; timer = setTimeout(tick, poll * 2); return; }
    if (r.status === 'approved') { save(null); status.textContent = 'Approved. Opening WavWiz…'; stop(); reload(); return; }
    if (r.status === 'denied') { save(null); status.textContent = 'The administrator said no. You can ask again, or pair with a code.'; code.textContent = '····'; again.hidden = false; return; }
    timer = setTimeout(tick, poll);
  }
  const cur = load(); if (cur?.match) { code.textContent = cur.match; status.textContent = 'Waiting for the administrator to approve…'; tick(); } else ask();
  return { el: root, stop };
}

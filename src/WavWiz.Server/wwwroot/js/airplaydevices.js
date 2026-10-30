import { h, api, toast } from './util.js';
import { isAdmin } from './ui.js';

/** F159: "AirPlay speakers" strip in Devices (admin). With AirPlay 2 speakers (experimental) ON: browses (same Ensure + query as Diagnostics),
 *  refreshes every ~4 s while mounted, and lists speakers with Add / Remove (POST /dev/airplay/connect|disconnect -> AirPlayOutputs as today).
 *  With it OFF: no discovery, just a quiet line + Open settings. One persistent element; returns null for non-admins.
 *  F163: quiet - one collapsed "Add AirPlay…" row under the Speakers tree (not under Master); expands on click only (open state remembered for
 *  the session); no discovery while collapsed; WavWiz self rows hidden unless "Show this PC". */
export const apSelf = x => /^WavWiz\s*[–-]/.test(x.name || '') && (x.addresses || []).concat(x.host ? [x.host] : []).some(a => a && (a === location.hostname || String(a).replace(/\.$/, '').toLowerCase() === location.hostname.toLowerCase()));

/** Quirk for a model (same prefix match as AirPlayQuirks.For). Pure. */
export function apQuirk(model, quirks) { const m = String(model || '').toLowerCase(); return (quirks || []).find(q => q.model && m.startsWith(String(q.model).toLowerCase())) || null; }

/** Brand / kind subline: "Sonos · AirPlay 2 · Still being tested". Pure. */
export function apSubline(x, quirks) {
  const q = apQuirk(x.model, quirks), kind = x.airplay2 || x.route?.startsWith('airplay2') ? 'AirPlay 2' : 'AirPlay 1';
  const brand = q ? String(q.label).split(' (')[0] : (x.manufacturer || x.model || '');
  return [brand, kind, q && !q.verified ? (String(q.note || '').split(/[.;—]/)[0].trim() || 'Still being tested') : null].filter(Boolean).join(' · ');
}

/** Why a row cannot be added (null = it can). Pure. */
export function apBlock(x, quirks) {
  if (x.password || x.pin) return 'Needs a password or PIN — not supported yet.';
  const q = apQuirk(x.model, quirks), m = String(x.model || '');
  if (x.route === 'airplay2-ntp' || /^(AppleTV|AudioAccessory)/i.test(m) || /not supported/i.test(q?.note || '') || !/^(raop|raop-rsa|airplay2)/.test(x.route || '')) return 'Not supported yet';
  return null;
}

/** Lock C: plain words for a connect failure. Pure. */
export function apErr(msg, name) {
  const m = String(msg || '');
  if (/experimental/i.test(m)) return 'Turn on AirPlay 2 speakers in Settings → Network → AirPlay speakers (experimental).';
  if (/NTP timing/i.test(m)) return 'This speaker’s AirPlay 2 mode isn’t supported yet.';
  if (/already/i.test(m)) return 'Already added.';
  if (/timed? ?out|timeout|could not|couldn.t|refused|unreachable|no route|not found|connect/i.test(m)) return `Couldn’t reach ${name}. Same Wi‑Fi as this PC? VPN off? If it keeps failing, check the firewall rules in Settings → Network → AirPlay speakers.`;
  return m && m.length <= 80 ? m : `Couldn’t add ${name}.`;
}

let shared = null;   // one strip per page (panel + Devices page both reuse it while mounted where drawn)
export function airplayDevicesStrip(S, ctl) {
  if (!isAdmin(S)) return null;
  if (shared) return shared;
  const box = h('section', { class: 'apds', id: 'devices-airplay', 'aria-label': 'Add AirPlay speakers' }), body = h('div', { class: 'apds-body' });
  let on = null, quirks = [], outs = new Map(), devs = [], timer = 0, busy = new Map(), showSelf = false;
  let open = (() => { try { return sessionStorage.getItem('ww.apds.open') === '1'; } catch { return false; } })();
  const count = h('span', { class: 'apds-n small dim' });
  const toggle = h('button', { class: 'apds-toggle', type: 'button', 'data-act': 'apds-toggle', 'aria-expanded': String(open), onclick: () => setOpen(!open) },
    h('span', { class: 'apds-chev', 'aria-hidden': 'true' }, '▸'), h('span', { class: 'apds-lbl' }, 'Add AirPlay…'), h('span', { class: 'apds-exp small dim' }, 'experimental'), count);
  const again = h('button', { class: 'btn sm', type: 'button', 'data-act': 'apds-search', onclick: () => query(true) }, 'Search again');
  box.append(toggle, body);
  function setOpen(v) { open = v; try { sessionStorage.setItem('ww.apds.open', v ? '1' : '0'); } catch { } if (v) { load().then(() => { if (on) query(false); paint(); }); } paint(); }
  const openSet = async () => { try { const { openSettings } = await import('./settings.js'); openSettings(S, ctl?.refreshAll, ctl?.go, 'airplay'); } catch (e) { toast(e.message, true); } };
  async function query(user) { try { await api('/dev/airplay/query', { method: 'POST' }); } catch (e) { if (user) toast(e.message, true); } if (user) setTimeout(tick, 1200); }
  async function load() {
    try { const s = await api('/airplay/settings'); on = !!s.airPlay2Experimental; quirks = s.quirks || []; } catch { on = null; }
    if (!on) { devs = []; return; }
    try { outs = new Map((await api('/dev/airplay/outputs')).map(o => [o.key, o])); } catch { /* keep last */ }
    try { devs = (await api('/dev/airplay')).devices || []; } catch { /* keep last */ }
  }
  function row(x) {
    const added = outs.has(x.id), b = busy.get(x.id), self = apSelf(x), why = !added && !self ? apBlock(x, quirks) : null;
    const actEl = self ? h('span', { class: 'dim small', title: 'This is WavWiz itself.' }, 'this server')
      : why ? h('span', { class: 'dim small apds-why' }, why)
      : h('button', { class: 'btn sm' + (added ? '' : ' primary'), type: 'button', 'data-act': added ? 'apds-remove' : 'apds-add', disabled: !!b, onclick: () => doAct(x, added) }, b || (added ? 'Remove' : 'Add'));
    return h('div', { class: 'row apds-row' + (self || why ? ' dim' : ''), 'data-id': x.id },
      h('span', { class: 'grow' }, h('b', null, x.name), h('div', { class: 'small dim' }, apSubline(x, quirks), (x.addresses?.[0] || x.host) ? h('span', { class: 'mono' }, ' · ' + (x.addresses[0] || x.host)) : null)), actEl);
  }
  function paint() {
    if (on === null) { box.hidden = true; return; } box.hidden = false;
    box.classList.toggle('open', open); toggle.setAttribute('aria-expanded', String(open)); body.hidden = !open;
    const vis = on ? devs.filter(d => !apSelf(d)) : [];
    count.textContent = on && vis.length ? ` · ${vis.length} found` : '';
    if (!open) { body.replaceChildren(); return; }
    if (!on) { body.replaceChildren(h('div', { class: 'row wrap small dim' }, h('span', { class: 'grow' }, 'To add Sonos / WiiM / AirPlay speakers, turn on AirPlay 2 speakers in Settings → Network.'), h('button', { class: 'btn sm', type: 'button', 'data-act': 'apds-settings', onclick: openSet }, 'Open settings'))); return; }
    const seen = new Set(devs.map(d => d.id));
    const selfN = devs.filter(apSelf).length;
    const rows = devs.filter(d => showSelf || !apSelf(d)).map(row).concat([...outs.values()].filter(o => !seen.has(o.key)).map(o => row({ id: o.key, name: o.name, addresses: [o.address], route: 'raop' })));
    body.replaceChildren(h('div', { class: 'row wrap' }, h('span', { class: 'grow small dim' }, 'Sonos, WiiM, and other AirPlay speakers on this Wi‑Fi. Add one to use it like any WavWiz output.'), again),
      h('div', { class: 'apds-list' }, rows.length ? rows : h('div', { class: 'small dim' }, 'Looking for speakers… answers usually arrive within a few seconds.')),
      selfN ? h('button', { class: 'linkbtn small dim apds-self', type: 'button', 'data-act': 'apds-self', onclick: () => { showSelf = !showSelf; paint(); } }, showSelf ? 'Hide this PC' : 'Show this PC') : null);
  }
  async function doAct(x, added) {
    if (busy.has(x.id)) return; busy.set(x.id, added ? 'Removing…' : 'Adding…'); paint();
    try {
      if (added) { await api('/dev/airplay/disconnect', { method: 'POST', body: { key: x.id } }); toast(`Removed ${x.name}`); }
      else { const r = await api('/dev/airplay/connect', { method: 'POST', body: { key: x.id } }); if (r && r.ok === false) throw new Error(r.error); toast(`Added ${x.name}`); }
    } catch (e) { toast(added ? (e.message || `Couldn’t remove ${x.name}.`) : apErr(e.message, x.name), true); }
    busy.delete(x.id); await load(); paint(); window.dispatchEvent(new CustomEvent('wavwiz:airplay-outputs')); ctl?.refreshAll?.();
  }
  async function tick() {
    if (!box.isConnected) { if (box._gone && Date.now() - box._gone < 8000) return; if (!box._gone) { box._gone = Date.now(); return; } clearInterval(timer); timer = 0; shared = null; window.removeEventListener('wavwiz:airplay-settings', onSet); return; }
    box._gone = 0;
    if (box.closest('[hidden]') || box.offsetParent === null) return;   // Devices folded / not shown: no browsing
    if (!open) { await load(); paint(); return; }   // F163: collapsed -> no discovery, settings re-checked every ~16 s
    const was = on; await load(); if (on && !was) query(false); paint();
  }
  const onSet = () => { load().then(() => { if (on && open) query(false); paint(); }); };
  window.addEventListener('wavwiz:airplay-settings', onSet);
  let n = 0;
  load().then(() => { if (on && open) query(false); paint(); });   // one 4 s poll: discovery only while ON; settings re-checked every ~16 s while OFF; stops once the strip leaves the page
  timer = setInterval(() => { if (!box.isConnected || (on && open) || ++n % 4 === 0) tick(); }, 4000);
  shared = box;
  return box;
}

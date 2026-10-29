// WavWiz 0.4.0 Stage 2: zones that play their own music. One selected zone per browser/phone decides what the Now Playing bar, Queue, mini player,
// hotkeys and media keys control. Vocabulary (see ZoneLinks.cs): device = one speaker/output; zone = a named set of devices (a "zone group" row);
// playback group = the server's per-zone queue/stream. Zones that are LINKED share one playback group (same song, in sync); a zone that is split off has its own.
import { h, api, toast, setApiZone, fmtTime } from './util.js';
import { icon } from './icons.js';

export const ZONE_KEY = 'wavwiz.zone';
export const JUKEBOX_KEY = 'jukebox';
export const loadSel = (store = globalThis.localStorage) => { try { return store.getItem(ZONE_KEY) || null; } catch { return null; } };
export function saveSel(v, store = globalThis.localStorage) { try { v == null ? store.removeItem(ZONE_KEY) : store.setItem(ZONE_KEY, v); } catch { /* private mode */ } }

/** Pure: the zones a user can control, in the Devices order: every zone, then the Jukebox zone once it has its own devices. */
export function choices(groups, jb) {
  const list = (groups || []).map(g => ({ key: 'g:' + g.id, kind: 'zone', id: g.id, name: g.name, playbackId: g.playbackId || 'default', linked: (g.linked || []).length > 0, linkedWith: g.linked || [], now: g.now || null, online: (g.online || 0) > 0, overlaps: !!g.overlapsLarger, playingHere: g.playingHere, of: g.of, claims: g.claims || [], claiming: !!g.claiming }));
  if (jb?.own) list.push({ key: JUKEBOX_KEY, kind: 'jukebox', id: null, name: 'Jukebox', playbackId: jb.zoneId || 'jukebox', linked: false, linkedWith: [], now: jb.now || null, online: true });
  return list;
}
/** Pure: the zone targets for an alarm / schedule / sleep timer: [key, name] per zone and the Jukebox zone (once it has speakers). No key = everything (today's behavior). */
export const targetKeys = (groups, jb) => choices(groups, jb).map(c => [c.key, c.name]);
/** Pure: the name for a stored zone key (F103: a deleted zone reads "zone unavailable"). */
export const targetName = (key, groups, jb) => !key ? '' : targetKeys(groups, jb).find(([k]) => k === key)?.[1] || 'zone unavailable';
/** Pure: the selected zone (a stale or missing choice falls back to the first zone; null when there are no zones at all). */
export const resolve = (groups, jb, sel) => { const c = choices(groups, jb); return c.find(x => x.key === sel) || c[0] || null; };
/** Pure: the zoneId the API wants: null for the house group (old behavior, nothing added to the URL). */
// 0.4.1: a zone that sits inside a larger one is sent as its zone key (g:<id>): pressing play there makes it play on its own devices automatically.
export const zoneIdFor = ch => (!ch ? null : ch.kind === 'zone' && ch.overlaps ? ch.key : !ch.playbackId || ch.playbackId === 'default' ? null : ch.playbackId);
/** Pure: "▶ Song" while playing, the dim title while paused, or a plain sentence. */
export function nowLabel(now) {
  if (!now || !now.title) return 'Nothing playing';
  return (now.state === 'playing' ? '▶ ' : '') + now.title;
}
/** Pure: the position of a zone's song right now (the server value + the time since it was read, while playing). */
export const livePos = (now, atMs, nowMs = Date.now()) => !now ? 0 : Math.max(0, Math.min(now.durationMs || 0, (now.positionMs || 0) + (now.state === 'playing' && !now.live ? nowMs - atMs : 0)));
/** Pure: "Linked with Patio" / "Linked with 3 zones". */
export const linkText = names => !names?.length ? '' : names.length <= 2 ? 'Linked with ' + names.join(' + ') : `Linked with ${names.length} zones`;
/** Pure: is every zone already playing the same group? (Link all has nothing to do.) */
export const allLinked = groups => (groups || []).length < 2 || new Set(groups.map(g => g.playbackId || 'default')).size === 1;

/** 0.4.2 pure: the Queue panel's title suffix. Solo: " · KITCHEN". Linked leader: " · PATIO + LIVING ROOM". Linked follower: " FROM PATIO". */
export function queueSuffix(groups, c) {
  if (!c) return ''; const up = t => String(t).toUpperCase();
  if (c.kind !== 'zone' || !c.linked) return ' · ' + up(c.name);
  const set = (groups || []).filter(g => (g.playbackId || 'default') === (c.playbackId || 'default'));
  if (set.length < 2) return ' · ' + up(c.name);
  return set[0].id === c.id ? ' · ' + up(set.map(g => g.name).join(' + ')) : ' FROM ' + up(set[0].name);
}
/** The leader of the zone's linked set (the zone itself when it is not linked). Pure. */
export const leaderOf = (groups, g) => { const set = (groups || []).filter(x => (x.playbackId || 'default') === (g.playbackId || 'default')); return (g.linked || []).length && set.length > 1 ? set[0] : g; };
export const queueSuffixNow = () => S ? queueSuffix(S.groups, current()) : '';
/** 0.4.5 F28: the title suffix for any zone choice (the Queue panel's Editing zone). */
export const queueSuffixFor = c => S && c ? queueSuffix(S.groups, c) : '';

// ---------------------------------------------------------------- shared state + chips
let S = null, ctl = {}, lastPid = undefined; const chips = new Set(); let menu = null;
export function init(state, controls = {}) { S = state; ctl = controls; sync(); }
export const choicesNow = () => S ? choices(S.groups, S.jb) : [];
export const current = () => S ? resolve(S.groups, S.jb, loadSel()) : null;
export const selectedGroupId = () => { const c = current(); return c?.kind === 'zone' ? c.id : null; };
/** Apply the selection: the API zone, the chips, and (when the stream we show changed) a reload of Now Playing + Queue. Call after zones data changed. */
export function sync() {
  if (!S) return; const c = current(), pid = zoneIdFor(c); setApiZone(pid); globalThis.__wavwizZoneKey = c?.key || null;   // 0.5.1: the visualizer / EQ meters feed follows the resolved zone
  // 0.4.1: a selected zone that no longer exists is forgotten (back to the first zone), not kept in storage
  if ((S.groups || []).length && loadSel() && c && loadSel() !== c.key) saveSel(null);
  if (pid !== lastPid) { const first = lastPid === undefined; lastPid = pid; if (!first) ctl.refreshNow?.(); }
  drawChips(); window.dispatchEvent(new CustomEvent('wavwiz:zonesync'));
}
export function select(key) { saveSel(key); closeMenu(); sync(); window.dispatchEvent(new CustomEvent('wavwiz:zone', { detail: key })); }
globalThis.addEventListener?.('storage', ev => { if (ev.key === ZONE_KEY && S) sync(); });   // the mini player / another tab on this browser

function drawChip(b) {
  const c = current(), has = !!c && choicesNow().length > 1;   // a one-zone home has nothing to choose, so no chip
  b.hidden = !has; if (!has) return;
  b.querySelector('.zs-name').textContent = c.name; b.querySelector('.zs-name').title = c.name;
  if (b._link) { b.setAttribute('aria-label', `Playing on ${c.name}. Choose the zone this player controls`); b.title = `On ${c.name} - choose the zone this player controls`; return; }
  b.classList.toggle('linked', c.linked); b.setAttribute('aria-label', `Controlling ${c.name}. Tap to switch zone`); b.title = `Queue: ${c.name} - choose the zone this player controls`;
}
function drawChips() { for (const b of [...chips]) { if (!b.isConnected && b._seen) { chips.delete(b); continue; } b._seen = b._seen || b.isConnected; drawChip(b); } }
/** The zone chip: "CONTROLLING <zone> ▾". Same element on the Now Playing bar, the mini player and the phone; tapping opens the zone list. */
export function zoneChip(extra = '') {
  const b = h('button', { type: 'button', class: 'zsel ' + extra, 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Choose the zone this player controls',
    onclick: ev => { ev.stopPropagation(); menu && menu._for === b ? closeMenu() : openMenu(b); } },
    h('span', { class: 'zs-ico', 'aria-hidden': 'true' }, icon('devices')), h('span', { class: 'zs-lbl' }, 'CONTROLLING'), h('b', { class: 'zs-name ell' }, ''), h('span', { class: 'zs-car', 'aria-hidden': 'true' }, '▾'));
  chips.add(b); drawChip(b); return b;
}
/** 0.4.5 F27: "on Basement ▾" - the zone name inside the now-playing text is the zone picker (same menu as the chip). Picking a zone also makes
 *  it the Editing zone of the Queue (0.4.4 F14 behavior), via the 'wavwiz:editzone' event. No row or button of its own: it sits on the song line. */
export function zoneLink(extra = '') {
  const b = h('button', { type: 'button', class: 'zlink ' + extra, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    onclick: ev => { ev.stopPropagation(); menu && menu._for === b ? closeMenu() : openMenu(b); } },
    h('span', { class: 'zl-on' }, 'on '), h('b', { class: 'zs-name zl-name ell' }, ''), h('span', { class: 'zs-car', 'aria-hidden': 'true' }, '▾'));
  b._link = true; chips.add(b); drawChip(b); return b;
}
export function closeMenu() { if (!menu) return; menu._for?.setAttribute('aria-expanded', 'false'); menu.remove(); menu = null; document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keys, true); }
const outside = ev => { if (menu && !menu.contains(ev.target) && !menu._for?.contains(ev.target)) closeMenu(); };
const keys = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); const f = menu?._for; closeMenu(); f?.focus(); } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { const it = [...menu.querySelectorAll('.zm-item')], i = it.indexOf(document.activeElement); ev.preventDefault(); it[(i + (ev.key === 'ArrowDown' ? 1 : -1) + it.length) % it.length]?.focus(); } };
function openMenu(anchor) {
  closeMenu(); const cs = choices(S?.groups, S?.jb), sel = current()?.key; if (!cs.length) return;
  const pos = () => { const r = anchor.getBoundingClientRect(), vw = innerWidth, vh = innerHeight, phone = vw < 700, mw = phone ? vw - 16 : Math.min(360, Math.max(r.width, 280));
    menu.style.width = mw + 'px'; menu.style.left = Math.max(8, Math.min(vw - mw - 8, phone ? 8 : r.left)) + 'px';
    const mh = menu.offsetHeight, up = r.top > vh / 2 || r.bottom + mh + 8 > vh; menu.style.top = Math.max(8, up ? r.top - mh - 6 : r.bottom + 6) + 'px'; };
  menu = h('div', { class: 'zmenu40', role: 'menu', 'aria-label': 'Zones' },
    cs.map(c => h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(c.key === sel), 'data-zone-key': c.key, class: 'zm-item' + (c.key === sel ? ' on' : ''), onclick: () => { const edit = !!menu?._for?._link; select(c.key); if (edit) window.dispatchEvent(new CustomEvent('wavwiz:editzone', { detail: c.key })); } },
      h('span', { class: 'dot ' + (c.online ? 'ok' : 'off') }), h('b', { class: 'zm-n ell' }, c.name), c.linked ? h('span', { class: 'zm-link', title: linkText(c.linkedWith) }, icon('link')) : null, h('span', { class: 'grow' }),
      h('span', { class: 'zm-now ell' }, nowLabel(c.now)))),
    h('button', { type: 'button', class: 'zm-manage', onclick: () => { closeMenu(); ctl.manage?.(); } }, 'Manage zones in Devices'));
  menu._for = anchor; anchor.setAttribute('aria-expanded', 'true'); document.body.append(menu); pos();
  document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', keys, true);
  menu.querySelector('.zm-item.on, .zm-item')?.focus();
}

// ---------------------------------------------------------------- shared card pieces (Devices expanded + phone)
/** The now-playing line of a zone card: ▶ title · artist, a thin progress bar and the time. Tapping it selects that zone. */
/** 0.4.8 F61: every "now playing in this zone" line (device cards, zone / speaker settings, Devices strip) ticks its time and progress bar from
 *  the last zone data every 500 ms, the way the main Now Playing does. Before, they only moved when the Devices tree was rebuilt, which a
 *  position change alone triggers only every 10 s (devices.js sig42). Track / play-state / zone changes still arrive over the live socket. */
const liveLines = new Set(); let lineTick = 0;
function paintLine(b) { const { now, at } = b._zl || {}; if (!now?.title) return; const dur = now.durationMs || 0, pos = livePos(now, at);
  const t = b.querySelector('.zl-time'); if (t && dur && !now.live) { const s = `${fmtTime(pos)} / ${fmtTime(dur)}`; if (t.textContent !== s) t.textContent = s; }
  const bar = b.querySelector('.zl-bar'); if (bar && dur) bar.style.setProperty('--p', (Math.min(1, pos / dur) * 100).toFixed(1) + '%'); }
function startLineTick() { if (lineTick || typeof setInterval !== 'function') return; lineTick = setInterval(() => { for (const b of liveLines) { if (!b.isConnected) { liveLines.delete(b); continue; } if (b._zl?.now?.state === 'playing') paintLine(b); } if (!liveLines.size) { clearInterval(lineTick); lineTick = 0; } }, 500); }
export function nowLine(now, { at = Date.now(), onSelect = null, selected = false } = {}) {
  const has = !!now?.title, pos = livePos(now, at), dur = now?.durationMs || 0, frac = has && dur ? Math.min(1, pos / dur) : 0;
  const b = h('div', { class: 'zl-now' + (has ? '' : ' empty') + (onSelect ? ' tap' : ''), role: onSelect ? 'button' : null, tabindex: onSelect ? 0 : null, 'aria-label': has ? `Now playing in this zone: ${now.title}` : 'Nothing playing in this zone', title: onSelect && !selected ? 'Control this zone' : null },
    h('span', { class: 'zl-ico', 'aria-hidden': 'true' }, now?.state === 'playing' ? '▶' : has ? '❚❚' : '▷'),
    h('span', { class: 'zl-t ell' }, has ? h('b', null, now.title) : 'Nothing playing', has && now.artist ? h('span', { class: 'dim' }, ' · ' + now.artist) : null),
    has ? h('span', { class: 'zl-bar', style: `--p:${(frac * 100).toFixed(1)}%` }, h('i')) : null,
    has && !now.live && dur ? h('span', { class: 'zl-time small dim' }, `${fmtTime(pos)} / ${fmtTime(dur)}`) : null);
  b._zl = { now, at }; liveLines.add(b); startLineTick();   // 0.4.8 F61: time + bar tick live (the tree only rebuilds on real changes)
  if (onSelect) { b.addEventListener('click', ev => { ev.stopPropagation(); onSelect(); }); b.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); onSelect(); } }); }
  return b;
}
// 0.4.1: a link icon chip instead of the long "LINKED WITH ..." text; the text is its tooltip and screen-reader label
export const linkBadge = g => (g.linked || []).length ? h('span', { class: 'dtag zlink zicon', title: linkText(g.linked) + ' - these zones play the same song in sync', 'aria-label': linkText(g.linked), role: 'img' }, icon('link')) : null;
/** 0.4.1: "2 of 3 playing here" when a smaller zone has taken some of this zone's devices (hidden otherwise). */
export const hereTag = g => g.of && g.playingHere != null && g.playingHere < g.of ? h('span', { class: 'dtag zhere', title: 'Some devices of this zone are playing in a smaller zone right now' }, `${g.playingHere} of ${g.of} playing here`) : null;
export const controllingTag = () => h('span', { class: 'dtag zctl tagact', 'data-tag-act': 'zctl', role: 'button', tabindex: 0, title: 'Control this zone (it already is: the Now Playing bar, Queue, mini player and hotkeys control it)' }, 'CONTROLLING');   // 0.4.4 F19

/** Pick the zone to link `g` with, then link (admin and Control both may switch playback; the buttons are read-only for view users). */
export function linkMenu(anchor, S_, g, done) {
  closeMenu(); const others = (S_.groups || []).filter(x => x.id !== g.id && x.playbackId !== g.playbackId);
  const m = h('div', { class: 'zmenu40 zlinkmenu', role: 'menu', 'aria-label': `Link ${g.name} with` }, h('div', { class: 'zm-head' }, `Link ${g.name} with…`),
    others.length ? others.map(o => h('button', { type: 'button', role: 'menuitem', class: 'zm-item', 'data-with': o.id, onclick: async () => { closeMenu(); try { await api(`/groups/${g.id}/link`, { method: 'POST', body: { with: o.id } }); toast(`${g.name} now plays the same music as ${o.name}`); done?.(); } catch (e) { toast(e.message, true); } } },
      h('span', { class: 'dot ok' }), h('b', { class: 'zm-n ell' }, o.name), h('span', { class: 'grow' }), h('span', { class: 'zm-now ell' }, nowLabel(o.now)))) : h('div', { class: 'zm-head dim' }, 'Everything is already linked.'));
  menu = m; m._for = anchor; document.body.append(m);
  const r = anchor.getBoundingClientRect(), mw = Math.min(innerWidth - 16, 320); m.style.width = mw + 'px'; m.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.right - mw)) + 'px';
  const mh = m.offsetHeight; m.style.top = Math.max(8, r.bottom + mh + 8 > innerHeight ? r.top - mh - 6 : r.bottom + 6) + 'px';
  document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', keys, true); m.querySelector('.zm-item')?.focus();
}
export async function splitOff(g, done) { try { await api(`/groups/${g.id}/split`, { method: 'POST' }); toast(`${g.name} now has its own music`); done?.(); } catch (e) { toast(e.message, e.status !== 409); } }   // 409 = nothing to split: the server says why
export async function linkAll(into, done) { try { await api('/groups/link-all', { method: 'POST', body: { into } }); toast('Every zone now plays the same music'); done?.(); } catch (e) { toast(e.message, true); } }

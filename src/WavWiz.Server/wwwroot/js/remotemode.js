// WavWiz 0.3.0 §2 Remote mode: this device controls playback but plays no audio and is not a speaker card. Remembered per device.
import { h, api, toast } from './util.js';
import { webRoomId } from './ui.js';
export const REMOTE_KEY = 'wavwiz.remoteMode';
/** ?remote=1 / ?remote=0 (the Player hands its tray choice over this way) wins and is remembered. */
export function isRemote(store = globalThis.localStorage, search = globalThis.location?.search || '') {
  let q = null; try { q = new URLSearchParams(search).get('remote'); } catch { /* ignore */ }
  if (q === '1' || q === '0') { try { store?.setItem(REMOTE_KEY, q); } catch { /* ignore */ } return q === '1'; }
  try { return store?.getItem(REMOTE_KEY) === '1'; } catch { return false; }
}
export const REMOTE_BANNER = 'Remote mode: this device controls playback and plays no sound.';
/** The gold banner (theme Highlight color via CSS, never a fixed color). */
export function remoteBanner(on, onOff) {
  let b = document.getElementById('remotebanner');
  if (!on) { b?.remove(); return null; }
  if (!b) {
    b = h('div', { id: 'remotebanner', class: 'remote-banner', role: 'status' }, h('span', { class: 'grow' }, '◎ ', REMOTE_BANNER), h('button', { class: 'btn', type: 'button', onclick: onOff }, 'Play here instead'));
    const top = document.querySelector('.topbar'); if (top) top.after(b); else document.body.prepend(b);
  }
  return b;
}
/** Turn remote mode on/off for this browser. On: stop the local speaker and hide its card on the server. */
export async function setRemote(S, on, { stopDevice, startDevice } = {}) {
  try { localStorage.setItem(REMOTE_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  // only this browser's own speaker (never the Player window on the same PC: that has its own tray choice)
  const rid = webRoomId(); const z = rid ? (S.zones || []).find(x => x.playerId === rid) : null;
  let zid = z?.id ?? null; try { if (on && zid != null) localStorage.setItem(REMOTE_KEY + '.zone', String(zid)); if (!on) zid = zid ?? Number(localStorage.getItem(REMOTE_KEY + '.zone')) ?? null; } catch { /* ignore */ }
  if (on) await stopDevice?.();
  if (zid != null && !Number.isNaN(zid) && zid !== 0) { try { await api(`/zones/${zid}/remote`, { method: 'PUT', body: { remote: on } }); } catch (e) { toast(e.message, true); } }
  if (!on) await startDevice?.();
  remoteBanner(on, () => setRemote(S, false, { stopDevice, startDevice }));
}
/** Inside the WavWiz Player window: the tray choice (?remote=1/0) hides or brings back this PC's speaker card. */
export async function syncPlayerRemote(S, mine) {
  const on = isRemote(); let stored = null; try { stored = localStorage.getItem(REMOTE_KEY + '.zone'); } catch { /* ignore */ }
  const zid = on ? mine?.id : (stored ? Number(stored) : null);
  if (zid == null || Number.isNaN(zid)) return;
  try { await api(`/zones/${zid}/remote`, { method: 'PUT', body: { remote: on } }); if (on) localStorage.setItem(REMOTE_KEY + '.zone', String(zid)); else localStorage.removeItem(REMOTE_KEY + '.zone'); } catch { /* View role: the server keeps the old state */ }
}

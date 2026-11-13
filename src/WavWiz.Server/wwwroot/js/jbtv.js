// 0.6.8-#6d: while the Jukebox runs, a small top-bar chip shows the view-only TV address (the guest page in TV mode:
// /jukebox.html?j=<code>&tv=1). A smart-TV browser opens it with no sign-in, no admin and no player (it never becomes a speaker).
// Kept out of the device list on purpose. Click: the address big + the join QR + Copy.
import { h, api, toast, dialog } from './util.js';

export const tvUrlFrom = joinUrl => joinUrl ? joinUrl + (joinUrl.includes('?') ? '&' : '?') + 'tv=1' : '';

export function jbTvChip(S) {
  const label = h('code', { class: 'jbtv-u' });
  const chip = h('button', { type: 'button', class: 'jbtv-chip', hidden: true, title: 'Open this address on a TV browser to show the Jukebox (view only)', onclick: () => openInfo() },
    h('span', { class: 'jbtv-ic', 'aria-hidden': 'true' }, '📺'), h('span', { class: 'jbtv-l' }, 'Jukebox TV'), label);
  let url = '', running = false, at = 0;
  async function sync() {
    const r = !!S.jb?.running;
    if (!r) { running = false; url = ''; chip.hidden = true; return; }
    if (running && url && Date.now() - at < 30_000) return;   // the code only changes when the Jukebox restarts
    running = true; at = Date.now();
    try { const j = await api('/jukebox/join'); url = tvUrlFrom(j?.url || ''); } catch { url = ''; }
    label.textContent = url.replace(/^https?:\/\//, ''); chip.hidden = !url;
  }
  function openInfo() {
    if (!url) return;
    const copy = async () => { try { await navigator.clipboard.writeText(url); toast('TV address copied'); } catch { toast(url); } };
    dialog('Show the Jukebox on a TV', h('div', { class: 'jbtv-info' },
      h('p', null, 'Open this address in the TV’s web browser. It shows Now Playing, Up next and the join QR - view only, no sign-in, no sound on the TV.'),
      h('code', { class: 'jbtv-big' }, url.replace(/^https?:\/\//, '')),
      h('img', { class: 'jbtv-qr', src: '/api/v1/jukebox/qr.svg', alt: 'QR code guests scan to add songs' }),
      h('p', { class: 'small dim' }, 'The QR on the TV is the guest link (add songs). The address changes when the Jukebox is restarted.')),
      [{ text: 'Copy address', keep: true, onclick: copy }, { text: 'Close', cls: 'primary' }]);
  }
  window.addEventListener('wavwiz:zonesdata', sync);
  return { el: chip, sync };
}
/** 0.6.9 #26 (t1876): the same 'Show the Jukebox on a TV' dialog, opened from the Jukebox host panel (the title-bar pill is gone). */
export async function showTvInfo() {
  let url = ''; try { url = tvUrlFrom((await api('/jukebox/join'))?.url || ''); } catch { url = ''; }
  if (!url) { toast('The Jukebox is not running', true); return; }
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast('TV address copied'); } catch { toast(url); } };
  dialog('Show the Jukebox on a TV', h('div', { class: 'jbtv-info' },
    h('p', null, 'Open this address in the TV’s web browser. It shows Now Playing, Up next and the join QR - view only, no sign-in, no sound on the TV.'),
    h('code', { class: 'jbtv-big' }, url.replace(/^https?:\/\//, '')),
    h('img', { class: 'jbtv-qr', src: '/api/v1/jukebox/qr.svg', alt: 'QR code guests scan to add songs' }),
    h('p', { class: 'small dim' }, 'The QR on the TV is the guest link (add songs). The address changes when the Jukebox is restarted.')),
    [{ text: 'Copy address', keep: true, onclick: copy }, { text: 'Close', cls: 'primary' }]);
}

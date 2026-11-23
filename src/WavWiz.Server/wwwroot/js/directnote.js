// WavWiz 0.7.3: the "Direct (no processing)" notice for the center EQ and the phone Sound sheet. Same card look as the Speaker Settings switch
// (.spk-direct); says the EQ there is bypassed, and offers Turn off and Speaker settings, so an edit never silently does nothing.
import { h } from './util.js';

export const DIRECT_NOTE = 'Direct is on — processing bypassed';
/** Pure: the one-line explanation under the title. */
export const directNoteText = speaker => `${DIRECT_NOTE}. The EQ, Bass / Treble, Balance, Trim and Loudness${speaker ? ` of ${speaker}` : ''} are kept but not used until you turn Direct off.`;

/** { speaker, canOff, onOff(), onOpen() } -> element. Turn off is disabled (with a reason) for a read-only user; Speaker settings is left out without onOpen. */
export function directBanner({ speaker = '', canOff = false, onOff = () => {}, onOpen = null } = {}) {
  const off = h('button', { type: 'button', class: 'btn sm', 'data-act': 'direct-off', disabled: !canOff || undefined,
    title: canOff ? 'Turn Direct off and use the EQ again' : 'Only this speaker’s owner or an admin can change the sound.', onclick: () => { if (canOff) onOff(); } }, 'Turn off');
  const open = onOpen ? h('button', { type: 'button', class: 'btn sm', 'data-act': 'direct-open', title: speaker ? `Open ${speaker} settings` : 'Open speaker settings', onclick: () => onOpen() }, 'Speaker settings') : null;
  return h('div', { class: 'spk-direct direct-banner', role: 'status', 'data-act': 'direct-banner' },
    h('div', { class: 'spk-direct-h' }, h('span', { class: 'dlbl' }, 'DIRECT (NO PROCESSING)'), h('span', { class: 'grow' }), off, open),
    h('div', { class: 'spk-direct-sub' }, directNoteText(speaker)));
}

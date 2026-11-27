// F274: "Make your phone secure" - the optional sub-step under Getting started's "Open it on your phone", and the
// "Phones with a secure connection" list (phones report Secure ✓ themselves over HTTPS; the list grants nothing).
import { h } from './util.js';

export const SECURE_TITLE = 'Make your phone secure';
export const SECURE_WHY = 'Only needed to use your phone\u2019s microphone: calibrating speakers, Announce and Check with phone. Everything else already works.';
export const SECURE_SETUP_PATH = '/tls/setup?next=app';
export const SECURE_QR = '/tls/qr.svg?to=secure';
export const SETUP_BTN = 'Set up secure connection';

/** "Nov 26" in the reader's own locale (short month + day). */
export const shortDay = (iso, locale) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(locale || undefined, { month: 'short', day: 'numeric' }); };
/** "iPhone: Secure ✓ (Nov 26) · Android phone: Secure ✓ (Nov 20)" (newest first, as the server keeps them). */
export const trustedLabel = (devices, locale) => (devices || []).filter(d => d && d.name).map(d => `${d.name}: Secure \u2713${d.lastSeen ? ` (${shortDay(d.lastSeen, locale)})` : ''}`).join(' \u00b7 ');

/** On a phone the button opens the set-up page right here; on a PC it shows the QR code (it opens the http set-up page, never https). */
export function secureStep(item, { onPhone = false } = {}) {
  const devices = item?.devices || [], done = devices.length > 0 || !!item?.done;
  return h('div', { class: 'gs-secure' + (done ? ' done' : ''), 'data-step': 'phone-secure' },
    h('b', null, done ? '\u{1F512} ' : '', SECURE_TITLE, h('span', { class: 'dim small' }, ' (optional, about 2 minutes)')),
    done ? h('div', { class: 'small gs-secure-list', 'data-secure-list': '' }, trustedLabel(devices)) : h('div', { class: 'small dim' }, SECURE_WHY),
    onPhone
      ? h('div', { class: 'row wrap', style: 'margin-top:6px;gap:6px' }, h('a', { class: 'btn' + (done ? '' : ' primary'), href: SECURE_SETUP_PATH, 'data-act': 'secure-setup' }, done ? 'Set up another phone' : SETUP_BTN))
      : h('div', { class: 'addspk-connect-row gs-phone', style: 'margin-top:6px' },
          h('img', { class: 'addspk-qr', src: SECURE_QR, alt: 'QR code for the secure-connection set-up page', width: 120, height: 120 }),
          h('div', { class: 'addspk-urlbox' }, h('span', { class: 'small dim' }, done ? 'Another phone? Scan this with its camera.' : 'Scan this with the phone\u2019s camera. The page shows the steps for that phone and checks that they worked.'),
            h('a', { class: 'btn sm', href: SECURE_SETUP_PATH, target: '_blank', rel: 'noopener', 'data-act': 'secure-setup' }, SETUP_BTN))));
}

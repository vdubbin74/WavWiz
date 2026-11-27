// F273 (0.7.3): "Check your network" - step 1 of Getting started, and the slim Public banner on the server PC.
// Windows has the home network set to Public -> its firewall blocks every phone and other PC (WavWiz's rules are Private-only).
// Detect, explain, open the right Windows Settings page. Never changes a firewall rule or network setting (Phase 2 skipped).
import { h, api, toast } from './util.js';

/** The only Windows Settings pages this card may open (the Player's exact-match allowlist, UiUrl.NetSettingsUris). */
export const NET_URIS = ['ms-settings:network-wifi', 'ms-settings:network-ethernet', 'ms-settings:network-status'];
export const netUri = kind => kind === 'Wi-Fi' ? NET_URIS[0] : kind === 'Ethernet' ? NET_URIS[1] : NET_URIS[2];
export const RECHECK_MS = 10_000;                 // the card re-checks by itself while it is on screen
export const BANNER_POLL_MS = 15_000;
export const BANNER_HIDE_MS = 7 * 24 * 3600_000;  // × hides the banner for 7 days
export const SKIP_KEY = 'wavwiz.net.skip';        // sessionStorage: Skip for now lasts until the app restarts
export const BANNER_KEY = 'wavwiz.netBanner.hideUntil';
export const AUTO_KEY = 'wavwiz.net.autoShown';    // sessionStorage: Getting started opened by itself once this app start
export const FIX_FIRST = 'Fix your network first';
export const ON_PC = 'Fix this on the PC that runs WavWiz: Settings > Network & internet > your network > Private.';
export const ADMIN_LINE = 'If Windows asks for an administrator, sign in with one.';
export const BANNER_TEXT = '⚠ Phones and other PCs can\u2019t reach WavWiz: Windows has this network set to Public.';
/** High-contrast fills (theme-independent, so AA holds in every theme incl. Midnight Neon): amber / info blue / red, dark text. */
export const NET_COLORS = { pub: { bg: '#ffb020', fg: '#1a1000' }, dom: { bg: '#cfe3ff', fg: '#0a1830' }, bad: { bg: '#ffd2cc', fg: '#4a0800' }, ok: { bg: '#cdeccf', fg: '#06290b' } };

const ss = () => { try { return globalThis.sessionStorage; } catch { return null; } };
const ls = () => { try { return globalThis.localStorage; } catch { return null; } };
export const netSkipped = () => ss()?.getItem(SKIP_KEY) === '1';
export function setNetSkipped(v) { try { if (v) ss()?.setItem(SKIP_KEY, '1'); else ss()?.removeItem(SKIP_KEY); } catch { /* private mode */ } }

/** WCAG contrast ratio of two #rrggbb colors. */
export function contrast(a, b) {
  const L = hex => { const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05);
}

/** Open the Windows network page: in the WavWiz Player window an exact allowlisted message, in a browser on the server PC a plain ms-settings: link. */
export function openNetSettings(uri, w = globalThis.window) {
  const u = NET_URIS.includes(uri) ? uri : NET_URIS[2];
  if (w?.chrome?.webview?.postMessage) { w.chrome.webview.postMessage({ open: u }); return 'player'; }
  try { const a = w.document.createElement('a'); a.href = u; a.rel = 'noopener'; w.document.body.append(a); a.click(); a.remove(); } catch { /* node */ }
  return 'link';
}

/** Is this checklist "network" item a Public network that should hold back the later steps? */
export const netWaits = (net, skipped = netSkipped()) => !!net && net.state === 'public' && !skipped;

let alerted = false;   // role="alert" once, when the card first appears (re-checks must not re-announce it)
export function _resetAlert() { alerted = false; }

/** Step 1 body: Private = green row; Public = the high-contrast card (or one red row after Skip for now); Domain = info card; unknown = plain row. */
export function netCard(net, { thisMachine = false, skipped = netSkipped(), onCheck = null, onSkip = null, onFix = null, checking = false } = {}) {
  const name = net?.network || 'your network', st = net?.state || 'unknown';
  if (st === 'private') return h('div', { class: 'netrow ok', 'data-net': 'private' }, `✓ Your network \u201c${name}\u201d is Private. Phones can connect.`);
  if (st === 'domain') return h('div', { class: 'netcard dom', 'data-net': 'domain', role: 'note' }, h('b', { class: 'netcard-t' }, 'ℹ This PC is on a work (domain) network, so phones may not find WavWiz. Ask whoever manages this PC.'));
  if (st !== 'public') return h('div', { class: 'netrow', 'data-net': 'unknown' }, 'Couldn\u2019t check your network type. If your phone can\u2019t connect, make sure Windows has it set to Private.');
  if (skipped) return h('div', { class: 'netrow bad', 'data-net': 'public-skipped' }, h('span', { class: 'grow' }, '⚠ Network is Public: phones won\u2019t connect.'),
    h('button', { type: 'button', class: 'btn sm', 'data-act': 'net-fix', onclick: () => onFix?.() }, 'Fix'));
  const eth = net.kind === 'Ethernet';
  const role = alerted ? {} : { role: 'alert' }; alerted = true;
  return h('div', { class: 'netcard pub', 'data-net': 'public', ...role },
    h('b', { class: 'netcard-t' }, `⚠ Your network \u201c${name}\u201d is set to Public, so phones and other devices can\u2019t find WavWiz.`),
    thisMachine
      ? [h('p', null, 'Switch it to Private (only on your own home network):'),
         h('ol', { class: 'netcard-steps' }, h('li', null, 'Click ', h('b', null, 'Open network settings'), '.'),
           h('li', null, eth ? ['Click ', h('b', null, 'Ethernet'), '.'] : [`Click your network (\u201c${name}\u201d).`]),
           h('li', null, 'Under ', h('b', null, 'Network profile type'), ', choose ', h('b', null, 'Private'), '.')),
         h('p', { class: 'small' }, ADMIN_LINE)]
      : h('p', { class: 'netcard-pc' }, ON_PC),
    h('div', { class: 'row wrap netcard-acts' },
      thisMachine ? h('button', { type: 'button', class: 'btn primary', 'data-act': 'net-open', onclick: () => openNetSettings(net.settingsUri || netUri(net.kind)) }, 'Open network settings') : null,
      h('button', { type: 'button', class: 'btn', 'data-act': 'net-check', disabled: checking || undefined, onclick: () => onCheck?.() }, checking ? 'Checking…' : 'Check again')));
}

/** Steps 2-6 while Public: dimmed (not hidden), buttons disabled, under "Fix your network first · Skip for now". */
export function netWait(nodes, { onSkip } = {}) {
  const box = h('div', { class: 'net-later', 'aria-disabled': 'true' }, nodes);
  box.querySelectorAll('button, input, select, a').forEach(e => { if ('disabled' in e) e.disabled = true; e.tabIndex = -1; });
  return h('div', { class: 'net-wait' },
    h('div', { class: 'small net-wait-note' }, h('b', null, FIX_FIRST), ' · ',
      h('button', { type: 'button', class: 'linkbtn', 'data-act': 'net-skip', onclick: () => { setNetSkipped(true); onSkip?.(); } }, 'Skip for now')), box);
}

/** Step 2: QR + address + Copy (the Add speaker > Browser markup). */
export function phoneOpenBox(url) {
  return h('div', { class: 'addspk-connect-row gs-phone' },
    h('img', { class: 'addspk-qr', src: '/tls/qr.svg?to=app', alt: 'QR code for the WavWiz web app', width: 120, height: 120 }),
    h('div', { class: 'addspk-urlbox' }, h('span', { class: 'small dim' }, 'Scan it with the phone camera, or type this address in the phone\u2019s browser:'),
      h('code', { class: 'addspk-url', 'data-net-url': '' }, url),
      h('button', { type: 'button', class: 'btn sm', 'data-act': 'net-copy', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Address copied'); } catch { toast(url); } } }, 'Copy address')));
}

// ---------------- the server-PC banner
export const bannerHidden = (now = Date.now()) => { const t = +(ls()?.getItem(BANNER_KEY) || 0); return t > now; };
export function hideBanner(now = Date.now()) { try { ls()?.setItem(BANNER_KEY, String(now + BANNER_HIDE_MS)); } catch { /* */ } }
/** Show the banner? Server PC only (a phone that loaded the page can reach WavWiz), Public, not hidden with ×. */
export const showBanner = (auth, net, now = Date.now()) => !!auth?.thisMachine && net?.state === 'public' && !bannerHidden(now);
export function netBanner({ onFix, onHide } = {}) {
  return h('div', { class: 'netbanner', role: 'status', 'data-net-banner': '' },
    h('span', { class: 'grow' }, BANNER_TEXT),
    h('button', { type: 'button', class: 'btn sm', 'data-act': 'net-banner-fix', onclick: () => onFix?.() }, 'Fix it'),
    h('button', { type: 'button', class: 'btn sm quiet', 'aria-label': 'Hide for 7 days', title: 'Hide for 7 days', 'data-act': 'net-banner-x', onclick: () => { hideBanner(); onHide?.(); } }, '×'));
}
/** /api/network -> the same shape as the checklist item (state, network, kind, settingsUri). */
export async function fetchNet(fresh = false) { try { const r = await api('/network' + (fresh ? '?fresh=true' : '')); return r?.net || null; } catch { return null; } }

/** Getting started opens by itself while Public: server PC only, once per app start, until fixed or "Don't open this by itself again". */
export function shouldAutoOpenPublic(c, auth, localDismissed, store = ss()) {
  const net = c?.items?.find(i => i.id === 'network');
  if (!auth?.thisMachine || !net || net.state !== 'public' || c.dismissed || localDismissed) return false;
  return store?.getItem(AUTO_KEY) !== '1';
}
export function markAutoOpened(store = ss()) { try { store?.setItem(AUTO_KEY, '1'); } catch { /* */ } }

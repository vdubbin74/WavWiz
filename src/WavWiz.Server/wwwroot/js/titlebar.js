// 0.6.8-#16: themed title bar for the Windows app (WavWiz Player's WebView2 window). The host removes the Windows caption strip and adds
// "WavWizChrome/1" to the user agent; this page then turns its own top bar (wordmark + File/app menus) into the window's title bar:
// app-region: drag on the bar (move, double-click maximize, right-click system menu - WebView2 non-client regions), no-drag on every control,
// and themed minimize / maximize-restore / close buttons. Phones and plain browsers never get the token, so nothing changes there.
import { h } from './util.js';

/** True only inside WavWiz Player with the custom title bar on (pure). */
export const hasCustomChrome = (ua = globalThis.navigator?.userAgent || '') => /WavWizPlayer\//.test(ua) && /\bWavWizChrome\/1\b/.test(ua) && !/iPhone|iPad|Android|Mobile/.test(ua);

// Logo hook: the bar uses the current wordmark. The official Parallel Flow logo (blocked until the font arrives) plugs in with
// setTitlebarLogo(() => element) without touching the bar.
let logoFactory = null;
export function setTitlebarLogo(fn) {
  logoFactory = typeof fn === 'function' ? fn : null;
  for (const slot of globalThis.document?.querySelectorAll?.('.wtb-logo') || []) { const el = logoFactory?.(); if (el) slot.replaceChildren(el); }
}
/** The logo for a top bar: the swapped-in logo when one is set, else the fallback (the wordmark). */
export const titlebarLogo = fallback => h('span', { class: 'wtb-logo' }, (logoFactory && logoFactory()) || fallback());

// Segoe Fluent Icons / MDL2 caption glyphs (the Windows app only ever runs on Windows 10/11)
export const GLYPH = { min: '\uE921', max: '\uE922', restore: '\uE923', close: '\uE8BB' };
const post = m => { try { globalThis.chrome?.webview?.postMessage(m); } catch { /* not the Player */ } };

/** Minimize / maximize-restore / close. The host answers {cmd:'win',state:'max'|'normal'} so the middle button shows the right icon. */
export function windowControls(send = post) {
  const btn = (act, label, cls) => h('button', { type: 'button', class: 'wtb-btn ' + cls, 'data-act': act, 'aria-label': label, title: label, onclick: ev => { ev.stopPropagation(); send({ cmd: 'win', act }); } }, h('span', { class: 'wtb-g', 'aria-hidden': 'true' }, GLYPH[act === 'max' ? 'max' : act]));
  const max = btn('max', 'Maximize', 'wtb-max');
  const el = h('div', { class: 'wtb-ctl', role: 'group', 'aria-label': 'Window' }, btn('min', 'Minimize', 'wtb-min'), max, btn('close', 'Close', 'wtb-close'));
  el.setState = state => { const on = state === 'max'; max.querySelector('.wtb-g').textContent = on ? GLYPH.restore : GLYPH.max; max.setAttribute('aria-label', on ? 'Restore' : 'Maximize'); max.title = on ? 'Restore' : 'Maximize'; document.documentElement.classList.toggle('wtb-maxed', on); };
  return el;
}

/** Publish the caption-button strip width so the top bar (and any host inset) can reserve it. */
// 0.6.9 #18: the width is computed, never measured. It used to be the strip's own on-screen width - but the strip's CSS width IS --wtb-ctl-w,
// and with a Display size other than 100 % (html zoom) the measured box is that width x zoom. Every resize (maximize, restore, DPI change)
// fed the zoomed value back in, so at 67 % the buttons shrank 138 -> 92 -> 62 ... px ("scrunched" when maximized) and at 125 % they grew.
export const CTL_BTN_PX = 46;
// Like Windows' own caption buttons they keep their real size at every Display size: 46 px on screen = 46 / zoom CSS px.
export const ctlInsetPx = n => Math.max(1, n | 0 || 3) * CTL_BTN_PX;   // on-screen px (pure)
export const ctlInsetCss = n => `calc(${ctlInsetPx(n)}px / var(--z,1))`;
export const applyCtlInset = (ctl, root = globalThis.document?.documentElement) => {
  if (!root) return 0;
  const n = ctl?.children?.length || 3, v = ctlInsetCss(n);
  if (root.style.getPropertyValue('--wtb-ctl-w') !== v) root.style.setProperty('--wtb-ctl-w', v);
  return ctlInsetPx(n);
};

/** Turns the page's top bar into the window title bar (only inside the Player with the token). Returns true when it did. */
export function installTitlebar(bar, ua) {
  if (!bar || !hasCustomChrome(ua)) return false;
  document.documentElement.classList.add('wtb'); bar.classList.add('wtitlebar');
  bar.querySelector('.wtb-ctl')?.remove();
  const ctl = windowControls(); bar.append(ctl);
  // In-flow caption buttons + --wtb-ctl-w so ADMIN / Connected never sit under min/max/close.
  const sync = () => applyCtlInset(ctl);
  sync();
  try { globalThis.chrome?.webview?.addEventListener('message', ev => { const d = ev.data; if (d && d.cmd === 'win' && d.state) { ctl.setState(d.state); sync(); } }); } catch { /* not the Player */ }
  window.addEventListener('blur', () => document.documentElement.classList.add('wtb-inactive'));
  window.addEventListener('focus', () => document.documentElement.classList.remove('wtb-inactive'));
  window.addEventListener('resize', sync);
  post({ cmd: 'win', act: 'ready' });
  return true;
}

// Theme sub-section of Settings > Appearance. 0.2.2 T2: back to the 0.2.0 Themes page layout (theme cards + Custom colors), with a live
// app preview on top. Five colors (Background, Main, Second, Highlight, Text - 0.2.1 F14). Saved on this device.
import { h, toast } from './util.js';
import { PRESETS, loadTheme, saveTheme, resetTheme, applyTheme, isHex, derive, defaultInk } from './theme.js';

const fire = () => window.dispatchEvent(new CustomEvent('wavwiz:theme'));
/** 0.2.1 F20: the Pepecoin note - the official onDark logo with wordmark (Pepecoin_onDark_RGB, byte-for-byte the brand-kit file, never
 * edited: the kit's artboard is a full page, so the logo is shown through a window that crops the empty page around it), "Pepecoin" written
 * exactly, brand colors only (#212121 note background, white text). */
export const PEPE_LOGO = '/assets/pepecoin/Pepecoin_onDark_RGB.svg';
export function pepeNote() {
  return h('div', { class: 'pepe-note' },
    h('div', { class: 'pepe-logo', role: 'img', 'aria-label': 'Pepecoin' }, h('img', { src: PEPE_LOGO, alt: '', width: 842, height: 595, decoding: 'async' })),
    h('p', { class: 'small pepe-text' }, 'Colors from the Pepecoin brand guidelines (primary #269B4D, second #208241, highlight #C07A4E on #212121). WavWiz is not affiliated with Pepecoin.'));
}
/** 0.2.2 T2: the 0.2.0 theme card (mini app in the theme's colors, name, check), now with the Highlight color too. */
function previewCard(id, p, current, onPick, onHover) {
  const v = derive(p);
  const mini = h('div', { class: 'tp-mini', style: `background:${p.bg};border-color:${v['--line']}` },
    h('div', { class: 'tp-bar', style: `background:${v['--panel']};border-bottom:1px solid ${v['--line']}` }, h('b', { style: `color:${p.accent}` }, 'Wav'), h('b', { style: `color:${v['--accent2']}` }, 'Wiz'), h('i', { class: 'tp-hl', style: `background:${v['--hl']}` })),
    h('div', { class: 'tp-body' },
      h('div', { class: 'tp-art', style: `background:linear-gradient(135deg,${p.accent},${v['--accent2']})` }),
      h('div', { class: 'tp-lines' }, h('i', { style: `background:${v['--ink']}` }), h('i', { style: `background:${v['--accent2']};width:55%` }),
        h('div', { class: 'tp-prog', style: `background:${v['--line']}` }, h('span', { style: `background:${p.accent};width:62%` })))),
    h('div', { class: 'tp-ctl' }, h('span', { class: 'tp-dot', style: `background:${v['--panel2']}` }), h('span', { class: 'tp-play', style: `background:${p.accent};box-shadow:0 0 12px ${p.accent}` }), h('span', { class: 'tp-dot', style: `background:${v['--panel2']}` })));
  return h('button', { type: 'button', class: 'themecard' + (current ? ' on' : ''), 'data-id': id, 'aria-pressed': String(current), 'aria-label': `Theme ${p.name}${current ? ' (active)' : ''}`,
    onclick: () => onPick(id), onmouseenter: () => onHover(p), onmouseleave: () => onHover(null), onfocus: () => onHover(p), onblur: () => onHover(null) },
    mini, h('div', { class: 'tp-name' }, h('span', { class: 'ell' }, p.name), current ? h('span', { class: 'tp-check', 'aria-hidden': 'true' }, '✓') : null));
}

/** 0.2.2 T2: live app preview for the Theme page - a small WavWiz drawn with the theme variables; hovering a card recolors it with that theme. */
export function appPreview() {
  const col = (cls, ...kids) => h('div', { class: 'ap-col ' + cls }, ...kids);
  const rows = n => Array.from({ length: n }, (_, i) => h('div', { class: 'ap-row' }, h('i', { class: 'ap-av', style: `opacity:${0.55 + (i % 3) * 0.15}` }), h('i', { class: 'ap-ln' })));
  const app = h('div', { class: 'ap-app', 'aria-hidden': 'true' },
    h('div', { class: 'ap-top' }, h('b', { class: 'ap-w1' }, 'Wav'), h('b', { class: 'ap-w2' }, 'Wiz'), h('span', { class: 'ap-beta' }, 'BETA'), h('span', { class: 'grow' }), h('i', { class: 'ap-dot' })),
    h('div', { class: 'ap-desk' },
      col('ap-lib', h('div', { class: 'ap-h' }, 'LIBRARY'), ...rows(5)),
      col('ap-mid', h('div', { class: 'ap-viz' }, Array.from({ length: 22 }, (_, i) => h('i', { style: `height:${18 + Math.round(60 * Math.abs(Math.sin(i * 0.55)))}%` }))),
        h('div', { class: 'ap-np' }, h('i', { class: 'ap-art' }), h('div', { class: 'ap-t' }, h('b', null, 'Glass Harbor'), h('span', null, 'Lumen'), h('div', { class: 'ap-prog' }, h('span'))),
          h('span', { class: 'ap-btn' }), h('span', { class: 'ap-play' }), h('span', { class: 'ap-btn' }), h('i', { class: 'ap-heart' }, '♥'))),
      col('ap-dev', h('div', { class: 'ap-h' }, 'DEVICES'), ...rows(4).map(r => (r.append(h('i', { class: 'ap-tog' })), r)))),
    h('div', { class: 'ap-list' }, h('div', { class: 'ap-h' }, 'PLAYLIST'), h('div', { class: 'ap-row on' }, h('i', { class: 'ap-ln' })), h('div', { class: 'ap-row' }, h('i', { class: 'ap-ln' }))));
  const cap = h('div', { class: 'small dim ap-cap' }, '');
  const el = h('div', { class: 'npprev apprev pinprev', 'aria-label': 'Live preview of the theme' },   // 0.2.3 U5: pinned while the cards scroll
    h('div', { class: 'npprev-h' }, h('span', { class: 'npprev-live' }, h('i', { 'aria-hidden': 'true' }), 'LIVE PREVIEW'), h('span', { class: 'small dim ap-name' }, ''), h('span', { class: 'grow' }), h('span', { class: 'npprev-ex' }, 'EXAMPLE DATA')),
    h('div', { class: 'ap-stage' }, app), cap);
  const name = el.querySelector('.ap-name');
  const caption = () => { const t = loadTheme(); const n = t.preset !== 'custom' && PRESETS[t.preset] ? PRESETS[t.preset].name : 'Custom colors'; name.textContent = n; cap.textContent = `Recolors as you hover or pick. Move away to go back to ${n}.`; };
  /** Show theme p in the preview only (null = back to the active theme). */
  function hover(p) {
    for (const k of [...Object.keys(derive(PRESETS.default)), '--amber', '--red', '--green']) app.style.removeProperty(k);
    if (p) { for (const [k, v] of Object.entries(derive(p))) app.style.setProperty(k, v); name.textContent = p.name + ' - preview'; } else caption();
  }
  caption();
  return { el, hover, update: caption };
}

/** The Theme sub-section of Settings > Appearance (0.2.2 T2): the 0.2.0 Themes page layout - live app preview, theme cards in the F15
 *  order, Custom colors (Background, Main, Second, Highlight, Text) and Reset. Saved on this device. */
export function themeCard() {
  const box = h('div', { class: 'themes-page', id: 'sec-theme' });
  const prev = appPreview();
  const pick = id => { const t = { ...PRESETS[id], preset: id }; applyTheme(t); saveTheme(t); fire(); draw(); };
  function draw() {
    const t = loadTheme();
    const inkVal = isHex(t.ink) ? t.ink : defaultInk(t.bg);
    const picker = (key, label, value) => h('label', { class: 'row tp-pick' }, h('input', { type: 'color', value, 'aria-label': label, 'data-color': key, oninput: ev => {
      if (!isHex(ev.target.value)) return;
      const n = { ...loadTheme(), [key]: ev.target.value.toUpperCase(), preset: 'custom' };
      if (!isHex(n.ink)) n.ink = defaultInk(n.bg);
      applyTheme(n); saveTheme(n); fire(); prev.update();
      box.querySelectorAll('.themecard.on').forEach(c => { c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); c.querySelector('.tp-check')?.remove(); });
    } }), label);
    // 0.3.1 B15: grid first (5 per row, all 10 themes in 2 rows, above the fold); the large preview and the custom colors follow below
    box.replaceChildren(
      h('p', { class: 'dim small' }, 'Tap a theme to use it on this phone or PC. Midnight Neon is the default. Custom themes use five colors: Background, Main, Second, Highlight and Text. Visualizers follow the theme unless you give a look its own colors.'),
      h('div', { class: 'themegrid pgrid pgrid-theme', role: 'group', 'aria-label': 'Theme', style: '--pg-cols:5;--pg-max:200px' }, Object.entries(PRESETS).map(([id, p]) => previewCard(id, p, t.preset === id, pick, prev.hover))),
      prev.el,
      t.preset === 'pepecoin' ? pepeNote() : null,
      h('div', { class: 'card tcustomcard' }, h('h3', null, 'Custom colors'),
        h('div', { class: 'row wrap' }, picker('bg', 'Background', t.bg), picker('accent', 'Main', t.accent), picker('accent2', 'Second', isHex(t.accent2) ? t.accent2 : derive(t)['--accent2']), picker('hl', 'Highlight', derive(t)['--hl']), picker('ink', 'Text', inkVal)),
        h('div', { class: 'row wrap', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: () => { const n = resetTheme(); applyTheme(n); fire(); draw(); toast('Back to Midnight Neon'); } }, 'Reset to default'))));
    prev.update();
  }
  draw();
  return { el: box, reload: draw };
}

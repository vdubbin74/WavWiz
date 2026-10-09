// Theme card on Settings > Appearance (0.2.1 F8: the separate Themes page is folded in). Presets as compact chips + Custom colors…
// (Background, Main, Second, Text). Saved on this device. 0.2.0 items 4-7 colors unchanged.
import { h, toast } from './util.js';
import { PRESETS, loadTheme, saveTheme, resetTheme, applyTheme, isHex, derive, defaultInk } from './theme.js';

const fire = () => window.dispatchEvent(new CustomEvent('wavwiz:theme'));
function chip(id, p, current, onPick) {
  const v = derive(p);
  return h('button', { type: 'button', class: 'themechip' + (current ? ' on' : ''), 'data-id': id, 'aria-pressed': String(current), 'aria-label': `Theme ${p.name}${current ? ' (active)' : ''}`, onclick: () => onPick(id) },
    h('span', { class: 'tsw', style: `background:${p.bg};border-color:${v['--line']}`, 'aria-hidden': 'true' }, h('i', { style: `background:${p.accent}` }), h('i', { style: `background:${v['--accent2']}` })),
    h('span', { class: 'ell' }, p.name));
}
/** 0.2.1 F20: the Pepecoin note - official onDark mark, "Pepecoin" written exactly, brand colors only. */
export function pepeNote() {
  return h('div', { class: 'pepe-note' },
    h('img', { src: '/assets/pepecoin/P_onDark.svg', alt: 'Pepecoin logo', width: 76, height: 76, class: 'pepe-logo' }),
    h('div', { class: 'grow' },
      h('img', { src: '/assets/pepecoin/Pepecoin_onDark.svg', alt: 'Pepecoin', class: 'pepe-wordmark', height: 22 }),
      h('p', { class: 'dim small', style: 'margin:4px 0 0' }, 'Colors from the Pepecoin brand guidelines (primary #269B4D, second #208241 on #212121). WavWiz is not affiliated with Pepecoin.')));
}
export function themeCard() {
  const box = h('div', { class: 'card', id: 'sec-theme' });
  let custom = false;
  const pick = id => { const t = { ...PRESETS[id], preset: id }; applyTheme(t); saveTheme(t); fire(); draw(); };
  function draw() {
    const t = loadTheme();
    const inkVal = isHex(t.ink) ? t.ink : defaultInk(t.bg);
    const picker = (key, label, value) => h('label', { class: 'row tp-pick' }, h('input', { type: 'color', value, 'aria-label': label, 'data-color': key, oninput: ev => {
      if (!isHex(ev.target.value)) return;
      const n = { ...loadTheme(), [key]: ev.target.value.toUpperCase(), preset: 'custom' };
      if (!isHex(n.ink)) n.ink = defaultInk(n.bg);
      applyTheme(n); saveTheme(n); fire();
      box.querySelectorAll('.themechip.on').forEach(c => { c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); });
    } }), label);
    const pickers = h('div', { class: 'tcustom', hidden: !custom || undefined },
      h('div', { class: 'row wrap' }, picker('bg', 'Background', t.bg), picker('accent', 'Main', t.accent), picker('accent2', 'Second', isHex(t.accent2) ? t.accent2 : derive(t)['--accent2']), picker('ink', 'Text', inkVal)),
      h('div', { class: 'row wrap', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: () => { const n = resetTheme(); applyTheme(n); fire(); draw(); toast('Back to Midnight Neon'); } }, 'Reset to default')));
    box.replaceChildren(h('h3', null, 'Theme'),
      h('p', { class: 'dim small' }, 'Colors for this phone or PC. Midnight Neon is the default.'),
      h('div', { class: 'themechips', role: 'group', 'aria-label': 'Theme' }, Object.entries(PRESETS).map(([id, p]) => chip(id, p, t.preset === id, pick))),
      h('div', { class: 'row wrap', style: 'margin-top:10px;gap:10px' },
        h('button', { class: 'btn', 'aria-expanded': String(custom), onclick: () => { custom = !custom; draw(); } }, 'Custom colors…'),
        h('span', { class: 'dim small' }, 'Background, Main, Second and Text')),
      pickers,
      t.preset === 'pepecoin' ? pepeNote() : null);
  }
  draw();
  return { el: box, reload: draw };
}

// Themes page: five presets + custom Background / Accent / Text. Saved on this device.
import { h, toast } from './util.js';
import { PRESETS, loadTheme, saveTheme, resetTheme, applyTheme, isHex, derive, defaultInk } from './theme.js';

function previewCard(id, p, current, onPick) {
  const v = derive(p);
  const mini = h('div', { class: 'tp-mini', style: `background:${p.bg};border-color:${v['--line']}` },
    h('div', { class: 'tp-bar', style: `background:${v['--panel']};border-bottom:1px solid ${v['--line']}` }, h('b', { style: `color:${p.accent}` }, 'Wav'), h('b', { style: `color:${v['--accent2']}` }, 'Wiz')),
    h('div', { class: 'tp-body' },
      h('div', { class: 'tp-art', style: `background:linear-gradient(135deg,${p.accent},${v['--accent2']})` }),
      h('div', { class: 'tp-lines' }, h('i', { style: `background:${v['--ink']}` }), h('i', { style: `background:${v['--accent2']};width:55%` }),
        h('div', { class: 'tp-prog', style: `background:${v['--line']}` }, h('span', { style: `background:${p.accent};width:62%` })))),
    h('div', { class: 'tp-ctl' }, h('span', { class: 'tp-dot', style: `background:${v['--panel2']}` }), h('span', { class: 'tp-play', style: `background:${p.accent};box-shadow:0 0 12px ${p.accent}` }), h('span', { class: 'tp-dot', style: `background:${v['--panel2']}` })));
  return h('button', { type: 'button', class: 'themecard' + (current ? ' on' : ''), 'data-id': id, 'aria-pressed': String(current), 'aria-label': `Theme ${p.name}${current ? ' (active)' : ''}`, onclick: () => onPick(id) },
    mini, h('div', { class: 'tp-name' }, h('span', { class: 'ell' }, p.name), current ? h('span', { class: 'tp-check', 'aria-hidden': 'true' }, '✓') : null));
}

export function themesView() {
  const root = h('div', { class: 'themes-page' });
  const pick = id => { const t = { ...PRESETS[id], preset: id }; applyTheme(t); saveTheme(t); window.dispatchEvent(new CustomEvent('wavwiz:theme')); draw(); };
  function draw() {
    const t = loadTheme();
    const inkVal = isHex(t.ink) ? t.ink : defaultInk(t.bg);
    const picker = (key, label, value) => h('label', { class: 'row tp-pick' }, h('input', { type: 'color', value, 'aria-label': label, oninput: ev => {
      if (!isHex(ev.target.value)) return;
      const cur = loadTheme();
      const n = { ...cur, [key]: ev.target.value.toUpperCase(), preset: 'custom' };
      if (!isHex(n.ink)) n.ink = defaultInk(n.bg);
      applyTheme(n); saveTheme(n); window.dispatchEvent(new CustomEvent('wavwiz:theme'));
      root.querySelectorAll('.themecard.on').forEach(c => c.classList.remove('on'));
    } }), label);
    root.replaceChildren(
      h('p', { class: 'dim small' }, 'Tap a theme to use it on this phone or PC. Midnight Neon is the default. Custom themes use Background, Accent and Text — everything else is derived. Visualizers follow the theme unless you give a look its own colors (View > Visualizer).'),
      h('div', { class: 'themegrid' }, Object.entries(PRESETS).map(([id, p]) => previewCard(id, p, t.preset === id, pick))),
      t.preset === 'pepecoin' ? h('div', { class: 'card', style: 'margin-top:12px' },
        h('div', { class: 'row', style: 'gap:12px;align-items:center' },
          h('img', { src: '/assets/pepecoin/P_onDark.svg', alt: '', width: 40, height: 40, style: 'flex:none' }),
          h('div', { class: 'grow' },
            h('b', null, 'Pepecoin'),
            h('p', { class: 'dim small', style: 'margin:4px 0 0' }, 'Colors from the Pepecoin brand guidelines (primary #269B4D, accent #C07A4E). WavWiz is not affiliated with Pepecoin.')))) : null,
      h('div', { class: 'card' }, h('h3', null, 'Custom colors'),
        h('div', { class: 'row wrap' }, picker('bg', 'Background', t.bg), picker('accent', 'Accent', t.accent), picker('ink', 'Text', inkVal)),
        h('div', { class: 'row wrap', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: () => { const n = resetTheme(); applyTheme(n); window.dispatchEvent(new CustomEvent('wavwiz:theme')); draw(); toast('Back to Midnight Neon'); } }, 'Reset to default'))));
  }
  return { el: root, reload: draw };
}

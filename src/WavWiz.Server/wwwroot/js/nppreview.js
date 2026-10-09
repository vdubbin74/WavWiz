// 0.2.1 F9: live preview of the Now Playing control panel inside Settings > Appearance (desktop and phone).
// It clones the real panel (same markup, same CSS = same rendering code), drops in example track info, applies the picked style and
// effects plus the current theme colors, and scales it down to fit the card. Updates instantly on each pick. Never interactive.
import { h } from './util.js';
import { NP_STYLES, loadNpPrefs, npVars, waveBars } from './npstyle.js';
import { npPanelTemplate } from './now.js';
import { loadTheme, PRESETS } from './theme.js';

export const PREVIEW_SAMPLE = Object.freeze({ title: 'Glass Harbor', artist: 'Lumen', elapsed: '0:14', remain: '-3:06', total: '3:20', frac: 0.07, track: 'TRACK 03' });
const W = 760;      // the panel is laid out at a typical desktop width, then scaled to the card

export function fillSample(panel, p = loadNpPrefs()) {
  const S0 = PREVIEW_SAMPLE, q = sel => panel.querySelectorAll(sel), set = (sel, t) => q(sel).forEach(e => { e.textContent = t; });
  panel.removeAttribute('id'); q('[id]').forEach(e => e.removeAttribute('id'));
  panel.classList.remove('collapsed'); panel.classList.add('playing', 'npprev-panel');
  for (const [id] of NP_STYLES) panel.classList.toggle('pn-' + id, p.style === id);
  for (const [k, v] of Object.entries(npVars(p))) panel.style.setProperty(k, v);
  panel.dataset.style = p.style;
  set('.np-tabletitles .t1', S0.title); set('.np-tabletitles .t2', S0.artist); set('.np-ctlnow', '');
  set('.np-elv,.pn-pel,.pn-cval', S0.elapsed); set('.np-rev,.pn-lrev', S0.remain); set('.pn-pdur', S0.total); set('.pn-trk', S0.track);
  set('.volpct', '60%'); q('input[type=range]').forEach(r => { r.value = 60; r.disabled = false; });
  q('.prog .fill,.pn-ledfill').forEach(e => { e.style.width = S0.frac * 100 + '%'; }); q('.prog .knob').forEach(e => { e.style.left = S0.frac * 100 + '%'; });
  q('.pn-ring .val').forEach(e => { e.style.strokeDashoffset = String(100 - S0.frac * 100); });
  q('.pn-wclip').forEach(e => { e.style.clipPath = `inset(0 ${100 - S0.frac * 100}% 0 0)`; });
  const bars = waveBars(S0.title); q('.pn-wbars').forEach(b => b.replaceChildren(...bars.map(v => h('i', { style: `height:${Math.round(v * 100)}%` }))));
  q('.pn-cover,.pn-refl').forEach(c => c.replaceChildren(h('div', { class: 'cover md npprev-art', 'aria-hidden': 'true' }, h('span', null, '♪'))));
  q('.np-heartslot').forEach(s => s.replaceChildren(h('button', { class: 'heart', tabindex: -1, 'aria-hidden': 'true' }, '♡')));
  q('.np-volpop').forEach(e => { e.hidden = true; });
  q('.mutedtag,.np-mutedtag').forEach(e => { e.hidden = true; });
  const play = panel.querySelector('.np-tablexport .play'); play?.classList.add('playing');
  return panel;
}

export function npPreview() {
  const stage = h('div', { class: 'npprev-stage' }), label = h('span', { class: 'small dim' });
  const el = h('div', { class: 'npprev', 'data-preview': 'np', 'aria-label': 'Live preview of the Now Playing panel' },
    h('div', { class: 'npprev-h' }, h('span', { class: 'npprev-live' }, h('i', { 'aria-hidden': 'true' }), 'LIVE PREVIEW'), label, h('span', { class: 'grow' }), h('span', { class: 'npprev-ex' }, 'EXAMPLE DATA')),
    stage, h('div', { class: 'small dim npprev-foot' }, 'Updates as you pick.'));
  let panel = null;
  // scale by the panel's real laid-out width (a style may need more than W), so nothing is ever clipped on the right
  const fit = () => { if (!panel) return; const w = Math.max(W, panel.scrollWidth), s = Math.min(1, (stage.clientWidth || w) / w); panel.style.width = w + 'px'; panel.style.transform = `scale(${s})`; stage.style.height = Math.ceil(panel.offsetHeight * s) + 'px'; };
  function update() {
    const p = loadNpPrefs(), t = loadTheme();
    label.textContent = `${NP_STYLES.find(x => x[0] === p.style)?.[1] ?? p.style} · ${PRESETS[t.preset]?.name ?? 'Custom'}`;
    const tpl = npPanelTemplate();
    if (!tpl) { stage.replaceChildren(h('p', { class: 'small dim' }, 'The preview appears once the player has loaded.')); panel = null; return; }
    panel = fillSample(tpl.cloneNode(true), p);
    panel.setAttribute('inert', ''); panel.setAttribute('aria-hidden', 'true'); panel.style.width = W + 'px';
    stage.replaceChildren(panel);
    requestAnimationFrame(fit);
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(stage);
  let seen = false;
  const onTheme = () => { if (el.isConnected) { seen = true; update(); } else if (seen) { window.removeEventListener('wavwiz:theme', onTheme); window.removeEventListener('wavwiz:npstyle', onTheme); } };
  window.addEventListener('wavwiz:theme', onTheme); window.addEventListener('wavwiz:npstyle', onTheme);
  update();
  return { el, update };
}

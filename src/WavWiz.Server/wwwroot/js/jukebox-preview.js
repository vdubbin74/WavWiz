// WavWiz 0.3.4 H4b: Settings > Jukebox style preview cards. Each card shows the real big-screen layout for that style (the same markup and CSS
// as the kiosk, example data), drawn at its true 980 x 551 size and scaled down to the card, so what you pick is what the TV shows.
import { h } from './util.js';
import { RETRO_SVG } from './jukebox-retro.js';

export const JB_EXAMPLE = {
  now: { title: 'Velvet Circuit', artist: 'Cassette Hearts', by: 'Sam', pos: '1:46', dur: '4:12', sel: 107 },
  next: [['Night Swim', 'Faded Atlas', 'Mia'], ['Paper Satellites', 'Amber Kites', 'Jordan'], ['Golden Hour Drive', 'Coastal Ghosts', 'Sam'], ['Signal Fires', 'Cinder Club', 'Alex'], ['Echo Garden', 'Daybreak Union', 'Priya']],
  more: [['Room Tone', 'Glow Society'], ['Polar Lights', 'Fox Harbor'], ['Overpass', 'Field Theory'], ['Kaleidoscope', 'Future Tense'], ['Westward', 'Golden Static']],
};
const ART = ['linear-gradient(135deg,#1fb5a8,#245b8f)', 'linear-gradient(135deg,#2e7d32,#9ccc65)', 'linear-gradient(135deg,#f06292,#7e57c2)', 'linear-gradient(135deg,#bdbdbd,#616161)', 'linear-gradient(135deg,#e53935,#3e2723)', 'linear-gradient(135deg,#7e57c2,#ec407a)'];
const fakeQr = () => h('i', { class: 'jbpv-qr', 'aria-hidden': 'true' });

function modernStage() {
  const d = JB_EXAMPLE;
  return h('div', { class: 'jbpm' },
    h('div', { class: 'jbpm-logo' }, h('b', null, h('span', { class: 'wm-wav' }, 'Wav'), h('span', { class: 'wm-wiz' }, 'Wiz')), h('small', null, 'Hold for host')),
    h('div', { class: 'jbpm-chips' }, h('span', null, '3 songs per guest'), h('span', null, 'Vote to skip: on')),
    h('div', { class: 'jbpm-left' }, h('i', { class: 'jbpm-cover', style: `background:${ART[0]}` }), h('span', { class: 'jbpm-kick' }, 'NOW PLAYING'), h('b', { class: 'jbpm-title' }, d.now.title), h('span', { class: 'jbpm-artist' }, d.now.artist),
      h('div', { class: 'jbpm-prog' }, h('i'), h('b')), h('div', { class: 'jbpm-times' }, h('span', null, d.now.pos), h('span', null, d.now.dur)), h('span', { class: 'jbpm-by' }, 'Requested by ' + d.now.by),
      h('span', { class: 'jbpm-big' }, h('span', { class: 'jb-sico', 'aria-hidden': 'true' }), 'Search & add')),
    h('div', { class: 'jbpm-next' }, h('div', { class: 'jbpm-nh' }, h('span', null, 'UP NEXT'), h('span', null, '5 songs · 19 min')),
      ...d.next.map(([t, a, by], i) => h('div', { class: 'jbpm-row' }, h('span', { class: 'n' }, String(i + 1)), h('i', { style: `background:${ART[i + 1]}` }), h('div', null, h('b', null, t), h('small', null, a, h('span', null, ' · ' + by)))))),
    h('div', { class: 'jbpm-join' }, h('div', null, h('b', null, 'Scan to add a song'), h('code', null, 'wavwiz.local/jukebox'), h('small', null, 'No app, no login')), fakeQr()));
}
function retroStage() {
  const d = JB_EXAMPLE, st = h('div', { class: 'jbr jbr-preview' });
  st.innerHTML = RETRO_SVG + `<div class="jbr-disc"><i class="jbr-sheen"></i><i class="jbr-hub"></i><i class="jbr-spindle"></i></div>
    <span class="jbr-badge l">3 picks per guest</span><span class="jbr-badge r">Vote to skip: on</span>
    <div class="jbr-plac"><span class="jbr-kick">NOW&nbsp;&nbsp;PLAYING</span><span class="jbr-vfd">SEL ${d.now.sel} ${d.now.pos}/${d.now.dur}</span><div class="jbr-line"><b class="jbr-title">${d.now.title}</b><span class="jbr-artist">${d.now.artist}</span></div><span class="jbr-by">Requested by ${d.now.by}</span></div>
    <div class="jbr-rack"><span class="jbr-h a">UP NEXT</span><span class="jbr-h b">MORE TO PICK</span><div class="jbr-col a"></div><div class="jbr-col b"></div></div>
    <div class="jbr-qr"><span>Scan to pick<br>a song</span><i class="jbpv-qr"></i><small>wavwiz.local/jukebox</small></div>
    <span class="jbr-select" aria-hidden="true"><span>SELECT</span></span><span class="jbr-sel-l">Search &amp; add</span>`;
  const strip = (cls, c, kids) => h('div', { class: 'jbr-strip ' + cls }, h('span', { class: 'jbr-code' }, c), h('span', { class: 'jbr-st' }, kids));
  st.querySelector('.jbr-col.a').append(...d.next.map(([t, , by], i) => strip('', 'A' + (i + 1), [h('span', { class: 'jbr-tt' }, t), h('span', { class: 'jbr-who' }, ' · ' + by)])));
  st.querySelector('.jbr-col.b').append(...d.more.map(([t, a], i) => strip('dim', 'B' + (i + 1), `${t} · ${a}`)));
  st.querySelector('.jbr-disc').style.background = ART[0];
  return st;
}
/** A preview frame (16:9) holding the style's stage, scaled to the frame width. */
export function jbPreview(style) {
  const stage = style === 'retro' ? retroStage() : modernStage();
  const frame = h('div', { class: 'jbpv ' + (style === 'retro' ? 'retro' : 'modern'), 'aria-hidden': 'true' }, stage);
  const fit = () => { const w = frame.clientWidth; if (w) frame.style.setProperty('--k', String(w / 980)); };
  try { new ResizeObserver(fit).observe(frame); } catch { /* old */ }
  requestAnimationFrame(fit);
  return frame;
}

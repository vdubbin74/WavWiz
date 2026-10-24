// WavWiz 0.4.8 F62: one shared marquee for every now-playing title / artist / album line. A line scrolls back and forth (2 s hold at each
// end, a steady ~30 px/s) ONLY when its text overflows the box; text that fits stays still. Measures only on a box resize (Display size / zoom
// included) and on a text change (track change); the motion itself is a compositor transform animation. Reduced motion: plain ellipsis.
export const MQ_SELECTORS = [
  '.np-meta .titles > .t1', '.np-meta .titles > .t2',          // main Now Playing (Classic / Center / every look)
  '.np-tabletitles > .t1', '.np-tabletitles > .t2',            // Now Playing panel + full-screen overlay
  '.ns-t1', '.ns-t2',                                          // collapsed Now Playing strip
  '.npb-titles .t1', '.npb-titles .t2',                        // player bars (queue-area bar, Roomy / wide bottom bar)
  '.mp-t', '.mp-a',                                            // condensed player, in-app mini, standalone mini player
  '.zl-now .zl-t',                                             // device cards, zone / speaker settings, Devices strip
];
export const MQ_SPEED = 30, MQ_HOLD = 2000;
const SEL = MQ_SELECTORS.join(','), reduce = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
/** Pure: the keyframes + duration for a distance in px. */
export function mqPlan(dist, speed = MQ_SPEED, hold = MQ_HOLD) {
  const move = (dist / speed) * 1000, total = 2 * hold + 2 * move, a = hold / total, b = (hold + move) / total, c = (2 * hold + move) / total;
  return { duration: Math.round(total), keyframes: [{ transform: 'translateX(0)', offset: 0 }, { transform: 'translateX(0)', offset: a }, { transform: `translateX(${-dist}px)`, offset: b }, { transform: `translateX(${-dist}px)`, offset: c }, { transform: 'translateX(0)', offset: 1 }] };
}
const known = new WeakSet(); let ro = null, mo = null;
function wrap(el) {   // the app sets textContent (that drops our wrapper): put the content back inside one inner span
  if (!el.textContent.trim()) { if (el.firstElementChild?.classList.contains('mq-in')) el.replaceChildren(); return null; }   // F62b: an empty line stays :empty (CSS hides it and its separator)
  const inn = el.firstElementChild;
  if (inn && inn.classList.contains('mq-in') && el.childNodes.length === 1) return inn;
  const s = document.createElement('span'); s.className = 'mq-in'; s.append(...el.childNodes); el.append(s); return s;
}
// CSS zoom (Display size): rects are zoomed, clientWidth and the transform are not
const dist0 = (el, inn) => { const z = el.getBoundingClientRect().width / (el.clientWidth || 1) || 1; return Math.ceil(inn.getBoundingClientRect().width / z - el.clientWidth); };
function measure(el) {
  const inn = wrap(el); el._mqAnim?.cancel(); el._mqAnim = null; el.classList.remove('mq-on');
  if (!inn || reduce() || !el.isConnected || !el.clientWidth) { el._mqKey = ''; return; }
  if (dist0(el, inn) <= 1) { el._mqKey = ''; return; }
  const dist = dist0(el, inn);
  el.classList.add('mq-on'); const p = mqPlan(dist + 2), key = el.textContent + '|' + dist, t = performance.now();
  // the app repaints the same title every second (that rebuilds our inner span): same text + same distance keeps its place in the cycle
  if (key !== el._mqKey) { el._mqKey = key; el._mqT0 = t; }
  try { el._mqAnim = inn.animate(p.keyframes, { duration: p.duration, iterations: Infinity, easing: 'linear' }); el._mqAnim.currentTime = (t - el._mqT0) % p.duration; el._mqDist = dist; } catch { /* old browser: ellipsis */ el.classList.remove('mq-on'); }
}
const pending = new Set(); let raf = 0;
const later = el => { pending.add(el); if (!raf) raf = requestAnimationFrame(() => { raf = 0; const l = [...pending]; pending.clear(); l.forEach(measure); }); };
function attach(el) {
  if (known.has(el)) return; known.add(el); el.classList.add('mq'); ro.observe(el);
  new MutationObserver(() => { const k = el.textContent; if (k === el._mqText && el.firstElementChild?.classList.contains('mq-in')) return; el._mqText = k; later(el); }).observe(el, { childList: true, characterData: true, subtree: true });
  el._mqText = el.textContent; later(el);
}
function scan(root = document) { if (root.matches?.(SEL)) attach(root); root.querySelectorAll?.(SEL).forEach(attach); }
/** Start once per page (main app, phone, standalone mini). */
export function startMarquee() {
  if (ro || typeof document === 'undefined' || typeof ResizeObserver === 'undefined') return;
  ro = new ResizeObserver(es => es.forEach(e => later(e.target)));
  let sc = 0; mo = new MutationObserver(ms => { if (sc) return; sc = requestAnimationFrame(() => { sc = 0; for (const m of ms) m.addedNodes.forEach(n => n.nodeType === 1 && scan(n)); scan(); }); });
  mo.observe(document.body, { childList: true, subtree: true });
  const all = () => document.querySelectorAll('.mq').forEach(later);
  window.addEventListener('wavwiz:uiscale', all); globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', all);
  scan();
}
if (typeof document !== 'undefined') { if (document.body) startMarquee(); else document.addEventListener('DOMContentLoaded', startMarquee, { once: true }); }

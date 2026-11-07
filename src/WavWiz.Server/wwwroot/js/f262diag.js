// F262 CAPTURE TOOLING, NOT A FIX. Imported only by explicit ?diag=1.
// No module-load listeners, storage, traffic or DOM mutations. No app/track/input values collected.
const LIMIT = 256 * 1024, RECORD_LIMIT = 8 * 1024, encoder = new TextEncoder();
const bytes = s => encoder.encode(s).length;
const instances = new WeakMap();
const selectors = Object.freeze({
  delayRange: 'input.spk-range[aria-label="Delay / sync offset"]', delayInput: 'input.spk-num',
  balanceRange: 'input.spk-range[aria-label="Balance"]', outerDone: '[data-act="pd-done"]', innerDone: '[data-act="spk-done"]'
});
const reasons = ['baseline', 'detach', 'before', 'focus', 'blur', 'input', 'change', 'composition', 'end', 'cancel', 'capturelost', 'viewport', 'scroll', 'resize', 'orientation', 'visibility', 'pagehide', 'pageshow', 'settled', 'freeze', 'manual'];
const reasonOf = v => reasons.includes(v) ? v : 'manual';
const number = v => typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(-1e7, Math.min(1e7, v)) * 10) / 10 : null;
const choice = (v, list) => list.includes(v) ? v : 'other';
const rect = e => { const r = e.getBoundingClientRect(); return Object.fromEntries(['x','y','top','right','bottom','left','width','height'].map(k => [k, number(r[k])])); };
const transform = v => /^(?:none|matrix(?:3d)?\([0-9eE+.,\s-]{1,240}\))$/.test(v) ? v : 'other';
const envelope = (dropped, records) => '{"schema":1,"purpose":"F262 capture tooling, not a fix","dropped":' + dropped + ',"records":[' + records.join(',') + ']}';

// Exported for bounded-buffer tests; production pushes only the allowlisted sampler below.
export function createRing() {
  const records = [], sizes = []; let total = 0, dropped = 0;
  const text = () => envelope(dropped, records);
  return {
    push(record) {
      const s = JSON.stringify(record), size = bytes(s);
      if (size > RECORD_LIMIT) { dropped++; return; }
      records.push(s); sizes.push(size); total += size;
      while (records.length > 64 || total + Math.max(0, records.length - 1) + bytes(envelope(dropped, [])) > LIMIT) {
        total -= sizes.shift(); records.shift(); dropped++;
      }
    },
    text, clear() { records.length = sizes.length = 0; total = dropped = 0; }
  };
}

export function installCapture(doc = document, win = window) {
  // Defense in depth: even a manually imported module is inert without the exact flag.
  if (new URLSearchParams(win.location.search).get('diag') !== '1') return null;
  if (instances.has(doc)) return instances.get(doc);
  const ring = createRing(), sampling = new win.AbortController(), gestures = new win.AbortController();
  const start = win.performance.now();
  let sheet = null, seen = false, frozen = false, frozenText = '', seq = 0, composing = false;
  let frame = 0, timer = 0, last = -100, mask = 0, exportUI = null, gesture = null;
  const now = () => win.performance.now();
  const targets = () => Object.fromEntries(Object.entries(selectors).map(([key, sel]) => [key, sheet?.querySelector(sel) || null]));
  const findSheet = () => doc.querySelector('.pd42-sheet .spkset')?.closest('.pd42-sheet') || null;
  const style = e => win.getComputedStyle(e);
  const classify = (e, ts) => {
    if (!e) return 'none';
    for (const [key, el] of Object.entries(ts)) if (el && (el === e || el.contains(e))) return key;
    if (sheet?.querySelector('.pd42-head')?.contains(e)) return 'sheetHeader';
    if (sheet?.querySelector(':scope > .pd42')?.contains(e)) return 'sheetScroller';
    if (sheet?.contains(e)) return 'sheet';
    return doc.getElementById('app')?.contains(e) ? 'background' : 'other';
  };
  function snapshot(reason = 'manual', absent = false, events = 0) {
    if (frozen) return;
    if (!sheet && !absent) return;
    const ts = targets(), vv = win.visualViewport, ancestors = [], paths = {}, known = new Map();
    const chain = (key, e) => {
      paths[key] = []; let count = 0;
      for (; e && count++ < 10; e = e.parentElement) {
        if (!known.has(e)) {
          const c = style(e); known.set(e, ancestors.length);
          ancestors.push({ tag: choice(e.tagName, ['HTML','BODY','DIV','SECTION','MAIN','INPUT','BUTTON','SPAN']),
            scrollTop: number(e.scrollTop), scrollLeft: number(e.scrollLeft), position: choice(c.position, ['static','relative','absolute','fixed','sticky']),
            transform: transform(c.transform), zoom: number(parseFloat(c.zoom)),
            overflowX: choice(c.overflowX, ['visible','hidden','clip','auto','scroll']), overflowY: choice(c.overflowY, ['visible','hidden','clip','auto','scroll']) });
        }
        paths[key].push(known.get(e));
      }
    };
    chain('sheet', sheet);
    const items = Object.fromEntries(Object.entries(ts).map(([key, e]) => {
      if (!e) return [key, { present: false }];
      chain(key, e.parentElement); const r = rect(e), c = style(e), x = r.x + r.width / 2, y = r.y + r.height / 2;
      return [key, { present: true, connected: e.isConnected, rect: r,
        probes: [0, -40].map(dy => {
          const hit = classify(doc.elementFromPoint(x, y + dy), ts);
          return { x: number(x), y: number(y + dy), hit, expected: hit === key };
        }), font: number(parseFloat(c.fontSize)), position: choice(c.position, ['static','relative','absolute','fixed','sticky']),
        transform: transform(c.transform), pointerEvents: choice(c.pointerEvents, ['auto','none']),
        touchAction: choice(c.touchAction, ['auto','none','manipulation','pan-x','pan-y','pan-x pan-y','pan-x pan-y pinch-zoom','pinch-zoom']) }];
    }));
    const de = style(doc.documentElement), sc = sheet?.querySelector(':scope > .pd42');
    const record = { seq: ++seq, ms: number(now() - start), reason: reasonOf(reason), events, present: !!sheet,
      root: { zoom: number(parseFloat(de.zoom)), z: number(parseFloat(de.getPropertyValue('--z'))), dpr: number(win.devicePixelRatio),
        innerWidth: number(win.innerWidth), innerHeight: number(win.innerHeight), scrollX: number(win.scrollX), scrollY: number(win.scrollY) },
      viewport: vv ? Object.fromEntries(['width','height','offsetTop','offsetLeft','pageTop','pageLeft','scale'].map(k => [k, number(vv[k])])) : null,
      sheetRect: sheet ? rect(sheet) : null,
      scroller: sc ? { scrollTop: number(sc.scrollTop), scrollLeft: number(sc.scrollLeft), clientHeight: number(sc.clientHeight), scrollHeight: number(sc.scrollHeight) } : null,
      active: classify(doc.activeElement, ts), visibility: choice(doc.visibilityState, ['visible','hidden']), composing,
      items, ancestors, paths, truncated: false };
    // Keep the five target measurements; trim optional ancestor tails if a pathological chain is large.
    while (bytes(JSON.stringify(record)) > RECORD_LIMIT && ancestors.length) {
      ancestors.pop(); for (const key of Object.keys(paths)) paths[key] = paths[key].filter(i => i < ancestors.length);
      record.truncated = true;
    }
    ring.push(record); last = now();
  }
  function cancelQueued() {
    if (frame) win.cancelAnimationFrame(frame); if (timer) win.clearTimeout(timer);
    frame = timer = mask = 0;
  }
  function queue(reason, critical = false) {
    if (frozen || !sheet) return;
    mask |= 1 << reasons.indexOf(reasonOf(reason));
    if (critical && timer) { win.clearTimeout(timer); timer = 0; }
    if (frame || timer) return;
    const schedule = () => { frame = win.requestAnimationFrame(() => { frame = 0; const bits = mask; mask = 0; snapshot('settled', false, bits); }); };
    const wait = critical ? 0 : 100 - (now() - last);
    if (wait > 0) timer = win.setTimeout(() => { timer = 0; schedule(); }, wait); else schedule();
  }
  function updateSheet() {
    if (frozen) return;
    const next = findSheet(); if (next === sheet) return;
    const was = sheet; sheet = next; composing = false;
    if (sheet) { seen = true; snapshot('baseline'); } else if (was) snapshot('detach', true);
  }
  const on = (target, type, handler, controller = sampling) => target?.addEventListener(type, handler, { capture: true, passive: true, signal: controller.signal });
  const observer = new win.MutationObserver(updateSheet);
  observer.observe(doc.body, { childList: true, subtree: true });
  for (const type of ['pointerdown','touchstart','focusin','focusout','input','change','compositionstart','compositionend']) on(doc, type, e => {
    if (!sheet) return;
    const ts = targets(), key = classify(e.target, ts); if (!Object.hasOwn(selectors, key)) return;
    if (type.startsWith('composition')) { if (key !== 'delayInput') return; composing = type === 'compositionstart'; snapshot('composition'); }
    else if (type === 'focusin' || type === 'focusout') { snapshot(type === 'focusin' ? 'focus' : 'blur'); queue('focus', true); }
    else if (type === 'pointerdown' || type === 'touchstart') snapshot('before');
    else queue(type);
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture','touchend','touchcancel']) on(doc, type, () => snapshot(type.includes('cancel') ? 'cancel' : type === 'lostpointercapture' ? 'capturelost' : 'end'));
  on(doc, 'scroll', () => queue('scroll')); on(doc, 'visibilitychange', () => snapshot('visibility'));
  for (const type of ['resize','orientationchange','pagehide','pageshow']) on(win, type, () => {
    const reason = type === 'orientationchange' ? 'orientation' : type;
    if (type === 'resize' || type === 'orientationchange') queue(reason); else snapshot(reason);
  });
  for (const type of ['resize','scroll']) on(win.visualViewport, type, () => queue('viewport'));

  function showExport() {
    if (exportUI) return exportUI;
    const box = doc.createElement('section'), status = doc.createElement('p'), area = doc.createElement('textarea');
    box.dataset.f262Export = '1'; box.setAttribute('aria-label', 'F262 local diagnostic export');
    box.style.cssText = 'position:fixed;inset:8px;z-index:2147483647;background:#fff;color:#111;padding:12px;overflow:auto;font:16px sans-serif';
    status.textContent = 'CAPTURE TOOLING — NOT A FIX. Frozen locally. Copy/paste only if you choose.';
    area.readOnly = true; area.setAttribute('aria-label', 'Frozen F262 diagnostic text'); area.value = frozenText;
    area.style.cssText = 'display:block;width:100%;height:65vh;box-sizing:border-box;font:16px monospace';
    box.append(status, area); doc.body.append(box); exportUI = { box, status, area }; return exportUI;
  }
  function copyExport() {
    // No await before writeText: called directly from the explicit two-finger gesture.
    let result = null;
    try { if (typeof win.navigator.clipboard?.writeText === 'function') result = win.navigator.clipboard.writeText(frozenText); } catch { /* fixed status below */ }
    const ui = showExport();
    try { ui.area.focus({ preventScroll: true }); ui.area.select(); ui.area.setSelectionRange(0, frozenText.length); } catch { /* native fallback still visible */ }
    ui.status.textContent = 'Frozen locally. Use native iOS Copy on the selected text if clipboard copying is unavailable.';
    if (result) Promise.resolve(result).then(() => { ui.status.textContent = 'Copied locally. Paste into Notes or chat if you choose. CAPTURE TOOLING, NOT A FIX.'; }, () => { ui.status.textContent = 'Clipboard copy rejected. Use native iOS Copy on the selected text; two-finger tap reselects/retries.'; });
  }
  function freeze() {
    if (!seen) return;
    if (!frozen) {
      snapshot('freeze', !sheet); frozen = true; frozenText = ring.text();
      cancelQueued(); sampling.abort(); observer.disconnect();
    }
    copyExport();
  }
  // Passive document capture ignores target identity: a displaced web control is not the rescue button.
  on(doc, 'touchstart', e => {
    const touches = [...e.touches], at = now();
    if (!gesture && touches.length) gesture = { at, points: new Map(), armed: false, invalid: false };
    if (!gesture) return;
    if (touches.length > 2 || at - gesture.at > 120) gesture.invalid = true;
    for (const t of touches) if (!gesture.points.has(t.identifier)) gesture.points.set(t.identifier, [t.clientX, t.clientY]);
    if (touches.length === 2 && !gesture.invalid) gesture.armed = true;
  }, gestures);
  on(doc, 'touchmove', e => {
    if (!gesture) return;
    for (const t of e.touches) { const p = gesture.points.get(t.identifier); if (!p || Math.hypot(t.clientX - p[0], t.clientY - p[1]) > 20) gesture.invalid = true; }
  }, gestures);
  on(doc, 'touchcancel', () => { gesture = null; }, gestures);
  on(doc, 'touchend', e => {
    if (!gesture || e.touches.length) return;
    const capture = gesture.armed && !gesture.invalid && now() - gesture.at <= 350;
    gesture = null; if (capture) freeze();
  }, gestures);
  const handle = {
    snapshot, freeze, text: () => frozen ? frozenText : ring.text(),
    destroy() { frozen = true; cancelQueued(); sampling.abort(); gestures.abort(); observer.disconnect(); exportUI?.box.remove(); exportUI = null; ring.clear(); frozenText = ''; gesture = null; instances.delete(doc); }
  };
  instances.set(doc, handle); updateSheet(); return handle;
}

// WavWiz 0.2.5: a calibration link (?cal=CODE) that lands on the main app is sent straight to the mic-only page, BEFORE any module of the
// main app runs - so the phone never joins as a speaker, never starts audio and never switches the iOS audio session to playback.
// Classic (non-module) script: it runs before /js/main.js, which is a deferred module.
(function () {
  try {
    var q = new URLSearchParams(location.search), cal = q.get('cal') || '';
    if (/^[A-Za-z0-9]{6}$/.test(cal) && location.pathname === '/') { window.__wwCalRedirect = true; location.replace('/calmic.html?cal=' + encodeURIComponent(cal)); }
  } catch (e) { /* old browser: main.js does the same check */ }
})();

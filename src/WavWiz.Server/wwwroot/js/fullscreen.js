// WavWiz 0.5.0 F120: borderless fullscreen for the whole Player window. HTML fullscreen on <html>, so WebView2's
// ContainsFullScreenElementChanged -> Forms.cs SetFull drops the title bar / borders and restores them on exit. Never remembered across launches.
let mine = false;   // true only while WE put the page in fullscreen (viz overlay / Jukebox kiosk own theirs)
export const isAppFull = () => mine && document.fullscreenElement === document.documentElement;
export function toggleAppFull() {
  try {
    if (document.fullscreenElement) { mine = false; return document.exitFullscreen?.()?.catch?.(() => {}); }
    mine = true; return document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch?.(() => { mine = false; });
  } catch { mine = false; }
}
const BUSY = 'dialog[open],.sheet,.dlg,.jb,.zmenu40,.ctxmenu,.menu-pop,.mb-pop';
/** Esc leaves app fullscreen when nothing else (dialog, Settings, menu, zone picker, kiosk) wants it. */
export function installAppFull(doc = document) {
  doc.addEventListener('fullscreenchange', () => { if (!doc.fullscreenElement) mine = false; doc.body?.classList.toggle('appfull', isAppFull()); });
  doc.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape' || !isAppFull() || doc.body.classList.contains('jb-kiosk') || doc.querySelector(BUSY)) return;
    ev.preventDefault(); toggleAppFull();
  });
}

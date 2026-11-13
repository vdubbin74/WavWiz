// 0.6.9 #6: "Browse…" for Settings > Library > Music folders opens the native Windows folder dialog through the WavWiz Player's WebView2 host
// bridge. Only offered in the Windows app running ON the server PC (the folder must be readable by the server); browsers, phones and
// Player windows on other PCs keep typing the path (D:\Music or \\NAS\music).
let seq = 0;
export const canPickNative = (auth, w = globalThis.window) => !!(auth?.thisMachine && w?.chrome?.webview?.postMessage);

/** Resolves with the chosen path, or null when cancelled. */
export function pickFolder({ title = 'Choose a music folder', initial = '' } = {}, w = globalThis.window) {
  const wv = w?.chrome?.webview; if (!wv) return Promise.resolve(null);
  const id = 'f' + Date.now().toString(36) + (++seq);
  return new Promise(resolve => {
    const on = ev => { const m = ev?.data; if (!m || m.cmd !== 'folderPicked' || m.id !== id) return; wv.removeEventListener('message', on); resolve(typeof m.path === 'string' && m.path ? m.path : null); };
    wv.addEventListener('message', on);
    wv.postMessage({ cmd: 'pickFolder', id, title, initial });
  });
}

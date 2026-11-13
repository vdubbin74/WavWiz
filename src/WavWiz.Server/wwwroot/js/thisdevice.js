// WavWiz 0.6.9: which speaker is "this device" - moved out of ui.js unchanged so light modules (zones40.js, the mini player) can use it without
// pulling in ui.js's DOM-bound imports. ui.js re-exports both.
/** The browser speaker id of this page. */
export function webRoomId() { try { return localStorage.getItem('wavwiz.webRoom.id'); } catch { return null; } }
/** 0.2.0 item 9: "this device" = the speaker this page plays on: this browser's own web speaker, else a Player on the same PC that the
 * server marked as mine (the WavWiz Player window, or a browser on a PC that runs a Player). */
export function thisDevice(S, rid = webRoomId()) {
  const zs = S?.zones || [];
  return zs.find(z => rid && z.playerId === rid && z.connected) || zs.find(z => z.mine && z.connected) || zs.find(z => rid && z.playerId === rid) || zs.find(z => z.mine) || null;
}

// 0.7.3: audio inputs carry the name of the PC they are on ("PCBOXV2 · Speakers (what you hear)", "PCBOXV2 · Microphone") so a phone or
// another PC knows which PC it is. A browser running on that same PC (auth/state thisMachine + machineName) shows "This PC" instead.
export const THIS_PC = 'This PC';
const SEP = ' · ';

/** "PCBOXV2 · Speakers" -> "This PC · Speakers" only in a browser on PCBOXV2 itself; everything else unchanged. */
export function pcText(text, auth) {
  const pc = auth?.thisMachine ? String(auth.machineName || '') : '';
  if (!pc || typeof text !== 'string') return text;
  const pre = pc + SEP;
  return text.length > pre.length && text.slice(0, pre.length).toLowerCase() === pre.toLowerCase() ? THIS_PC + SEP + text.slice(pre.length) : text;
}
/** An input from /inputs, labels for this browser. */
export const pcInput = (i, auth) => i && ({ ...i, name: pcText(i.name, auth), source: pcText(i.source, auth), defaultName: pcText(i.defaultName, auth) });
/** A queue item: only audio inputs ("input") are renamed. */
export const pcItem = (it, auth) => it && it.kind === 'input' ? { ...it, title: pcText(it.title, auth), artist: pcText(it.artist, auth) } : it;
/** /stream now: the playing item (and the next one). */
export const pcNow = (now, auth) => now && (now.item?.kind === 'input' || now.nextTrack?.kind === 'input') ? { ...now, item: pcItem(now.item, auth), nextTrack: pcItem(now.nextTrack, auth) } : now;
export const pcQueue = (items, auth) => Array.isArray(items) ? items.map(x => pcItem(x, auth)) : items;

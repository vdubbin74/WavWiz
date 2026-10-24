/** 0.4.4 F7: the collapsed Library rail's song count - thousands separator + "5,372 songs" tooltip (pure). */
export function libCountLabel(tracks, locale) {
  if (tracks == null) return { text: '', title: 'Songs in the library' };
  const t = Number(tracks).toLocaleString(locale || 'en-US');
  return { text: t, title: `${t} song${tracks === 1 ? '' : 's'}` };
}

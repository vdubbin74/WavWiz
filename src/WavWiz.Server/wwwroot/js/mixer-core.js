// 0.4.8 F49: Master Volume mixer - pure math (no DOM). Levels are 0..100.
// Whole-Home scales every on speaker relative to where they are now; a zone slider scales its own speakers relative to each other;
// a speaker slider changes only that speaker. Scaling always starts from the snapshot taken when the drag began, so ratios survive a
// drag down to 0 and back up (nothing collapses to the same value on the way).
export const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
/** The level a group of speakers shows: its loudest member (so the slider never sits below a speaker it moves). */
export const groupLevel = vols => (vols.length ? Math.max(...vols) : 0);
/** New volumes for `base` when the group's slider moves from groupLevel(base) to `to`. caps[i] (optional) limits each speaker. */
export function scaleTo(base, to, caps = []) {
  const from = groupLevel(base), t = clamp(to);
  return base.map((v, i) => { const cap = caps[i] ?? 100; const nv = from > 0 ? v * t / from : t; return Math.round(clamp(nv, 0, cap) * 10) / 10; });
}
/** Only the entries that actually changed (by more than 0.05), as [index, value]. */
export const changed = (base, next) => next.map((v, i) => [i, v]).filter(([i, v]) => Math.abs(v - base[i]) > 0.05);
/** Speakers of a zone (group) from the device list; unassigned = in no zone. */
export const members = (zones, g) => (zones || []).filter(z => (g.deviceIds || []).includes(z.id));
export const unassigned = (zones, groups) => { const inz = new Set((groups || []).flatMap(g => g.deviceIds || [])); return (zones || []).filter(z => !inz.has(z.id)); };
/** Tags shown on a speaker row (existing names): REF, MUTED, OFFLINE, BT. */
export function tags(z) {
  const t = []; if (z.isReference || z.reference || z.ref) t.push('REF'); if (z.muted) t.push('MUTED'); if (!z.connected) t.push('OFFLINE');
  const o = (z.outputs || []).find(x => x.active) || (z.outputs || [])[0]; if (o && /bluetooth|\bbt\b/i.test(`${o.kind || ''} ${o.name || ''}`)) t.push('BT'); return t;
}

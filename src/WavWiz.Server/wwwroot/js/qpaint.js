// WavWiz 0.7.3 fix073d: phone Queue repaint rule (pure, no imports - unit-tested in tests/js/fix073d-phone.test.mjs).
/** 0.7.3 fix073d - pure: may the phone Queue skip this repaint? Only when nothing changed since the last paint (sig === painted) and rows
 *  exist. While a row menu / sheet is open, also only when nothing changed since that menu opened (menuSig): an unchanged server tick
 *  (about once a second while playing) must not tear down the sheet the ⋯ just opened, but a real change (lock, reorder, permission,
 *  zone) still rebuilds the rows and closes it. */
export function queuePaintSkip({ sig, painted, hasRows, menuUp = false, menuSig = null } = {}) {
  if (sig == null || sig !== painted || !hasRows) return false;
  return !menuUp || sig === menuSig;
}

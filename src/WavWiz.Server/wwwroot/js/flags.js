// WavWiz 0.3.0: feature flags kept in ONE place so an option can be removed with no other changes.
export const FLAGS = Object.freeze({
  /** §3.5 (optional, user decides before release): admin-only output picker in the center EQ view. Default ON. */
  'ui.eqOutputPicker': true,
});
export const flag = (k, over = globalThis.__wavwizFlags) => (over && k in over ? !!over[k] : !!FLAGS[k]);

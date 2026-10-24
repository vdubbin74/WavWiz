// WavWiz 0.4.5 F29: the built-in calibration guide - the four steps, By ear in three lines, the "How calibration works" sheet, and an
// error -> what-to-do mapper. Pure module (no DOM at import) so node tests can load it; calibrate.js draws it.
export const CAL_STEPS = [
  { n: 1, title: 'Pick a reference speaker', text: 'The steady, wired one (marked REF). The other speakers are timed against it.' },
  { n: 2, title: 'Pick a mic', text: 'Which device listens: this PC, a phone, or a USB, 3.5 mm or interface mic. Use a mic in the same room, not the server\'s mic if the server is somewhere else.' },
  { n: 3, title: 'Place the mic', text: 'About equally far from the REF speaker and the speaker being tuned, at ear height. Keep the room quiet. WavWiz pauses the music for you.' },
  { n: 4, title: 'Run', text: 'Each speaker plays chirps. You get the offset (ms) and a confidence for each one, with Apply or Retry. Low confidence? Retry with the mic closer, or use By ear.' },
];
export const EAR_LINES = [
  'The REF speaker and the speaker you are tuning take turns playing clicks.',
  'Drag the slider until the clicks land together, like one sound.',
  'Press Save.',
];
export const GUIDE_TITLE = 'How calibration works';
export const GUIDE_SECTIONS = [
  { h: 'Why calibrate', p: ['Every speaker has its own delay. Calibration measures it so all your speakers play in sync.'] },
  { h: 'The steps', steps: true },
  { h: 'By ear (no mic)', ear: true },
  { h: 'Bluetooth speakers', p: ['Bluetooth adds lag, and the lag can drift.', 'Calibrate again after a Bluetooth speaker reconnects.', 'You can also set its delay by hand with the manual delay slider (Devices > speaker > Delay).'] },
  { h: 'Phone speakers', p: ['Keep the WavWiz page open and the screen awake while it calibrates.', 'Unmute the phone and turn its volume up. Tap the page once if you hear nothing.'] },
  { h: 'If something goes wrong', p: ['Every message says what to try. Most of the time: turn the speaker up, move the mic closer, keep the room quiet, and retry. If it still fails, use By ear.'] },
];
export const stepLabel = (n, of = CAL_STEPS.length) => `Step ${n} of ${of}`;

/** Pure: turn a calibration error into a sentence that says what to do. `ctx` = { name, web, phone, bluetooth } of the speaker involved (optional). */
export function calFix(msg, ctx = {}) {
  const m = String(msg || '').trim(), name = ctx.name ? ` on ${ctx.name}` : '', who = ctx.name || 'the speaker';
  const phoneish = ctx.phone || ctx.web || /iphone|ipad|android|phone|browser/i.test(`${ctx.name || ''} ${m}`);
  const has = re => re.test(m);
  if (has(/no chirp|not heard|silent|heard nothing|no sound/i)) return phoneish
    ? `No chirp heard${name}: keep the WavWiz page open and unmuted, raise the volume, retry.`
    : `No chirp heard${name}: check that ${who} is on and its volume is up, then retry.`;
  if (has(/too quiet|weak|low confidence|not confident/i)) return `${m.replace(/[.!]?$/, '.')} Move the mic closer, turn the test volume up, keep the room quiet, and retry. Still low? Use By ear.`;
  if (has(/permission|denied|not allowed|NotAllowedError/i)) return 'The microphone is blocked: allow microphone access for WavWiz in the browser or system settings, then retry.';
  if (has(/no (microphone|mic)|mic(rophone)? (not found|missing|unplugged)/i)) return 'No microphone found: plug one in or pick another mic (this PC, a phone, or a USB mic), then retry.';
  if (has(/https|secure context/i)) return 'The phone mic needs HTTPS: set up HTTPS in Settings > Network (or use this PC\'s mic), then retry.';
  if (has(/offline|not connected|disconnected|unreachable/i)) return `${m.replace(/[.!]?$/, '.')} Turn ${who} on and wait until it shows as connected, then retry.`;
  if (has(/bluetooth/i)) return `${m.replace(/[.!]?$/, '.')} Bluetooth lag can drift: reconnect it, calibrate again, or set the delay by hand.`;
  if (has(/busy|already running|in progress/i)) return 'Another calibration is running: finish or cancel it, then retry.';
  if (has(/timed? ?out|timeout/i)) return `${m.replace(/[.!]?$/, '.')} Check that the speakers and the mic device are online, then retry.`;
  if (has(/reference/i)) return `${m.replace(/[.!]?$/, '.')} Pick a connected reference speaker (step 1), then retry.`;
  if (has(/choose at least one speaker/i)) return m;
  // anything else: keep the server's words and add the next step
  return (m ? m.replace(/[.!]?$/, '.') + ' ' : '') + 'Retry. If it keeps failing, use By ear.';
}

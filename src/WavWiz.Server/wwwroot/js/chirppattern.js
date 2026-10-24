// Calibration chirp pattern (matches WavWiz.Measure.ChirpPattern): 8 log chirps at irregular offsets.
// Used by the browser speaker (room.js) so phone/TV/browser devices play the same signal the Windows Player does.

export const SampleRate = 48000;
export const OffsetsMs = Object.freeze([0, 450, 1000, 1350, 2050, 2400, 3150, 3500]);
export const ChirpMs = 50, F0 = 700, F1 = 7000;
export const FrameSec = 0.02; // same 20 ms frames as music (FrameScheduler)

/** Build the mono 48 kHz pattern at levelDb (default -20 dBFS). */
export function makeChirpPattern(levelDb = -20) {
  const n = Math.round(ChirpMs * SampleRate / 1000);
  const chirp = new Float32Array(n);
  const T = ChirpMs / 1000, k = Math.log(F1 / F0) / T, amp = Math.pow(10, levelDb / 20);
  for (let i = 0; i < n; i++) {
    const t = i / SampleRate;
    const phase = 2 * Math.PI * F0 * (Math.exp(k * t) - 1) / k;
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    chirp[i] = amp * w * Math.sin(phase);
  }
  const offsetSamples = OffsetsMs.map(ms => Math.round(ms * SampleRate / 1000));
  const signal = new Float32Array(offsetSamples[offsetSamples.length - 1] + n);
  for (const o of offsetSamples) for (let i = 0; i < n; i++) signal[o + i] += chirp[i];
  return { chirp, signal, offsetSamples, lengthMs: OffsetsMs[OffsetsMs.length - 1] + ChirpMs, sampleRate: SampleRate, levelDb };
}

/**
 * Plan chirp playback as 20 ms frames on the same clock math as music.
 * latencyMs is forced to 0 (saved offset is being measured); acoustic + Bluetooth delay is what the mic hears.
 * Returns { frames, ack, startCtx0 } where each frame is { i, playAtUs, action, start, rate }.
 */
export function planChirpFrames(atUs, { pair, offsetUs, outputLatencySec = 0, nowCtx, signalLength, frameSec = FrameSec, sched, serverNowUs }) {
  const clockOk = pair != null && offsetUs != null && Number.isFinite(offsetUs);
  const leadMs = clockOk && serverNowUs != null ? (atUs - serverNowUs) / 1000 : 0;
  let ack = !clockOk ? 'no-clock' : leadMs < 150 ? `late=${Math.round(leadMs)}` : `ok;lead=${Math.round(leadMs)}`;
  const nSamples = signalLength | 0;
  const samplesPerFrame = Math.round(SampleRate * frameSec);
  const nFrames = Math.max(1, Math.ceil(nSamples / samplesPerFrame));
  const frames = [];
  if (!clockOk || !sched) return { frames, ack, startCtx0: null, samplesPerFrame, nFrames };
  // Import-free: caller passes ctxTimeFor + FrameScheduler instance
  return { frames, ack, startCtx0: null, samplesPerFrame, nFrames, atUs, leadMs };
}

/** Slice a mono signal into 20 ms stereo AudioBuffers and schedule each via FrameScheduler + ctxTimeFor (latencyMs = 0). */
export function scheduleChirpOnScheduler(ctx, signal, atUs, { pair, offsetUs, outputLatencySec = 0, latencyMs = 0, sched, ctxTimeFor, gainNode, frameSec = FrameSec }) {
  const samplesPerFrame = Math.round(SampleRate * frameSec);
  const nFrames = Math.ceil(signal.length / samplesPerFrame);
  const sources = [];
  let played = 0, dropped = 0;
  const epoch = 'cal-' + atUs;
  sched.reset();
  for (let i = 0; i < nFrames; i++) {
    const playAtUs = atUs + Math.round(i * frameSec * 1e6);
    const startCtx = ctxTimeFor(playAtUs, { pair, offsetUs, latencyMs, outputLatencySec });
    const now = ctx.currentTime;
    const p = sched.plan(startCtx, now, epoch);
    if (p.action === 'drop') { dropped++; continue; }
    const off = i * samplesPerFrame;
    const count = Math.min(samplesPerFrame, signal.length - off);
    if (count <= 0) break;
    const buf = ctx.createBuffer(2, count, SampleRate);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let s = 0; s < count; s++) L[s] = R[s] = signal[off + s];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = p.rate;
    src.connect(gainNode);
    src.start(p.start);
    sources.push(src);
    played++;
  }
  return { sources, played, dropped, nFrames, samplesPerFrame };
}

/**
 * Simulated acoustic measurement: chirp scheduled with latencyMs=0; the device adds outputLatencyMs
 * before the sound reaches the mic. The measured offset should include that injected latency.
 */
export function simulateMeasuredOffsetMs(atUs, { outputLatencyMs = 0, acousticMs = 0 } = {}) {
  // First sample intended at DAC time atUs; arrives at mic atUs + (output + path)
  return outputLatencyMs + acousticMs;
}

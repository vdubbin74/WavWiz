// Phone-as-a-device timing maths (pure, unit-tested with node). The browser has two clocks to reconcile:
//   server time  <-- (NTP-style samples over /ws/clock) -->  performance.now()  <-- (paired reads) -->  AudioContext.currentTime
// then every 20 ms audio frame is started at the AudioContext time that makes it audible at its server playAt (minus the device's delay).

/** NTP-style offset: serverUs - localUs. Uses the lowest-RTT recent samples; one slow sample cannot move it. */
export class OffsetEstimator {
  constructor(keep = 24) { this.keep = keep; this.samples = []; this.offsetUs = null; this.rttUs = null; }
  /** t0 local send, t1 server receive, t2 server send, t3 local receive (all microseconds). */
  add(t0, t1, t2, t3) {
    const rtt = (t3 - t0) - (t2 - t1); if (!(rtt >= 0) || rtt > 2_000_000) return false;
    const off = ((t1 - t0) + (t2 - t3)) / 2;
    this.samples.push({ rtt, off }); if (this.samples.length > this.keep) this.samples.shift();
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.ceil(this.samples.length / 4)));
    const target = best.reduce((s, x) => s + x.off, 0) / best.length;
    // 0.4.6 F44: while warming up (the first 8 samples after a start / resume) follow the best-RTT target directly - the first replies after a launch
    // or a wake often carry Wi-Fi power-save delay on ONE leg, and slewing away from that at 0.1 ms/s left a different error on every launch.
    if (this.offsetUs == null || this.samples.length <= 8 || Math.abs(target - this.offsetUs) > 5000) this.offsetUs = target;
    else this.offsetUs += Math.max(-100, Math.min(100, (target - this.offsetUs) * 0.5));                  // otherwise slew gently (no audible jumps)
    this.rttUs = best[0].rtt; return true;
  }
  /** 0.4.6 F44: forget everything (start / resume / back from the background): the next samples rebuild the offset from scratch. */
  reset() { this.samples = []; this.offsetUs = null; this.rttUs = null; }
  get ready() { return this.samples.length >= 4 && this.offsetUs != null; }
  get jitterUs() { if (this.samples.length < 3) return null; const o = this.samples.map(s => s.off), m = o.reduce((a, b) => a + b, 0) / o.length; return Math.sqrt(o.reduce((a, b) => a + (b - m) ** 2, 0) / o.length); }
}

/**
 * Pairs AudioContext.currentTime with performance.now(). currentTime is quantised (render quantum, ~3 ms) and Safari has no getOutputTimestamp,
 * so several back-to-back reads are taken and the one with the SMALLEST (perf - ctx) is used: it carries the least scheduling delay.
 */
export function pairClocks(reads) {   // reads: [{ctxSec, perfMs}]
  if (!reads.length) throw new Error('no clock reads');
  let best = reads[0], bv = best.perfMs - best.ctxSec * 1000;
  for (const r of reads) { const v = r.perfMs - r.ctxSec * 1000; if (v < bv) { bv = v; best = r; } }
  return { ctxSec: best.ctxSec, perfUs: best.perfMs * 1000 };
}

/**
 * 0.4.6 F44: pairs on an EDGE of currentTime. iOS advances currentTime once per hardware IO buffer (up to ~20-40 ms), so a read can sit anywhere inside
 * that step; the old min(perf - ctx) over 6 back-to-back reads (all inside one step) carried up to a whole step of error, different each launch.
 * reads come from a short polling loop; the first read whose ctxSec differs from the previous one marks the moment the step happened. Falls back
 * to pairClocks when no edge was seen.
 */
export function pairClocksEdge(reads) {
  let best = null;
  for (let i = 1; i < reads.length; i++) if (reads[i].ctxSec !== reads[i - 1].ctxSec) { const gap = reads[i].perfMs - reads[i - 1].perfMs; if (!best || gap < best.gap) best = { gap, r: reads[i] }; }
  if (!best) return pairClocks(reads);
  return { ctxSec: best.r.ctxSec, perfUs: (best.r.perfMs - best.gap / 2) * 1000, edge: true, errMs: best.gap / 2 };
}
/** 0.4.6 F44: the output path delay the browser reports: outputLatency when given (> 0), else baseLatency (Safari has no outputLatency), in seconds. */
export function outputDelaySec(ctx) { const o = +ctx?.outputLatency || 0, b = +ctx?.baseLatency || 0; return o > 0 ? o : b > 0 ? b : 0; }

/** server microseconds -> AudioContext seconds, for the audio that must be HEARD at serverUs. */
export function ctxTimeFor(serverUs, { pair, offsetUs, latencyMs = 0, outputLatencySec = 0 }) {
  const heardAtPerfUs = serverUs - offsetUs;
  const startPerfUs = heardAtPerfUs - latencyMs * 1000;         // the device's delay: output starts early by this much
  return pair.ctxSec + (startPerfUs - pair.perfUs) / 1e6 - outputLatencySec;
}

/**
 * Decides when each frame starts. Frames are chained back-to-back (no gaps/clicks); small disagreements with the computed time are
 * absorbed by nudging playbackRate (+-0.3 %, inaudible); big ones re-anchor (counted as a re-sync); frames already late are dropped.
 */
export class FrameScheduler {
  constructor({ frameSec = 0.02, maxRateTrim = 0.003, resyncSec = 0.05, minLeadSec = 0.005 } = {}) { Object.assign(this, { frameSec, maxRateTrim, resyncSec, minLeadSec }); this.reset(); }
  reset() { this.next = null; this.epoch = null; this.stats = { played: 0, dropped: 0, resyncs: 0 }; }
  plan(computedStart, nowCtx, epoch) {
    if (this.epoch !== epoch) { this.epoch = epoch; this.next = null; }
    let start, rate = 1;
    if (this.next == null) start = computedStart;
    else {
      const err = computedStart - this.next;                       // + : this frame should start LATER than the chain (we are early)
      if (Math.abs(err) > this.resyncSec) { start = computedStart; this.stats.resyncs++; }
      else { start = this.next; rate = 1 - Math.max(-this.maxRateTrim, Math.min(this.maxRateTrim, err / (this.frameSec * 12))); }
    }
    const dur = this.frameSec / rate;
    if (start < nowCtx + this.minLeadSec) {
      const late = nowCtx + this.minLeadSec - start;
      if (late > this.frameSec) { this.stats.dropped++; this.next = start + dur; return { action: 'drop', start, rate, late }; }
      start = nowCtx + this.minLeadSec;                            // slightly late: play now (a few ms off is better than a hole)
    }
    this.next = start + dur; this.stats.played++;
    return { action: 'play', start, rate, late: 0 };
  }
}

/** Plain-English state for the UI from the context + socket facts. */
export function roomHealth({ wsOpen, ctxState, hidden, bufferMs, clockReady }) {
  if (!wsOpen) return { state: 'reconnecting', text: 'Reconnecting to WavWiz...' };
  if (ctxState === 'suspended' || ctxState === 'interrupted') return { state: 'paused', text: 'Paused by the phone - tap to resume' };
  if (!clockReady) return { state: 'syncing', text: 'Syncing the clock...' };
  if (hidden) return { state: 'background', text: 'In the background - the phone may stop the sound soon' };
  if (bufferMs < 300) return { state: 'buffering', text: 'Buffering...' };
  return { state: 'ok', text: 'Playing in this phone' };
}

/** Same log taper as the Windows player (100 = 0 dB, every 10 points = 5 dB down, 0 = silence). */
export const volumeToGain = percent => !(percent > 0) ? 0 : Math.pow(10, -(100 - Math.min(100, percent)) * 0.5 / 20);

/**
 * 0.4.4 F22: the Delay slider applies live. Frames already queued on the AudioContext (seconds of buffer) are re-planned with the new
 * delay instead of waiting for the buffer to drain: items = [{ playAtUs, ... }] still in the future; computeStart(playAtUs) uses the NEW latency.
 * Re-anchors the scheduler (no restart, same epoch, nothing re-sent by the server). Returns [{ item, action, start, rate }].
 */
export function retimeFrames(items, { nowCtx, computeStart, sched, epoch }) {
  sched.next = null;
  return [...items].sort((a, b) => a.playAtUs - b.playAtUs).map(item => ({ item, ...sched.plan(computeStart(item.playAtUs), nowCtx, epoch) }));
}

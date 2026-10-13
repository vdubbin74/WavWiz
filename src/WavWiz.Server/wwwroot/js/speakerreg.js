// WavWiz 0.3.2 F2: exactly one local speaker stream per browser. Leaving Remote mode (or opening / closing the mini player) used to be able
// to leave a second stream on the same output: a stop that arrived while a start was still connecting cleared the pointer but not the device,
// so the orphan kept playing next to the new one (echo). Every start / stop now runs in one queue, and stop ends EVERY live device.
/** make(): a new device with async start() / stop() and a .running flag. */
export function speakerRegistry(make) {
  const live = new Set(); let chain = Promise.resolve(), current = null;
  const run = f => (chain = chain.then(f, f));
  async function stopAll() { const ds = [...live]; live.clear(); current = null; for (const d of ds) { try { await d.stop(); } catch { /* already gone */ } } }
  return {
    start: (...a) => run(async () => {
      if (current?.running && live.size === 1) return current;
      await stopAll();                                // dedupe: never two streams on this output
      const d = make(...a); live.add(d); current = d;
      try { await d.start(); } catch (e) { live.delete(d); if (current === d) current = null; try { await d.stop(); } catch { /* ok */ } throw e; }
      return d;
    }),
    stop: () => run(stopAll),
    get current() { return current; },
    get liveCount() { return [...live].filter(d => d.running !== false).length; },
  };
}

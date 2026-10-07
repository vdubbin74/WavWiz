// Captures raw microphone samples (mono) and posts them to the page in chunks, together with the audio-context time of each chunk.
class Recorder extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.first = true; this.port.onmessage = e => { if (e.data === 'start') { this.on = true; this.first = true; } else if (e.data === 'stop') this.on = false; }; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (this.on && ch && ch.length) {
      const copy = new Float32Array(ch); // block of 128 frames
      this.port.postMessage({ samples: copy, time: currentTime, frame: currentFrame, first: this.first }, [copy.buffer]); this.first = false;
    }
    return true;
  }
}
registerProcessor('wavwiz-recorder', Recorder);

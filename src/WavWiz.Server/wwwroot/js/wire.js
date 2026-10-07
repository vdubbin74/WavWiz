// WavWiz audio-channel wire frames in the browser (same bytes the Windows player speaks). Pure functions: unit-tested with node.
export const MAGIC = [0x55, 0x4E, 0x53, 0x4E];   // 'UNSN'
export const HEADER = 16;
export const MSG = { Hello: 1, Welcome: 2, Audio: 3, Epoch: 4, StopAt: 5, ZoneUpdate: 6, PlayerStatus: 7, CalCmd: 8, CalResult: 9, Bye: 10, Outputs: 11, DspConfig: 12 };
const MAX_PAYLOAD = 1 << 20;

export function encodeJson(type, seq, body) {
  const json = new TextEncoder().encode(JSON.stringify(body));
  const buf = new Uint8Array(HEADER + json.length), dv = new DataView(buf.buffer);
  buf.set(MAGIC, 0); buf[4] = 1; buf[5] = type; dv.setUint16(6, 0, true); dv.setUint32(8, seq >>> 0, true); dv.setUint32(12, json.length, true);
  buf.set(json, HEADER); return buf;
}

/** Re-assembles frames from arbitrary chunks (WebSocket messages may carry part of a frame, or several). */
export class FrameParser {
  constructor() { this.buf = new Uint8Array(0); }
  push(chunk) {
    const c = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    const nb = new Uint8Array(this.buf.length + c.length); nb.set(this.buf, 0); nb.set(c, this.buf.length); this.buf = nb;
    const out = [];
    for (;;) {
      if (this.buf.length < HEADER) break;
      for (let i = 0; i < 4; i++) if (this.buf[i] !== MAGIC[i]) throw new Error('bad magic (not a WavWiz server)');
      const dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.length);
      const ver = this.buf[4], type = this.buf[5], seq = dv.getUint32(8, true), len = dv.getUint32(12, true);
      if (ver !== 1) throw new Error('unsupported protocol version ' + ver);
      if (type < 1 || type > 12) throw new Error('unknown message type ' + type);
      if (len > MAX_PAYLOAD) throw new Error('payload too large');
      if (this.buf.length < HEADER + len) break;
      out.push({ type, seq, payload: this.buf.slice(HEADER, HEADER + len) });
      this.buf = this.buf.slice(HEADER + len);
    }
    return out;
  }
}

export const decodeJson = payload => JSON.parse(new TextDecoder().decode(payload));

/** AUDIO payload: i64 playAtUs | u32 epoch | u16 count | pcm24 stereo. Returns planar float32 channels. */
export function decodeAudio(payload) {
  if (payload.length < 14) throw new Error('short audio frame');
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.length);
  const playAtUs = Number(dv.getBigInt64(0, true)), epoch = dv.getUint32(8, true), count = dv.getUint16(12, true);
  if (payload.length !== 14 + count * 6) throw new Error('audio length mismatch');
  const l = new Float32Array(count), r = new Float32Array(count);
  let o = 14;
  for (let i = 0; i < count; i++) {
    let a = payload[o] | (payload[o + 1] << 8) | (payload[o + 2] << 16); if (a & 0x800000) a |= ~0xFFFFFF;
    let b = payload[o + 3] | (payload[o + 4] << 8) | (payload[o + 5] << 16); if (b & 0x800000) b |= ~0xFFFFFF;
    l[i] = a / 8388608; r[i] = b / 8388608; o += 6;
  }
  return { playAtUs, epoch, count, l, r };
}

export function decodeEpoch(payload) {   // EPOCH and STOP_AT share the layout: u32 epoch | i64 us
  if (payload.length !== 12) throw new Error('bad epoch frame');
  const dv = new DataView(payload.buffer, payload.byteOffset, 12); return { epoch: dv.getUint32(0, true), us: Number(dv.getBigInt64(4, true)) };
}

// test helper (also used by the server-side fake in tests through the same layout)
export function encodeAudio(seq, playAtUs, epoch, l, r) {
  const n = l.length, buf = new Uint8Array(HEADER + 14 + n * 6), dv = new DataView(buf.buffer);
  buf.set(MAGIC, 0); buf[4] = 1; buf[5] = MSG.Audio; dv.setUint32(8, seq >>> 0, true); dv.setUint32(12, 14 + n * 6, true);
  dv.setBigInt64(HEADER, BigInt(Math.round(playAtUs)), true); dv.setUint32(HEADER + 8, epoch, true); dv.setUint16(HEADER + 12, n, true);
  let o = HEADER + 14; const put = f => { let v = Math.round(Math.max(-1, Math.min(1, f)) * 8388607); buf[o++] = v & 255; buf[o++] = (v >> 8) & 255; buf[o++] = (v >> 16) & 255; };
  for (let i = 0; i < n; i++) { put(l[i]); put(r[i]); }
  return buf;
}

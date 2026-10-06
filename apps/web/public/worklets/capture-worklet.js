/**
 * Microphone capture worklet.
 *
 * Accumulates mono input into fixed-size chunks, converts to signed 16-bit
 * PCM and posts the chunk to the main thread together with its peak level.
 * The main thread decides whether to transmit (push-to-talk) or only use it
 * for the level meter.
 */
const CHUNK_SAMPLES = 480; // 10 ms at 48 kHz

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(CHUNK_SAMPLES);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }
    const channel = input[0];
    for (let i = 0; i < channel.length; i++) {
      this.chunk[this.offset++] = channel[i];
      if (this.offset === CHUNK_SAMPLES) {
        this.flush();
      }
    }
    return true;
  }

  flush() {
    const samples = new Int16Array(CHUNK_SAMPLES);
    let peak = 0;
    for (let i = 0; i < CHUNK_SAMPLES; i++) {
      let value = this.chunk[i];
      if (value > 1) value = 1;
      else if (value < -1) value = -1;
      const magnitude = Math.abs(value);
      if (magnitude > peak) peak = magnitude;
      samples[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
    }
    this.offset = 0;
    this.port.postMessage({ type: 'audio', samples, level: peak }, [samples.buffer]);
  }
}

registerProcessor('capture-processor', CaptureProcessor);

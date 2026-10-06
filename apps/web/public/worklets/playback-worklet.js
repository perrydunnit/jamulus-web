/**
 * Playback worklet.
 *
 * Receives 16-bit PCM chunks from the main thread and plays them out of a
 * queue. When the queue runs dry it outputs silence (a simple underrun
 * strategy; a production build would add fade-out and packet-loss concealment).
 */
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.current = null;
    this.offset = 0;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'audio') {
        this.queue.push(data.samples);
      } else if (data.type === 'clear') {
        this.queue.length = 0;
        this.current = null;
        this.offset = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0] && outputs[0][0];
    if (!output) {
      return true;
    }
    for (let i = 0; i < output.length; i++) {
      if (this.current === null) {
        if (this.queue.length === 0) {
          output[i] = 0;
          continue;
        }
        this.current = this.queue.shift();
        this.offset = 0;
      }
      output[i] = this.current[this.offset++] / 32768;
      if (this.offset >= this.current.length) {
        this.current = null;
      }
    }
    return true;
  }
}

registerProcessor('playback-processor', PlaybackProcessor);

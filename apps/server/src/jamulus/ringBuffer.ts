/** Fixed-capacity ring buffer of 16-bit samples (mono). */
export class Int16RingBuffer {
  private readonly data: Int16Array;
  private readIndex = 0;
  private writeIndex = 0;
  private count = 0;

  constructor(capacity: number) {
    this.data = new Int16Array(Math.max(capacity, 1));
  }

  /** Capacity in samples. */
  get capacity(): number {
    return this.data.length;
  }

  /** Samples currently buffered. */
  get available(): number {
    return this.count;
  }

  /** Discard all buffered samples. */
  clear(): void {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.count = 0;
  }

  /**
   * Append samples, dropping the oldest data when the buffer is full.
   * Returns the number of dropped samples.
   */
  write(samples: Int16Array): number {
    let dropped = 0;
    for (let i = 0; i < samples.length; i++) {
      if (this.count === this.data.length) {
        this.readIndex = (this.readIndex + 1) % this.data.length;
        this.count--;
        dropped++;
      }
      this.data[this.writeIndex] = samples[i] as number;
      this.writeIndex = (this.writeIndex + 1) % this.data.length;
      this.count++;
    }
    return dropped;
  }

  /**
   * Fill `out` with the next samples. Returns `false` (leaving `out` untouched)
   * when fewer than `out.length` samples are available.
   */
  readInto(out: Int16Array): boolean {
    if (this.count < out.length) {
      return false;
    }
    for (let i = 0; i < out.length; i++) {
      out[i] = this.data[this.readIndex] as number;
      this.readIndex = (this.readIndex + 1) % this.data.length;
    }
    this.count -= out.length;
    return true;
  }
}

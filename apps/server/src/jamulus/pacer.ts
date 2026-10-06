/**
 * High-resolution frame clock.
 *
 * A plain `setTimeout`/`setInterval` cannot hit a 2.667 ms cadence reliably on
 * Windows, where the timer granularity is coarse. This clock sleeps with
 * `Atomics.wait` up to a short window before each deadline and then busy-spins
 * the remainder, using absolute deadlines so that no drift accumulates.
 *
 * Between ticks control is returned to the event loop (`setImmediate`), which
 * gives socket I/O a chance to run.
 */
const waiter = new Int32Array(new SharedArrayBuffer(4));

function sleepUntil(targetNs: bigint, spinNs: bigint): void {
  for (;;) {
    const remaining = targetNs - process.hrtime.bigint();
    if (remaining <= 0n) {
      return;
    }
    if (remaining > spinNs) {
      const waitMs = Number(remaining - spinNs) / 1e6;
      Atomics.wait(waiter, 0, 0, waitMs);
      continue;
    }
    // Spin the final window for sub-millisecond accuracy.
  }
}

function spinUntil(targetNs: bigint): void {
  while (process.hrtime.bigint() < targetNs) {
    // Busy-wait: Windows quantizes all blocking waits to the system timer
    // (~15.6 ms), which is far too coarse for a 2.667 ms frame cadence.
  }
}

export interface FrameClockOptions {
  /** Samples per frame. */
  frameSamples: number;
  /** Sample rate in Hz. */
  sampleRate: number;
  /** Busy-spin window in nanoseconds. */
  spinNs: number;
  /**
   * When true, block with `Atomics.wait` for the bulk of the interval and spin
   * only the tail. When false (default) the clock busy-spins the whole
   * interval, which is required on Windows where blocking waits are quantized
   * to the ~15.6 ms system timer.
   */
  hybrid?: boolean;
  /** Called once per frame, on the deadline. */
  onFrame: () => void;
  /** Optional jitter telemetry, called after each frame. */
  onStats?: (stats: { tick: number; latenessNs: number }) => void;
}

/** Drift-corrected, high-resolution frame clock. */
export class FrameClock {
  private readonly intervalNs: bigint;
  private readonly spinNs: bigint;
  private readonly hybrid: boolean;
  private readonly frameSamples: number;
  private readonly sampleRate: number;
  private readonly onFrame: () => void;
  private readonly onStats?: (stats: { tick: number; latenessNs: number }) => void;

  private running = false;
  private startNs = 0n;
  private tick = 0n;

  constructor(options: FrameClockOptions) {
    this.frameSamples = options.frameSamples;
    this.sampleRate = options.sampleRate;
    this.spinNs = BigInt(Math.max(0, options.spinNs));
    this.hybrid = options.hybrid ?? false;
    this.onFrame = options.onFrame;
    this.onStats = options.onStats;
    this.intervalNs = (BigInt(this.frameSamples) * 1_000_000_000n) / BigInt(this.sampleRate);
  }

  /** Frame interval in nanoseconds. */
  get interval(): bigint {
    return this.intervalNs;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.startNs = process.hrtime.bigint();
    this.tick = 0n;
    setImmediate(() => this.step());
  }

  stop(): void {
    this.running = false;
  }

  private step(): void {
    if (!this.running) {
      return;
    }
    const target = this.startNs + this.tick * this.intervalNs;
    if (this.hybrid) {
      sleepUntil(target, this.spinNs);
    } else {
      spinUntil(target);
    }
    const lateness = process.hrtime.bigint() - target;
    this.onFrame();
    this.onStats?.({ tick: Number(this.tick), latenessNs: Number(lateness) });
    this.tick++;
    setImmediate(() => this.step());
  }
}

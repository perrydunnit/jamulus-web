/**
 * Web Audio engine.
 *
 * Captures the microphone through an `AudioWorklet` and plays the downlink mix
 * through a second worklet. Both run at 48 kHz mono to match the Jamulus
 * audio stream, so no resampling is required in the common case.
 */
export interface CaptureFrame {
  samples: Int16Array;
  /** Peak input level in the range 0..1, for the level meter. */
  level: number;
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private playbackNode: AudioWorkletNode | null = null;
  private outputGain: GainNode | null = null;
  private microphone: MediaStream | null = null;
  private captureHandler: ((frame: CaptureFrame) => void) | null = null;

  get isRunning(): boolean {
    return this.context !== null;
  }

  /** Current output volume in the range 0..1. */
  get volume(): number {
    return this.outputGain?.gain.value ?? 1;
  }

  /**
   * Start the microphone and audio graph. Must be called from a user gesture
   * (browser autoplay policy) and requires a secure context.
   */
  async start(onCapture: (frame: CaptureFrame) => void): Promise<void> {
    if (this.context) {
      return;
    }
    this.captureHandler = onCapture;

    const context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    this.context = context;

    await context.audioWorklet.addModule('worklets/capture-worklet.js');
    await context.audioWorklet.addModule('worklets/playback-worklet.js');

    this.microphone = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const source = context.createMediaStreamSource(this.microphone);

    const captureNode = new AudioWorkletNode(context, 'capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });
    captureNode.port.onmessage = (event: MessageEvent<CaptureFrame & { type: string }>) => {
      if (event.data.type === 'audio') {
        this.captureHandler?.({ samples: event.data.samples, level: event.data.level });
      }
    };
    // A worklet only processes while connected to the destination; a muted gain
    // node prevents the microphone from being played back into the speakers.
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    source.connect(captureNode).connect(silentGain).connect(context.destination);
    this.captureNode = captureNode;

    const playbackNode = new AudioWorkletNode(context, 'playback-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const outputGain = context.createGain();
    outputGain.gain.value = 1;
    playbackNode.connect(outputGain).connect(context.destination);
    this.playbackNode = playbackNode;
    this.outputGain = outputGain;

    if (context.state === 'suspended') {
      await context.resume();
    }
  }

  /** Queue downlink PCM for playback. */
  play(samples: Int16Array): void {
    this.playbackNode?.port.postMessage({ type: 'audio', samples }, [samples.buffer]);
  }

  /** Drop any queued playback audio. */
  clearPlayback(): void {
    this.playbackNode?.port.postMessage({ type: 'clear' });
  }

  /** Set the output volume (0..1). */
  setVolume(value: number): void {
    if (this.outputGain) {
      this.outputGain.gain.value = Math.max(0, Math.min(1, value));
    }
  }

  /** Stop the microphone and tear down the audio graph. */
  async stop(): Promise<void> {
    this.captureNode?.port.close();
    this.playbackNode?.port.close();
    this.captureNode?.disconnect();
    this.playbackNode?.disconnect();
    this.outputGain?.disconnect();
    this.microphone?.getTracks().forEach((track) => track.stop());
    this.captureNode = null;
    this.playbackNode = null;
    this.outputGain = null;
    this.microphone = null;
    this.captureHandler = null;
    const context = this.context;
    this.context = null;
    await context?.close();
  }
}

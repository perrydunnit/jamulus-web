import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AudioEngine, type CaptureFrame } from './audio/audio-engine';
import { BridgeService } from './bridge/bridge.service';

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onKeyDown($event)',
    '(document:keyup)': 'onKeyUp($event)',
  },
})
export class App {
  readonly bridge = inject(BridgeService);

  readonly name = signal('Web Musician');
  readonly transmitting = signal(false);
  readonly micLevel = signal(0);
  readonly volume = signal(0.9);
  readonly busy = signal(false);
  readonly micError = signal<string | null>(null);
  readonly showSettings = signal(false);

  private readonly engine = new AudioEngine();

  readonly isConnected = computed(() => this.bridge.state() === 'connected');
  readonly statusLabel = computed(() => {
    switch (this.bridge.state()) {
      case 'connecting':
        return 'Connecting';
      case 'connected':
        return this.transmitting() ? 'Transmitting' : 'Listening';
      case 'closed':
        return 'Disconnected';
      default:
        return 'Not connected';
    }
  });
  readonly otherUsers = computed(() =>
    this.bridge.users().filter((user) => user.channelId !== this.bridge.channelId()),
  );

  async toggleConnection(): Promise<void> {
    if (this.bridge.state() === 'connected' || this.bridge.state() === 'connecting') {
      await this.stop();
    } else {
      await this.start();
    }
  }

  private async start(): Promise<void> {
    this.busy.set(true);
    this.micError.set(null);
    try {
      await this.engine.start((frame) => this.onCaptureFrame(frame));
      this.engine.setVolume(this.volume());
      this.bridge.setAudioSink((samples) => this.engine.play(samples));
      this.bridge.connect('/ws', this.name().trim() || 'Web Musician');
    } catch (error) {
      this.micError.set(
        error instanceof Error
          ? `Microphone unavailable: ${error.message}`
          : 'Microphone unavailable.',
      );
      await this.engine.stop();
    } finally {
      this.busy.set(false);
    }
  }

  private async stop(): Promise<void> {
    this.transmitting.set(false);
    this.bridge.disconnect();
    await this.engine.stop();
    this.micLevel.set(0);
  }

  private onCaptureFrame(frame: CaptureFrame): void {
    this.micLevel.set(frame.level);
    if (this.transmitting() && this.isConnected()) {
      this.bridge.sendAudio(frame.samples);
    }
  }

  startTransmitting(): void {
    if (this.isConnected()) {
      this.transmitting.set(true);
    }
  }

  stopTransmitting(): void {
    this.transmitting.set(false);
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.code !== 'Space' || event.repeat || this.isTyping(event)) {
      return;
    }
    event.preventDefault();
    this.startTransmitting();
  }

  onKeyUp(event: KeyboardEvent): void {
    if (event.code !== 'Space' || this.isTyping(event)) {
      return;
    }
    event.preventDefault();
    this.stopTransmitting();
  }

  private isTyping(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable === true
    );
  }

  onVolumeInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value) / 100;
    this.volume.set(value);
    this.engine.setVolume(value);
  }

  onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  toggleSettings(): void {
    this.showSettings.update((value) => !value);
  }

  levelPercent(level: number): number {
    return Math.round(Math.min(1, Math.max(0, level)) * 100);
  }
}

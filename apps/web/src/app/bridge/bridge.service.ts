import { Injectable, signal } from '@angular/core';

/** A musician connected to the Jamulus server. */
export interface RemoteUser {
  channelId: number;
  name: string;
  city: string;
  instrument: number;
}

/** Periodic link metrics reported by the bridge. */
export interface BridgeMetrics {
  pingMs: number;
  serverJitterBlocks: number;
  uplinkBufferSamples: number;
  underruns: number;
  downlinkLevel: number;
}

export type BridgeState = 'idle' | 'connecting' | 'connected' | 'closed';

const EMPTY_METRICS: BridgeMetrics = {
  pingMs: 0,
  serverJitterBlocks: 0,
  uplinkBufferSamples: 0,
  underruns: 0,
  downlinkLevel: 0,
};

/**
 * WebSocket client for the Node bridge.
 *
 * Binary frames carry plain PCM; text frames carry JSON control/status
 * messages. All state is exposed as signals so components stay declarative.
 */
@Injectable({ providedIn: 'root' })
export class BridgeService {
  readonly state = signal<BridgeState>('idle');
  readonly channelId = signal<number | null>(null);
  readonly rawAudio = signal(false);
  readonly server = signal('');
  readonly error = signal<string | null>(null);
  readonly users = signal<RemoteUser[]>([]);
  readonly metrics = signal<BridgeMetrics>(EMPTY_METRICS);
  readonly chat = signal<string[]>([]);

  private socket: WebSocket | null = null;
  private audioSink: ((samples: Int16Array) => void) | null = null;

  /** Register the callback that receives downlink PCM. */
  setAudioSink(sink: (samples: Int16Array) => void): void {
    this.audioSink = sink;
  }

  /** Open the WebSocket and ask the bridge to join the Jamulus server. */
  connect(url: string, name: string): void {
    if (this.socket) {
      return;
    }
    this.error.set(null);
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'join', name }));
    };
    socket.onmessage = (event) => this.onMessage(event);
    socket.onerror = () => this.error.set('Connection to the bridge failed.');
    socket.onclose = () => {
      this.socket = null;
      if (this.state() !== 'closed') {
        this.state.set('closed');
      }
    };
  }

  /** Ask the bridge to leave the session, then close the socket. */
  disconnect(): void {
    const socket = this.socket;
    if (!socket) {
      return;
    }
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'leave' }));
    }
    socket.close();
    this.socket = null;
    this.state.set('idle');
    this.users.set([]);
    this.metrics.set(EMPTY_METRICS);
  }

  /**
   * Send microphone audio. The bridge turns an empty uplink buffer into
   * silence, so simply not calling this while listening is enough.
   */
  sendAudio(samples: Int16Array): void {
    const socket = this.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(samples);
    }
  }

  private onMessage(event: MessageEvent): void {
    if (event.data instanceof ArrayBuffer) {
      this.audioSink?.(new Int16Array(event.data));
      return;
    }
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(event.data as string) as Record<string, unknown>;
    } catch {
      return;
    }

    switch (message['type']) {
      case 'state': {
        this.state.set(message['state'] as BridgeState);
        this.channelId.set((message['channelId'] as number | null) ?? null);
        this.rawAudio.set(Boolean(message['rawAudio']));
        this.server.set((message['server'] as string) ?? '');
        const error = message['error'] as string | undefined;
        if (error) {
          this.error.set(error);
        }
        break;
      }
      case 'users':
        this.users.set((message['users'] as RemoteUser[]) ?? []);
        break;
      case 'metrics':
        this.metrics.set(message as unknown as BridgeMetrics);
        break;
      case 'chat': {
        const text = message['text'] as string;
        this.chat.update((lines) => [...lines.slice(-19), text]);
        break;
      }
      default:
        break;
    }
  }
}

import type { WebSocket } from 'ws';
import type { ConnectedClient } from './protocol.ts';
import { JamulusClient } from './jamulus/client.ts';
import type { ServerConfig } from './config.ts';
import { parseAddress } from './config.ts';
import {
  parseClientMessage,
  pcmBufferToInt16,
  pcmPeakLevel,
  type ServerMessage,
} from './wsProtocol.ts';

/**
 * One browser connection mapped to one Jamulus channel.
 *
 * The session owns a `JamulusClient` (one UDP socket) and relays audio and
 * status between it and the browser. Microphone audio arrives as binary frames;
 * when the browser is not transmitting the client's uplink buffer drains and the
 * bridge sends silence, which keeps the Jamulus stream alive.
 */
export class BridgeSession {
  private readonly socket: WebSocket;
  private readonly config: ServerConfig;
  private readonly server: string;
  private jamulus: JamulusClient | null = null;
  private closed = false;
  private lastError: string | undefined;

  constructor(socket: WebSocket, config: ServerConfig) {
    this.socket = socket;
    this.config = config;
    this.server = config.serverAddress;

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        this.onAudio(data);
      } else {
        this.onControl(data.toString('utf8'));
      }
    });
    socket.on('close', () => this.dispose());
    socket.on('error', () => this.dispose());

    this.sendState('idle');
  }

  private onControl(text: string): void {
    const message = parseClientMessage(text);
    if (!message) {
      return;
    }
    if (message.type === 'join') {
      void this.join(message.name);
    } else if (message.type === 'leave') {
      void this.leave();
    }
  }

  private onAudio(buffer: Buffer): void {
    this.jamulus?.pushUplink(pcmBufferToInt16(buffer));
  }

  private async join(name?: string): Promise<void> {
    if (this.jamulus) {
      return;
    }
    const { host, port } = parseAddress(this.server);
    const client = new JamulusClient({
      host,
      port,
      name: name?.trim() || this.config.clientName,
      jitterBlocks: this.config.jitterBlocks,
      spinNs: this.config.spinNs,
      channels: this.config.channels,
      frameSamples: this.config.frameSamples,
    });
    this.jamulus = client;

    client.on('connected', (info) => {
      this.sendState('connected', { channelId: info.channelId, rawAudio: info.rawAudio });
    });
    client.on('users', (users: ConnectedClient[]) => {
      this.send({
        type: 'users',
        users: users.map((u) => ({
          channelId: u.channelId,
          name: u.name,
          city: u.city,
          instrument: u.instrument,
        })),
      });
    });
    client.on('audio', (buffer: Buffer) => {
      this.lastDownlinkLevel = pcmPeakLevel(buffer);
      if (this.socket.readyState === this.socket.OPEN) {
        this.socket.send(buffer, { binary: true });
      }
    });
    client.on('chat', (text) => this.send({ type: 'chat', text }));
    client.on('ping', (pingMs) => {
      this.pingMs = pingMs;
    });
    client.on('serverJitterBuffer', (blocks) => {
      this.serverJitterBlocks = blocks;
    });
    client.on('error', (error: Error) => {
      // Store the reason; the `disconnected` event that follows surfaces it.
      this.lastError = error.message;
    });
    client.on('disconnected', ({ reason }) => {
      this.sendState('closed', { error: this.lastError ?? reason });
    });

    this.sendState('connecting');
    try {
      await client.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.sendState('closed', { error: message });
      this.jamulus = null;
    }
  }

  private pingMs = 0;
  private serverJitterBlocks = 0;
  private lastDownlinkLevel = 0;

  /** Push periodic metrics to the browser. */
  pushMetrics(): void {
    const client = this.jamulus;
    if (!client) {
      return;
    }
    this.send({
      type: 'metrics',
      pingMs: this.pingMs,
      serverJitterBlocks: this.serverJitterBlocks,
      uplinkBufferSamples: client.uplinkBufferLevel,
      underruns: 0,
      downlinkLevel: this.lastDownlinkLevel,
    });
  }

  private sendState(
    state: 'idle' | 'connecting' | 'connected' | 'closed',
    extra: { channelId?: number | null; rawAudio?: boolean; error?: string } = {},
  ): void {
    this.send({
      type: 'state',
      state,
      channelId: extra.channelId ?? this.jamulus?.assignedChannelId ?? null,
      rawAudio: extra.rawAudio ?? this.jamulus?.isRawAudioSupported ?? false,
      server: this.server,
      error: extra.error,
    });
  }

  private send(message: ServerMessage): void {
    if (this.socket.readyState === this.socket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  /** Stop the Jamulus session and detach listeners. */
  async dispose(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const client = this.jamulus;
    this.jamulus = null;
    await client?.stop('browser disconnected');
  }

  private async leave(): Promise<void> {
    const client = this.jamulus;
    this.jamulus = null;
    await client?.stop('client left');
    this.sendState('idle');
  }
}

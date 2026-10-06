import { EventEmitter } from 'node:events';
import dgram from 'node:dgram';
import { lookup } from 'node:dns/promises';
import {
  AudioCodec,
  ConnectionLessMessageId,
  MessageId,
  MinNetBufSizeNumBl,
  NetwFlags,
  SpecialSplitMessageId,
  SplitMessageReassembler,
  SystemSampleRateHz,
  decodeAck,
  decodeChatText,
  decodeClientId,
  decodeConnectedClients,
  decodeJitterBufferSize,
  decodeLicenceRequired,
  decodeMessage,
  decodeNetworkTransportProps,
  decodePing,
  decodeRecorderState,
  decodeVersionAndOs,
  encodeAck,
  encodeChannelInfo,
  encodeJitterBufferSize,
  encodeMessage,
  encodeNetworkTransportProps,
  encodePing,
  rawAudioBytesPerFrame,
  type ConnectedClient,
  type NetworkTransportProps,
} from '../protocol.ts';
import { FrameClock } from './pacer.ts';
import { Int16RingBuffer } from './ringBuffer.ts';

export type JamulusClientState = 'idle' | 'connecting' | 'connected' | 'closing' | 'closed';

export interface JamulusClientOptions {
  host: string;
  port: number;
  /** Display name advertised to the server. */
  name: string;
  city?: string;
  /** Audio channels (1 = mono). */
  channels?: number;
  /** Audio frame size in samples (128 for CT_OPUS). */
  frameSamples?: number;
  /** Jitter buffer size in blocks requested from the server. */
  jitterBlocks?: number;
  /** Busy-spin window in nanoseconds used to sharpen the frame clock. */
  spinNs?: number;
  /** Uplink ring buffer capacity in samples. */
  uplinkBufferSamples?: number;
  /** Handshake timeout in milliseconds. */
  handshakeTimeoutMs?: number;
  /** Emit a `debug` event for every received protocol message. */
  debug?: boolean;
}

interface QueuedMessage {
  frame: Buffer;
  id: number;
  cnt: number;
  sentAt: number;
  attempts: number;
}

const ACK_TIMEOUT_MS = 400;
const RETRANSMIT_CHECK_MS = 50;
const MAX_SEND_ATTEMPTS = 12;
const PING_INTERVAL_MS = 2000;

/**
 * A single Jamulus session: owns one UDP socket, performs the protocol
 * handshake, and streams raw uncompressed PCM at the codec frame rate.
 *
 * Raw audio is used because it avoids the custom (non-standard) Opus build that
 * Jamulus ships. The server advertises support with RAWAUDIO_SUPPORTED and
 * detects raw packets from their size.
 */
export class JamulusClient extends EventEmitter {
  private readonly options: Required<JamulusClientOptions>;
  private socket: dgram.Socket | null = null;
  private clock: FrameClock | null = null;
  private readonly reassembler = new SplitMessageReassembler();

  private state: JamulusClientState = 'idle';
  private channelId: number | null = null;
  private rawAudioSupported = false;
  private splitMessSupported = false;
  private serverProps: NetworkTransportProps | null = null;

  private readonly channels: number;
  private readonly frameSamples: number;
  private readonly codedBytesPerFrame: number;
  private readonly downlinkBytes: number;

  private readonly uplink: Int16RingBuffer;
  private readonly frameScratch: Int16Array;

  private sendQueue: QueuedMessage[] = [];
  private nextCounter = 0;

  private retransmitTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private usersTimer: NodeJS.Timeout | null = null;
  private handshakeTimer: NodeJS.Timeout | null = null;
  private rawAudioTimer: NodeJS.Timeout | null = null;

  private statsTimer: NodeJS.Timeout | null = null;
  private latenessSamples: number[] = [];
  private underruns = 0;
  private framesSent = 0;

  constructor(options: JamulusClientOptions) {
    super();
    this.options = {
      channels: 1,
      frameSamples: 128,
      jitterBlocks: 3,
      spinNs: 500_000,
      city: '',
      uplinkBufferSamples: SystemSampleRateHz, // ~1 second
      handshakeTimeoutMs: 5000,
      debug: false,
      ...options,
    };

    this.channels = this.options.channels;
    this.frameSamples = this.options.frameSamples;
    this.codedBytesPerFrame = rawAudioBytesPerFrame(this.channels, this.frameSamples);
    // The server sends its mix using the frame size we advertise.
    this.downlinkBytes = this.codedBytesPerFrame;

    this.uplink = new Int16RingBuffer(this.options.uplinkBufferSamples);
    this.frameScratch = new Int16Array(this.frameSamples * this.channels);
  }

  get connectionState(): JamulusClientState {
    return this.state;
  }

  get isRawAudioSupported(): boolean {
    return this.rawAudioSupported;
  }

  get assignedChannelId(): number | null {
    return this.channelId;
  }

  /** Queue mono PCM samples for transmission to the server. */
  pushUplink(samples: Int16Array): void {
    // Only accept microphone data once the server has confirmed raw audio
    // support. Before that the server would treat our PCM as Opus data and
    // decode it into noise for everyone else, so silence is sent instead.
    if (!this.rawAudioSupported) {
      return;
    }
    this.uplink.write(samples);
  }

  /** Current uplink buffer fill level in samples. */
  get uplinkBufferLevel(): number {
    return this.uplink.available;
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`cannot start client in state "${this.state}"`);
    }
    this.state = 'connecting';

    const address = await lookup(this.options.host, { family: 4 });

    const socket = dgram.createSocket('udp4');
    this.socket = socket;
    socket.on('error', (error) => this.fail(error));
    socket.on('message', (message) => this.onDatagram(message));

    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, () => {
        socket.off('error', reject);
        resolve();
      });
    });

    // Wait for the socket to be connected so that `send` knows the peer, and so
    // that datagrams from any other source are filtered out.
    await new Promise<void>((resolve, reject) => {
      const onConnect = (): void => {
        socket.off('error', onError);
        resolve();
      };
      const onError = (error: Error): void => {
        socket.off('connect', onConnect);
        reject(error);
      };
      socket.once('connect', onConnect);
      socket.once('error', onError);
      socket.connect(this.options.port, address.address);
    });

    this.clock = new FrameClock({
      frameSamples: this.frameSamples,
      sampleRate: SystemSampleRateHz,
      spinNs: this.options.spinNs,
      onFrame: () => this.onFrameTick(),
      onStats: (stats) => this.latenessSamples.push(stats.latenessNs),
    });
    this.clock.start();

    // Advertise transport properties first: this is what makes the server
    // create our channel and learn the raw-audio frame size.
    this.enqueue(
      MessageId.NetwTransportProps,
      encodeNetworkTransportProps({
        baseNetworkPacketSize: this.codedBytesPerFrame,
        blockSizeFact: 1,
        numAudioChannels: this.channels,
        sampleRate: SystemSampleRateHz,
        audioCodingType: AudioCodec.Opus,
        flags: NetwFlags.None,
        audioCodingArg: 0,
      }),
    );

    this.retransmitTimer = setInterval(() => this.checkRetransmit(), RETRANSMIT_CHECK_MS);
    this.pingTimer = setInterval(() => this.sendPing(), PING_INTERVAL_MS);
    this.usersTimer = setInterval(
      () => this.send(MessageId.ReqConnClientsList, new Uint8Array(0)),
      PING_INTERVAL_MS,
    );
    this.statsTimer = setInterval(() => this.reportStats(), 1000);
    this.handshakeTimer = setTimeout(
      () => this.fail(new Error('handshake timed out: no CLIENT_ID received')),
      this.options.handshakeTimeoutMs,
    );
  }

  /** Stop streaming and disconnect gracefully. */
  async stop(reason = 'client requested'): Promise<void> {
    if (this.state === 'closed' || this.state === 'closing') {
      return;
    }
    this.state = 'closing';
    this.clearTimers();

    this.clock?.stop();
    this.clock = null;

    if (this.socket) {
      const frame = encodeMessage(0, ConnectionLessMessageId.Disconnection);
      for (let i = 0; i < 3; i++) {
        this.socket.send(frame);
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      this.socket.close();
      this.socket = null;
    }

    this.state = 'closed';
    this.emit('disconnected', { reason });
  }

  // -- outbound ---------------------------------------------------------------

  private send(id: number, data: Uint8Array): void {
    this.enqueue(id, data);
  }

  private enqueue(id: number, data: Uint8Array): void {
    const cnt = this.nextCounter;
    this.nextCounter = (this.nextCounter + 1) & 0xff;
    const frame = Buffer.from(encodeMessage(cnt, id, data));
    this.sendQueue.push({ frame, id, cnt, sentAt: 0, attempts: 0 });
    if (this.sendQueue.length === 1) {
      this.sendHead();
    }
  }

  private sendHead(): void {
    const head = this.sendQueue[0];
    if (!head || !this.socket) {
      return;
    }
    head.sentAt = Date.now();
    head.attempts++;
    this.socket.send(head.frame);
    if (head.attempts > MAX_SEND_ATTEMPTS) {
      this.fail(new Error(`message ${head.id} was not acknowledged after ${head.attempts} attempts`));
    }
  }

  private checkRetransmit(): void {
    const head = this.sendQueue[0];
    if (!head) {
      return;
    }
    if (Date.now() - head.sentAt > ACK_TIMEOUT_MS) {
      this.sendHead();
    }
  }

  private sendConnectionLess(id: number, data: Uint8Array): void {
    if (!this.socket) {
      return;
    }
    this.socket.send(Buffer.from(encodeMessage(0, id, data)));
  }

  private sendPing(): void {
    this.sendConnectionLess(ConnectionLessMessageId.PingMs, encodePing(this.nowMs()));
  }

  private nowMs(): number {
    return Date.now() & 0xffffffff;
  }

  private sendAck(id: number, cnt: number): void {
    if (!this.socket) {
      return;
    }
    this.socket.send(Buffer.from(encodeMessage(cnt, MessageId.Ack, encodeAck(id))));
  }

  // -- inbound ----------------------------------------------------------------

  private onDatagram(message: Buffer): void {
    const decoded = decodeMessage(message);

    if (!decoded) {
      // Not a protocol message: this is the server's audio mix.
      if (message.length === this.downlinkBytes) {
        this.emit('audio', Buffer.from(message));
      }
      return;
    }

    if (this.options.debug) {
      this.emit('debug', `recv id=${decoded.id} cnt=${decoded.cnt} len=${decoded.data.length}`);
    }

    if (this.isConnectionLess(decoded.id)) {
      this.onConnectionLessMessage(decoded.id, decoded.data);
      return;
    }

    // Every connected message except ACK must be acknowledged.
    if (decoded.id !== MessageId.Ack) {
      this.sendAck(decoded.id, decoded.cnt);
    }

    if (decoded.id === SpecialSplitMessageId) {
      const complete = this.reassembler.push(decoded.data);
      if (complete) {
        this.handleMessage(complete.id, complete.data, decoded.cnt);
      }
      return;
    }

    this.handleMessage(decoded.id, decoded.data, decoded.cnt);
  }

  private isConnectionLess(id: number): boolean {
    return id >= 1000 && id <= 1999;
  }

  private onConnectionLessMessage(id: number, data: Uint8Array): void {
    switch (id) {
      case ConnectionLessMessageId.PingMs: {
        const transmitTime = decodePing(data);
        const rtt = (this.nowMs() - transmitTime + 0x100000000) & 0xffffffff;
        this.emit('ping', rtt);
        break;
      }
      case ConnectionLessMessageId.PingMsWithNumClients:
        break;
      case ConnectionLessMessageId.ServerFull:
        this.fail(new Error('server is full'));
        break;
      default:
        break;
    }
  }

  private handleMessage(id: number, data: Uint8Array, cnt: number): void {
    switch (id) {
      case MessageId.Ack: {
        const acknowledgedId = decodeAck(data);
        const head = this.sendQueue[0];
        if (head && head.id === acknowledgedId && head.cnt === cnt) {
          this.sendQueue.shift();
          this.sendHead();
        }
        break;
      }
      case MessageId.ClientId:
        this.channelId = decodeClientId(data);
        if (this.handshakeTimer) {
          clearTimeout(this.handshakeTimer);
          this.handshakeTimer = null;
        }
        // The server only advertises raw audio when enabled.
        this.rawAudioTimer = setTimeout(() => {
          if (!this.rawAudioSupported) {
            this.fail(
              new Error(
                'server does not support raw audio (it may be running with --noraw); ' +
                  'a custom-Opus codec build would be required',
              ),
            );
          } else {
            this.markConnected();
          }
        }, 1500);
        break;
      case MessageId.RawAudioSupported:
        this.rawAudioSupported = true;
        break;
      case MessageId.OpusSupported:
        break;
      case MessageId.NetwTransportProps:
        this.serverProps = decodeNetworkTransportProps(data);
        break;
      case MessageId.ReqNetwTransportProps:
        this.send(
          MessageId.NetwTransportProps,
          encodeNetworkTransportProps({
            baseNetworkPacketSize: this.codedBytesPerFrame,
            blockSizeFact: 1,
            numAudioChannels: this.channels,
            sampleRate: SystemSampleRateHz,
            audioCodingType: AudioCodec.Opus,
            flags: NetwFlags.None,
            audioCodingArg: 0,
          }),
        );
        break;
      case MessageId.ReqJitBufSize:
        this.sendJitterBufferSize();
        break;
      case MessageId.JitBufSize:
        this.emit('serverJitterBuffer', decodeJitterBufferSize(data));
        break;
      case MessageId.ReqChannelInfos:
        this.sendChannelInfo();
        break;
      case MessageId.ChannelInfos:
        break;
      case MessageId.ReqSplitMessSupport:
        this.splitMessSupported = true;
        this.send(MessageId.SplitMessSupported, new Uint8Array(0));
        break;
      case MessageId.SplitMessSupported:
        this.splitMessSupported = true;
        break;
      case MessageId.ConnClientsList:
        this.emit('users', decodeConnectedClients(data) as ConnectedClient[]);
        break;
      case MessageId.ChatText:
        this.emit('chat', decodeChatText(data));
        break;
      case MessageId.VersionAndOs: {
        const info = decodeVersionAndOs(data);
        this.emit('serverVersion', info);
        break;
      }
      case MessageId.RecorderState:
        this.emit('recorderState', decodeRecorderState(data));
        break;
      case MessageId.LicenceRequired:
        this.emit('licenceRequired', decodeLicenceRequired(data));
        break;
      case MessageId.ChannelGain:
      case MessageId.ChannelPan:
      case MessageId.MuteStateChanged:
        break;
      default:
        this.emit('unknownMessage', id);
        break;
    }
  }

  private sendChannelInfo(): void {
    this.send(
      MessageId.ChannelInfos,
      encodeChannelInfo({
        country: 0,
        instrument: 0,
        skillLevel: 0,
        name: this.options.name,
        city: this.options.city,
      }),
    );
  }

  private sendJitterBufferSize(): void {
    const blocks = Math.min(Math.max(this.options.jitterBlocks, MinNetBufSizeNumBl), 20);
    this.send(MessageId.JitBufSize, encodeJitterBufferSize(blocks));
  }

  private markConnected(): void {
    if (this.state === 'connected') {
      return;
    }
    this.state = 'connected';
    // Send our identity so the server starts streaming the mix to us.
    this.sendChannelInfo();
    this.sendJitterBufferSize();
    this.send(MessageId.ReqConnClientsList, new Uint8Array(0));
    this.emit('connected', {
      channelId: this.channelId,
      rawAudio: this.rawAudioSupported,
    });
  }

  // -- frame clock ------------------------------------------------------------

  private onFrameTick(): void {
    if (!this.socket || this.state === 'closed' || this.state === 'closing') {
      return;
    }
    if (!this.uplink.readInto(this.frameScratch)) {
      this.underruns++;
      this.frameScratch.fill(0);
    }

    const frame = Buffer.allocUnsafe(this.frameScratch.length * 2);
    for (let i = 0; i < this.frameScratch.length; i++) {
      frame.writeInt16LE(this.frameScratch[i] as number, i * 2);
    }
    this.socket.send(frame);
    this.framesSent++;
  }

  private reportStats(): void {
    const sorted = [...this.latenessSamples].sort((a, b) => a - b);
    const p = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    this.emit('stats', {
      framesSent: this.framesSent,
      underruns: this.underruns,
      uplinkBuffer: this.uplink.available,
      latenessP50Ns: p(0.5),
      latenessP99Ns: p(0.99),
      latenessMaxNs: sorted[sorted.length - 1] ?? 0,
    });
    this.latenessSamples = [];
  }

  private clearTimers(): void {
    for (const timer of [
      this.retransmitTimer,
      this.pingTimer,
      this.usersTimer,
      this.handshakeTimer,
      this.rawAudioTimer,
      this.statsTimer,
    ]) {
      if (timer) {
        clearTimeout(timer);
        clearInterval(timer);
      }
    }
    this.retransmitTimer = null;
    this.pingTimer = null;
    this.usersTimer = null;
    this.handshakeTimer = null;
    this.rawAudioTimer = null;
    this.statsTimer = null;
  }

  private fail(error: Error): void {
    if (this.state === 'closed' || this.state === 'closing') {
      return;
    }
    this.clearTimers();
    this.clock?.stop();
    this.clock = null;
    try {
      this.socket?.close();
    } catch {
      // ignore
    }
    this.socket = null;
    this.state = 'closed';
    if (this.listenerCount('error') > 0) {
      this.emit('error', error);
    }
    this.emit('disconnected', { reason: error.message });
  }
}

/**
 * WebSocket frame protocol between the browser and the bridge.
 *
 * - Binary frames carry mono 16-bit little-endian PCM at 48 kHz. In both
 *   directions the payload is raw audio with no header.
 * - Text frames carry JSON control/status messages.
 */
import type { ConnectedClient } from './protocol.ts';

/** Client -> bridge JSON messages. */
export type ClientMessage =
  | { type: 'join'; name?: string }
  | { type: 'leave' };

/** Bridge -> client JSON messages. */
export type ServerMessage =
  | {
      type: 'state';
      state: 'idle' | 'connecting' | 'connected' | 'closed';
      channelId: number | null;
      rawAudio: boolean;
      server: string;
      error?: string;
    }
  | { type: 'users'; users: Array<Pick<ConnectedClient, 'channelId' | 'name' | 'city' | 'instrument'>> }
  | {
      type: 'metrics';
      pingMs: number;
      serverJitterBlocks: number;
      uplinkBufferSamples: number;
      underruns: number;
      downlinkLevel: number;
    }
  | { type: 'chat'; text: string };

/** Parse a text frame into a client message, returning null when invalid. */
export function parseClientMessage(text: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const candidate = parsed as { type?: unknown; name?: unknown };
  if (candidate.type === 'join') {
    return { type: 'join', name: typeof candidate.name === 'string' ? candidate.name : undefined };
  }
  if (candidate.type === 'leave') {
    return { type: 'leave' };
  }
  return null;
}

/** Convert a little-endian PCM buffer into samples. */
export function pcmBufferToInt16(buffer: Buffer): Int16Array {
  const count = Math.floor(buffer.length / 2);
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    samples[i] = buffer.readInt16LE(i * 2);
  }
  return samples;
}

/** Peak (linear) level of a little-endian PCM buffer, in the range 0..1. */
export function pcmPeakLevel(buffer: Buffer): number {
  let peak = 0;
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    const value = Math.abs(buffer.readInt16LE(i));
    if (value > peak) {
      peak = value;
    }
  }
  return peak / 32768;
}

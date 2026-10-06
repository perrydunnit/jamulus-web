import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

/** Parse a `host:port` string, applying a default port when omitted. */
export function parseAddress(address: string, defaultPort = 22124): { host: string; port: number } {
  const trimmed = address.trim();
  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon === -1) {
    return { host: trimmed, port: defaultPort };
  }
  const host = trimmed.slice(0, lastColon).replace(/^\[|\]$/g, '');
  const port = Number.parseInt(trimmed.slice(lastColon + 1), 10);
  return { host, port: Number.isFinite(port) ? port : defaultPort };
}

/** Minimal `.env` loader: `KEY=VALUE` lines, `#` comments, optional quotes. */
function loadEnvFile(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return result;
  }
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const equals = line.indexOf('=');
    if (equals === -1) {
      continue;
    }
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export interface ServerConfig {
  /** Jamulus server `host:port` the bridge connects to. */
  serverAddress: string;
  /** TCP port the web server (HTTP + WebSocket) listens on. */
  httpPort: number;
  /** WebSocket path the browser connects to. */
  wsPath: string;
  /** Base display name sent to the Jamulus server. */
  clientName: string;
  /** Audio channels per session (1 = mono). */
  channels: number;
  /** Audio frame size in samples (128 for the standard OPUS codec). */
  frameSamples: number;
  /** Jitter buffer size (in blocks) requested from the server. */
  jitterBlocks: number;
  /** Busy-spin window in nanoseconds used to sharpen the frame clock. */
  spinNs: number;
  /** Maximum concurrent Jamulus sessions. */
  maxSessions: number;
}

/** Load configuration from the repo-root `.env`, with process env overrides. */
export function loadConfig(): ServerConfig {
  const env = { ...loadEnvFile(resolve(repoRoot, '.env')), ...process.env };

  return {
    serverAddress: env.SERVER_ADDRESS?.trim() || 'anygenre1.jamulus.app:22124',
    httpPort: Number.parseInt(env.HTTP_PORT ?? '8080', 10),
    wsPath: env.WS_PATH?.trim() || '/ws',
    clientName: env.CLIENT_NAME?.trim() || 'Web Client',
    channels: Number.parseInt(env.CHANNELS ?? '1', 10),
    frameSamples: Number.parseInt(env.FRAME_SAMPLES ?? '128', 10),
    jitterBlocks: Number.parseInt(env.JITTER_BLOCKS ?? '3', 10),
    spinNs: Number.parseInt(env.SPIN_NS ?? '500000', 10),
    maxSessions: Number.parseInt(env.MAX_SESSIONS ?? '8', 10),
  };
}

export const paths = { repoRoot };

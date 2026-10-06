/**
 * Phase 0 spike: prove that the bridge can join the real Jamulus server using
 * raw (uncompressed) audio, and measure frame-clock jitter.
 *
 * Usage:  node scripts/spike.ts [seconds]
 *
 * Writes the received downlink mix to `spike-output.wav` so the audio can be
 * verified by ear. This script is intentionally listen-only: it never sends
 * microphone data.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, parseAddress, paths } from '../apps/server/src/config.ts';
import { JamulusClient } from '../apps/server/src/jamulus/client.ts';

const durationSeconds = Number.parseInt(process.argv[2] ?? '10', 10);
const config = loadConfig();
const override = process.argv[3];
const { host, port } = parseAddress(override ?? config.serverAddress);

console.log('Jamulus web bridge — Phase 0 spike');
console.log(`  server      : ${host}:${port}`);
console.log(`  name        : ${config.clientName}`);
console.log(`  frame size  : ${config.frameSamples} samples (${48000 / config.frameSamples} pps)`);
console.log(`  duration    : ${durationSeconds}s`);
console.log('');

const client = new JamulusClient({
  host,
  port,
  name: `${config.clientName} (spike)`,
  jitterBlocks: config.jitterBlocks,
  spinNs: config.spinNs,
  debug: process.env.DEBUG === '1',
});

const chunks: Buffer[] = [];
let audioBytes = 0;
let usersSeen = 0;
let ping = 0;
let finished = false;

client.on('connected', (info) => {
  console.log(`[connected] channel=${info.channelId} rawAudio=${info.rawAudio}`);
});
client.on('serverVersion', (info) => {
  console.log(`[server] version=${info.version} os=${info.os}`);
});
client.on('chat', (text) => {
  console.log(`[chat] ${stripHtml(text)}`);
});
client.on('users', (users) => {
  usersSeen = users.length;
  console.log(`[users] ${users.map((u) => u.name || `#${u.channelId}`).join(', ') || '(none)'}`);
});
client.on('licenceRequired', (type) => {
  console.log(`[licence] server requires a licence (type ${type})`);
});
client.on('ping', (rtt) => {
  ping = rtt;
});
client.on('serverJitterBuffer', (blocks) => {
  console.log(`[jitter] server buffer = ${blocks} block(s)`);
});
client.on('audio', (buffer: Buffer) => {
  audioBytes += buffer.length;
  chunks.push(buffer);
});
client.on('stats', (stats) => {
  console.log(
    `[stats] frames=${stats.framesSent} underruns=${stats.underruns} ` +
      `buffer=${stats.uplinkBuffer} lateness p50=${nsToMs(stats.latenessP50Ns)}ms ` +
      `p99=${nsToMs(stats.latenessP99Ns)}ms max=${nsToMs(stats.latenessMaxNs)}ms`,
  );
});
client.on('disconnected', ({ reason }) => {
  console.log(`[disconnected] ${reason}`);
});
client.on('debug', (line: string) => {
  console.log(`[debug] ${line}`);
});
client.on('error', (error) => {
  console.error(`[error] ${error.message}`);
});

function nsToMs(ns: number): string {
  return (ns / 1e6).toFixed(2);
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}

function writeWav(path: string, pcm: Buffer): void {
  const header = Buffer.alloc(44);
  const dataLength = pcm.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(48000, 24);
  header.writeUInt32LE(48000 * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  writeFileSync(path, Buffer.concat([header, pcm]));
}

async function main(): Promise<void> {
  await client.start();
  console.log('Started; waiting for handshake...\n');

  await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1000));
  finished = true;
  await client.stop('spike finished');

  const pcm = Buffer.concat(chunks);
  const wavPath = resolve(paths.repoRoot, 'spike-output.wav');
  writeWav(wavPath, pcm);

  console.log('');
  console.log('Result');
  console.log(`  audio received : ${audioBytes} bytes (~${(audioBytes / 2 / 48000).toFixed(2)}s)`);
  console.log(`  users seen     : ${usersSeen}`);
  console.log(`  last ping      : ${ping}ms`);
  console.log(`  wav written to : ${wavPath}`);
  console.log(audioBytes > 0 ? '  PASS — audio flowed' : '  FAIL — no audio received');
}

process.on('SIGINT', () => {
  void client.stop('SIGINT').then(() => process.exit(0));
});

main().catch((error: unknown) => {
  if (!finished) {
    console.error(error);
  }
  process.exit(1);
});

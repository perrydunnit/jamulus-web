/**
 * Connectivity diagnostics for a Jamulus server.
 *
 * Reports A/AAAA records, then sends a connection-less ping over IPv4 and (when
 * available) IPv6, printing any reply. Useful when a specific host does not
 * respond even though other Jamulus servers do.
 *
 * Usage: node scripts/diag.ts [host] [port]
 */
import dgram from 'node:dgram';
import { lookup } from 'node:dns/promises';
import { decodeMessage, encodeMessage, ConnectionLessMessageId } from '../packages/protocol/src/index.ts';

const host = process.argv[2] ?? 'jamulus.perry.party';
const port = Number.parseInt(process.argv[3] ?? '22124', 10);

async function resolve(host: string, family: 4 | 6): Promise<string[]> {
  try {
    const records = await lookup(host, { all: true, family });
    return records.map((r) => r.address);
  } catch {
    return [];
  }
}

function ping(family: 4 | 6, address: string): Promise<string> {
  return new Promise((resolve) => {
    const type = family === 4 ? 'udp4' : 'udp6';
    const socket = dgram.createSocket(type);
    let done = false;
    const finish = (result: string): void => {
      if (done) return;
      done = true;
      try {
        socket.close();
      } catch {
        // ignore
      }
      resolve(result);
    };

    socket.on('error', (error) => finish(`error: ${error.message}`));
    socket.on('message', (message, remote) => {
      const decoded = decodeMessage(message);
      finish(
        `reply from ${remote.address}:${remote.port} (${message.length} bytes` +
          (decoded ? `, id=${decoded.id}` : '') +
          ')',
      );
    });

    socket.bind(family === 4 ? 0 : 0, () => {
      const frame = Buffer.from(
        encodeMessage(0, ConnectionLessMessageId.PingMs, Buffer.from([0xab, 0xcd, 0x00, 0x00])),
      );
      socket.send(frame, port, address, (error) => {
        if (error) finish(`send error: ${error.message}`);
      });
    });

    setTimeout(() => finish('no reply (2500 ms)'), 2500);
  });
}

const v4 = await resolve(host, 4);
const v6 = await resolve(host, 6);
console.log(`${host}`);
console.log(`  A    : ${v4.length > 0 ? v4.join(', ') : '(none)'}`);
console.log(`  AAAA : ${v6.length > 0 ? v6.join(', ') : '(none)'}`);
console.log(`  port : ${port}/udp`);
console.log('');

for (const address of v4) {
  console.log(`  IPv4 ${address} -> ${await ping(4, address)}`);
}
if (v6.length === 0) {
  console.log('  IPv6 (skipped — no AAAA record)');
}
for (const address of v6) {
  console.log(`  IPv6 ${address} -> ${await ping(6, address)}`);
}

process.exit(0);

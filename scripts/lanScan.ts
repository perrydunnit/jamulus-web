/**
 * Scan a /24 subnet for Jamulus servers.
 *
 * Sends a connection-less ping to every host on the subnet and prints the ones
 * that answer. Handy for finding a server's LAN address when the public
 * hostname cannot be reached from inside the network (no NAT loopback).
 *
 * Usage: node scripts/lanScan.ts [subnetPrefix] [port]
 *        node scripts/lanScan.ts 192.168.0 22124
 */
import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { decodeMessage, encodeMessage, ConnectionLessMessageId } from '../packages/protocol/src/index.ts';

const prefix = process.argv[2] ?? '192.168.0';
const port = Number.parseInt(process.argv[3] ?? '22124', 10);

const frame = Buffer.from(
  encodeMessage(0, ConnectionLessMessageId.PingMs, Buffer.from([0x77, 0x77, 0x00, 0x00])),
);

const responders = new Map<string, number>();
const socket = dgram.createSocket('udp4');

socket.on('message', (message, remote) => {
  const decoded = decodeMessage(message);
  if (decoded && decoded.id === ConnectionLessMessageId.PingMs) {
    responders.set(remote.address, decoded.data.length);
  }
});

socket.bind(0, () => {
  socket.setBroadcast(false);
  for (let host = 1; host <= 254; host++) {
    socket.send(frame, port, `${prefix}.${host}`);
  }
});

setTimeout(() => {
  const local = Object.values(networkInterfaces())
    .flat()
    .filter((info) => info && info.family === 'IPv4' && !info.internal)
    .map((info) => info!.address);

  console.log(`Scanning ${prefix}.1-254 on ${port}/udp (local addresses: ${local.join(', ') || 'none'})`);
  if (responders.size === 0) {
    console.log('  no Jamulus servers replied on this subnet');
  } else {
    for (const [address, _] of responders) {
      console.log(`  ⮕ Jamulus server at ${address}:${port}`);
    }
  }
  socket.close();
  process.exit(0);
}, 1500);

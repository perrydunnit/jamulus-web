/**
 * Connectivity probe: send a Jamulus connection-less ping to one or more
 * servers and report any reply. Used to distinguish "outbound UDP is blocked"
 * from "the handshake is wrong".
 *
 * Usage: node scripts/probe.ts [host:port ...]
 */
import dgram from 'node:dgram';
import { decodeMessage, encodeMessage, ConnectionLessMessageId } from '../packages/protocol/src/index.ts';

const defaultTargets = [
  'anygenre1.jamulus.app:22124',
  'anygenre2.jamulus.app:22224',
  'jamulus.perry.party:22124',
];

const targets = process.argv.slice(2);
const list = targets.length > 0 ? targets : defaultTargets;

async function probe(target: string): Promise<void> {
  const [host, portText] = target.split(':');
  const port = Number.parseInt(portText ?? '22124', 10);

  await new Promise<void>((resolve) => {
    const socket = dgram.createSocket('udp4');
    let replied = false;

    socket.on('error', (error) => {
      console.log(`${target} -> socket error: ${error.message}`);
      resolve();
    });

    socket.on('message', (message, remote) => {
      replied = true;
      const decoded = decodeMessage(message);
      console.log(
        `${target} <- ${message.length} bytes from ${remote.address}:${remote.port} ` +
          (decoded
            ? `id=${decoded.id} data=${Buffer.from(decoded.data).toString('hex')}`
            : `raw=${message.toString('hex')}`),
      );
      socket.close();
      resolve();
    });

    socket.bind(0, () => {
      const frame = Buffer.from(encodeMessage(0, ConnectionLessMessageId.PingMs, Buffer.from([1, 0, 0, 0])));
      socket.send(frame, port, host, (error) => {
        if (error) {
          console.log(`${target} -> send error: ${error.message}`);
        }
      });
    });

    setTimeout(() => {
      if (!replied) {
        console.log(`${target} -> no reply`);
        socket.close();
        resolve();
      }
    }, 2500);
  });
}

for (const target of list) {
  await probe(target);
}
process.exit(0);

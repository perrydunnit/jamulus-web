/**
 * End-to-end smoke test for the WebSocket bridge.
 *
 * Connects to the bridge, asks it to join the configured Jamulus server, and
 * prints the state/users/metrics messages it receives. Also reports how many
 * downlink audio bytes arrived.
 *
 * Usage: node scripts/wsSmoke.ts [ws://127.0.0.1:8080/ws] [seconds]
 */
import { WebSocket } from 'ws';

const url = process.argv[2] ?? 'ws://127.0.0.1:8080/ws';
const seconds = Number.parseInt(process.argv[3] ?? '5', 10);

const socket = new WebSocket(url);
let audioBytes = 0;
let audioFrames = 0;
let sawConnected = false;

socket.on('open', () => {
  console.log(`[ws] connected to ${url}`);
  socket.send(JSON.stringify({ type: 'join', name: 'WS Smoke Test' }));
});

socket.on('message', (data: Buffer, isBinary: boolean) => {
  if (isBinary) {
    audioBytes += data.length;
    audioFrames++;
    return;
  }
  console.log('[ws]', data.toString('utf8'));
  try {
    const message = JSON.parse(data.toString('utf8')) as { type?: string; state?: string };
    if (message.type === 'state' && message.state === 'connected') {
      sawConnected = true;
    }
  } catch {
    // ignore
  }
});

socket.on('error', (error) => console.log('[ws] error:', error.message));
socket.on('close', () => console.log('[ws] closed'));

setTimeout(() => {
  console.log('');
  console.log('Summary');
  console.log(`  reached connected state : ${sawConnected}`);
  console.log(`  downlink audio frames   : ${audioFrames} (${audioBytes} bytes)`);
  socket.send(JSON.stringify({ type: 'leave' }));
  setTimeout(() => {
    socket.close();
    process.exit(0);
  }, 300);
}, seconds * 1000);

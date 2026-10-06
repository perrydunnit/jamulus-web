/**
 * HTTP + WebSocket bridge server.
 *
 * Serves the built Angular app (when present) and a WebSocket endpoint that
 * maps each browser connection to a Jamulus channel via `BridgeSession`.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { WebSocketServer } from 'ws';
import { loadConfig, paths } from './config.ts';
import { BridgeSession } from './session.ts';

const config = loadConfig();
const app = Fastify({ logger: { level: 'info' } });

app.get('/health', async () => ({ status: 'ok' }));
app.get('/api/config', async () => ({ server: config.serverAddress, wsPath: config.wsPath }));

// Serve the built Angular application when it exists (production mode).
const webDist = resolve(paths.repoRoot, 'apps', 'web', 'dist', 'web', 'browser');
if (existsSync(webDist)) {
  const fastifyStatic = (await import('@fastify/static')).default;
  await app.register(fastifyStatic, { root: webDist, wildcard: false });
  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith('/api') || request.raw.url?.startsWith(config.wsPath)) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.sendFile('index.html');
  });
  app.log.info(`serving web app from ${webDist}`);
}

await app.listen({ port: config.httpPort, host: '0.0.0.0' });

const wss = new WebSocketServer({ noServer: true });
const sessions = new Set<BridgeSession>();

app.server.on('upgrade', (request, socket, head) => {
  const path = (request.url ?? '/').split('?')[0];
  if (path !== config.wsPath) {
    socket.destroy();
    return;
  }
  if (sessions.size >= config.maxSessions) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws) => {
  const session = new BridgeSession(ws, config);
  sessions.add(session);
  ws.on('close', () => {
    sessions.delete(session);
    void session.dispose();
  });
});

const metricsTimer = setInterval(() => {
  for (const session of sessions) {
    session.pushMetrics();
  }
}, 500);

const shutdown = async (): Promise<void> => {
  clearInterval(metricsTimer);
  await Promise.all([...sessions].map((session) => session.dispose()));
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

app.log.info(
  `Jamulus bridge ready — target ${config.serverAddress}, ws path ${config.wsPath}, ` +
    `http port ${config.httpPort}`,
);

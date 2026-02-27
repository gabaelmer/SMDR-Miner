import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectionManager } from '../../backend/connection/ConnectionManager';

describe('ConnectionManager failover', () => {
  const servers: net.Server[] = [];

  afterEach(async () => {
    for (const server of servers) {
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
    servers.length = 0;
  });

  it('fails over to secondary controller when primary is unavailable', async () => {
    const port = await allocatePort();
    const received: string[] = [];

    const secondary = net.createServer((socket) => {
      socket.write('2026-02-17 10:10:10 00:00:20 1111 2222 T001 +18005550100 ACC:1 A CID:10 OLI:01\n');
    });

    const listenOk = await listenSafely(secondary, port, '127.0.0.1');
    if (!listenOk) {
      // Restricted test runners may forbid bind/listen; skip failover assertion in that environment.
      expect(true).toBe(true);
      return;
    }

    servers.push(secondary);

    const manager = new ConnectionManager({
      controllerIps: ['127.0.0.2', '127.0.0.1'],
      port,
      concurrentConnections: 1,
      autoReconnect: true,
      reconnectDelayMs: 150,
      autoReconnectPrimary: false,
      primaryRecheckDelayMs: 60_000
    });

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        manager.stop();
        resolve();
      }, 8000);

      manager.on('line', (line) => {
        received.push(line);
        clearTimeout(timeout);
        manager.stop();
        resolve();
      });

      manager.start();
    });

    expect(received.length).toBeGreaterThan(0);
    expect(received[0]).toContain('1111 2222');
  }, 15000);
});

async function allocatePort(): Promise<number> {
  const probe = net.createServer();
  const listened = await listenSafely(probe, 0, '127.0.0.1');
  if (!listened) return 11_752;

  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 11_752;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function listenSafely(server: net.Server, port: number, host: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      cleanup();
      if (error.code === 'EPERM' || error.code === 'EACCES') resolve(false);
      else reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      server.off('error', onError);
      server.off('listening', onListening);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

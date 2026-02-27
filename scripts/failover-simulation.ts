import net from 'node:net';
import { ConnectionManager } from '../backend/connection/ConnectionManager';

const PORT = 1752;

const primaryServer = net.createServer((socket) => {
  socket.write('2026-02-17 12:00:00 00:00:10 1001 2002 T001 +18005550100 ACC:123 A CID:100 SEQ:1 OLI:01\n');
  setTimeout(() => socket.destroy(), 1200);
});

const secondaryServer = net.createServer((socket) => {
  socket.write('2026-02-17 12:00:01 00:00:11 1002 2003 X101 +18005550101 ACC:124 A CID:101 SEQ:2 OLI:01\n');
});

primaryServer.listen(PORT, '127.0.0.1', () => {
  secondaryServer.listen(PORT, '127.0.0.2', () => {
    console.log('Failover simulation servers ready on 127.0.0.1 and 127.0.0.2');

    const cm = new ConnectionManager({
      controllerIps: ['127.0.0.1', '127.0.0.2'],
      port: PORT,
      concurrentConnections: 1,
      autoReconnect: true,
      reconnectDelayMs: 500,
      autoReconnectPrimary: false,
      primaryRecheckDelayMs: 60_000
    });

    cm.on('status', (status) => console.log('status:', status));
    cm.on('event', (event) => console.log('event:', event.message));
    cm.on('line', (line) => console.log('line:', line));

    cm.start();

    setTimeout(() => {
      cm.stop();
      primaryServer.close();
      secondaryServer.close();
      process.exit(0);
    }, 6000);
  });
});

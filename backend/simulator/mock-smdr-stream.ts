import net from 'node:net';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 1752);
const maxClients = 10;
const intervalMs = Number(process.env.INTERVAL_MS ?? 250);

const clients = new Set<net.Socket>();

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(items: T[]): T {
  return items[randomInt(0, items.length - 1)];
}

function buildRecordLine(): string {
  const date = new Date().toISOString().slice(0, 10);
  const hour = randomInt(0, 23).toString().padStart(2, '0');
  const min = randomInt(0, 59).toString().padStart(2, '0');
  const sec = randomInt(0, 59).toString().padStart(2, '0');
  const start = `${hour}:${min}:${sec}`;

  const durMin = randomInt(0, 59).toString().padStart(2, '0');
  const durSec = randomInt(1, 59).toString().padStart(2, '0');
  const duration = `${randomInt(0, 1)}:${durMin}:${durSec}`;

  const from = String(randomInt(1000, 8999));
  const to = String(randomInt(1000, 8999));
  const trunk = randomChoice(['T001', 'X112', '']);
  const completion = randomChoice(['A', 'B', 'E', 'T', 'I', 'O', 'D', 'S', 'U']);
  const transfer = randomChoice(['T', 'X', 'C', '']);
  const callId = `CID:${Date.now()}${randomInt(10, 99)}`;
  const seq = `SEQ:${randomInt(1000, 99999)}`;
  const assoc = `ACID:${randomInt(1000, 99999)}`;
  const oli = `OLI:${randomChoice(['01', '02', '06', '27'])}`;
  const acct = `ACC:${randomInt(100000, 999999)}`;
  const digits = `+1${randomInt(2000000000, 9999999999)}`;

  return [date, start, duration, from, to, trunk, digits, acct, completion, transfer, callId, seq, assoc, oli]
    .filter(Boolean)
    .join(' ');
}

const server = net.createServer((socket) => {
  if (clients.size >= maxClients) {
    socket.write('ERR max connections reached\n');
    socket.destroy();
    return;
  }

  clients.add(socket);
  socket.write('# mock-smdr-stream connected\n');

  socket.on('close', () => {
    clients.delete(socket);
  });

  socket.on('error', () => {
    clients.delete(socket);
  });
});

server.listen(port, host, () => {
  console.log(`Mock SMDR stream server listening on ${host}:${port}`);
});

const timer = setInterval(() => {
  const line = `${buildRecordLine()}\n`;
  for (const client of clients) {
    client.write(line);
  }
}, intervalMs);

process.on('SIGINT', () => {
  clearInterval(timer);
  for (const client of clients) client.destroy();
  server.close(() => process.exit(0));
});

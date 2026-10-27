import { createConnection, createServer, type AddressInfo, type Socket } from 'node:net';

// TEST-ONLY. A TCP proxy in front of the test database that delays every chunk
// by `oneWayMs` in each direction, so a round trip costs 2 x oneWayMs: the
// Cloudflare colo to eu-west-1 hop the go-live functional test measured the
// daily-cap lock under (fix round 2, F1). Timers of one delay fire in order, so
// the byte stream is never reordered.

function relayWithDelay(from: Socket, to: Socket, oneWayMs: number): void {
  from.on('data', (chunk) => setTimeout(() => to.write(chunk), oneWayMs));
  from.on('end', () => setTimeout(() => to.end(), oneWayMs));
  from.on('error', () => to.destroy());
}

export interface LatencyProxy {
  /** `databaseUrl` with its host and port replaced by the proxy's. */
  url: string;
  close: () => Promise<void>;
}

export async function startLatencyProxy(databaseUrl: string, oneWayMs: number): Promise<LatencyProxy> {
  const target = new URL(databaseUrl);
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    const upstream = createConnection({ host: target.hostname, port: Number(target.port || 5432) });
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    }
    relayWithDelay(client, upstream, oneWayMs);
    relayWithDelay(upstream, client, oneWayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const proxied = new URL(databaseUrl);
  proxied.hostname = '127.0.0.1';
  proxied.port = String((server.address() as AddressInfo).port);
  return {
    url: proxied.toString(),
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

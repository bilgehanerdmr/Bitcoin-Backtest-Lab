import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import type { Socket } from 'node:net';
import { createBinanceFeed, type CandleFeed } from '../server/paper-feed';

// Just enough of RFC 6455 to stand in for Binance: the upgrade handshake and unmasked text
// frames. The client is Node's real WebSocket, which the feed uses in production.
function streamServer() {
  const clients = new Set<Socket>(),
    paths: string[] = [],
    server = createServer();
  server.on('upgrade', (req, socket: Socket) => {
    paths.push(req.url!);
    const accept = createHash('sha1')
      .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on('error', () => {});
    socket.on('close', () => clients.delete(socket));
    clients.add(socket);
  });
  return {
    server,
    paths,
    clients,
    send(text: string) {
      const data = Buffer.from(text),
        header =
          data.length < 126
            ? Buffer.from([0x81, data.length])
            : Buffer.from([0x81, 126, data.length >> 8, data.length & 255]);
      for (const c of clients) c.write(Buffer.concat([header, data]));
    },
    drop() {
      for (const c of clients) c.destroy();
    },
  };
}
// A combined-stream kline message with every field Binance sends.
const kline = (closed: boolean) =>
  JSON.stringify({
    stream: 'btcusdt@kline_1m',
    data: {
      e: 'kline',
      E: 1760620079999,
      s: 'BTCUSDT',
      k: {
        t: 1760620020000,
        T: 1760620079999,
        s: 'BTCUSDT',
        i: '1m',
        f: 5300000001,
        L: 5300000999,
        o: '108123.45000000',
        c: '108150.01000000',
        h: '108199.99000000',
        l: '108100.00000000',
        v: '12.34567000',
        n: 999,
        x: closed,
        q: '1335000.12345678',
        V: '6.00000000',
        Q: '649000.00000000',
        B: '0',
      },
    },
  });
let feed: CandleFeed | undefined, stream: ReturnType<typeof streamServer> | undefined;
afterEach(async () => {
  feed?.close();
  // Upgraded sockets keep the HTTP server open; this stand-in never answers close frames.
  stream?.drop();
  await new Promise((resolve) => (stream ? stream.server.close(resolve) : resolve(null)));
  feed = stream = undefined;
});

describe('Binance feed over a real WebSocket connection', () => {
  it('parses closed klines, and reconnects and catches up after the server drops it', async () => {
    const server = (stream = streamServer());
    await new Promise<void>((resolve) => server.server.listen(0, '127.0.0.1', resolve));
    const { port } = server.server.address() as { port: number },
      onCandle = vi.fn(),
      onConnect = vi.fn();
    feed = createBinanceFeed(
      onCandle,
      onConnect,
      (url) =>
        new WebSocket(
          url.replace('wss://data-stream.binance.vision', `ws://127.0.0.1:${port}`),
        ) as never,
    );
    feed.watch(['1m']);
    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledTimes(1));
    expect(feed.status()).toBe('live');
    expect(server.paths).toEqual(['/stream?streams=btcusdt@kline_1m']);
    server.send(kline(false));
    server.send(kline(true));
    await vi.waitFor(() => expect(onCandle).toHaveBeenCalledTimes(1));
    expect(onCandle).toHaveBeenCalledWith('1m', {
      time: 1760620020,
      open: 108123.45,
      high: 108199.99,
      low: 108100,
      close: 108150.01,
      volume: 12.34567,
    });
    server.drop();
    await vi.waitFor(() => expect(feed!.status()).toBe('reconnecting'));
    // First retry after one second, then the caller is asked to fill the gap over REST.
    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(feed.status()).toBe('live');
    expect(server.paths).toHaveLength(2);
  });
});

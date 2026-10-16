import { createHash } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';

export interface StreamClient {
  path: string;
  send(text: string): void;
  closed(): boolean;
}
// Just enough of RFC 6455 to stand in for Binance's market streams: the upgrade handshake and
// unmasked text frames from server to client. Clients only ever close; their frames are ignored.
export function acceptStreams(server: Server, onClient?: (client: StreamClient) => void) {
  const clients = new Set<Socket>(),
    paths: string[] = [];
  server.on('upgrade', (req: IncomingMessage, socket: Socket) => {
    paths.push(req.url!);
    const accept = createHash('sha1')
      .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on('error', () => {});
    socket.on('close', () => clients.delete(socket));
    // A close frame from the client (opcode 8) ends the connection.
    socket.on('data', (data: Buffer) => {
      if ((data[0] & 0x0f) === 8) socket.destroy();
    });
    clients.add(socket);
    onClient?.({
      path: req.url!,
      send: (text) => write(socket, text),
      closed: () => socket.destroyed,
    });
  });
  const write = (socket: Socket, text: string) => {
    if (socket.destroyed) return;
    const data = Buffer.from(text),
      header =
        data.length < 126
          ? Buffer.from([0x81, data.length])
          : Buffer.from([0x81, 126, data.length >> 8, data.length & 255]);
    socket.write(Buffer.concat([header, data]));
  };
  return {
    paths,
    clients,
    send(text: string) {
      for (const c of clients) write(c, text);
    },
    drop() {
      for (const c of clients) c.destroy();
    },
  };
}

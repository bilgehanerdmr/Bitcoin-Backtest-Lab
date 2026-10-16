// A local stand-in for Binance's public market data, used by the browser tests so they run
// offline against the application's real Binance code paths. Prices come from a formula of
// time alone: the same candle always has the same values, and only closed candles are served.
import { createServer } from 'node:http';
import { acceptStreams, type StreamClient } from './stream-server';
import { intervals, type Interval } from '../../shared/types';

const port = Number(process.env.FAKE_BINANCE_PORT || 3109);
const noise = (t: number) => {
  const x = Math.sin(t * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};
// Each pair gets its own price level; BTCUSDT trades around 40,000.
const level = (symbol: string) =>
  symbol === 'BTCUSDT'
    ? 40000
    : 1 + ([...symbol].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 9973, 7) % 5000);
const price = (symbol: string, t: number) =>
  level(symbol) *
  (1 + 0.03 * Math.sin((t / 86400) * 1.3) + 0.008 * Math.sin(t / 10800) + (noise(t) - 0.5) * 0.003);
function candle(symbol: string, t: number, step: number) {
  const open = price(symbol, t),
    close = price(symbol, t + step),
    high = Math.max(open, close) * (1 + noise(t + 1) * 0.001),
    low = Math.min(open, close) * (1 - noise(t + 2) * 0.001);
  return { time: t, open, high, low, close, volume: 5 + noise(t + 3) * 20 };
}
const fixed = (n: number) => n.toFixed(2);
const row = (symbol: string, t: number, step: number) => {
  const c = candle(symbol, t, step);
  return [
    t * 1000,
    fixed(c.open),
    fixed(c.high),
    fixed(c.low),
    fixed(c.close),
    c.volume.toFixed(5),
    (t + step) * 1000 - 1,
  ];
};
const kline = (symbol: string, interval: Interval, t: number, closed: boolean) => {
  const step = intervals[interval],
    c = candle(symbol, t, step);
  return {
    stream: `${symbol.toLowerCase()}@kline_${interval}`,
    data: {
      e: 'kline',
      E: Date.now(),
      s: symbol,
      k: {
        t: t * 1000,
        T: (t + step) * 1000 - 1,
        s: symbol,
        i: interval,
        o: fixed(c.open),
        h: fixed(c.high),
        l: fixed(c.low),
        c: fixed(c.close),
        v: c.volume.toFixed(5),
        x: closed,
      },
    },
  };
};
function ticker(symbol: string) {
  const now = Math.floor(Date.now() / 60000) * 60,
    day = Array.from({ length: 1440 }, (_, i) => candle(symbol, now - (1440 - i) * 60, 60)),
    last = day.at(-1)!;
  return {
    symbol,
    lastPrice: fixed(last.close),
    priceChangePercent: ((last.close / day[0].open - 1) * 100).toFixed(3),
    highPrice: fixed(Math.max(...day.map((c) => c.high))),
    lowPrice: fixed(Math.min(...day.map((c) => c.low))),
    volume: day.reduce((s, c) => s + c.volume, 0).toFixed(5),
    quoteVolume: day.reduce((s, c) => s + c.volume * c.close, 0).toFixed(2),
  };
}
const server = createServer((req, res) => {
  const url = new URL(req.url!, 'http://localhost'),
    q = url.searchParams,
    symbol = q.get('symbol') ?? 'BTCUSDT',
    json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
  if (url.pathname === '/api/v3/ping') return json(200, {});
  if (url.pathname === '/api/v3/ticker/24hr') return json(200, ticker(symbol));
  if (url.pathname === '/api/v3/klines') {
    const interval = q.get('interval') as Interval;
    if (!Object.hasOwn(intervals, interval)) return json(400, { msg: 'Invalid interval.' });
    const step = intervals[interval],
      limit = Math.min(Number(q.get('limit') || 500), 1000),
      first = Math.ceil(Number(q.get('startTime')) / 1000 / step) * step,
      closed = Math.floor(Date.now() / 1000 / step) * step - step,
      rows = [];
    for (let t = first; t <= closed && rows.length < limit; t += step)
      rows.push(row(symbol, t, step));
    return json(200, rows);
  }
  json(404, { msg: 'Not found.' });
});
// Each stream gets the forming candle every second and the closed one when a candle ends.
const subscribers = new Map<StreamClient, { streams: string[]; sent: Map<string, number> }>();
acceptStreams(server, (client) => {
  const streams = (
    new URL(client.path, 'http://localhost').searchParams.get('streams') ?? ''
  ).split('/');
  subscribers.set(client, { streams, sent: new Map() });
});
setInterval(() => {
  const now = Date.now() / 1000;
  for (const [client, { streams, sent }] of subscribers) {
    if (client.closed()) {
      subscribers.delete(client);
      continue;
    }
    for (const stream of streams) {
      const [pair, kind] = stream.split('@'),
        symbol = pair.toUpperCase();
      if (kind === 'ticker') {
        const t = ticker(symbol);
        client.send(
          JSON.stringify({
            stream,
            data: {
              e: '24hrTicker',
              c: t.lastPrice,
              P: t.priceChangePercent,
              h: t.highPrice,
              l: t.lowPrice,
              q: t.quoteVolume,
              v: t.volume,
            },
          }),
        );
      }
      if (!kind?.startsWith('kline_')) continue;
      const interval = kind.slice(6) as Interval,
        step = intervals[interval],
        open = Math.floor(now / step) * step,
        last = sent.get(stream) ?? open - step;
      for (let t = last + step; t < open; t += step)
        client.send(JSON.stringify(kline(symbol, interval, t, true)));
      sent.set(stream, open - step);
      client.send(JSON.stringify(kline(symbol, interval, open, false)));
    }
  }
}, 1000);
server.listen(port, '127.0.0.1', () => console.log(`Fake Binance: http://127.0.0.1:${port}`));

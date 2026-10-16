import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBinanceFeed, type FeedSocket } from '../server/paper-feed';

class FakeSocket implements FeedSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
  kline(closed: boolean, t = 1704067200000) {
    this.onmessage?.({
      data: JSON.stringify({
        stream: 'btcusdt@kline_1m',
        data: {
          e: 'kline',
          k: {
            t,
            s: 'BTCUSDT',
            i: '1m',
            o: '100',
            h: '102',
            l: '99',
            c: '101',
            v: '3.5',
            x: closed,
          },
        },
      }),
    });
  }
}
let sockets: FakeSocket[];
const open = (url: string) => {
  const socket = new FakeSocket(url);
  sockets.push(socket);
  return socket;
};
beforeEach(() => {
  sockets = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('Binance kline feed', () => {
  it('passes on only closed candles from one combined stream', () => {
    const onCandle = vi.fn(),
      feed = createBinanceFeed(onCandle, () => {}, open);
    feed.watch([
      { symbol: 'BTCUSDT', interval: '5m' },
      { symbol: 'BTCUSDT', interval: '1m' },
      { symbol: 'BTCUSDT', interval: '1m' },
    ]);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe(
      'wss://data-stream.binance.vision/stream?streams=btcusdt@kline_1m/btcusdt@kline_5m',
    );
    sockets[0].onopen!();
    expect(feed.status()).toBe('live');
    sockets[0].kline(false);
    sockets[0].onmessage!({ data: 'not json' });
    sockets[0].kline(true);
    expect(onCandle.mock.calls).toEqual([
      [
        'BTCUSDT',
        '1m',
        { time: 1704067200, open: 100, high: 102, low: 99, close: 101, volume: 3.5 },
      ],
    ]);
    feed.watch([
      { symbol: 'BTCUSDT', interval: '1m' },
      { symbol: 'BTCUSDT', interval: '5m' },
    ]);
    expect(sockets).toHaveLength(1);
    feed.close();
  });
  it('subscribes to every pair in one stream and passes on the pair of each candle', () => {
    const onCandle = vi.fn(),
      feed = createBinanceFeed(onCandle, () => {}, open);
    feed.watch([
      { symbol: 'ETHUSDT', interval: '1m' },
      { symbol: 'BTCUSDT', interval: '1m' },
    ]);
    expect(sockets[0].url).toBe(
      'wss://data-stream.binance.vision/stream?streams=btcusdt@kline_1m/ethusdt@kline_1m',
    );
    const message = (s: string) =>
      sockets[0].onmessage!({
        data: JSON.stringify({
          data: {
            e: 'kline',
            k: { t: 0, s, i: '1m', o: '2', h: '3', l: '1', c: '2', v: '9', x: true },
          },
        }),
      });
    message('ETHUSDT');
    message('ETHBTC');
    expect(onCandle.mock.calls).toEqual([
      ['ETHUSDT', '1m', { time: 0, open: 2, high: 3, low: 1, close: 2, volume: 9 }],
    ]);
    feed.close();
  });
  it('reconnects with growing delays and asks for a REST catch-up on every connect', () => {
    const onConnect = vi.fn(),
      feed = createBinanceFeed(() => {}, onConnect, open);
    feed.watch([{ symbol: 'BTCUSDT', interval: '1m' }]);
    sockets[0].onopen!();
    expect(onConnect).toHaveBeenCalledTimes(1);
    sockets[0].close();
    expect(feed.status()).toBe('reconnecting');
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1].close();
    vi.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    sockets[2].onopen!();
    expect(onConnect).toHaveBeenCalledTimes(2);
    expect(feed.status()).toBe('live');
    feed.close();
    expect(sockets[2].closed).toBe(true);
    vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(3);
  });
  it('drops a socket that has gone silent and reconnects', () => {
    const feed = createBinanceFeed(
      () => {},
      () => {},
      open,
    );
    feed.watch([{ symbol: 'BTCUSDT', interval: '1h' }]);
    sockets[0].onopen!();
    vi.advanceTimersByTime(45000);
    sockets[0].kline(false);
    vi.advanceTimersByTime(45000);
    expect(sockets[0].closed).toBe(false);
    vi.advanceTimersByTime(30000);
    expect(sockets[0].closed).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    feed.close();
  });
});

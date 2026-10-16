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
          k: { t, i: '1m', o: '100', h: '102', l: '99', c: '101', v: '3.5', x: closed },
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
    feed.watch(['5m', '1m', '1m']);
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
      ['1m', { time: 1704067200, open: 100, high: 102, low: 99, close: 101, volume: 3.5 }],
    ]);
    feed.watch(['1m', '5m']);
    expect(sockets).toHaveLength(1);
    feed.close();
  });
  it('reconnects with growing delays and asks for a REST catch-up on every connect', () => {
    const onConnect = vi.fn(),
      feed = createBinanceFeed(() => {}, onConnect, open);
    feed.watch(['1m']);
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
    feed.watch(['1h']);
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

import { intervals, type Candle, type Interval } from '../shared/types';
import type { FeedStatus } from '../shared/paper';

// The subset of the WebSocket API the feed uses, so tests can supply a fake.
export interface FeedSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}
export type SocketFactory = (url: string) => FeedSocket;
export interface CandleFeed {
  watch(next: Interval[]): void;
  status(): FeedStatus;
  close(): void;
}
const STREAM = 'wss://data-stream.binance.vision/stream?streams=';
const RETRY_MS = [1000, 2000, 5000, 10000, 30000];
// Kline streams push several updates a minute; a silent socket is treated as dropped.
const SILENT_MS = 60000;
export const openWebSocket: SocketFactory = (url) => new WebSocket(url) as unknown as FeedSocket;

// One combined Binance kline stream for every interval a live session needs. Only candles
// Binance marks closed (`k.x`) are passed on; `onConnect` lets the caller fill whatever was
// missed while disconnected from REST.
export function createBinanceFeed(
  onCandle: (interval: Interval, candle: Candle) => void,
  onConnect: () => void,
  open: SocketFactory = openWebSocket,
): CandleFeed {
  let socket: FeedSocket | null = null,
    watched = '',
    state: FeedStatus = 'connecting',
    attempt = 0,
    last = 0,
    closed = false,
    retry: ReturnType<typeof setTimeout> | undefined;
  const watchdog = setInterval(() => {
    if (socket && Date.now() - last > SILENT_MS) socket.close();
  }, 15000);
  watchdog.unref?.();
  function connect() {
    if (closed || !watched) return;
    const s = open(
      STREAM +
        watched
          .split(',')
          .map((i) => `btcusdt@kline_${i}`)
          .join('/'),
    );
    socket = s;
    last = Date.now();
    s.onopen = () => {
      attempt = 0;
      state = 'live';
      onConnect();
    };
    s.onmessage = (event) => {
      last = Date.now();
      state = 'live';
      try {
        const data = JSON.parse(String(event.data))?.data,
          k = data?.k;
        if (data?.e !== 'kline' || !k?.x || !Object.hasOwn(intervals, k.i)) return;
        onCandle(k.i, {
          time: k.t / 1000,
          open: +k.o,
          high: +k.h,
          low: +k.l,
          close: +k.c,
          volume: +k.v,
        });
      } catch {
        /* A malformed message is skipped; REST catch-up fills the candle. */
      }
    };
    s.onerror = () => s.close();
    s.onclose = () => {
      if (socket !== s) return;
      socket = null;
      if (closed || !watched) return;
      state = 'reconnecting';
      retry = setTimeout(connect, RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
      retry.unref?.();
    };
  }
  return {
    watch(next) {
      const key = [...new Set(next)].sort().join(',');
      if (key === watched) return;
      watched = key;
      clearTimeout(retry);
      const old = socket;
      socket = null;
      old?.close();
      attempt = 0;
      state = 'connecting';
      connect();
    },
    status: () => state,
    close() {
      closed = true;
      clearTimeout(retry);
      clearInterval(watchdog);
      const old = socket;
      socket = null;
      old?.close();
    },
  };
}

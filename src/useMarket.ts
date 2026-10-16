import { useEffect, useState } from 'react';
import { api } from './api';
import type { Candle, Interval } from '../shared/types';
// Overridable so the browser tests can run against a local stand-in for Binance.
const STREAM_URL = import.meta.env.VITE_BINANCE_STREAM_URL ?? 'wss://data-stream.binance.vision';
type Ticker = {
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  quoteVolume: string;
  volume: string;
};
export function useMarket(symbol: string, interval: Interval) {
  const [candles, setCandles] = useState<Candle[]>([]),
    [ticker, setTicker] = useState<Ticker | null>(null),
    [status, setStatus] = useState('connecting'),
    [error, setError] = useState(''),
    [historyError, setHistoryError] = useState(''),
    [updated, setUpdated] = useState<number | null>(null),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true,
      socket: WebSocket | undefined,
      reconnect: ReturnType<typeof setTimeout>,
      watchdog: ReturnType<typeof setInterval>,
      poll: ReturnType<typeof setInterval>,
      lastEvent = 0;
    setCandles([]);
    setTicker(null);
    setError('');
    setHistoryError('');
    setUpdated(null);
    setStatus('connecting');
    const refresh = async () => {
      try {
        const tick = await api<Ticker>('/ticker?symbol=' + symbol);
        if (active) {
          setTicker(tick);
          setUpdated(Date.now());
          setError('');
          if (Date.now() - lastEvent > 30000) setStatus('polling');
        }
      } catch (e) {
        if (active && Date.now() - lastEvent > 30000) {
          setError((e as Error).message);
          setStatus('offline');
        }
      }
    };
    const history = async () => {
      try {
        const data = await api<{ candles: Candle[] }>(
          `/candles?symbol=${symbol}&interval=${interval}`,
        );
        if (active) {
          setHistoryError('');
          setCandles((old) => {
            const merged = new Map(data.candles.map((b) => [b.time, b]));
            old
              .filter((b) => b.time > data.candles.at(-1)!.time)
              .forEach((b) => merged.set(b.time, b));
            return [...merged.values()].sort((a, b) => a.time - b.time).slice(-501);
          });
        }
      } catch (e) {
        if (active) setHistoryError((e as Error).message);
      }
    };
    void refresh();
    void history();
    poll = setInterval(() => {
      void refresh();
      void history();
    }, 30000);
    function connect() {
      if (!active) return;
      socket = new WebSocket(
        `${STREAM_URL}/stream?streams=${symbol.toLowerCase()}@ticker/${symbol.toLowerCase()}@kline_${interval}`,
      );
      socket.onmessage = (e) => {
        if (!active) return;
        try {
          const { data: d } = JSON.parse(e.data);
          lastEvent = Date.now();
          setStatus('live');
          setError('');
          setUpdated(lastEvent);
          if (d.e === '24hrTicker')
            setTicker({
              lastPrice: d.c,
              priceChangePercent: d.P,
              highPrice: d.h,
              lowPrice: d.l,
              quoteVolume: d.q,
              volume: d.v,
            });
          if (d.e === 'kline') {
            const k = d.k,
              b: Candle = {
                time: k.t / 1000,
                open: +k.o,
                high: +k.h,
                low: +k.l,
                close: +k.c,
                volume: +k.v,
              };
            setCandles((old) => {
              if (!old.length) return old;
              const last = old.at(-1)!;
              if (b.time < last.time) return old;
              return b.time === last.time ? [...old.slice(0, -1), b] : [...old.slice(-500), b];
            });
          }
        } catch {
          /* Ignore malformed stream messages; watchdog detects stale connection. */
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (active) {
          setStatus(Date.now() - lastEvent < 30000 ? 'reconnecting' : 'offline');
          reconnect = setTimeout(connect, 5000);
        }
      };
    }
    connect();
    watchdog = setInterval(() => {
      if (lastEvent && Date.now() - lastEvent > 30000) {
        setStatus('reconnecting');
        socket?.close();
      }
    }, 15000);
    return () => {
      active = false;
      clearTimeout(reconnect);
      clearInterval(watchdog);
      clearInterval(poll);
      socket?.close();
    };
    // `retry` is a counter whose only job is to restart the connection.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [symbol, interval, retry]);
  return {
    candles,
    ticker,
    status,
    error: historyError || error,
    updated,
    retry: () => setRetry((n) => n + 1),
  };
}

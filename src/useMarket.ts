import { useEffect, useState } from 'react';
import { api } from './api';
import { demoCandles } from '../shared/demo';
import { intervals, type Candle, type Interval, type Mode } from '../shared/types';
type Ticker = {
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  quoteVolume: string;
  volume: string;
};
export function useMarket(interval: Interval, mode: Mode) {
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
    setStatus(mode === 'demo' ? 'demo' : 'connecting');
    if (mode === 'demo') {
      const end =
          Math.floor(Date.now() / 1000 / intervals[interval]) * intervals[interval] -
          intervals[interval],
        dayBars = 86400 / intervals[interval],
        // One-minute charts need a full day plus its previous close for 24h statistics.
        count = Math.max(500, dayBars + 1),
        data = demoCandles(interval, end - (count - 1) * intervals[interval], end);
      setCandles(data.slice(-500));
      const last = data.at(-1)!,
        day = data.slice(-dayBars);
      setTicker({
        lastPrice: String(last.close),
        priceChangePercent: String((last.close / data.at(-dayBars - 1)!.close - 1) * 100),
        highPrice: String(Math.max(...day.map((b) => b.high))),
        lowPrice: String(Math.min(...day.map((b) => b.low))),
        quoteVolume: String(day.reduce((s, b) => s + b.volume * b.close, 0)),
        volume: '0',
      });
      return () => {
        active = false;
      };
    }
    const refresh = async () => {
      try {
        const tick = await api<Ticker>('/ticker');
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
        const data = await api<{ candles: Candle[] }>('/candles?interval=' + interval);
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
        `wss://data-stream.binance.vision/stream?streams=btcusdt@ticker/btcusdt@kline_${interval}`,
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
  }, [interval, mode, retry]);
  return {
    candles,
    ticker,
    status,
    error: historyError || error,
    updated,
    retry: () => setRetry((n) => n + 1),
  };
}

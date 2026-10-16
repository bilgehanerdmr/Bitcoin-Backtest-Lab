import { intervals, type Candle, type Interval } from '../../shared/types';
// Deterministic synthetic candles for tests: the same range always gives the same series.
export function syntheticCandles(interval: Interval, start: number, end: number): Candle[] {
  const step = intervals[interval],
    out: Candle[] = [];
  let seed = 42;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let price = 86400;
  for (
    let t = Math.ceil(start / step) * step, i = 0;
    t <= end && out.length < 50000;
    t += step, i++
  ) {
    const open = price,
      drift = Math.sin(i / 38) * 0.0018 + 0.00009;
    price = Math.max(100, open * (1 + drift + (random() - 0.5) * 0.009));
    const spread = random() * 0.003;
    out.push({
      time: t,
      open,
      close: price,
      high: Math.max(open, price) * (1 + spread),
      low: Math.min(open, price) * (1 - spread),
      volume: 15 + random() * 160,
    });
  }
  return out;
}

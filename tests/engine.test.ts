import { describe, it, expect } from 'vitest';
import { backtest, rsi, sma, validateConfig, validateLiveRange } from '../shared/engine';
import { syntheticCandles } from './support/synthetic';
import { defaultConfig, intervals, type Candle, type Config } from '../shared/types';
const config: Config = {
  ...defaultConfig,
  strategy: 'rsi',
  rsiPeriod: 2,
  capital: 10000,
  allocation: 100,
  fee: 0,
  slippage: 0,
  stopLoss: 0,
  takeProfit: 0,
  mode: 'demo',
};
const bars = (prices = [100, 90, 80, 80, 80, 90]): Candle[] =>
  prices.map((price, i) => ({
    time: 1704067200 + i * 3600,
    open: price,
    close: price,
    high: price + 1,
    low: price - 1,
    volume: 10,
  }));
describe('Indicators', () => {
  it('does not populate SMA before its warmup', () =>
    expect(sma([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]));
  it('uses Wilder RSI and treats a flat market as neutral', () => {
    expect(rsi([10, 10, 10, 10], 2)).toEqual([null, null, 50, 50]);
    expect(rsi([1, 2, 3], 2)[2]).toBe(100);
    expect(rsi([3, 2, 1], 2)[2]).toBe(0);
  });
});
describe('Backtest execution', () => {
  it.each(['1m', '1h'] as const)('fills at the next %s candle open after warmup', (interval) => {
    const data = bars().map((b, i) => ({ ...b, time: 1704067200 + i * intervals[interval] })),
      result = backtest(data, { ...config, interval });
    expect(result.trades[0].entryTime).toBe(data[3].time);
    expect(result.trades[0].entry).toBe(80);
    expect(result.metrics.netProfit).toBeCloseTo(1250);
    expect(result.metrics.finalEquity).toBeCloseTo(11250);
  });
  it('deducts both entry and exit fees and adverse slippage', () => {
    const result = backtest(bars(), { ...config, fee: 1, slippage: 1 });
    const qty = 10000 / (80 * 1.01 * 1.01);
    expect(result.metrics.finalEquity).toBeCloseTo(qty * 90 * 0.99 * 0.99);
    expect(result.trades[0].quantity).toBeCloseTo(qty);
    expect(result.metrics.totalFees).toBeCloseTo(qty * (80 * 1.01 + 90 * 0.99) * 0.01);
    expect(result.metrics.netProfit).toBeCloseTo(result.trades.reduce((s, t) => s + t.pnl, 0));
  });
  it('keeps unallocated capital as cash', () => {
    const result = backtest(bars(), { ...config, allocation: 50 });
    expect(result.metrics.finalEquity).toBeCloseTo(10625);
  });
  it('prioritizes the stop when both stop and target are crossed in one candle', () => {
    const data = bars();
    data[3].high = 95;
    data[3].low = 65;
    const result = backtest(data, { ...config, stopLoss: 10, takeProfit: 10 });
    expect(result.trades[0].reason).toBe('Stop-loss');
    expect(result.trades[0].exit).toBe(72);
  });
  it('fills a stop gap at the open rather than the unavailable stop price', () => {
    const data = bars();
    data[4] = { ...data[4], open: 60, close: 60, low: 59, high: 61 };
    const result = backtest(data, { ...config, stopLoss: 10, takeProfit: 10 });
    expect(result.trades[0].exit).toBe(60);
    expect(result.trades[0].reason).toContain('fiyat boşluğu');
  });
  it('closes the final position and reconciles the equity and trade ledger', () => {
    const result = backtest(bars(), config);
    expect(result.trades.at(-1)!.reason).toBe('Test sonu');
    expect(result.equity.at(-1)!.value).toBe(result.metrics.finalEquity);
    expect(result.metrics.netProfit).toBeCloseTo(result.trades.reduce((s, t) => s + t.pnl, 0));
  });
  it('does not let future candles change historical fills', () => {
    const original = backtest(bars(), config);
    const altered = bars();
    altered[5] = { ...altered[5], open: 200, close: 300, high: 301, low: 199 };
    const future = backtest(altered, config);
    expect(future.trades[0].entry).toBe(original.trades[0].entry);
    expect(future.trades[0].entryTime).toBe(original.trades[0].entryTime);
    expect(future.equity.slice(0, 5)).toEqual(original.equity.slice(0, 5));
  });
  it('handles no trades without nonfinite metrics', () => {
    const result = backtest(bars([100, 100, 100, 100, 100, 100]), config);
    expect(result.trades).toHaveLength(0);
    expect(result.metrics.returnPct).toBe(0);
    expect(result.metrics.profitFactor).toBeNull();
    expect(result.metrics.sharpe).toBeNull();
  });
  it('computes maximum drawdown from marked-to-market equity', () => {
    const result = backtest(bars([100, 90, 80, 80, 60, 80]), config);
    expect(result.metrics.maxDrawdown).toBeCloseTo(25);
  });
  it.each(['sma', 'rsi', 'breakout'] as const)(
    'reconciles %s trades over a longer dataset',
    (strategy) => {
      const data = syntheticCandles('1h', 1704067200, 1704067200 + 1200 * 3600);
      const result = backtest(data, { ...defaultConfig, strategy, mode: 'demo' });
      expect(result.trades.length).toBeGreaterThan(0);
      expect(result.metrics.netProfit).toBeCloseTo(
        result.trades.reduce((s, t) => s + t.pnl, 0),
        6,
      );
      expect(result.metrics.totalFees).toBeCloseTo(
        result.trades.reduce((s, t) => s + t.fees, 0),
        6,
      );
      expect(result.equity.every((p) => p.value >= 0)).toBe(true);
    },
  );
});
describe('Data and configuration guards', () => {
  it('rejects duplicate or unaligned candles', () => {
    for (const shift of [3600, 1800]) {
      const data = bars();
      data[3].time += shift;
      expect(() => backtest(data, config)).toThrow(/sırasız veya yinelenen/);
    }
  });
  it('runs across exchange outages and reports the skipped candles', () => {
    const data = bars([100, 90, 80, 80, 80, 90, 95]).filter((_, i) => i !== 4),
      result = backtest(data, config);
    expect(result.missingCandles).toBe(1);
    expect(result.candleCount).toBe(6);
    expect(result.equity.map((p) => p.time)).toEqual(data.map((b) => b.time));
    expect(result.trades[0].entryTime).toBe(data[3].time);
    expect(backtest(bars(), config).missingCandles).toBe(0);
  });
  it('rejects live ranges that start before Binance listed BTCUSDT', () => {
    const range = { start: '2017-08-01', end: '2017-09-01' };
    expect(() => validateLiveRange({ ...config, ...range, mode: 'live' })).toThrow(/2017-08-17/);
    expect(() => validateLiveRange({ ...config, ...range, mode: 'demo' })).not.toThrow();
    expect(() =>
      validateLiveRange({ ...config, start: '2017-08-17', end: '2017-09-01', mode: 'live' }),
    ).not.toThrow();
  });
  it('rejects malformed OHLC', () => {
    const data = bars();
    data[3].high = 1;
    expect(() => backtest(data, config)).toThrow(/geçersiz/);
  });
  it('rejects insufficient warmup', () =>
    expect(() => backtest(bars().slice(0, 3), config)).toThrow(/En az/));
  it('rejects NaN, negative fees and fractional indicator periods', () => {
    for (const patch of [{ capital: NaN }, { fee: -1 }, { rsiPeriod: 2.3 }])
      expect(() => validateConfig({ ...config, ...patch })).toThrow();
  });
  it('rejects reversed dates and oversized requests', () => {
    expect(() => validateConfig({ ...config, start: '2025-05-01', end: '2025-01-01' })).toThrow();
    expect(() =>
      validateConfig({ ...config, interval: '5m', start: '2020-01-01', end: '2025-01-01' }),
    ).toThrow(/50.000/);
  });
  it('rejects calendar dates that do not exist', () =>
    expect(() => validateConfig({ ...config, start: '2025-02-30', end: '2025-03-05' })).toThrow(
      /tarih/,
    ));
  it('generates deterministic, valid synthetic test candles', () => {
    const a = syntheticCandles('1h', 1704067200, 1704067200 + 99 * 3600);
    expect(a).toEqual(syntheticCandles('1h', 1704067200, 1704067200 + 99 * 3600));
    expect(a).toHaveLength(100);
    expect(
      a.every(
        (b) =>
          b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close) && b.low > 0,
      ),
    ).toBe(true);
  });
});

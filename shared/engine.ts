import {
  intervals,
  LIVE_DATA_START,
  type Candle,
  type Config,
  type Result,
  type Trade,
  type EquityPoint,
} from './types';
import { customLookback, matchesGroup, validateCustomStrategy } from './candle-rules';
import { validatePythonStrategy, type PythonSignal } from './python-strategy';

export function validateConfig(c: Config) {
  if (
    !c ||
    !['sma', 'rsi', 'breakout', 'custom', 'python'].includes(c.strategy) ||
    !Object.hasOwn(intervals, c.interval) ||
    !['live', 'demo'].includes(c.mode)
  )
    throw new Error('Geçersiz strateji, zaman dilimi veya veri modu.');
  const limits: Record<string, [number, number]> = {
    capital: [10, 1e9],
    allocation: [1, 100],
    fee: [0, 5],
    slippage: [0, 5],
    stopLoss: [0, 90],
    takeProfit: [0, 1000],
    fast: [2, 500],
    slow: [3, 1000],
    rsiPeriod: [2, 200],
    rsiBuy: [1, 49],
    rsiSell: [51, 99],
    lookback: [2, 500],
  };
  for (const [key, [min, max]] of Object.entries(limits)) {
    const n = c[key as keyof Config];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
      throw new Error(`${key}: ${min}–${max} arasında bir değer girin.`);
  }
  for (const key of ['fast', 'slow', 'rsiPeriod', 'lookback'] as const)
    if (!Number.isInteger(c[key])) throw new Error('Gösterge periyotları tam sayı olmalı.');
  if (c.strategy === 'sma' && c.fast >= c.slow)
    throw new Error('Hızlı ortalama, yavaş ortalamadan küçük olmalı.');
  if (c.strategy === 'custom' || c.custom !== undefined) validateCustomStrategy(c.custom);
  if (c.strategy === 'python' || c.python !== undefined) validatePythonStrategy(c.python);
  const start = Date.parse(c.start + 'T00:00:00Z'),
    end = Date.parse(c.end + 'T23:59:59Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(c.start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(c.end) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    new Date(start).toISOString().slice(0, 10) !== c.start ||
    new Date(end).toISOString().slice(0, 10) !== c.end
  )
    throw new Error('Geçerli bir tarih aralığı seçin.');
  if (end - start > intervals[c.interval] * 1000 * 50000)
    throw new Error(
      'En fazla 50.000 mum test edilebilir. Tarih aralığını daraltın veya zaman dilimini büyütün.',
    );
  if (start > Date.now()) throw new Error('Başlangıç tarihi gelecekte olamaz.');
}
// Kept out of validateConfig so stored presets and reports stay loadable.
export function validateLiveRange(c: Config) {
  if (c.mode === 'live' && c.start < LIVE_DATA_START)
    throw new Error(
      `Binance BTC/USDT verileri ${LIVE_DATA_START} tarihinde başlar. Bu tarih veya sonrasını seçin.`,
    );
}
export function sma(values: number[], period: number): (number | null)[] {
  let sum = 0;
  return values.map((v, i) => {
    sum += v;
    if (i >= period) sum -= values[i - period];
    return i >= period - 1 ? sum / period : null;
  });
}
export function rsi(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  let gain = 0,
    loss = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (i <= period) {
      gain += Math.max(d, 0) / period;
      loss += Math.max(-d, 0) / period;
    } else {
      gain = (gain * (period - 1) + Math.max(d, 0)) / period;
      loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    }
    if (i >= period) out[i] = loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
  }
  return out;
}
export function backtest(
  candles: Candle[],
  config: Config,
  pythonSignals?: PythonSignal[],
): Result {
  validateConfig(config);
  if (
    config.strategy === 'python' &&
    (!pythonSignals ||
      pythonSignals.length !== candles.length ||
      pythonSignals.some((s) => !['buy', 'sell', 'hold'].includes(s)))
  )
    throw new Error('Python sinyalleri eksik veya geçersiz.');
  const c = config,
    warmup =
      c.strategy === 'python'
        ? 0
        : c.strategy === 'custom'
          ? customLookback(c.custom!)
          : c.strategy === 'sma'
            ? c.slow
            : c.strategy === 'rsi'
              ? c.rsiPeriod
              : c.lookback;
  if (candles.length < warmup + 3)
    throw new Error(`En az ${warmup + 3} kapanmış mum gerekli. Tarih aralığını genişletin.`);
  const step = intervals[c.interval];
  // Holes are allowed: the data layer only admits open times Binance confirms it never had.
  candles.forEach((b, i) => {
    if (
      ![b.time, b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite) ||
      b.low <= 0 ||
      b.volume < 0 ||
      b.high < Math.max(b.open, b.close) ||
      b.low > Math.min(b.open, b.close) ||
      b.high < b.low ||
      b.time % step !== 0 ||
      (i > 0 && b.time <= candles[i - 1].time)
    )
      throw new Error('Veride geçersiz, sırasız veya yinelenen mum var.');
  });
  const closes = candles.map((b) => b.close),
    fast = sma(closes, c.fast),
    slow = sma(closes, c.slow),
    rs = rsi(closes, c.rsiPeriod);
  const trades: Trade[] = [],
    equity: EquityPoint[] = [];
  let cash = c.capital,
    position: { entry: number; quantity: number; fee: number; time: number; cost: number } | null =
      null,
    peak = c.capital,
    maxDD = 0,
    totalFees = 0;
  const fee = c.fee / 100,
    slip = c.slippage / 100;
  // Signals use the previous closed candle. Orders fill at the next candle open.
  const close = (price: number, time: number, reason: string) => {
    if (!position) return;
    const exit = price * (1 - slip),
      proceeds = position.quantity * exit,
      exitFee = proceeds * fee,
      pnl = proceeds - exitFee - position.cost;
    cash += proceeds - exitFee;
    totalFees += exitFee;
    trades.push({
      id: trades.length + 1,
      entryTime: position.time,
      exitTime: time,
      entry: position.entry,
      exit,
      quantity: position.quantity,
      fees: position.fee + exitFee,
      pnl,
      returnPct: (pnl / position.cost) * 100,
      reason,
    });
    position = null;
  };
  const benchEntry = candles[0].open * (1 + slip),
    benchQty = c.capital / (benchEntry * (1 + fee));
  for (let i = 0; i < candles.length; i++) {
    const b = candles[i],
      j = i - 1;
    const wasInPosition = position !== null;
    let buy = false,
      sell = false;
    if (j >= warmup) {
      if (c.strategy === 'python') {
        buy = pythonSignals![j] === 'buy';
        sell = pythonSignals![j] === 'sell';
      }
      if (c.strategy === 'custom') {
        sell = matchesGroup(candles, j, c.custom!.exit);
        buy = !sell && matchesGroup(candles, j, c.custom!.entry);
      }
      if (c.strategy === 'sma') {
        buy = fast[j]! > slow[j]! && fast[j - 1]! <= slow[j - 1]!;
        sell = fast[j]! < slow[j]! && fast[j - 1]! >= slow[j - 1]!;
      }
      if (c.strategy === 'rsi') {
        buy = rs[j]! < c.rsiBuy;
        sell = rs[j]! > c.rsiSell;
      }
      if (c.strategy === 'breakout') {
        const prev = candles.slice(j - c.lookback, j);
        buy = candles[j].close > Math.max(...prev.map((x) => x.high));
        sell = candles[j].close < Math.min(...prev.map((x) => x.low));
      }
    }
    if (position) {
      const stop = position.entry * (1 - c.stopLoss / 100),
        target = position.entry * (1 + c.takeProfit / 100);
      if (c.stopLoss > 0 && b.open <= stop) close(b.open, b.time, 'Stop-loss (fiyat boşluğu)');
      else if (c.takeProfit > 0 && b.open >= target)
        close(b.open, b.time, 'Take-profit (fiyat boşluğu)');
      else if (sell) close(b.open, b.time, 'Strateji sinyali');
    }
    if (
      !position &&
      buy &&
      i < candles.length - 1 &&
      (!['custom', 'python'].includes(c.strategy) || !wasInPosition)
    ) {
      const budget = (cash * c.allocation) / 100,
        entry = b.open * (1 + slip),
        quantity = budget / (entry * (1 + fee)),
        entryFee = entry * quantity * fee;
      position = { entry, quantity, fee: entryFee, time: b.time, cost: budget };
      cash -= budget;
      totalFees += entryFee;
    }
    if (position) {
      const stop = position.entry * (1 - c.stopLoss / 100),
        target = position.entry * (1 + c.takeProfit / 100);
      if (c.stopLoss > 0 && b.low <= stop) close(stop, b.time, 'Stop-loss');
      else if (c.takeProfit > 0 && b.high >= target) close(target, b.time, 'Take-profit');
    }
    if (i === candles.length - 1 && position) close(b.close, b.time, 'Test sonu');
    const value = cash + (position ? position.quantity * b.close : 0);
    peak = Math.max(peak, value);
    const drawdown = (value / peak - 1) * 100;
    maxDD = Math.max(maxDD, -drawdown);
    equity.push({
      time: b.time,
      value,
      benchmark: benchQty * b.close * (1 - slip) * (1 - fee),
      drawdown,
    });
  }
  const wins = trades.filter((t) => t.pnl > 0),
    grossWin = wins.reduce((s, t) => s + t.pnl, 0),
    grossLoss = -trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0);
  const returns = equity.slice(1).map((e, i) => e.value / equity[i].value - 1),
    mean = returns.reduce((a, b) => a + b, 0) / returns.length,
    variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    config: structuredClone(c),
    source: c.mode === 'demo' ? 'Sentetik demo' : 'Binance Spot',
    candleCount: candles.length,
    missingCandles: (candles.at(-1)!.time - candles[0].time) / step + 1 - candles.length,
    start: candles[0].time,
    end: candles.at(-1)!.time,
    trades,
    equity,
    metrics: {
      netProfit: cash - c.capital,
      returnPct: (cash / c.capital - 1) * 100,
      benchmarkPct: (equity.at(-1)!.benchmark / c.capital - 1) * 100,
      maxDrawdown: maxDD,
      winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
      sharpe:
        variance > 0
          ? (mean / Math.sqrt(variance)) * Math.sqrt((365 * 86400) / intervals[c.interval])
          : null,
      totalFees,
      finalEquity: cash,
    },
  };
}

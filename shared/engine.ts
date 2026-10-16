import {
  intervals,
  LIVE_DATA_START,
  type Candle,
  type Config,
  type Interval,
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
// Gates on the strategy's own lookback; Python strategies handle warmup themselves.
export function strategyWarmup(c: Config): number {
  return c.strategy === 'python'
    ? 0
    : c.strategy === 'custom'
      ? customLookback(c.custom!)
      : c.strategy === 'sma'
        ? c.slow
        : c.strategy === 'rsi'
          ? c.rsiPeriod
          : c.lookback;
}
export function validateCandles(candles: Candle[], interval: Interval) {
  const step = intervals[interval];
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
}
export interface StrategySignal {
  buy: boolean;
  sell: boolean;
}
const noSignal: StrategySignal = { buy: false, sell: false };
// Entry j is decided at the close of candle j and executed at the open of candle j + 1.
// Each entry depends only on candles 0..j, so a longer series never changes earlier ones.
export function strategySignals(
  candles: Candle[],
  c: Config,
  pythonSignals?: PythonSignal[],
): StrategySignal[] {
  const warmup = strategyWarmup(c),
    closes = candles.map((b) => b.close),
    fast = sma(closes, c.fast),
    slow = sma(closes, c.slow),
    rs = rsi(closes, c.rsiPeriod);
  return candles.map((_, j) => {
    if (j < warmup) return noSignal;
    let buy = false,
      sell = false;
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
    return { buy, sell };
  });
}
export interface OpenPosition {
  entry: number;
  quantity: number;
  fee: number;
  time: number;
  cost: number;
}
export interface Portfolio {
  cash: number;
  position: OpenPosition | null;
  peak: number;
  maxDD: number;
  totalFees: number;
  trades: Trade[];
  equity: EquityPoint[];
  benchQty: number;
}
// Buy and hold enters at the open of the first traded candle with full capital.
export function openPortfolio(c: Config, first: Candle): Portfolio {
  const benchEntry = first.open * (1 + c.slippage / 100);
  return {
    cash: c.capital,
    position: null,
    peak: c.capital,
    maxDD: 0,
    totalFees: 0,
    trades: [],
    equity: [],
    benchQty: c.capital / (benchEntry * (1 + c.fee / 100)),
  };
}
// One candle of the shared execution model: the previous close's signal fills at this open,
// then stop-loss and take-profit are checked inside the candle. `last` ends the test here.
export function stepPortfolio(
  p: Portfolio,
  c: Config,
  b: Candle,
  signal: StrategySignal,
  last: boolean,
) {
  const fee = c.fee / 100,
    slip = c.slippage / 100;
  const close = (price: number, time: number, reason: string) => {
    const position = p.position;
    if (!position) return;
    const exit = price * (1 - slip),
      proceeds = position.quantity * exit,
      exitFee = proceeds * fee,
      pnl = proceeds - exitFee - position.cost;
    p.cash += proceeds - exitFee;
    p.totalFees += exitFee;
    p.trades.push({
      id: p.trades.length + 1,
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
    p.position = null;
  };
  const wasInPosition = p.position !== null;
  if (p.position) {
    const stop = p.position.entry * (1 - c.stopLoss / 100),
      target = p.position.entry * (1 + c.takeProfit / 100);
    if (c.stopLoss > 0 && b.open <= stop) close(b.open, b.time, 'Stop-loss (fiyat boşluğu)');
    else if (c.takeProfit > 0 && b.open >= target)
      close(b.open, b.time, 'Take-profit (fiyat boşluğu)');
    else if (signal.sell) close(b.open, b.time, 'Strateji sinyali');
  }
  if (
    !p.position &&
    signal.buy &&
    !last &&
    (!['custom', 'python'].includes(c.strategy) || !wasInPosition)
  ) {
    const budget = (p.cash * c.allocation) / 100,
      entry = b.open * (1 + slip),
      quantity = budget / (entry * (1 + fee)),
      entryFee = entry * quantity * fee;
    p.position = { entry, quantity, fee: entryFee, time: b.time, cost: budget };
    p.cash -= budget;
    p.totalFees += entryFee;
  }
  if (p.position) {
    const stop = p.position.entry * (1 - c.stopLoss / 100),
      target = p.position.entry * (1 + c.takeProfit / 100);
    if (c.stopLoss > 0 && b.low <= stop) close(stop, b.time, 'Stop-loss');
    else if (c.takeProfit > 0 && b.high >= target) close(target, b.time, 'Take-profit');
  }
  if (last && p.position) close(b.close, b.time, 'Test sonu');
  const value = p.cash + (p.position ? p.position.quantity * b.close : 0);
  p.peak = Math.max(p.peak, value);
  const drawdown = (value / p.peak - 1) * 100;
  p.maxDD = Math.max(p.maxDD, -drawdown);
  p.equity.push({
    time: b.time,
    value,
    benchmark: p.benchQty * b.close * (1 - slip) * (1 - fee),
    drawdown,
  });
}
// Equity at the last close; equal to cash once the test has closed the position.
export function summarize(p: Portfolio, c: Config): Result['metrics'] {
  const { trades, equity } = p,
    final = equity.at(-1)!.value;
  const wins = trades.filter((t) => t.pnl > 0),
    grossWin = wins.reduce((s, t) => s + t.pnl, 0),
    grossLoss = -trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0);
  const returns = equity.slice(1).map((e, i) => e.value / equity[i].value - 1),
    mean = returns.reduce((a, b) => a + b, 0) / returns.length,
    variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  return {
    netProfit: final - c.capital,
    returnPct: (final / c.capital - 1) * 100,
    benchmarkPct: (equity.at(-1)!.benchmark / c.capital - 1) * 100,
    maxDrawdown: p.maxDD,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    sharpe:
      variance > 0
        ? (mean / Math.sqrt(variance)) * Math.sqrt((365 * 86400) / intervals[c.interval])
        : null,
    totalFees: p.totalFees,
    finalEquity: final,
  };
}
export interface BacktestOptions {
  // Open time of the first candle allowed to trade. Earlier candles only warm up the
  // strategy, so equity, benchmark and metrics start here (paper sessions).
  tradeFrom?: number;
  // End the test at the last candle: no entry there and any open position closes at its
  // close. A running paper session leaves this off to keep the position open.
  finalize?: boolean;
}
export function simulate(
  candles: Candle[],
  config: Config,
  pythonSignals?: PythonSignal[],
  options: BacktestOptions = {},
): { result: Result; portfolio: Portfolio; signals: StrategySignal[] } {
  validateConfig(config);
  if (
    config.strategy === 'python' &&
    (!pythonSignals ||
      pythonSignals.length !== candles.length ||
      pythonSignals.some((s) => !['buy', 'sell', 'hold'].includes(s)))
  )
    throw new Error('Python sinyalleri eksik veya geçersiz.');
  const c = config,
    warmup = strategyWarmup(c);
  if (candles.length < warmup + 3)
    throw new Error(`En az ${warmup + 3} kapanmış mum gerekli. Tarih aralığını genişletin.`);
  validateCandles(candles, c.interval);
  const from =
    options.tradeFrom === undefined ? 0 : candles.findIndex((b) => b.time >= options.tradeFrom!);
  if (from < 0) throw new Error('İşlem başlangıcından sonra kapanmış mum yok.');
  const finalize = options.finalize ?? true,
    signals = strategySignals(candles, c, pythonSignals),
    portfolio = openPortfolio(c, candles[from]);
  for (let i = from; i < candles.length; i++)
    stepPortfolio(
      portfolio,
      c,
      candles[i],
      i > 0 ? signals[i - 1] : noSignal,
      finalize && i === candles.length - 1,
    );
  const step = intervals[c.interval],
    window = candles.length - from;
  return {
    portfolio,
    signals,
    result: {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      config: structuredClone(c),
      source: c.mode === 'demo' ? 'Sentetik demo' : 'Binance Spot',
      candleCount: window,
      missingCandles: (candles.at(-1)!.time - candles[from].time) / step + 1 - window,
      start: candles[from].time,
      end: candles.at(-1)!.time,
      trades: portfolio.trades,
      equity: portfolio.equity,
      metrics: summarize(portfolio, c),
    },
  };
}
export function backtest(
  candles: Candle[],
  config: Config,
  pythonSignals?: PythonSignal[],
  options?: BacktestOptions,
): Result {
  return simulate(candles, config, pythonSignals, options).result;
}

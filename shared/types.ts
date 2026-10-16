export const intervals = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
} as const;
export type Interval = keyof typeof intervals;
// First BTCUSDT kline on Binance Spot; earlier live ranges have no data at all.
export const LIVE_DATA_START = '2017-08-17';
// Binance USDT spot pairs only, e.g. BTCUSDT, 1000SATSUSDT.
export const DEFAULT_SYMBOL = 'BTCUSDT';
export const SYMBOL_PATTERN = /^[A-Z0-9]{1,20}USDT$/;
// Configs saved before multi-coin support have no symbol; they all used BTCUSDT.
export const symbolOf = (c: { symbol?: string }) => c.symbol ?? DEFAULT_SYMBOL;
export type Mode = 'live' | 'demo';
export type Strategy = 'sma' | 'rsi' | 'breakout' | 'custom' | 'python';
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export interface Config {
  strategy: Strategy;
  symbol?: string;
  custom?: CustomStrategy;
  python?: import('./python-strategy').PythonStrategy;
  interval: Interval;
  start: string;
  end: string;
  capital: number;
  allocation: number;
  fee: number;
  slippage: number;
  stopLoss: number;
  takeProfit: number;
  fast: number;
  slow: number;
  rsiPeriod: number;
  rsiBuy: number;
  rsiSell: number;
  lookback: number;
  mode: Mode;
}
export interface Trade {
  id: number;
  entryTime: number;
  exitTime: number;
  entry: number;
  exit: number;
  quantity: number;
  fees: number;
  pnl: number;
  returnPct: number;
  reason: string;
}
export interface EquityPoint {
  time: number;
  value: number;
  benchmark: number;
  drawdown: number;
}
export interface Result {
  id: string;
  createdAt: string;
  config: Config;
  source: string;
  candleCount: number;
  // Open times inside start..end that Binance never produced (exchange outages).
  // Absent in reports saved before gaps were supported, which were always continuous.
  missingCandles?: number;
  start: number;
  end: number;
  // Reports produced by a paper session: its final report or a comparison backtest.
  paper?: PaperReportInfo;
  trades: Trade[];
  equity: EquityPoint[];
  metrics: {
    netProfit: number;
    returnPct: number;
    benchmarkPct: number;
    maxDrawdown: number;
    winRate: number;
    profitFactor: number | null;
    sharpe: number | null;
    totalFees: number;
    finalEquity: number;
  };
}
export interface PaperReportInfo {
  kind: 'session' | 'comparison';
  sessionId: string;
  startedAt: string;
  // Open time of the first warmup candle; trading starts at the report's `start`.
  warmupStart: number;
}
export const strategyNames: Record<Strategy, string> = {
  sma: 'Hareketli Ortalama Kesişimi',
  rsi: 'RSI Ortalamaya Dönüş',
  breakout: 'Donchian Kanal Kırılımı',
  custom: 'Özel Mum Stratejisi',
  python: 'Python Stratejisi',
};
export function strategyLabel(config: Config): string {
  if (config.strategy === 'python' && config.python) return config.python.name;
  return config.strategy === 'custom' && config.custom
    ? config.custom.name
    : strategyNames[config.strategy];
}
export const defaultConfig: Config = {
  strategy: 'sma',
  symbol: DEFAULT_SYMBOL,
  interval: '1h',
  start: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
  end: new Date().toISOString().slice(0, 10),
  capital: 10000,
  allocation: 95,
  fee: 0.1,
  slippage: 0.05,
  stopLoss: 3,
  takeProfit: 6,
  fast: 9,
  slow: 21,
  rsiPeriod: 14,
  rsiBuy: 30,
  rsiSell: 70,
  lookback: 20,
  mode: 'live',
};
import type { CustomStrategy } from './candle-rules';

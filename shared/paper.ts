import type { Config, EquityPoint, Result, Trade } from './types';
import { strategyWarmup, validateConfig } from './engine';
import type { PythonSignal } from './python-strategy';

export const MAX_ACTIVE_SESSIONS = 3;
// Same ceiling as a backtest: warmup plus live candles must fit one simulation, and the
// Python strategy is replayed over all of them on every closed candle.
export const PAPER_MAX_CANDLES = 50000;
export const MAX_WARMUP = 5000;
export const DEFAULT_WARMUP = 300;
export type PaperStatus = 'running' | 'waiting' | 'error' | 'stopped';
export type DemoSpeed = 'realtime' | 'fast';
export type FeedStatus = 'connecting' | 'live' | 'reconnecting' | 'demo';
export const paperStatusLabels: Record<PaperStatus, string> = {
  running: 'Çalışıyor',
  waiting: 'Bekliyor',
  error: 'Hata',
  stopped: 'Durdu',
};
export interface PaperStart {
  config: Config;
  warmup: number;
  demoSpeed?: DemoSpeed;
}
export interface PaperSignal {
  time: number;
  signal: PythonSignal;
}
export interface PaperPosition {
  entry: number;
  quantity: number;
  time: number;
  cost: number;
  value: number;
}
export type PaperMetrics = Result['metrics'] & { trades: number };
export interface PaperComparison {
  reportId: string;
  at: string;
  lastCandle: number;
  candleCount: number;
  identical: boolean;
  differences: string[];
  live: PaperMetrics;
  backtest: PaperMetrics;
}
export interface PaperSession {
  id: string;
  createdAt: string;
  // Frozen copy of the strategy, its code and all settings. Editing or deleting the
  // template it came from never reaches a running session.
  config: Config;
  warmup: number;
  demoSpeed: DemoSpeed | null;
  status: PaperStatus;
  message: string;
  warmupStart: number;
  // Open time of the first candle that may trade (the first one opening after start).
  tradeFrom: number;
  lastProcessed: number | null;
  candleCount: number;
  tradingCandles: number;
  missingCandles: number;
  lastSignal: { time: number; signal: PythonSignal } | null;
  position: PaperPosition | null;
  metrics: Result['metrics'] | null;
  logs: string[];
  stoppedAt: string | null;
  stopReason: string | null;
  reportId: string | null;
  comparison: PaperComparison | null;
  // Fast demo clock: simulated time `simAt` at real time `realAt` (ms), one candle per second.
  clock: { simAt: number; realAt: number } | null;
}
export interface PaperView extends PaperSession {
  feed: FeedStatus | null;
  tradeCount: number;
}
export interface PaperDetail extends PaperView {
  trades: Trade[];
  equity: EquityPoint[];
}
export function minWarmup(c: Config): number {
  return strategyWarmup(c) + 2;
}
export function validatePaperStart(input: unknown): asserts input is PaperStart {
  const s = input as PaperStart;
  if (!s || typeof s !== 'object') throw new Error('Canlı test ayarları gerekli.');
  validateConfig(s.config);
  if (s.config.dataset)
    throw new Error('Canlı test yalnızca Binance verisiyle çalışır; yüklenen veri seti seçilemez.');
  const min = minWarmup(s.config);
  if (!Number.isInteger(s.warmup) || s.warmup < min || s.warmup > MAX_WARMUP)
    throw new Error(`Isınma mumu sayısı ${min}–${MAX_WARMUP} arasında bir tam sayı olmalı.`);
  if (s.config.mode === 'demo' && !['realtime', 'fast'].includes(s.demoSpeed as string))
    throw new Error('Demo hızı seçin.');
}
export const utcDate = (time: number) => new Date(time * 1000).toISOString().slice(0, 10);

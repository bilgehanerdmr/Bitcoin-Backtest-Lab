import {
  intervals,
  SYMBOL_PATTERN,
  type Candle,
  type EquityPoint,
  type Interval,
  type Result,
  type Trade,
} from './types';
import { validateConfig } from './engine';
import { validateWorkspace, type Workspace } from './workspace';
import type { PaperSession, PaperSignal } from './paper';
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
export interface StoredCandle extends Candle {
  // Version 1 backups predate multi-coin support and hold only BTCUSDT without this field.
  symbol?: string;
  interval: Interval;
}
export interface PaperSessionBackup {
  session: PaperSession;
  signals: PaperSignal[];
  equity: EquityPoint[];
  trades: Trade[];
}
export interface Backup {
  format: 'bitcoin-lab-backup';
  // 2 records each candle's symbol. Older platform versions reject it rather than filing
  // other coins' candles under BTCUSDT.
  version: 1 | 2;
  exportedAt: string;
  candles: StoredCandle[];
  backtests: Result[];
  workspace: Workspace;
  // Added with paper trading; older backups have no sessions and stay valid.
  paperSessions?: PaperSessionBackup[];
}
export interface ImportSummary {
  candlesAdded: number;
  candlesSkipped: number;
  reportsAdded: number;
  reportsSkipped: number;
  presetsAdded: number;
  sessionsAdded: number;
  sessionsSkipped: number;
  workspace: Workspace;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isReportId(id: unknown): id is string {
  return typeof id === 'string' && uuid.test(id);
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isDate = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const signals = ['buy', 'sell', 'hold'];
const fail = (message: string): never => {
  throw new Error('Yedek dosyası: ' + message);
};
function validateEquity(equity: EquityPoint[], step: number, start: number) {
  for (let i = 0; i < equity.length; i++) {
    const p = equity[i];
    if (
      !p ||
      ![p.time, p.value, p.benchmark, p.drawdown].every(finite) ||
      !Number.isInteger(p.time) ||
      p.value < 0 ||
      p.benchmark < 0 ||
      p.drawdown > 0 ||
      p.drawdown < -100 ||
      p.time % step !== 0 ||
      (i ? p.time <= equity[i - 1].time : p.time !== start)
    )
      fail('geçersiz sermaye eğrisi.');
  }
}
function validateTrades(trades: Trade[], step: number, start: number, end: number) {
  let lastExit = start;
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    if (
      !t ||
      t.id !== i + 1 ||
      ![t.entryTime, t.exitTime, t.entry, t.exit, t.quantity, t.fees, t.pnl, t.returnPct].every(
        finite,
      ) ||
      !Number.isInteger(t.entryTime) ||
      !Number.isInteger(t.exitTime) ||
      t.entryTime < start ||
      t.exitTime > end ||
      t.entryTime > t.exitTime ||
      t.entryTime < lastExit ||
      (t.entryTime - start) % step !== 0 ||
      (t.exitTime - start) % step !== 0 ||
      t.entry <= 0 ||
      t.exit <= 0 ||
      t.quantity < 0 ||
      t.fees < 0 ||
      typeof t.reason !== 'string' ||
      t.reason.length > 100
    )
      fail('geçersiz işlem dökümü.');
    lastExit = t.exitTime;
  }
}
function validMetrics(m: Result['metrics']): boolean {
  return (
    !!m &&
    [
      'netProfit',
      'returnPct',
      'benchmarkPct',
      'maxDrawdown',
      'winRate',
      'totalFees',
      'finalEquity',
    ].every((k) => finite(m[k as keyof Result['metrics']])) &&
    ['profitFactor', 'sharpe'].every((k) => m[k as 'sharpe'] === null || finite(m[k as 'sharpe']))
  );
}
function validatePaperSession(entry: PaperSessionBackup, ids: Set<string>) {
  const s = entry?.session,
    invalid = (): never => fail('geçersiz canlı test oturumu.');
  if (!s || !isReportId(s.id) || ids.has(s.id) || !isDate(s.createdAt)) invalid();
  ids.add(s.id);
  validateConfig(s.config);
  const step = intervals[s.config.interval],
    aligned = (t: unknown) => finite(t) && Number.isInteger(t) && t % step === 0,
    count = (n: unknown) => Number.isInteger(n) && (n as number) >= 0,
    c = s.comparison;
  if (
    !['running', 'waiting', 'error', 'stopped'].includes(s.status) ||
    !aligned(s.warmupStart) ||
    !aligned(s.tradeFrom) ||
    s.warmupStart > s.tradeFrom ||
    !(s.lastProcessed === null || aligned(s.lastProcessed)) ||
    ![s.warmup, s.candleCount, s.tradingCandles, s.missingCandles].every(count) ||
    !(s.demoSpeed === null || ['realtime', 'fast'].includes(s.demoSpeed)) ||
    typeof s.message !== 'string' ||
    s.message.length > 5000 ||
    !Array.isArray(s.logs) ||
    s.logs.length > 200 ||
    s.logs.some((line) => typeof line !== 'string' || line.length > 20000) ||
    !(
      s.lastSignal === null ||
      (aligned(s.lastSignal?.time) && signals.includes(s.lastSignal.signal))
    ) ||
    !(
      s.position === null ||
      [
        s.position?.entry,
        s.position?.quantity,
        s.position?.time,
        s.position?.cost,
        s.position?.value,
      ].every(finite)
    ) ||
    !(s.metrics === null || validMetrics(s.metrics)) ||
    !(s.stoppedAt === null || isDate(s.stoppedAt)) ||
    !(s.stopReason === null || typeof s.stopReason === 'string') ||
    !(s.reportId === null || isReportId(s.reportId)) ||
    !(s.clock === null || (finite(s.clock?.simAt) && finite(s.clock?.realAt))) ||
    !(
      c === null ||
      (isReportId(c?.reportId) &&
        isDate(c.at) &&
        aligned(c.lastCandle) &&
        count(c.candleCount) &&
        typeof c.identical === 'boolean' &&
        Array.isArray(c.differences) &&
        c.differences.length <= 20 &&
        c.differences.every((d) => typeof d === 'string') &&
        [c.live, c.backtest].every((m) => validMetrics(m) && count(m.trades)))
    ) ||
    !Array.isArray(entry.signals) ||
    entry.signals.length > 50000 ||
    !Array.isArray(entry.equity) ||
    entry.equity.length !== s.tradingCandles ||
    !Array.isArray(entry.trades) ||
    entry.trades.length > entry.equity.length
  )
    invalid();
  entry.signals.forEach((r, i) => {
    if (
      !r ||
      !aligned(r.time) ||
      !signals.includes(r.signal) ||
      (i && r.time <= entry.signals[i - 1].time)
    )
      invalid();
  });
  if (entry.equity.length) {
    validateEquity(entry.equity, step, entry.equity[0].time);
    validateTrades(entry.trades, step, entry.equity[0].time, entry.equity.at(-1)!.time);
  }
}
export function validateBackup(input: unknown): asserts input is Backup {
  const b = input as Backup;
  if (!b || b.format !== 'bitcoin-lab-backup' || (b.version !== 1 && b.version !== 2))
    fail('desteklenmeyen dosya biçimi veya sürüm.');
  if (typeof b.exportedAt !== 'string' || !Number.isFinite(Date.parse(b.exportedAt)))
    fail('geçersiz oluşturulma tarihi.');
  if (
    !Array.isArray(b.candles) ||
    b.candles.length > 1000000 ||
    !Array.isArray(b.backtests) ||
    b.backtests.length > 10000
  )
    fail('mum veya rapor listesi geçersiz ya da sınırı aşıyor.');
  validateWorkspace(b.workspace);
  for (const c of b.candles) {
    if (
      !c ||
      (c.symbol !== undefined &&
        (typeof c.symbol !== 'string' || !SYMBOL_PATTERN.test(c.symbol))) ||
      !Object.hasOwn(intervals, c.interval) ||
      ![c.time, c.open, c.high, c.low, c.close, c.volume].every(finite) ||
      !Number.isInteger(c.time) ||
      c.time < 0 ||
      c.time % intervals[c.interval] !== 0 ||
      c.low <= 0 ||
      c.high < c.low ||
      c.high < Math.max(c.open, c.close) ||
      c.low > Math.min(c.open, c.close) ||
      c.volume < 0 ||
      (c.time + intervals[c.interval]) * 1000 > Date.now()
    )
      fail('geçersiz veya kapanmamış mum verisi.');
  }
  const ids = new Set<string>();
  for (const r of b.backtests) {
    if (
      !r ||
      !isReportId(r.id) ||
      ids.has(r.id) ||
      typeof r.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(r.createdAt))
    )
      fail('geçersiz veya yinelenen rapor kimliği.');
    ids.add(r.id);
    validateConfig(r.config);
    if (
      !Number.isInteger(r.candleCount) ||
      r.candleCount < 3 ||
      r.candleCount > 50000 ||
      !Array.isArray(r.equity) ||
      r.equity.length !== r.candleCount ||
      !Array.isArray(r.trades) ||
      r.trades.length > r.candleCount ||
      !finite(r.start) ||
      !finite(r.end) ||
      r.end < r.start ||
      r.source !== (r.config.mode === 'demo' ? 'Sentetik demo' : 'Binance Spot')
    )
      fail('rapor veri yapısı geçersiz.');
    const step = intervals[r.config.interval];
    validateEquity(r.equity, step, r.start);
    if (r.equity.at(-1)!.time !== r.end) fail('rapor tarih aralığı tutarsız.');
    // Exchange outages are the only holes a report may have, and it must declare them.
    if ((r.end - r.start) / step + 1 - r.candleCount !== (r.missingCandles ?? 0))
      fail('rapordaki eksik mum sayısı tutarsız.');
    if (
      r.paper !== undefined &&
      (!r.paper ||
        !['session', 'comparison'].includes(r.paper.kind) ||
        !isReportId(r.paper.sessionId) ||
        !isDate(r.paper.startedAt) ||
        !finite(r.paper.warmupStart) ||
        r.paper.warmupStart > r.start)
    )
      fail('rapor veri yapısı geçersiz.');
    validateTrades(r.trades, step, r.start, r.end);
    if (!validMetrics(r.metrics)) fail('geçersiz performans metrikleri.');
    if (
      Math.abs(r.equity.at(-1)!.value - r.metrics.finalEquity) > 1e-6 ||
      Math.abs(r.metrics.finalEquity - r.config.capital - r.metrics.netProfit) > 1e-6
    )
      fail('sermaye toplamları tutarsız.');
  }
  if (b.paperSessions !== undefined) {
    if (!Array.isArray(b.paperSessions) || b.paperSessions.length > 1000)
      fail('canlı test oturumu listesi geçersiz ya da sınırı aşıyor.');
    const sessionIds = new Set<string>();
    for (const entry of b.paperSessions) validatePaperSession(entry, sessionIds);
  }
}

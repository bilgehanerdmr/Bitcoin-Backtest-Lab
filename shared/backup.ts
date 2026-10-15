import { intervals, type Candle, type Interval, type Result } from './types';
import { validateConfig } from './engine';
import { validateWorkspace, type Workspace } from './workspace';
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
export interface StoredCandle extends Candle {
  interval: Interval;
}
export interface Backup {
  format: 'bitcoin-lab-backup';
  version: 1;
  exportedAt: string;
  candles: StoredCandle[];
  backtests: Result[];
  workspace: Workspace;
}
export interface ImportSummary {
  candlesAdded: number;
  candlesSkipped: number;
  reportsAdded: number;
  reportsSkipped: number;
  presetsAdded: number;
  workspace: Workspace;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isReportId(id: unknown): id is string {
  return typeof id === 'string' && uuid.test(id);
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function validateBackup(input: unknown): asserts input is Backup {
  const b = input as Backup;
  const fail = (message: string): never => {
    throw new Error('Yedek dosyası: ' + message);
  };
  if (!b || b.format !== 'bitcoin-lab-backup' || b.version !== 1)
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
    for (let i = 0; i < r.equity.length; i++) {
      const p = r.equity[i];
      if (
        !p ||
        ![p.time, p.value, p.benchmark, p.drawdown].every(finite) ||
        !Number.isInteger(p.time) ||
        p.value < 0 ||
        p.benchmark < 0 ||
        p.drawdown > 0 ||
        p.drawdown < -100 ||
        p.time % step !== 0 ||
        (i ? p.time <= r.equity[i - 1].time : p.time !== r.start)
      )
        fail('geçersiz sermaye eğrisi.');
    }
    if (r.equity.at(-1)!.time !== r.end) fail('rapor tarih aralığı tutarsız.');
    // Exchange outages are the only holes a report may have, and it must declare them.
    if ((r.end - r.start) / step + 1 - r.candleCount !== (r.missingCandles ?? 0))
      fail('rapordaki eksik mum sayısı tutarsız.');
    let lastExit = r.start;
    for (let i = 0; i < r.trades.length; i++) {
      const t = r.trades[i];
      if (
        !t ||
        t.id !== i + 1 ||
        ![t.entryTime, t.exitTime, t.entry, t.exit, t.quantity, t.fees, t.pnl, t.returnPct].every(
          finite,
        ) ||
        !Number.isInteger(t.entryTime) ||
        !Number.isInteger(t.exitTime) ||
        t.entryTime < r.start ||
        t.exitTime > r.end ||
        t.entryTime > t.exitTime ||
        t.entryTime < lastExit ||
        (t.entryTime - r.start) % intervals[r.config.interval] !== 0 ||
        (t.exitTime - r.start) % intervals[r.config.interval] !== 0 ||
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
    if (
      !r.metrics ||
      ![
        'netProfit',
        'returnPct',
        'benchmarkPct',
        'maxDrawdown',
        'winRate',
        'totalFees',
        'finalEquity',
      ].every((k) => finite(r.metrics[k as keyof Result['metrics']])) ||
      !['profitFactor', 'sharpe'].every(
        (k) => r.metrics[k as 'sharpe'] === null || finite(r.metrics[k as 'sharpe']),
      )
    )
      fail('geçersiz performans metrikleri.');
    if (
      Math.abs(r.equity.at(-1)!.value - r.metrics.finalEquity) > 1e-6 ||
      Math.abs(r.metrics.finalEquity - r.config.capital - r.metrics.netProfit) > 1e-6
    )
      fail('sermaye toplamları tutarsız.');
  }
}

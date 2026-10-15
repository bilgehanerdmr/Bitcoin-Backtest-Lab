import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backtest } from '../shared/engine';
import { demoCandles } from '../shared/demo';
import { defaultConfig } from '../shared/types';
import { patternStrategy } from '../shared/candle-rules';
import { validateBackup, type Backup } from '../shared/backup';
import { emptyWorkspace } from '../shared/workspace';
import { examplePython } from '../shared/python-strategy';
let market: typeof import('../server/market'), storage: typeof import('../server/storage');
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('DATABASE_PATH', ':memory:');
  market = await import('../server/market');
  storage = await import('../server/storage');
});
afterEach(() => {
  market.db.close();
  vi.unstubAllEnvs();
});
function fixture(): Backup {
  const candles = demoCandles('1m', 1704067200, 1704067200 + 99 * 60),
    config = {
      ...defaultConfig,
      strategy: 'custom' as const,
      custom: patternStrategy('engulfing'),
      interval: '1m' as const,
      mode: 'demo' as const,
      start: '2024-01-01',
      end: '2024-01-01',
    };
  const report = backtest(candles, config);
  return {
    format: 'bitcoin-lab-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    candles: candles.map((c) => ({ ...c, interval: '1m' })),
    backtests: [report],
    workspace: {
      presets: [{ name: 'Taşınan özel strateji', config }],
      defaults: { fee: 0.2, capital: 20000 },
    },
  };
}
describe('Portable local storage', () => {
  it('round-trips Python source in presets and reports without executing imported code', () => {
    const backup = fixture();
    const config = {
      ...backup.backtests[0].config,
      strategy: 'python' as const,
      python: {
        ...examplePython,
        source: "raise RuntimeError('Do not execute on import')\n" + examplePython.source,
      },
    };
    backup.backtests = [
      backtest(
        backup.candles,
        config,
        backup.candles.map(() => 'hold'),
      ),
    ];
    backup.workspace.presets = [{ name: 'Python yedeği', config }];
    storage.importBackup(backup);
    const restored = storage.exportBackup();
    expect(restored.backtests).toEqual(backup.backtests);
    expect(restored.workspace).toEqual(backup.workspace);
  });
  it('round-trips candles, full reports, custom rules, presets and defaults', () => {
    const backup = fixture();
    expect(() => validateBackup(backup)).not.toThrow();
    const summary = storage.importBackup(backup);
    expect(summary.candlesAdded).toBe(100);
    expect(summary.reportsAdded).toBe(1);
    expect(summary.presetsAdded).toBe(1);
    const exported = storage.exportBackup();
    expect(exported.candles).toEqual(backup.candles);
    expect(exported.backtests).toEqual(backup.backtests);
    expect(exported.workspace).toEqual(backup.workspace);
    expect(storage.readWorkspace()).toEqual(backup.workspace);
  });
  it('accepts reports across exchange outages only when the skipped candles are declared', () => {
    const backup = fixture();
    backup.backtests = [
      backtest(
        backup.candles.filter((_, i) => i !== 40),
        backup.backtests[0].config,
      ),
    ];
    expect(backup.backtests[0].missingCandles).toBe(1);
    expect(() => validateBackup(backup)).not.toThrow();
    const hidden = structuredClone(backup);
    delete hidden.backtests[0].missingCandles;
    expect(() => validateBackup(hidden)).toThrow(/eksik mum/);
    // Reports saved before outages were supported have no field and no holes.
    const legacy = fixture();
    delete legacy.backtests[0].missingCandles;
    expect(() => validateBackup(legacy)).not.toThrow();
  });
  it('does not duplicate records when the same backup is imported twice', () => {
    const backup = fixture();
    storage.importBackup(backup);
    const second = storage.importBackup(backup);
    expect(second).toMatchObject({
      candlesAdded: 0,
      candlesSkipped: 100,
      reportsAdded: 0,
      reportsSkipped: 1,
      presetsAdded: 0,
    });
  });
  it('preserves existing candles and reports on conflicting keys', () => {
    const backup = fixture();
    storage.importBackup(backup);
    const incoming = structuredClone(backup);
    incoming.candles[0].volume += 99;
    incoming.backtests[0].config.custom!.name = 'Changed';
    storage.importBackup(incoming);
    const actual = storage.exportBackup();
    expect(actual.candles[0]).toEqual(backup.candles[0]);
    expect(actual.backtests[0]).toEqual(backup.backtests[0]);
  });
  it('validates the complete file before making any changes', () => {
    const backup = fixture();
    storage.writeWorkspace({ presets: [], defaults: { capital: 12345 } });
    backup.backtests[0].equity[50].value = NaN;
    expect(() => storage.importBackup(backup)).toThrow(/sermaye eğrisi/);
    expect(storage.exportBackup().candles).toHaveLength(0);
    expect(storage.exportBackup().backtests).toHaveLength(0);
    expect(storage.readWorkspace()!.defaults.capital).toBe(12345);
  });
  it('rolls back every row if a database write fails mid-import', () => {
    const backup = fixture();
    market.db.exec(
      "CREATE TRIGGER reject_report BEFORE INSERT ON backtests BEGIN SELECT RAISE(ABORT,'test failure'); END;",
    );
    expect(() => storage.importBackup(backup)).toThrow(/test failure/);
    expect(storage.exportBackup().candles).toHaveLength(0);
    expect(storage.readWorkspace()).toBeNull();
  });
  it('deletes only chosen reports, retaining candles, other reports and templates', () => {
    const backup = fixture(),
      other = structuredClone(backup.backtests[0]);
    other.id = crypto.randomUUID();
    backup.backtests.push(other);
    storage.importBackup(backup);
    expect(storage.deleteReports([backup.backtests[0].id])).toEqual([backup.backtests[0].id]);
    const remaining = storage.exportBackup();
    expect(remaining.backtests.map((r) => r.id)).toEqual([other.id]);
    expect(remaining.candles).toHaveLength(100);
    expect(remaining.workspace).toEqual(backup.workspace);
    expect(storage.deleteReports([backup.backtests[0].id])).toEqual([]);
  });
  it('restores deleted reports from an earlier backup and supports bulk deletion', () => {
    const backup = fixture(),
      other = structuredClone(backup.backtests[0]);
    other.id = crypto.randomUUID();
    backup.backtests.push(other);
    storage.importBackup(backup);
    storage.deleteReports(backup.backtests.map((r) => r.id));
    expect(storage.exportBackup().backtests).toHaveLength(0);
    expect(storage.importBackup(backup).reportsAdded).toBe(2);
  });
  it('rejects deletion of malformed identifiers before touching any rows', () => {
    const backup = fixture();
    storage.importBackup(backup);
    expect(() => storage.deleteReports([backup.backtests[0].id, 'invalid'])).toThrow(/geçerli/);
    expect(storage.exportBackup().backtests).toHaveLength(1);
  });
  it('rejects unsupported backups, malformed OHLC, unclosed candles and invalid rules', () => {
    const backup = fixture();
    expect(() => storage.importBackup({ ...backup, version: 2 })).toThrow(/sürüm/);
    const bad = structuredClone(backup);
    bad.candles[0].high = 1;
    expect(() => storage.importBackup(bad)).toThrow(/mum verisi/);
    bad.candles[0] = { ...backup.candles[0], time: Math.floor(Date.now() / 60000) * 60 };
    expect(() => storage.importBackup(bad)).toThrow(/kapanmamış/);
    bad.candles = [];
    bad.workspace.presets[0].config.custom!.entry.rules[0].left.offset = -1;
    expect(() => storage.importBackup(bad)).toThrow(/geriye bakış/);
  });
  it('exports an empty workspace and accepts a valid empty backup', () => {
    const backup = storage.exportBackup();
    expect(backup.workspace).toEqual(emptyWorkspace());
    expect(() => storage.importBackup(backup)).not.toThrow();
  });
  it('rejects malformed dormant custom rules attached to a built-in strategy', () => {
    const backup = fixture();
    backup.workspace.presets[0].config.strategy = 'sma';
    backup.workspace.presets[0].config.custom!.entry.rules[0].left.offset = -1;
    expect(() => storage.importBackup(backup)).toThrow(/geriye bakış/);
    expect(storage.exportBackup().backtests).toHaveLength(0);
  });
});

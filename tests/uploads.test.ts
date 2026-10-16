import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backtest } from '../shared/engine';
import { validateBackup } from '../shared/backup';
import { uploadSource } from '../shared/upload';
import { defaultConfig } from '../shared/types';

let market: typeof import('../server/market'),
  uploads: typeof import('../server/uploads'),
  storage: typeof import('../server/storage');
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('DATABASE_PATH', ':memory:');
  market = await import('../server/market');
  uploads = await import('../server/uploads');
  storage = await import('../server/storage');
});
afterEach(() => {
  market.db.close();
  vi.unstubAllEnvs();
});
const T0 = 1704067200;
// Hourly candles 0..59 with hour 30 missing, in Turkish Excel format.
const csv = [
  'Tarih;Açılış;En Yüksek;En Düşük;Kapanış;Hacim',
  ...Array.from({ length: 60 }, (_, i) => i)
    .filter((i) => i !== 30)
    .map((i) => {
      const d = new Date((T0 + i * 3600) * 1000),
        day = `${d.getUTCDate()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`,
        time = `${String(d.getUTCHours()).padStart(2, '0')}:00`,
        p = 100 + (i % 7) - (i % 3);
      return `${day} ${time};${p},5;${p + 2},25;${p - 1};${p + 1},75;${10 + i},5`;
    }),
].join('\n');
const create = (overrides = {}) =>
  uploads.createUpload({ name: 'Excel verim', fileName: 'veri.csv', text: csv, ...overrides });

describe('Uploaded datasets', () => {
  it('stores the parsed file and serves it for charts and backtests', () => {
    const meta = create();
    expect(meta).toMatchObject({
      name: 'Excel verim',
      fileName: 'veri.csv',
      interval: '1h',
      count: 59,
      start: T0,
      end: T0 + 59 * 3600,
      missing: 1,
      hasVolume: true,
    });
    expect(uploads.listUploads()).toEqual([meta]);
    expect(uploads.latestUploadCandles(meta.id, 2).map((c) => c.time)).toEqual([
      T0 + 58 * 3600,
      T0 + 59 * 3600,
    ]);
    const candles = uploads.uploadCandles(meta.id, T0, T0 + 40 * 3600);
    expect(candles[0]).toEqual({
      time: T0,
      open: 100.5,
      high: 102.25,
      low: 99,
      close: 101.75,
      volume: 10.5,
    });
    const result = backtest(candles, {
      ...defaultConfig,
      dataset: meta.id,
      interval: '1h',
      start: '2024-01-01',
      end: '2024-01-02',
      fast: 2,
      slow: 5,
    });
    expect(result.candleCount).toBe(40);
    expect(result.missingCandles).toBe(1);
  });
  it('rejects what the parser rejects, bad settings and bad names, storing nothing', () => {
    expect(() => create({ text: 'time,open\n1,2' })).toThrow();
    expect(() => create({ options: { delimiter: '|' } })).toThrow(/okuma ayarları/);
    expect(() =>
      create({
        options: { columns: { time: 0, open: 1, high: 2, low: 3, close: null, volume: 5 } },
      }),
    ).toThrow(/okuma ayarları/);
    expect(() => create({ name: ' ' })).toThrow(/1–60/);
    expect(uploads.listUploads()).toEqual([]);
  });
  it('honours the column settings confirmed in the preview', () => {
    const meta = create({
      options: { columns: { time: 0, open: 1, high: 2, low: 3, close: 4, volume: null } },
    });
    expect(meta.hasVolume).toBe(false);
    expect(uploads.uploadCandles(meta.id).every((c) => c.volume === 0)).toBe(true);
  });
  it('deletes a dataset and its candles', () => {
    const meta = create();
    expect(uploads.deleteUpload(meta.id)).toBe(true);
    expect(uploads.deleteUpload(meta.id)).toBe(false);
    expect(uploads.uploadCandles(meta.id)).toEqual([]);
  });
  it('round-trips datasets and their reports through a backup', () => {
    const meta = create(),
      report = backtest(uploads.uploadCandles(meta.id), {
        ...defaultConfig,
        dataset: meta.id,
        interval: '1h',
        start: '2024-01-01',
        end: '2024-01-03',
        fast: 2,
        slow: 5,
      });
    report.source = uploadSource(meta.name);
    storage.saveReport(report);
    const backup = JSON.parse(JSON.stringify(storage.exportBackup()));
    expect(() => validateBackup(backup)).not.toThrow();
    market.db.exec('DELETE FROM uploads; DELETE FROM upload_candles; DELETE FROM backtests;');
    expect(storage.importBackup(backup)).toMatchObject({
      uploadsAdded: 1,
      uploadsSkipped: 0,
      reportsAdded: 1,
    });
    expect(storage.importBackup(backup)).toMatchObject({ uploadsAdded: 0, uploadsSkipped: 1 });
    expect(uploads.readUpload(meta.id)).toEqual(meta);
    expect(uploads.uploadCandles(meta.id)).toHaveLength(59);
    const off = structuredClone(backup);
    off.uploads[0].candles[5].time += 1800;
    expect(() => validateBackup(off)).toThrow(/yüklenen veri seti/);
    const miscounted = structuredClone(backup);
    miscounted.uploads[0].upload.missing = 0;
    expect(() => validateBackup(miscounted)).toThrow(/yüklenen veri seti/);
    const relabelled = structuredClone(backup);
    relabelled.backtests[0].source = 'Binance Spot';
    expect(() => validateBackup(relabelled)).toThrow(/rapor veri yapısı/);
  });
});

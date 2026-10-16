import { describe, expect, it } from 'vitest';
import { parseCandleCsv } from '../shared/upload';
import { backtest } from '../shared/engine';
import { defaultConfig } from '../shared/types';

const T0 = 1704067200; // 2024-01-01 00:00 UTC
const prices = (i: number) => ({ open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i });

describe('Reading candles from CSV files', () => {
  it('reads a headerless Binance archive with microsecond timestamps', () => {
    const text = Array.from({ length: 5 }, (_, i) => {
      const p = prices(i),
        t = (T0 + i * 3600) * 1e6;
      return [t, p.open, p.high, p.low, p.close, 12.5, t + 3599999999, 1000, 42, 6, 500, 0].join(
        ',',
      );
    }).join('\n');
    const r = parseCandleCsv(text);
    expect(r.errors).toEqual([]);
    expect(r.options).toMatchObject({ delimiter: ',', decimal: '.', header: false });
    expect(r.timeFormat).toBe('microseconds');
    expect(r.interval).toBe('1h');
    expect(r.candles[0]).toEqual({ time: T0, ...prices(0), volume: 12.5 });
    expect(r.candles).toHaveLength(5);
  });
  it('reads a TradingView export by column name, ignoring indicator columns', () => {
    const text = [
      'time,open,high,low,close,MA,Volume',
      ...Array.from({ length: 4 }, (_, i) => {
        const p = prices(i);
        return [T0 + i * 900, p.open, p.high, p.low, p.close, 'NaN', 3].join(',');
      }),
    ].join('\n');
    const r = parseCandleCsv(text);
    expect(r.errors).toEqual([]);
    expect(r.options.columns).toEqual({ time: 0, open: 1, high: 2, low: 3, close: 4, volume: 6 });
    expect(r.interval).toBe('15m');
    expect(r.timeFormat).toBe('seconds');
  });
  it('reads Turkish Excel output: semicolons, decimal commas, thousands dots, d.m.yyyy dates', () => {
    const text = [
      'Tarih;Açılış;En Yüksek;En Düşük;Kapanış;Hacim',
      '1.01.2024 00:00;42.150,5;42.300,75;42.000;42.250,25;1.234,5',
      '2.01.2024 00:00;42.250,25;43.000;42.100;42.900;987,25',
      '3.01.2024 00:00;42.900;43.100;41.000,5;41.500;2.000',
    ].join('\r\n');
    const r = parseCandleCsv('﻿' + text);
    expect(r.errors).toEqual([]);
    expect(r.options).toMatchObject({ delimiter: ';', decimal: ',', header: true });
    expect(r.interval).toBe('1d');
    expect(r.candles[0]).toEqual({
      time: T0,
      open: 42150.5,
      high: 42300.75,
      low: 42000,
      close: 42250.25,
      volume: 1234.5,
    });
    expect(r.warnings).toContain('Saat dilimi belirtilmeyen tarihler UTC kabul edildi.');
  });
  it('converts ISO dates with a time zone offset to UTC', () => {
    // Daily candles that open at midnight Istanbul time (21:00 UTC).
    const text = [
      'date,open,high,low,close,volume',
      '2024-01-01T00:00:00+03:00,1,2,0.5,1.5,1',
      '2024-01-02T00:00:00+03:00,1.5,2,1,1.2,1',
      '2024-01-03T00:00:00+03:00,1.2,1.4,1,1.3,1',
    ].join('\n');
    const r = parseCandleCsv(text);
    expect(r.errors).toEqual([]);
    expect(r.candles.map((c) => c.time)).toEqual([T0 - 3 * 3600, T0 + 21 * 3600, T0 + 45 * 3600]);
    expect(r.warnings).toEqual([]);
    // The engine accepts a series on its own grid, not only midnight-aligned days.
    expect(() =>
      backtest(
        r.candles,
        {
          ...defaultConfig,
          interval: '1d',
          start: '2023-12-31',
          end: '2024-01-03',
          fast: 2,
          slow: 3,
        },
        undefined,
      ),
    ).toThrow(/En az 6/);
  });
  it('skips and reports bad rows, removes exact duplicates, sorts, and counts gaps', () => {
    const row = (i: number, change = {}) => {
      const p = { ...prices(i), ...change };
      return [T0 + i * 60, p.open, p.high, p.low, p.close, 1].join(',');
    };
    const text = [
      'time,open,high,low,close,volume',
      row(2),
      row(0),
      row(1),
      row(1),
      row(3, { high: 50 }),
      'abc,1,2,0.5,1,1',
      row(4).replace(/,1$/, ',x'),
      row(6),
    ].join('\n');
    const r = parseCandleCsv(text);
    expect(r.errors).toEqual([]);
    expect(r.candles.map((c) => (c.time - T0) / 60)).toEqual([0, 1, 2, 6]);
    expect(r.duplicates).toBe(1);
    expect(r.skippedCount).toBe(3);
    expect(r.skipped).toEqual([
      { line: 6, reason: expect.stringMatching(/tutarsız/) },
      { line: 7, reason: expect.stringMatching(/Zaman okunamadı/) },
      { line: 8, reason: 'Sayı okunamadı.' },
    ]);
    expect(r.missing).toBe(3);
    expect(r.warnings.join(' ')).toMatch(/sıralandı.*3 hatalı satır.*1 yinelenen.*3 mum eksik/);
  });
  it('accepts a file without volume and says so', () => {
    const text = Array.from({ length: 3 }, (_, i) => {
      const p = prices(i);
      return [T0 + i * 1800, p.open, p.high, p.low, p.close].join(';');
    }).join('\n');
    const r = parseCandleCsv(text);
    expect(r.errors).toEqual([]);
    expect(r.interval).toBe('30m');
    expect(r.options.columns.volume).toBeNull();
    expect(r.candles.every((c) => c.volume === 0)).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/Hacim sütunu yok/);
  });
  it('lets the user map columns that the header names do not reveal', () => {
    const text = [
      'a,b,c,d,e,f',
      ...Array.from({ length: 3 }, (_, i) => {
        const p = prices(i);
        return [p.close, p.open, p.high, p.low, T0 + i * 3600, 1].join(',');
      }),
    ].join('\n');
    expect(parseCandleCsv(text).errors[0]).toMatch(/bulunamadı.*elle seçin/);
    const r = parseCandleCsv(text, {
      columns: { time: 4, open: 1, high: 2, low: 3, close: 0, volume: 5 },
    });
    expect(r.errors).toEqual([]);
    expect(r.candles[2]).toEqual({ time: T0 + 7200, ...prices(2), volume: 1 });
  });
  it.each([
    ['', /boş/],
    ['time open high low close\n1 2 3 4 5', /ayrılamadı/],
    ['time,open,high,low,close\n1,2', /Geçerli satır bulunamadı/],
    [
      ['time,open,high,low,close,volume', `${T0},1,2,0.5,1,1`, `${T0},1,3,0.5,1,1`].join('\n'),
      /aynı zaman.*farklı değerler/,
    ],
    [
      [
        'time,open,high,low,close,volume',
        ...[0, 1, 2].map((i) => `${T0 + i * 604800},1,2,0.5,1,1`),
      ].join('\n'),
      /7 gün.*desteklenmiyor/,
    ],
    [
      [
        'time,open,high,low,close,volume',
        ...[0, 3600, 7200, 9000].map((d) => `${T0 + d},1,2,0.5,1,1`),
      ].join('\n'),
      /uyuşmuyor/,
    ],
    [['date,open,high,low,close', '45292,1,2,0.5,1', '45293,1,2,0.5,1'].join('\n'), /Excel tarih/],
  ])('rejects files that cannot be read without changing their meaning (%#)', (text, error) => {
    const r = parseCandleCsv(text);
    expect(r.errors[0]).toMatch(error);
    expect(r.candles).toEqual([]);
  });
});

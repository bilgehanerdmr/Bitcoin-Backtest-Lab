import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateConfig, validateLiveRange } from '../shared/engine';
import { defaultConfig, symbolOf, type Config } from '../shared/types';

const config: Config = { ...defaultConfig, start: '2024-01-01', end: '2024-01-02' };
let market: typeof import('../server/market') | undefined, dir: string | undefined;
afterEach(() => {
  market?.db.close();
  market = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function open(file: string) {
  vi.resetModules();
  vi.stubEnv('DATABASE_PATH', file);
  market = await import('../server/market');
  return market;
}

describe('Trading pair in configurations', () => {
  it('accepts Binance USDT spot pairs and treats configs without one as BTCUSDT', () => {
    for (const symbol of ['BTCUSDT', 'ETHUSDT', '1000SATSUSDT', 'TUSDT'])
      expect(() => validateConfig({ ...config, symbol })).not.toThrow();
    const { symbol: _symbol, ...legacy } = config;
    expect(() => validateConfig(legacy)).not.toThrow();
    expect(symbolOf(legacy as Config)).toBe('BTCUSDT');
  });
  it('rejects other quote assets and malformed pairs', () => {
    for (const symbol of ['BTCTRY', 'ethusdt', 'USDT', 'BTC-USDT', '', 42])
      expect(() => validateConfig({ ...config, symbol: symbol as string })).toThrow(/USDT spot/);
  });
  it('applies the known BTCUSDT listing date only to BTCUSDT', () => {
    const early = { ...config, mode: 'live' as const, start: '2017-01-01', end: '2017-02-01' };
    expect(() => validateLiveRange(early)).toThrow(/2017-08-17/);
    expect(() => validateLiveRange({ ...early, symbol: 'ETHUSDT' })).not.toThrow();
  });
});

describe('Candle cache by trading pair', () => {
  it('moves a pre-multi-coin database under BTCUSDT without losing rows', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'lab-migrate-'));
    const file = path.join(dir, 'lab.sqlite'),
      legacy = new DatabaseSync(file);
    legacy.exec(
      'CREATE TABLE candles (interval TEXT, time INTEGER, open REAL, high REAL, low REAL, close REAL, volume REAL, PRIMARY KEY(interval,time)); CREATE TABLE backtests (id TEXT PRIMARY KEY, created_at TEXT, payload TEXT); CREATE TABLE candle_gaps (interval TEXT, time INTEGER, PRIMARY KEY(interval,time));',
    );
    const insert = legacy.prepare('INSERT INTO candles VALUES (?,?,?,?,?,?,?)');
    for (let i = 0; i < 50; i++) insert.run('1h', 1704067200 + i * 3600, 100, 102, 98, 101, i);
    insert.run('1m', 1704067200, 100.5, 101, 100, 100.25, 0.125);
    legacy.prepare('INSERT INTO candle_gaps VALUES (?,?)').run('1h', 1704067200 + 50 * 3600);
    legacy.prepare('INSERT INTO backtests VALUES (?,?,?)').run('r1', '2024-01-01', '{"x":1}');
    legacy.close();
    let m = await open(file);
    const rows = () =>
      m.db
        .prepare('SELECT * FROM candles ORDER BY symbol,interval,time')
        .all() as unknown as Record<string, unknown>[];
    expect(rows()).toHaveLength(51);
    expect(new Set(rows().map((r) => r.symbol))).toEqual(new Set(['BTCUSDT']));
    expect(rows()[0]).toEqual({
      symbol: 'BTCUSDT',
      interval: '1h',
      time: 1704067200,
      open: 100,
      high: 102,
      low: 98,
      close: 101,
      volume: 0,
    });
    expect(m.db.prepare('SELECT * FROM candle_gaps').all()).toEqual([
      { symbol: 'BTCUSDT', interval: '1h', time: 1704067200 + 50 * 3600 },
    ]);
    expect(m.db.prepare('SELECT * FROM backtests').all()).toEqual([
      { id: 'r1', created_at: '2024-01-01', payload: '{"x":1}' },
    ]);
    const key = (m.db.prepare('PRAGMA table_info(candles)').all() as { name: string; pk: number }[])
      .filter((c) => c.pk)
      .map((c) => c.name);
    expect(key).toEqual(['symbol', 'interval', 'time']);
    // Reopening an already migrated database leaves it as it is.
    const before = rows();
    m.db.close();
    m = await open(file);
    expect(rows()).toEqual(before);
    // The migrated rows serve BTCUSDT requests from the cache, without the network.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await m.getCandles('BTCUSDT', '1h', 1704067200, 1704067200 + 50 * 3600)).toHaveLength(
      50,
    );
  });
  it('keeps each pair separate in requests, the cache and confirmed gaps', async () => {
    const m = await open(':memory:'),
      start = 1704067200,
      requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const params = new URL(url).searchParams,
          symbol = params.get('symbol')!,
          from = Number(params.get('startTime')) / 1000,
          price = symbol === 'BTCUSDT' ? 100 : 2;
        requested.push(symbol);
        const rows = [];
        // ETHUSDT has an outage at hour 2; BTCUSDT does not.
        for (let t = from; t <= start + 5 * 3600; t += 3600)
          if (symbol !== 'ETHUSDT' || t !== start + 2 * 3600)
            rows.push([t * 1000, price, price + 1, price - 1, price, 1]);
        return new Response(JSON.stringify(rows));
      }),
    );
    const btc = await m.getCandles('BTCUSDT', '1h', start, start + 4 * 3600),
      eth = await m.getCandles('ETHUSDT', '1h', start, start + 4 * 3600);
    expect(btc.map((b) => b.close)).toEqual([100, 100, 100, 100, 100]);
    expect(eth.map((b) => (b.time - start) / 3600)).toEqual([0, 1, 3, 4]);
    expect(eth.every((b) => b.close === 2)).toBe(true);
    expect(requested).toEqual(['BTCUSDT', 'ETHUSDT']);
    // Cached per pair: neither is downloaded again, and BTC never inherits ETH's gap.
    expect(await m.getCandles('BTCUSDT', '1h', start, start + 4 * 3600)).toEqual(btc);
    expect(await m.getCandles('ETHUSDT', '1h', start, start + 4 * 3600)).toEqual(eth);
    expect(requested).toHaveLength(2);
    m.storeClosedCandle('SOLUSDT', '1h', { ...btc[0], close: 101, high: 102 });
    expect(m.db.prepare('SELECT symbol, close FROM candles WHERE symbol=?').all('SOLUSDT')).toEqual(
      [{ symbol: 'SOLUSDT', close: 101 }],
    );
  });
});

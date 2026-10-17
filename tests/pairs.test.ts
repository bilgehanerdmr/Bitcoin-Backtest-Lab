import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { priceDecimals, stepDecimals } from '../shared/pairs';
import { validateLiveRange } from '../shared/engine';
import { defaultConfig } from '../shared/types';

let market: typeof import('../server/market'), pairs: typeof import('../server/pairs');
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('DATABASE_PATH', ':memory:');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 0, 10));
  market = await import('../server/market');
  pairs = await import('../server/pairs');
});
afterEach(() => {
  market.db.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const symbol = (s: string, base: string, quote: string, tick: string, extra = {}) => ({
  symbol: s,
  baseAsset: base,
  quoteAsset: quote,
  status: 'TRADING',
  isSpotTradingAllowed: true,
  filters: [
    { filterType: 'PRICE_FILTER', tickSize: tick },
    { filterType: 'LOT_SIZE', stepSize: '0.00001000' },
  ],
  ...extra,
});
const exchangeInfo = {
  symbols: [
    symbol('SHIBUSDT', 'SHIB', 'USDT', '0.00000001'),
    symbol('BTCUSDT', 'BTC', 'USDT', '0.01000000'),
    symbol('ETHBTC', 'ETH', 'BTC', '0.00001000'),
    symbol('币安人生USDT', '币安人生', 'USDT', '0.00001000'),
    symbol('HALTUSDT', 'HALT', 'USDT', '0.01', { status: 'BREAK' }),
    symbol('MARGINUSDT', 'MARGIN', 'USDT', '0.01', { isSpotTradingAllowed: false }),
  ],
};
function binance(overrides: Record<string, () => Response> = {}) {
  const fetch = vi.fn(async (url: string) => {
    const path = new URL(url).pathname.split('/').at(-1)!;
    if (overrides[path]) return overrides[path]();
    if (path === 'exchangeInfo') return new Response(JSON.stringify(exchangeInfo));
    if (path === 'klines')
      return new Response(JSON.stringify([[1621036800000, '1', '1', '1', '1', '1']]));
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const calls = (fetch: ReturnType<typeof binance>, path: string) =>
  fetch.mock.calls.filter(([url]) => new URL(url as string).pathname.endsWith(path)).length;

describe('Binance USDT spot pairs', () => {
  it('keeps only tradable USDT spot pairs the app can address, with their steps', async () => {
    const fetch = binance();
    expect(await pairs.listPairs()).toEqual([
      {
        symbol: 'BTCUSDT',
        base: 'BTC',
        tickSize: '0.01000000',
        stepSize: '0.00001000',
        listed: null,
      },
      {
        symbol: 'SHIBUSDT',
        base: 'SHIB',
        tickSize: '0.00000001',
        stepSize: '0.00001000',
        listed: null,
      },
    ]);
    const url = new URL(fetch.mock.calls[0][0] as string);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      permissions: 'SPOT',
      symbolStatus: 'TRADING',
    });
  });
  it('refreshes the list once a day and serves the last list if Binance is unreachable', async () => {
    const fetch = binance();
    await pairs.listPairs();
    vi.setSystemTime(Date.UTC(2026, 0, 10, 23));
    await pairs.listPairs();
    expect(calls(fetch, 'exchangeInfo')).toBe(1);
    vi.setSystemTime(Date.UTC(2026, 0, 11, 1));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect((await pairs.listPairs()).map((p) => p.symbol)).toEqual(['BTCUSDT', 'SHIBUSDT']);
  });
  it('fails clearly when no list was ever loaded and Binance is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(pairs.listPairs()).rejects.toMatchObject({ status: 502 });
  });
  it('looks up a listing date once, from the first daily candle', async () => {
    const fetch = binance();
    expect(await pairs.pairInfo('SHIBUSDT')).toMatchObject({ listed: 1621036800 });
    expect(await pairs.pairInfo('SHIBUSDT')).toMatchObject({ listed: 1621036800 });
    expect(calls(fetch, 'klines')).toBe(1);
    const first = new URL(
      fetch.mock.calls.find(([u]) => (u as string).includes('klines'))![0] as string,
    );
    expect(Object.fromEntries(first.searchParams)).toMatchObject({
      symbol: 'SHIBUSDT',
      interval: '1d',
      startTime: '0',
      limit: '1',
    });
    expect(await pairs.pairInfo('ETHBTC')).toBeNull();
  });
  it('reports a pair Binance does not know as the user’s error, not an outage', async () => {
    binance({
      klines: () =>
        new Response(JSON.stringify({ code: -1121, msg: 'Invalid symbol.' }), { status: 400 }),
    });
    const error = await market.getCandles('NOPEUSDT', '1h', 1704067200, 1704070800).catch((e) => e);
    expect(error.message).toMatch(/tanımıyor: NOPEUSDT/);
    expect(error.status).toBeUndefined();
  });
});

describe('Pair-specific display and ranges', () => {
  it('derives decimals from Binance steps and from prices without one', () => {
    expect([stepDecimals('0.01000000'), stepDecimals('0.00000001'), stepDecimals('1.00')]).toEqual([
      2, 8, 0,
    ]);
    expect([42000, 2.5, 0.5, 0.00001234].map(priceDecimals)).toEqual([2, 4, 4, 8]);
  });
  it('checks live ranges against a listing date reported for the pair', () => {
    const shib = { ...defaultConfig, symbol: 'SHIBUSDT', start: '2021-01-01', end: '2021-06-01' };
    expect(() => validateLiveRange(shib, '2021-05-10')).toThrow(/SHIB \/ USDT verileri 2021-05-10/);
    expect(() => validateLiveRange(shib)).not.toThrow();
    expect(() => validateLiveRange({ ...shib, start: '2021-05-10' }, '2021-05-10')).not.toThrow();
  });
});

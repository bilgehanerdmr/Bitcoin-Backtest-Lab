import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { intervals } from '../shared/types';
let market: typeof import('../server/market');
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('DATABASE_PATH', ':memory:');
  market = await import('../server/market');
});
afterEach(() => {
  market.db.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const start = 1704067200;
const row = (time: number, step = 3600) => [
  time * 1000,
  '100',
  '102',
  '98',
  '101',
  '25',
  (time + step) * 1000 - 1,
];
describe('Historical data provider', () => {
  it.each(['1m', '1h'] as const)(
    'paginates and caches more than 1000 %s candles',
    async (interval) => {
      const step = intervals[interval];
      const fetch = vi.fn(async (url: string) => {
        const params = new URL(url).searchParams,
          cursor = Number(params.get('startTime')) / 1000;
        expect(params.get('interval')).toBe(interval);
        const remaining = Math.floor((start + 1200 * step - cursor) / step) + 1;
        return new Response(
          JSON.stringify(
            Array.from({ length: Math.min(1000, remaining) }, (_, i) =>
              row(cursor + i * step, step),
            ),
          ),
        );
      });
      vi.stubGlobal('fetch', fetch);
      const data = await market.getCandles(interval, start, start + 1200 * step);
      expect(data).toHaveLength(1201);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(data[0].time).toBe(start);
      expect(data.at(-1)!.time).toBe(start + 1200 * step);
      expect(await market.getCandles(interval, start, start + 1200 * step)).toEqual(data);
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );
  // Binance answers from startTime onward, so a later candle proves the skipped ones never existed.
  const outage = (missing: number[]) =>
    vi.fn(async (url: string) => {
      const cursor = Number(new URL(url).searchParams.get('startTime')) / 1000,
        rows = [];
      for (let t = cursor; t <= start + 20 * 3600; t += 3600)
        if (!missing.includes((t - start) / 3600)) rows.push(row(t));
      return new Response(JSON.stringify(rows));
    });
  it('skips candles Binance never produced and remembers the outage', async () => {
    const fetch = outage([3, 4, 5]);
    vi.stubGlobal('fetch', fetch);
    const data = await market.getCandles('1h', start, start + 10 * 3600);
    expect(data.map((b) => (b.time - start) / 3600)).toEqual([0, 1, 2, 6, 7, 8, 9, 10]);
    expect(await market.getCandles('1h', start, start + 10 * 3600)).toEqual(data);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('confirms an outage at the end of the range from the next available candle', async () => {
    vi.stubGlobal('fetch', outage([3, 4, 5]));
    const data = await market.getCandles('1h', start, start + 4 * 3600);
    expect(data.map((b) => (b.time - start) / 3600)).toEqual([0, 1, 2]);
  });
  it('rejects a range that falls entirely inside an outage', async () => {
    vi.stubGlobal('fetch', outage([3, 4, 5]));
    await expect(market.getCandles('1h', start + 3 * 3600, start + 5 * 3600)).rejects.toThrow(
      /borsa kesintisi/,
    );
  });
  it('rejects incomplete historical ranges instead of quietly testing partial data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]')));
    await expect(market.getCandles('1h', start, start + 5 * 3600)).rejects.toThrow(
      /Eksik tarihsel veri/,
    );
  });
  it.each(['1m', '1h'] as const)('excludes the currently forming %s candle', async (interval) => {
    // A frozen clock: if the candle closed between these reads, it would rightly be included.
    vi.useFakeTimers({ toFake: ['Date'] });
    const step = intervals[interval];
    const now = Math.floor(Date.now() / 1000 / step) * step;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([row(now - step, step), row(now, step)]))),
    );
    const data = await market.getCandles(interval, now - step, now + 10);
    expect(data).toHaveLength(1);
    expect(data[0].time).toBe(now - step);
  });
  it('backs off across requests when Binance sends 429', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(market.binance('ticker/24hr')).rejects.toMatchObject({
      status: 503,
      message: expect.stringMatching(/istek sınırı/),
    });
    await expect(market.binance('ticker/24hr')).rejects.toMatchObject({
      status: 503,
      message: expect.stringMatching(/Biraz sonra/),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('turns network failures into an actionable error without fabricating data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(market.getCandles('1h', start, start + 3600)).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/Binance bağlantısı kurulamadı/),
    });
    expect(market.db.prepare('SELECT COUNT(*) AS count FROM candles').get()).toMatchObject({
      count: 0,
    });
  });
});

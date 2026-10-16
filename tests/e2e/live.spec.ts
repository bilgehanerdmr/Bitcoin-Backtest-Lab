import { test, expect } from '@playwright/test';
import type { Candle, Result } from '../../shared/types';
import type { PaperDetail } from '../../shared/paper';
test('one-minute real Binance chart and full-day historical backtest', async ({
  page,
  request,
}) => {
  test.skip(
    process.env.LIVE_TESTS !== '1',
    'Opt-in integration test requires Binance network access.',
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const chartResponse = page.waitForResponse(
    (r) => r.url().includes('/api/candles?') && r.url().includes('interval=1m'),
  );
  await page.getByRole('button', { name: '1m', exact: true }).click();
  const response = await chartResponse;
  expect(response.ok()).toBe(true);
  const { candles }: { candles: Candle[] } = await response.json();
  expect(candles.length).toBeGreaterThan(400);
  expect(candles.every((c, i) => !i || c.time - candles[i - 1].time === 60)).toBe(true);
  expect(candles.at(-1)!.time * 1000 + 60000).toBeLessThanOrEqual(Date.now());
  await expect(page.locator('.price-chart canvas').first()).toBeVisible();
  await expect(page.locator('.connection')).toContainText('CANLI BAĞLANTI', { timeout: 30000 });
  await page.getByRole('combobox', { name: 'Zaman dilimi', exact: true }).selectOption('1m');
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await page.getByLabel('Başlangıç · UTC').fill(day);
  await page.getByLabel('Bitiş · UTC').fill(day);
  const backtestResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/backtests') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Backtest Başlat', exact: true }).click();
  const completed = await backtestResponse;
  expect(completed.ok()).toBe(true);
  const result: Result = await completed.json();
  expect(result.source).toBe('Binance Spot');
  expect(result.config.interval).toBe('1m');
  expect(result.candleCount).toBe(1440);
  expect(result.end - result.start).toBe(1439 * 60);
  expect(result.metrics.netProfit).toBeCloseTo(
    result.trades.reduce((sum, t) => sum + t.pnl, 0),
    6,
  );
  const saved: Result = await (await request.get('/api/backtests/' + result.id)).json();
  expect(saved.config.interval).toBe('1m');
  expect(saved.candleCount).toBe(1440);
  await expect(page.locator('.results-panel .tiny-badge')).toHaveText('BINANCE');
  expect(errors).toEqual([]);
});
test('real Binance ticker, closed candles, WebSocket updates and historical backtest', async ({
  page,
  request,
}) => {
  test.skip(
    process.env.LIVE_TESTS !== '1',
    'Opt-in integration test requires Binance network access.',
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ticker = await request.get('/api/ticker');
  expect(ticker.ok()).toBe(true);
  expect(Number((await ticker.json()).lastPrice)).toBeGreaterThan(0);
  await page.goto('/');
  await expect(page.locator('.price-chart canvas').first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.connection')).toContainText('CANLI BAĞLANTI', { timeout: 30000 });
  const before = await page.locator('.price-metric .metric-sub').textContent();
  await expect.poll(() => page.locator('.price-metric .metric-sub').textContent()).not.toBe(before);
  await page
    .getByLabel('Başlangıç · UTC')
    .fill(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Backtest Başlat', exact: true }).click();
  await expect(page.locator('.performance-metrics')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.results-panel .tiny-badge')).toHaveText('BINANCE');
  await page.screenshot({ path: 'test-results/live-backtest-desktop.png', fullPage: true });
  const saved = await (await request.get('/api/backtests')).json();
  const result = await (
    await request.get(
      '/api/backtests/' +
        saved.find((r: { config: { mode: string } }) => r.config.mode === 'live').id,
    )
  ).json();
  expect(result.source).toBe('Binance Spot');
  expect(result.candleCount).toBeGreaterThan(150);
  expect(result.end * 1000 + 3600000).toBeLessThanOrEqual(Date.now());
  expect(result.metrics.finalEquity).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
test('real Binance paper session trades on closed 1m candles from the WebSocket', async ({
  page,
  request,
}) => {
  test.skip(
    process.env.LIVE_TESTS !== '1',
    'Opt-in integration test requires Binance network access.',
  );
  // Three traded one-minute candles plus the warmup candle that closes after the start.
  test.setTimeout(8 * 60000);
  const config = {
    strategy: 'sma',
    interval: '1m',
    start: '2026-01-01',
    end: '2026-01-01',
    capital: 10000,
    allocation: 95,
    fee: 0.1,
    slippage: 0.05,
    stopLoss: 3,
    takeProfit: 6,
    fast: 3,
    slow: 8,
    rsiPeriod: 14,
    rsiBuy: 30,
    rsiSell: 70,
    lookback: 20,
    mode: 'live',
  };
  const existing: PaperDetail[] = await (await request.get('/api/paper')).json();
  for (const session of existing.filter((s) => s.status !== 'stopped'))
    await request.post(`/api/paper/${session.id}/stop`);
  const started = await request.post('/api/paper', { data: { config, warmup: 60 } });
  expect(started.ok()).toBe(true);
  const id: string = (await started.json()).id;
  const read = async (): Promise<PaperDetail> => (await request.get('/api/paper/' + id)).json();
  // Warmup came from REST; the stream connects to the 1m kline channel.
  expect((await read()).candleCount).toBeGreaterThanOrEqual(50);
  await expect.poll(async () => (await read()).feed, { timeout: 60000 }).toBe('live');
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Canlı Test', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Canlı test oturumu' })).toContainText(
    'Canlı akış',
  );
  // The REST fallback waits 15 s after a close, so a candle processed sooner came from the
  // WebSocket's closed-kline event.
  const before = (await read()).lastProcessed!;
  let delay = Infinity;
  await expect
    .poll(
      async () => {
        const s = await read();
        if (s.lastProcessed! > before) delay = Date.now() / 1000 - (s.lastProcessed! + 60);
        return s.lastProcessed! > before;
      },
      { timeout: 2 * 60000, intervals: [1000] },
    )
    .toBe(true);
  expect(delay).toBeLessThan(14);
  await expect
    .poll(async () => (await read()).tradingCandles, { timeout: 5 * 60000, intervals: [5000] })
    .toBeGreaterThanOrEqual(3);
  const live = await read();
  expect(live.status).toBe('running');
  expect(live.equity.every((p, i) => !i || p.time - live.equity[i - 1].time === 60)).toBe(true);
  const compared: PaperDetail = await (await request.post(`/api/paper/${id}/compare`)).json();
  expect(compared.comparison).toMatchObject({ identical: true, differences: [] });
  const stopped: PaperDetail = await (await request.post(`/api/paper/${id}/stop`)).json();
  expect(stopped.status).toBe('stopped');
  const report: Result = await (await request.get('/api/backtests/' + stopped.reportId)).json();
  expect(report.source).toBe('Binance Spot');
  expect(report.paper).toMatchObject({ kind: 'session', sessionId: id });
  expect(report.candleCount).toBe(stopped.tradingCandles);
});

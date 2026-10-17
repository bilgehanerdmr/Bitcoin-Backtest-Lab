import { test, expect, type Page } from '@playwright/test';
import type { Result } from '../../shared/types';
import type { PaperDetail, PaperView } from '../../shared/paper';

// Without LIVE_TESTS these run against the local Binance stand-in, which lists BTC, ETH, SOL and
// SHIB against USDT with Binance's own price steps and listing days.
const live = process.env.LIVE_TESTS === '1';
async function pick(page: Page, query: string) {
  await page.getByRole('button', { name: /^İşlem çifti: / }).click();
  await page.getByRole('combobox', { name: 'İşlem çifti ara' }).fill(query);
  await page.getByRole('combobox', { name: 'İşlem çifti ara' }).press('Enter');
}
async function backtest(page: Page): Promise<Result> {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/backtests') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Backtest Başlat', exact: true }).click();
  const completed = await response;
  expect(completed.ok(), await completed.text()).toBe(true);
  return completed.json();
}

test('picks another USDT pair from the searchable list, backtests it and labels its report', async ({
  page,
}) => {
  test.skip(live, 'Uses the pairs of the local Binance stand-in.');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.chart-panel h2')).toHaveText('BTC / USDT');
  await page.getByRole('button', { name: 'İşlem çifti: BTC / USDT' }).click();
  const list = page.getByRole('listbox', { name: 'İşlem çiftleri' });
  await expect(list.getByRole('option')).toHaveText([
    'BTC / USDT',
    'ETH / USDT',
    'SOL / USDT',
    'SHIB / USDT',
  ]);
  await expect(page.locator('.pair-picker small')).toHaveText('4 USDT spot çifti');
  await page.getByRole('combobox', { name: 'İşlem çifti ara' }).fill('xyz');
  await expect(page.locator('.pair-picker small')).toHaveText('Eşleşen USDT çifti yok.');
  await page.getByRole('combobox', { name: 'İşlem çifti ara' }).fill('et');
  await list.getByRole('option', { name: 'ETH / USDT' }).click();
  await expect(page.getByRole('button', { name: 'İşlem çifti: ETH / USDT' })).toBeVisible();
  await expect(list).toHaveCount(0);
  await expect(page.locator('.chart-panel h2')).toHaveText('ETH / USDT');
  await expect(page.locator('.price-metric').first()).toContainText('ETH / USDT');
  await expect(page.locator('.price-metric .metric-value').first()).toContainText(
    /\$2,\d{3}\.\d{2}/,
  );
  await expect(page.locator('.price-chart canvas').first()).toBeVisible();

  const result = await backtest(page);
  expect(result.config.symbol).toBe('ETHUSDT');
  expect(result.candleCount).toBeGreaterThan(600);
  expect(result.trades.every((t) => t.entry > 2000 && t.entry < 3000)).toBe(true);
  await expect(page.locator('.performance-metrics')).toBeVisible();
  await page
    .locator('nav')
    .getByRole('button', { name: /Test Geçmişi/ })
    .click();
  await expect(
    page.getByRole('row').filter({
      has: page.getByRole('checkbox', { name: 'Karşılaştır ' + result.id, exact: true }),
    }),
  ).toContainText('ETH / USDT');
  expect(errors).toEqual([]);
});

test('moves dates to a pair’s listing and shows tiny prices with the pair’s own decimals', async ({
  page,
}) => {
  test.skip(live, 'Uses the pairs of the local Binance stand-in.');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const start = page.getByLabel('Başlangıç · UTC'),
    end = page.getByLabel('Bitiş · UTC');
  await expect(start).toHaveAttribute('min', '2017-08-17');
  await start.fill('2019-01-01');
  await pick(page, 'sol');
  await expect(page.getByRole('button', { name: 'İşlem çifti: SOL / USDT' })).toBeVisible();
  await expect(start).toHaveValue('2020-08-11');
  await expect(start).toHaveAttribute('min', '2020-08-11');
  await pick(page, 'shib');
  await expect(start).toHaveValue('2021-05-10');
  await expect(start).toHaveAttribute('min', '2021-05-10');
  await expect(page.locator('.price-metric .metric-value').first()).toContainText(/\$0\.\d{8}\b/);
  await end.fill('2021-05-20');

  const result = await backtest(page);
  expect(result.config.symbol).toBe('SHIBUSDT');
  expect(result.candleCount).toBe(11 * 24);
  expect(result.trades.length).toBeGreaterThan(0);
  await page
    .getByRole('button', { name: 'İşlemler', exact: false })
    .filter({ has: page.locator('span') })
    .click();
  await expect(page.locator('.results-panel tbody tr').first()).toContainText(/0\.0000\d{4}/);

  // Back on Bitcoin the earliest date is Bitcoin's own again; the chosen range stays.
  await pick(page, 'btc');
  await expect(start).toHaveAttribute('min', '2017-08-17');
  await expect(start).toHaveValue('2021-05-10');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'İşlem çifti: BTC / USDT' }).click();
  await expect(page.getByRole('listbox', { name: 'İşlem çiftleri' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('combobox', { name: 'İşlem çifti ara' }).press('Escape');
  await expect(page.getByRole('listbox', { name: 'İşlem çiftleri' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'İşlem çifti: BTC / USDT' })).toBeFocused();
  expect(errors).toEqual([]);
});

test('starts a paper session on another pair and follows that pair’s stream', async ({
  page,
  request,
}) => {
  test.skip(live, 'Uses the pairs of the local Binance stand-in.');
  for (const s of (await (await request.get('/api/paper')).json()) as PaperView[])
    if (s.status === 'running') await request.post(`/api/paper/${s.id}/stop`);
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Canlı Test', exact: true }).click();
  await pick(page, 'sol');
  // RSI keeps this stopped session's tab apart from the SMA session paper.spec.ts looks for.
  await page.getByRole('combobox', { name: 'Strateji', exact: true }).selectOption('rsi');
  await page.getByRole('combobox', { name: 'Zaman dilimi', exact: true }).selectOption('1m');
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/paper') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Canlı testi başlat', exact: true }).click();
  const started: PaperView = await (await response).json();
  expect(started.config.symbol).toBe('SOLUSDT');
  expect(started.config.strategy).toBe('rsi');
  await expect(page.getByRole('tab', { name: /· SOL · 1m/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Canlı test oturumu' })).toContainText(
    'SOL / USDT',
  );
  const read = async (): Promise<PaperDetail> =>
    (await request.get('/api/paper/' + started.id)).json();
  expect((await read()).candleCount).toBeGreaterThanOrEqual(250);
  await expect.poll(async () => (await read()).feed, { timeout: 30000 }).toBe('live');
  expect((await request.post(`/api/paper/${started.id}/stop`)).ok()).toBe(true);
});

test('lists Binance USDT pairs and refuses ones it does not trade', async ({ request }) => {
  const pairs: { symbol: string; tickSize: string }[] = await (
    await request.get('/api/pairs')
  ).json();
  expect(pairs.length).toBeGreaterThanOrEqual(4);
  expect(pairs.every((p) => p.symbol.endsWith('USDT'))).toBe(true);
  expect(Number(pairs.find((p) => p.symbol === 'SHIBUSDT')?.tickSize)).toBeLessThan(0.0001);
  const shib = await (await request.get('/api/pairs/SHIBUSDT')).json();
  expect(new Date(shib.listed * 1000).toISOString().slice(0, 10)).toBe('2021-05-10');

  const unknown = await request.get('/api/pairs/NOPEXYZUSDT');
  expect(unknown.status()).toBe(404);
  const candles = await request.get('/api/candles?symbol=NOPEXYZUSDT&interval=1h');
  expect(candles.status()).toBe(400);
  expect((await candles.json()).error).toMatch(/tanımıyor: NOPEXYZUSDT/);
  const config = {
    strategy: 'sma',
    interval: '1h',
    capital: 10000,
    allocation: 95,
    fee: 0.1,
    slippage: 0.05,
    stopLoss: 3,
    takeProfit: 6,
    fast: 9,
    slow: 21,
    rsiPeriod: 14,
    rsiBuy: 30,
    rsiSell: 70,
    lookback: 20,
    mode: 'live',
  };
  const refused = await request.post('/api/backtests', {
    data: { ...config, symbol: 'NOPEXYZUSDT', start: '2024-01-01', end: '2024-01-02' },
  });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toMatch(/işlemde olmayan bir çift: NOPEXYZUSDT/);
  const early = await request.post('/api/backtests', {
    data: { ...config, symbol: 'SHIBUSDT', start: '2021-01-01', end: '2021-06-01' },
  });
  expect(early.status()).toBe(400);
  expect((await early.json()).error).toMatch(/SHIB \/ USDT verileri 2021-05-10/);
  const paper = await request.post('/api/paper', {
    data: { config: { ...config, symbol: 'NOPEXYZUSDT', start: '', end: '' }, warmup: 50 },
  });
  expect(paper.status()).toBe(400);
  expect((await paper.json()).error).toMatch(/işlemde olmayan bir çift: NOPEXYZUSDT/);
});

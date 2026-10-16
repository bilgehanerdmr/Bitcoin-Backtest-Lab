import { test, expect } from '@playwright/test';
import type { Result } from '../../shared/types';
test('one-minute demo chart, backtest, saved report and mobile timeframe controls', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await page.getByRole('button', { name: '1m', exact: true }).click();
  await expect(page.locator('.price-chart canvas').first()).toBeVisible();
  await expect(page.locator('.market-metrics')).not.toContainText(/NaN|Infinity/);
  await page.getByRole('combobox', { name: 'Zaman dilimi', exact: true }).selectOption('1m');
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await page.getByLabel('Başlangıç · UTC').fill(day);
  await page.getByLabel('Bitiş · UTC').fill(day);
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/backtests') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Backtest Başlat', exact: true }).click();
  const completed = await response;
  expect(completed.ok()).toBe(true);
  const result: Result = await completed.json();
  expect(result.config.interval).toBe('1m');
  expect(result.candleCount).toBe(1440);
  expect(result.equity.every((p, i, all) => !i || p.time - all[i - 1].time === 60)).toBe(true);
  expect(result.metrics.finalEquity).toBeGreaterThan(0);
  await expect(page.locator('.performance-metrics')).toBeVisible();
  await page
    .locator('nav')
    .getByRole('button', { name: /Test Geçmişi/ })
    .click();
  await page
    .getByRole('row')
    .filter({ has: page.getByRole('checkbox', { name: 'Karşılaştır ' + result.id, exact: true }) })
    .getByRole('button', { name: 'Rapor', exact: true })
    .click();
  await expect(page.getByRole('combobox', { name: 'Zaman dilimi', exact: true })).toHaveValue('1m');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '1m', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
test('demo strategy, persisted report, export, templates, comparisons and mobile layout', async ({
  page,
}) => {
  const templateName = 'E2E Trend Şablonu ' + Date.now();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await expect(page.locator('.price-chart canvas').first()).toBeVisible();
  await expect(page.getByText('Demo çalışma alanı.')).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Backtest Başlat', exact: true }).click();
  await expect(page.locator('.performance-metrics')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.equity-chart canvas').first()).toBeVisible();
  await page
    .getByRole('button', { name: 'İşlemler', exact: false })
    .filter({ has: page.locator('span') })
    .click();
  await expect(page.locator('.results-panel tbody tr').first()).toBeVisible();
  const file = page.waitForEvent('download');
  await page.getByRole('button', { name: 'İşlemleri CSV indir' }).click();
  expect((await file).suggestedFilename()).toMatch(/bitcoin-lab-.*csv/);
  await page.getByRole('button', { name: 'Maksimum Düşüş', exact: true }).click();
  await expect(page.locator('.equity-chart canvas').first()).toBeVisible();
  await page.getByRole('button', { name: 'Stratejiyi şablon olarak kaydet' }).click();
  await page.getByLabel('Şablon adı').fill(templateName);
  await page.getByRole('button', { name: 'Şablonu kaydet', exact: true }).click();
  await page.locator('nav').getByRole('button', { name: 'Stratejiler', exact: true }).click();
  await expect(page.getByRole('heading', { name: templateName })).toBeVisible();
  await page.getByRole('button', { name: 'Şablonu sil ' + templateName }).click();
  await page
    .getByRole('dialog', { name: 'Şablonu sil' })
    .getByRole('button', { name: 'Silme işlemini onayla' })
    .click();
  await expect(page.getByRole('heading', { name: templateName })).toHaveCount(0);
  const workspace = await (await page.request.get('/api/workspace')).json();
  expect(workspace.presets.some((p: { name: string }) => p.name === templateName)).toBe(false);
  await page
    .locator('nav')
    .getByRole('button', { name: /Test Geçmişi/ })
    .click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.getByRole('checkbox').first().check();
  await expect(
    page.getByRole('heading', { name: 'Seçili testlerin karşılaştırması' }),
  ).toBeVisible();
  await page.locator('tbody').getByRole('button', { name: 'Rapor' }).first().click();
  await expect(page.locator('.performance-metrics')).toBeVisible();
  await page.screenshot({ path: 'test-results/backtest-desktop.png', fullPage: true });
  await page.reload();
  await page
    .locator('nav')
    .getByRole('button', { name: /Test Geçmişi/ })
    .click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Menüyü aç' }).click();
  await page.locator('nav').getByRole('button', { name: 'Genel Bakış', exact: true }).click();
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await expect(page.locator('.price-chart canvas').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('invalid strategy configuration prevents execution', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await page.getByLabel('Hızlı ortalama').fill('30');
  await page.getByLabel('Yavaş ortalama').fill('10');
  await page.getByRole('button', { name: 'Backtest Başlat', exact: true }).click();
  await expect(page.getByText('Hızlı ortalama, yavaş ortalamadan küçük olmalı.')).toBeVisible();
});
test('connection failure stays explicit and retry clears stale errors', async ({ page }) => {
  const data = Array.from({ length: 100 }, (_, i) => ({
    time: 1704067200 + i * 3600,
    open: 100 + i,
    close: 101 + i,
    high: 102 + i,
    low: 99 + i,
    volume: 10,
  }));
  await page.routeWebSocket(/data-stream\.binance\.vision/, (ws) => ws.close());
  await page.route('**/api/ticker?*', (route) =>
    route.fulfill({ status: 400, json: { error: 'Test: veri bağlantısı kesildi.' } }),
  );
  await page.route('**/api/candles?*', (route) =>
    route.fulfill({ status: 400, json: { error: 'Test: veri bağlantısı kesildi.' } }),
  );
  await page.goto('/');
  await expect(page.getByText('Test: veri bağlantısı kesildi.')).toBeVisible();
  await expect(page.getByText('Demo çalışma alanı.')).not.toBeVisible();
  await page.unroute('**/api/ticker?*');
  await page.unroute('**/api/candles?*');
  await page.route('**/api/ticker?*', (route) =>
    route.fulfill({
      json: {
        lastPrice: '200',
        priceChangePercent: '1',
        highPrice: '201',
        lowPrice: '190',
        quoteVolume: '200000',
        volume: '1000',
      },
    }),
  );
  await page.route('**/api/candles?*', (route) =>
    route.fulfill({ json: { candles: data, source: 'Binance Spot' } }),
  );
  await page.getByRole('button', { name: 'Tekrar dene' }).click();
  await expect(page.locator('.price-chart canvas').first()).toBeVisible();
  await expect(page.getByText('Test: veri bağlantısı kesildi.')).not.toBeVisible();
  await expect(page.locator('.price-metric .metric-value')).toContainText('$200.00');
});
test('market data endpoints accept only Binance USDT spot pairs', async ({ request }) => {
  for (const url of [
    '/api/candles?symbol=BTCTRY&interval=1h',
    '/api/candles?symbol=ethusdt&interval=1h',
    '/api/ticker?symbol=BTC-USDT',
  ]) {
    const response = await request.get(url);
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toMatch(/USDT spot/);
  }
  const backtest = await request.post('/api/backtests', {
    data: {
      strategy: 'sma',
      symbol: 'ETHBTC',
      interval: '1h',
      start: '2024-01-01',
      end: '2024-01-02',
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
    },
  });
  expect(backtest.status()).toBe(400);
  expect((await backtest.json()).error).toMatch(/USDT spot/);
});

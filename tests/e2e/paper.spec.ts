import { test, expect, type Page } from '@playwright/test';
import type { PaperView } from '../../shared/paper';

// The labelled synthetic demo stream closes one candle per second and needs no internet;
// Playwright's own server and throwaway database run it.
async function openPaper(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await page.locator('nav').getByRole('button', { name: 'Canlı Test', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zaman dilimi', exact: true }).selectOption('1m');
}
async function startSession(page: Page): Promise<PaperView> {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/paper') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Canlı testi başlat', exact: true }).click();
  const started = await response;
  expect(started.ok()).toBe(true);
  return started.json();
}

test('runs a demo paper session, compares it with a backtest and saves the report', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openPaper(page);
  await page.getByLabel('Hızlı ortalama').fill('3');
  await page.getByLabel('Yavaş ortalama').fill('8');
  await expect(page.getByRole('combobox', { name: 'Demo akış hızı' })).toHaveValue('fast');
  const session = await startSession(page);
  expect(session).toMatchObject({ status: 'running', demoSpeed: 'fast', feed: 'demo' });
  const view = page.getByRole('region', { name: 'Canlı test oturumu' });
  await expect(view.locator('.paper-status')).toHaveText('Çalışıyor');
  await expect(view).toContainText('Demo akışı');
  const compare = view.getByRole('button', { name: 'Aynı dönemi backtest et' });
  await expect(compare).toBeEnabled({ timeout: 30000 });
  await compare.click();
  const panel = view.getByLabel('Karşılaştırma', { exact: true });
  await expect(panel).toContainText('✓ İşlemler ve sermaye eğrisi birebir aynı.');
  await expect(panel.locator('tr.paper-diff')).toHaveCount(0);
  await view.getByRole('button', { name: /İşlemler/ }).click();
  await view.getByRole('button', { name: 'Sermaye Eğrisi' }).click();
  await expect(view.locator('.equity-chart canvas').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/paper-desktop.png', fullPage: true });
  await view.getByRole('button', { name: 'Durdur', exact: true }).click();
  await expect(view.locator('.paper-status')).toHaveText('Durdu');
  await view.getByRole('button', { name: 'Nihai raporu aç' }).click();
  const results = page.locator('.results-panel');
  await expect(results).toContainText('CANLI (PAPER)');
  await expect(results.locator('.result-footnote')).toContainText('Canlı test mumları');
  const file = page.waitForEvent('download');
  await page.getByRole('button', { name: 'İşlemleri CSV indir' }).click();
  expect((await file).suggestedFilename()).toMatch(/bitcoin-lab-.*csv/);
  await page
    .locator('nav')
    .getByRole('button', { name: /Test Geçmişi/ })
    .click();
  await expect(page.locator('tbody')).toContainText('CANLI (PAPER)');
  await expect(page.locator('tbody')).toContainText('KARŞILAŞTIRMA');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Menüyü aç' }).click();
  await page.locator('nav').getByRole('button', { name: 'Canlı Test', exact: true }).click();
  await expect(view.locator('.paper-status')).toHaveText('Durdu');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'test-results/paper-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
});

test('shows Python logs from candles closed after the start', async ({ page }) => {
  await openPaper(page);
  await page.getByRole('combobox', { name: 'Strateji', exact: true }).selectOption('python');
  await page.getByRole('button', { name: /Python kodunu yükle/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Python strateji editörü' });
  await dialog.getByLabel('Python strateji adı').fill('E2E canlı Python ' + Date.now());
  await dialog
    .getByLabel('Python kodu', { exact: true })
    .fill(
      'def on_candle(candles, state):\n    print("kapanış", candles[-1]["close"])\n    return "buy" if len(candles) % 4 == 0 else "sell" if len(candles) % 4 == 2 else "hold"\n',
    );
  await dialog.getByRole('button', { name: 'Kaydet ve kullan' }).click();
  await expect(dialog).not.toBeVisible();
  await page.locator('nav').getByRole('button', { name: 'Canlı Test', exact: true }).click();
  await startSession(page);
  const view = page.getByRole('region', { name: 'Canlı test oturumu' });
  await view.getByRole('button', { name: 'Python Logları' }).click();
  await expect(view.getByLabel('Python logları')).toContainText('kapanış', { timeout: 30000 });
  await view.getByRole('button', { name: 'Durdur', exact: true }).click();
  await expect(view.locator('.paper-status')).toHaveText('Durdu');
});

test('limits concurrent sessions and rejects invalid settings', async ({ request }) => {
  const config = {
    strategy: 'sma',
    interval: '1m',
    start: '2024-01-01',
    end: '2024-01-01',
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
    mode: 'demo',
  };
  // Earlier tests share this database; only sessions started here may be active.
  const existing: PaperView[] = await (await request.get('/api/paper')).json();
  for (const session of existing.filter((s) => s.status !== 'stopped'))
    await request.post(`/api/paper/${session.id}/stop`);
  const invalid = await request.post('/api/paper', {
    data: { config, warmup: 5, demoSpeed: 'realtime' },
  });
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).error).toMatch(/Isınma mumu sayısı/);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const started = await request.post('/api/paper', {
      data: { config, warmup: 50, demoSpeed: 'realtime' },
    });
    expect(started.ok()).toBe(true);
    ids.push((await started.json()).id);
  }
  const fourth = await request.post('/api/paper', {
    data: { config, warmup: 50, demoSpeed: 'realtime' },
  });
  expect(fourth.status()).toBe(409);
  for (const id of ids) expect((await request.post(`/api/paper/${id}/stop`)).ok()).toBe(true);
});

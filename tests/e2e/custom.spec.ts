import { test, expect } from '@playwright/test';
import type { Result } from '../../shared/types';

test('custom candle rules can be edited, validated, saved, backtested and restored on mobile', async ({
  page,
}) => {
  const savedName = 'Kaydedilmiş mum stratejim ' + Date.now();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Zaman dilimi', exact: true }).selectOption('1m');
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await page.getByLabel('Başlangıç · UTC').fill(day);
  await page.getByLabel('Bitiş · UTC').fill(day);
  await page.getByRole('combobox', { name: 'Strateji', exact: true }).selectOption('custom');
  await page.getByRole('button', { name: 'Mum kurallarını düzenle' }).click();
  const dialog = page.getByRole('dialog', { name: 'Özel mum stratejisi editörü' });
  await expect(dialog).toBeVisible();
  expect((await dialog.boundingBox())!.width).toBeGreaterThanOrEqual(900);
  await dialog.getByRole('button', { name: 'Uzun alt fitil', exact: true }).click();
  await expect(dialog.getByLabel('Özel strateji adı')).toHaveValue('Uzun alt fitil');
  await dialog.getByRole('button', { name: 'Yükseliş yutan mum', exact: true }).click();
  await dialog.getByLabel('Özel strateji adı').fill('E2E Özel Mum Formasyonu');
  const entry = dialog.getByRole('group', { name: 'Giriş kuralları' }),
    exit = dialog.getByRole('group', { name: 'Çıkış kuralları' });
  await entry.getByRole('button', { name: 'Koşul ekle' }).click();
  await entry.getByLabel('Koşul 5 sol alan').selectOption('volume');
  await expect(entry.getByLabel('Koşul 5 hedef türü')).toHaveValue('number');
  await entry.getByLabel('Koşul 1 çarpan').fill('0');
  await dialog.getByRole('button', { name: 'Kuralları uygula' }).click();
  await expect(dialog.getByRole('alert')).toContainText('çarpan');
  await entry.getByLabel('Koşul 1 çarpan').fill('1');
  await exit.getByRole('button', { name: 'Koşul 1 sil', exact: true }).click();
  await expect(exit.getByText('Mum formasyonuyla çıkış kapalı.', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'test-results/custom-editor-desktop.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Kuralları uygula' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.custom-strategy-summary')).toContainText('5 giriş · 0 çıkış koşulu');
  await page.getByRole('button', { name: 'Stratejiyi şablon olarak kaydet' }).click();
  await page.getByLabel('Şablon adı').fill(savedName);
  await page.getByRole('button', { name: 'Şablonu kaydet', exact: true }).click();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/backtests') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Backtest Başlat', exact: true }).click();
  const completed = await response;
  expect(completed.ok()).toBe(true);
  const result: Result = await completed.json();
  expect(result.config.strategy).toBe('custom');
  expect(result.config.custom!.name).toBe('E2E Özel Mum Formasyonu');
  expect(result.config.custom!.entry.rules).toHaveLength(5);
  expect(result.config.custom!.entry.rules[4].left.field).toBe('volume');
  expect(result.config.custom!.exit.rules).toHaveLength(0);
  expect(result.candleCount).toBe(1440);
  expect(result.trades.length).toBeGreaterThan(0);
  await page.getByText('Test edilen mum kuralları', { exact: true }).click();
  await expect(page.locator('.report-rules')).toContainText('Hacim > 0 BTC');
  await page
    .locator('nav')
    .getByRole('button', { name: /Test Geçmişi/ })
    .click();
  await page.locator('tbody').getByRole('button', { name: 'Rapor' }).first().click();
  await expect(page.locator('.custom-strategy-summary')).toContainText('E2E Özel Mum Formasyonu');
  await page.reload();
  await page.locator('nav').getByRole('button', { name: 'Stratejiler', exact: true }).click();
  await page
    .locator('.strategy-card')
    .filter({ has: page.getByRole('heading', { name: savedName }) })
    .getByRole('button', { name: 'Şablonu yükle' })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Mum kurallarını düzenle' }).click();
  await expect(dialog.getByLabel('Özel strateji adı')).toHaveValue('E2E Özel Mum Formasyonu');
  await expect(entry.getByLabel('Koşul 5 sol alan')).toHaveValue('volume');
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(
    await page.locator('.custom-editor-body').evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/custom-editor-mobile.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('malformed custom strategies are rejected by the API', async ({ request }) => {
  const { defaultConfig } = await import('../../shared/types');
  const { patternStrategy } = await import('../../shared/candle-rules');
  const custom = patternStrategy('engulfing');
  custom.entry.rules[0].left.offset = -1;
  const response = await request.post('/api/backtests', {
    data: { ...defaultConfig, mode: 'live', strategy: 'custom', custom },
  });
  expect(response.status()).toBe(400);
  expect((await response.json()).error).toContain('geriye bakış');
});

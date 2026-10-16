import { test, expect } from '@playwright/test';
import type { Result } from '../../shared/types';

// Hourly candles from 2024-01-01 in Turkish Excel format, with the candle at hour 120 missing.
function excelCsv() {
  const pad = (n: number) => String(n).padStart(2, '0'),
    tr = (n: number) =>
      n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    t0 = Date.UTC(2024, 0, 1),
    rows = ['Tarih;Açılış;En Yüksek;En Düşük;Kapanış;Hacim'];
  for (let i = 0; i < 200; i++) {
    if (i === 120) continue;
    const t = new Date(t0 + i * 3600000),
      p = 40000 + Math.round(Math.sin(i / 7) * 800 + i * 3);
    rows.push(
      `${t.getUTCDate()}.${pad(t.getUTCMonth() + 1)}.${t.getUTCFullYear()} ${pad(t.getUTCHours())}:00;${tr(p)};${tr(p + 120.5)};${tr(p - 95.25)};${tr(p + 40.75)};${tr(10 + (i % 5))}`,
    );
  }
  return rows.join('\r\n');
}

test('uploads a Turkish Excel CSV, backtests on it and keeps the report after deletion', async ({
  page,
}) => {
  const name = 'E2E Excel verisi ' + Date.now();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Veri Merkezi', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Kendi verini yükle' });
  await panel.getByLabel('CSV dosyası').setInputFiles({
    name: 'excel-verim.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('﻿' + excelCsv()),
  });
  const preview = panel.getByLabel('Yükleme önizlemesi');
  await expect(preview).toContainText('199 mum');
  await expect(preview).toContainText('1h zaman dilimi');
  await expect(preview).toContainText('1 eksik mum');
  await expect(preview).toContainText('Saat dilimi belirtilmeyen tarihler UTC kabul edildi.');
  await expect(preview.getByRole('combobox', { name: 'Ayraç' })).toHaveValue(';');
  await expect(preview.getByRole('combobox', { name: 'Ondalık ayırıcı' })).toHaveValue(',');
  await expect(preview.getByRole('combobox', { name: 'Kapanış sütunu' })).toHaveValue('4');
  await expect(preview.locator('.upload-sample tbody tr').first()).toContainText('40,000.00');
  await expect(preview.locator('.price-chart canvas').first()).toBeVisible();
  await preview.getByLabel('Veri seti adı').fill(name);
  await preview.getByRole('button', { name: 'Veri setini kaydet' }).click();
  const row = panel.locator('tbody tr', { hasText: name });
  await expect(row).toContainText('199');
  await row.getByRole('button', { name: /Backtest'te kullan/ }).click();
  const source = page.getByRole('combobox', { name: 'Veri kaynağı' });
  await expect(source).toContainText(name);
  await expect(page.getByRole('combobox', { name: 'Zaman dilimi', exact: true })).toBeDisabled();
  await expect(page.locator('.chart-panel h2')).toHaveText(name);
  await expect(page.locator('.market-metrics')).toContainText('199 mum');
  await page.getByLabel('Hızlı ortalama').fill('3');
  await page.getByLabel('Yavaş ortalama').fill('8');
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/backtests') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Backtest Başlat', exact: true }).click();
  const completed = await response;
  expect(completed.ok()).toBe(true);
  const result: Result = await completed.json();
  expect(result.source).toBe('Yüklenen veri · ' + name);
  expect(result.config.interval).toBe('1h');
  expect(result.candleCount).toBe(199);
  expect(result.missingCandles).toBe(1);
  const results = page.locator('.results-panel');
  await expect(results).toContainText('YÜKLENEN VERİ');
  await expect(results.locator('.result-footnote')).toContainText(
    'Veri dosyasında bulunmayan 1 mum',
  );
  await page.locator('nav').getByRole('button', { name: 'Veri Merkezi', exact: true }).click();
  await row.getByRole('button', { name: 'Veri setini sil ' + name }).click();
  await row.getByRole('button', { name: 'Silmeyi onayla' }).click();
  await expect(panel.locator('tbody tr', { hasText: name })).toHaveCount(0);
  await page
    .locator('nav')
    .getByRole('button', { name: /Test Geçmişi/ })
    .click();
  await expect(page.locator('tbody tr', { hasText: name }).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Menüyü aç' }).click();
  await page.locator('nav').getByRole('button', { name: 'Veri Merkezi', exact: true }).click();
  await panel.getByLabel('CSV dosyası').setInputFiles({
    name: 'excel-verim.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(excelCsv()),
  });
  await expect(preview).toContainText('199 mum');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'test-results/upload-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
});

test('rejects unreadable files with a clear message and stores nothing', async ({ request }) => {
  const before = await (await request.get('/api/uploads')).json();
  const response = await request.post('/api/uploads', {
    data: { name: 'Bozuk', fileName: 'bozuk.csv', text: 'tarih;fiyat\n1;2' },
  });
  expect(response.status()).toBe(400);
  expect((await response.json()).error).toMatch(/Sütunlar ayrılamadı/);
  expect(await (await request.get('/api/uploads')).json()).toEqual(before);
});

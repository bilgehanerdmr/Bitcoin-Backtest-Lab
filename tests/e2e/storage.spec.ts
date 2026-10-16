import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { defaultConfig, type Result } from '../../shared/types';
import { patternStrategy } from '../../shared/candle-rules';
import type { Backup } from '../../shared/backup';

test('selected reports can be deleted and restored from a portable local backup', async ({
  page,
  request,
}) => {
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    prefix = 'Backup E2E ' + Date.now(),
    reports: Result[] = [];
  for (let i = 0; i < 2; i++) {
    const custom = patternStrategy('engulfing');
    custom.name = prefix + ' ' + i;
    const response = await request.post('/api/backtests', {
      data: {
        ...defaultConfig,
        strategy: 'custom',
        custom,
        interval: '1h',
        mode: 'live',
        start: day,
        end: day,
      },
    });
    expect(response.ok()).toBe(true);
    reports.push(await response.json());
  }
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Veri Merkezi', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Tüm verileri dışa aktar' }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/bitcoin-lab-yedek-.*\.json/);
  const content = await readFile((await file.path())!, 'utf8'),
    backup: Backup = JSON.parse(content.replace(/^\uFEFF/, ''));
  expect(backup.format).toBe('bitcoin-lab-backup');
  expect(backup.backtests.some((r) => r.id === reports[0].id)).toBe(true);
  expect(Array.isArray(backup.workspace.presets)).toBe(true);
  await page
    .locator('nav')
    .getByRole('button', { name: /Test Geçmişi/ })
    .click();
  await page.getByRole('button', { name: 'Raporu sil ' + reports[0].id, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Test raporlarını sil' });
  await dialog.getByRole('button', { name: 'Vazgeç', exact: true }).click();
  expect((await request.get('/api/backtests/' + reports[0].id)).ok()).toBe(true);
  for (const r of reports) await page.getByLabel('Karşılaştır ' + r.id, { exact: true }).check();
  await page.getByRole('button', { name: 'Seçilenleri sil (2)', exact: true }).click();
  await expect(dialog).toContainText(prefix + ' 0');
  await expect(dialog).toContainText(prefix + ' 1');
  await dialog.getByRole('button', { name: 'Silme işlemini onayla' }).click();
  await expect(dialog).not.toBeVisible();
  for (const r of reports) expect((await request.get('/api/backtests/' + r.id)).status()).toBe(404);
  await page.locator('nav').getByRole('button', { name: 'Veri Merkezi', exact: true }).click();
  await page.getByLabel('Yedek dosyası', { exact: true }).setInputFiles({
    name: 'diger-bilgisayar-yedegi.json',
    mimeType: 'application/json',
    buffer: Buffer.from(content),
  });
  await expect(page.locator('.backup-preview')).toContainText('diger-bilgisayar-yedegi.json');
  await page.getByRole('button', { name: 'İçe aktarmayı başlat' }).click();
  await expect(page.locator('.backup-success')).toContainText('2 rapor');
  for (const r of reports)
    expect(await (await request.get('/api/backtests/' + r.id)).json()).toEqual(r);
  const after: Backup = await (await request.get('/api/backup')).json();
  expect(after.workspace).toEqual(backup.workspace);
  expect(after.candles.length).toBeGreaterThanOrEqual(backup.candles.length);
  await page.getByLabel('Yedek dosyası', { exact: true }).setInputFiles({
    name: 'ayni-yedek.json',
    mimeType: 'application/json',
    buffer: Buffer.from(content),
  });
  await page.getByRole('button', { name: 'İçe aktarmayı başlat' }).click();
  await expect(page.locator('.backup-success')).toContainText('0 rapor');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'test-results/backup-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByLabel('Yedek dosyası', { exact: true }).setInputFiles({
    name: 'hatali.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"unknown"}'),
  });
  await expect(page.locator('.backup-panel').getByRole('alert')).toContainText('desteklenmeyen');
  await expect(page.getByRole('button', { name: 'İçe aktarmayı başlat' })).not.toBeVisible();
  // Clean up only the two test-created reports.
  await request.post('/api/backtests/delete', { data: { ids: reports.map((r) => r.id) } });
  expect(errors).toEqual([]);
});

test('invalid imports leave the server data intact', async ({ request }) => {
  const before: Backup = await (await request.get('/api/backup')).json();
  const invalid = { ...before, version: 99 };
  const response = await request.post('/api/backup/import', { data: invalid });
  expect(response.status()).toBe(400);
  const after: Backup = await (await request.get('/api/backup')).json();
  expect(after.backtests).toEqual(before.backtests);
  expect(after.workspace).toEqual(before.workspace);
});
test('local database stays usable when browser localStorage is unavailable', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('Browser storage unavailable');
      },
    }),
  );
  await page.goto('/');
  await page.locator('nav').getByRole('button', { name: 'Veri Merkezi', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tüm verileri dışa aktar' })).toBeEnabled();
  await expect(page.getByText('Browser storage unavailable', { exact: true })).not.toBeVisible();
});

import { test, expect } from '@playwright/test';
import type { Result } from '../../shared/types';
import type { Backup } from '../../shared/backup';

test('uploads, edits, stores, backtests and restores a Python strategy', async ({
  page,
  request,
}) => {
  const name = 'E2E Python ' + Date.now();
  const source = `def on_candle(candles, state):
    if len(candles) == 2: return 'buy'
    if len(candles) == 4: return 'sell'
    return 'hold'
`;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Zaman dilimi', exact: true }).selectOption('1m');
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await page.getByLabel('Başlangıç · UTC').fill(day);
  await page.getByLabel('Bitiş · UTC').fill(day);
  await page.locator('nav').getByRole('button', { name: 'Stratejiler', exact: true }).click();
  await page.getByRole('button', { name: 'Python stratejisi yükle', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Python strateji editörü' });
  await dialog.getByLabel('.py dosyası yükle', { exact: false }).setInputFiles({
    name: 'formasyon.py',
    mimeType: 'text/x-python',
    buffer: Buffer.from('\uFEFF' + source),
  });
  await expect(dialog.getByLabel('Python strateji adı')).toHaveValue('formasyon');
  await expect(dialog.getByLabel('Python kodu', { exact: true })).toHaveValue(source);
  await dialog.getByLabel('Python strateji adı').fill(name);
  await dialog.getByLabel('Python kodu', { exact: true }).fill('def broken(:');
  await dialog.getByRole('button', { name: 'Sözdizimini kontrol et' }).click();
  await expect(dialog.getByRole('alert')).toContainText('satır 1');
  await dialog.getByLabel('Python kodu', { exact: true }).fill(source);
  await dialog.getByRole('button', { name: 'Sözdizimini kontrol et' }).click();
  await expect(dialog.getByRole('status')).toContainText('Sözdizimi uygun');
  await page.screenshot({ path: 'test-results/python-editor-desktop.png' });
  await dialog.getByRole('button', { name: 'Kaydet ve kullan' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Strateji', exact: true })).toHaveValue('python');
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/backtests') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Backtest Başlat', exact: true }).click();
  const completed = await response;
  expect(completed.ok()).toBe(true);
  const result: Result = await completed.json();
  expect(result.config.python).toEqual({ name, source });
  expect(result.candleCount).toBe(1440);
  expect(result.trades).toHaveLength(1);
  expect(result.trades[0].entryTime).toBe(result.start + 120);
  await page.getByText('Test edilen Python kodu', { exact: true }).click();
  await expect(page.locator('.python-report-code')).toHaveText(source);
  const backup: Backup = await (await request.get('/api/backup')).json();
  expect(
    backup.workspace.presets.some((p) => p.name === name && p.config.python?.source === source),
  ).toBe(true);
  expect((await request.post('/api/backtests/delete', { data: { ids: [result.id] } })).ok()).toBe(
    true,
  );
  expect((await request.post('/api/backup/import', { data: backup })).ok()).toBe(true);
  expect(
    (await (await request.get('/api/backtests/' + result.id)).json()).config.python.source,
  ).toBe(source);
  await page.reload();
  await page.locator('nav').getByRole('button', { name: 'Stratejiler', exact: true }).click();
  await page
    .locator('.strategy-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .getByRole('button', { name: 'Şablonu yükle' })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Python kodunu yükle / düzenle' }).click();
  await expect(dialog.getByLabel('Python kodu', { exact: true })).toHaveValue(source);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/python-editor-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('rejects cross-site Python requests and checks code without executing it', async ({
  request,
}) => {
  const data = {
    name: 'Kontrol',
    source: "raise RuntimeError('not during validation')\ndef on_candle(candles, state):\n    pass",
  };
  const denied = await request.post('/api/python/validate', {
    data,
    headers: { Origin: 'https://untrusted.example' },
  });
  expect(denied.status()).toBe(403);
  const allowed = await request.post('/api/python/validate', { data });
  expect(allowed.ok()).toBe(true);
});

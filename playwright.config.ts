import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import path from 'node:path';
// Unless pointed at a running app, E2E starts its own server on separate ports with a
// throwaway database, so test reports and templates never reach data/ or exported backups.
const external = process.env.PLAYWRIGHT_BASE_URL;
// Live tests talk to real Binance. Every other run uses a local stand-in for Binance's market
// data, so the tests are offline and still exercise the application's real Binance code.
const live = process.env.LIVE_TESTS === '1';
const fake = '127.0.0.1:3109';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: external || 'http://127.0.0.1:5273',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 1100 },
    screenshot: 'only-on-failure',
  },
  webServer: external
    ? undefined
    : [
        ...(live
          ? []
          : [
              {
                command: 'npx tsx tests/support/fake-binance.ts',
                url: `http://${fake}/api/v3/ping`,
                reuseExistingServer: false,
                env: { FAKE_BINANCE_PORT: '3109' },
              },
            ]),
        {
          command: 'npm run dev',
          url: 'http://127.0.0.1:5273/api/health',
          reuseExistingServer: false,
          timeout: 60000,
          env: {
            PORT: '3101',
            WEB_PORT: '5273',
            DATABASE_PATH: path.join(tmpdir(), `bitcoin-lab-e2e-${Date.now()}.sqlite`),
            ...(live
              ? {}
              : {
                  BINANCE_REST_URL: `http://${fake}/api/v3`,
                  BINANCE_STREAM_URL: `ws://${fake}`,
                  VITE_BINANCE_STREAM_URL: `ws://${fake}`,
                }),
          },
        },
      ],
  reporter: 'list',
});

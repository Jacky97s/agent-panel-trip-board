import { defineConfig, devices } from '@playwright/test';

const port = 5174;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `rm -rf e2e/.data && mkdir -p e2e/.data && cp -a data/trips data/cache e2e/.data/ && pnpm dev --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      TRIP_DATA: 'e2e/.data',
      TRIP_GEOCODE: 'off',
    },
  },
});

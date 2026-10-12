import { defineConfig } from '@playwright/test';

const port = process.env.PORT || 8791;
export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  workers: 1, // both tests open a review, and only one review can be open at a time
  use: { baseURL: `http://localhost:${port}`, browserName: 'chromium', viewport: { width: 375, height: 812 } },
  webServer: {
    command: `npx wrangler d1 migrations apply hui360_db --local && npx wrangler pages dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

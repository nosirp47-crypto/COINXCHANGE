import { defineConfig, devices } from '@playwright/test';

const mode = process.env.COINXCHANGE_DEPLOY_TEST_MODE || 'visual';
if (!['visual', 'staging'].includes(mode)) throw new Error('Unknown deployment test mode.');
const directory = mode === 'staging' ? 'dist/staging' : 'coinxchange';

export default defineConfig({
  testDir: './deployment-tests',
  fullyParallel: true,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: 'test-results/deployment-root',
  use: { baseURL: 'http://127.0.0.1:4174', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'] } }
  ],
  webServer: {
    command: `python3 -m http.server 4174 --bind 127.0.0.1 --directory ${directory}`,
    url: 'http://127.0.0.1:4174/',
    reuseExistingServer: false,
    timeout: 30_000
  }
});

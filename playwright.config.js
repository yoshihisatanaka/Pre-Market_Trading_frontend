import { defineConfig, devices } from '@playwright/test'

// コンテナ間(e2e → frontend)では http://frontend:5173、
// ホストから直接叩く場合は E2E_BASE_URL=http://localhost:5173 を指定する
const baseURL = process.env.E2E_BASE_URL || 'http://frontend:5173'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})

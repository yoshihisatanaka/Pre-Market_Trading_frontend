/**
 * モンキーテスト専用の Playwright 設定。
 *
 * 既定の playwright.config.js（testDir: ./e2e）とは分けてある。受け入れ条件の E2E に
 * ランダムテストを混ぜると、合否の意味が変わってしまうため。
 */
import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'http://frontend:5173'
const steps = Number(process.env.MONKEY_STEPS ?? 60)

export default defineConfig({
  testDir: '.',
  testMatch: 'monkey.spec.js',
  // 画面ごとに操作回数ぶんの待ちが積み上がるので、既定の 30 秒では足りない
  timeout: 60_000 + steps * 3_000,
  // 同じ dev サーバを叩くため直列にする（並行させると操作の間隔が揺れて再現性が落ちる）
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: '../monkey-report/playwright.json' }]],
  outputDir: '../monkey-report/artifacts',
  use: {
    baseURL,
    trace: process.env.MONKEY_TRACE === '1' ? 'on' : 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})

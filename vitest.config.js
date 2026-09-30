import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

export default defineConfig((configEnv) =>
  mergeConfig(
    viteConfig(configEnv),
    defineConfig({
      test: {
        environment: 'jsdom',
        // 相対 URL('/api/...') を解決させるため origin を固定する
        environmentOptions: {
          jsdom: { url: 'http://localhost:5173' },
        },
        globals: true,
        /*
         * 更新系に必須の X-User-Code は src/api/client.js が読み込み時に import.meta.env から取る。
         * 各自の .env に左右されないよう、テストではここで固定する
         * （実際の値は運用で決まる。テストは「載っていること」だけを見る）。
         */
        env: { VITE_USER_CODE: 'test-user' },
        setupFiles: ['./vitest.setup.js'],
        /*
         * Docker Desktop（12 CPU / 8GB）を複数 worktree で共有するので、隣の worktree が全件を回している間は
         * MSW + jsdom の view テストが既定の 5000ms / 10000ms を超えて偽失敗する（2026-09-28 / 09-30 に実測）。
         * 速くはならない。速くするのは本数を絞る scripts/test-unit.sh の側。
         * isolate / pool は変えないこと（--no-isolate は速くならず 466 件壊れた。2026-09-30）。
         */
        testTimeout: 15000,
        hookTimeout: 30000,
        include: ['src/**/*.spec.js'],
        exclude: [...configDefaults.exclude, 'e2e/**'],
        root: fileURLToPath(new URL('./', import.meta.url)),
      },
    }),
  ),
)

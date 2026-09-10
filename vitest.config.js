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
        include: ['src/**/*.spec.js'],
        exclude: [...configDefaults.exclude, 'e2e/**'],
        root: fileURLToPath(new URL('./', import.meta.url)),
      },
    }),
  ),
)

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
        setupFiles: ['./vitest.setup.js'],
        include: ['src/**/*.spec.js'],
        exclude: [...configDefaults.exclude, 'e2e/**'],
        root: fileURLToPath(new URL('./', import.meta.url)),
      },
    }),
  ),
)

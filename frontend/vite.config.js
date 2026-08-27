import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [vue()],
    resolve: {
      // jsconfig.json の paths と必ず対で維持すること
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      // Vite は既定で未知の Host ヘッダを 403 で弾く。
      // E2E コンテナは http://frontend:5173 でアクセスするため明示的に許可する。
      allowedHosts: ['frontend', 'localhost'],
      watch: {
        // Windows ホスト → Linux コンテナの bind mount では
        // ファイル変更イベントが伝播しないため HMR にポーリングが必須
        usePolling: true,
        interval: 300,
        // テスト成果物の書き込みでページリロードが走らないようにする
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/coverage/**',
          '**/test-results/**',
          '**/playwright-report/**',
        ],
      },
      proxy: {
        // MSW が処理しなかったリクエストだけがここに到達し、実 API へ転送される
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://backend:8000',
          changeOrigin: true,
        },
      },
    },
  }
})

import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// /api の転送先。バックエンドは別リポジトリ・別サーバなので、
// 既定は「ホスト側の 8000 番」を指す（host.docker.internal）。
// 正は .env の VITE_PROXY_TARGET。
const DEFAULT_PROXY_TARGET = 'http://host.docker.internal:8000'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // 未設定でも throw しないこと。vitest.config.js がこの設定を import するため、
  // .env が無い環境では npm run test:unit まで落ちてしまう。既定値で続行して警告する。
  const proxyTarget = env.VITE_PROXY_TARGET || DEFAULT_PROXY_TARGET
  if (!env.VITE_PROXY_TARGET) {
    console.warn(
      `[vite] VITE_PROXY_TARGET が未設定のため ${DEFAULT_PROXY_TARGET} を使います。` +
        '.env.example をコピーして .env を作り、バックエンドの場所を指定してください。',
    )
  }

  return {
    plugins: [vue()],
    // 依存の事前バンドルキャッシュを node_modules の外へ出す。
    // node_modules は全 worktree で共有する named volume なので、既定の
    // node_modules/.vite のままだと dev サーバを複数 worktree で同時に起動したときに
    // 同じキャッシュを奪い合う（504 Outdated Optimize Dep の温床）。
    // .vite/ は gitignore 済み。worktree ごとの初回起動が少し遅いのは事前バンドルのため。
    cacheDir: '.vite',
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
      // E2E コンテナは http://frontend:5173 でアクセスするため明示的に許可する
      // （'frontend' は docker-compose.yml のサービス名 = DNS 名。対で維持すること）。
      allowedHosts: ['frontend', 'localhost'],
      // hmr は明示設定しないこと。未設定なら HMR クライアントは
      // 「ブラウザが読み込んだ origin」へ WebSocket を張るので、worktree ごとに
      // ホスト公開ポートが 5174 / 5175 とずれても成立する。
      // hmr.clientPort を書くとホスト（localhost:517x）と E2E コンテナ（frontend:5173）の
      // どちらか片方が必ず壊れる。
      watch: {
        // Windows ホスト → Linux コンテナの bind mount では
        // ファイル変更イベントが伝播しないため HMR にポーリングが必須
        usePolling: true,
        interval: 300,
        // リポジトリ全体を /app にマウントしているので、アプリ外まで舐めさせない。
        // テスト成果物や MCP の出力でページリロードが走らないようにする狙いも兼ねる。
        ignored: [
          '**/node_modules/**',
          '**/.vite/**',
          '**/.git/**',
          '**/.idea/**',
          '**/.claude/**',
          '**/.playwright-mcp/**',
          '**/docs/**',
          '**/dist/**',
          '**/coverage/**',
          '**/test-results/**',
          '**/playwright-report/**',
        ],
      },
      proxy: {
        // MSW が処理しなかったリクエストだけがここに到達し、実 API へ転送される
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          // バックエンドの実パスに /api プレフィックスは無いので剥がす。
          // /api はフロント側で「プロキシに乗せる」ための目印にすぎない。
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})

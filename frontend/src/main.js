import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import './assets/styles/main.css'

async function enableMocking() {
  // import.meta.env.DEV は本番ビルド時に false へ静的置換されるため、
  // この分岐ごと MSW の動的 import が tree-shake され、本番バンドルに含まれない。
  // モック入りのビルドが必要な場合は `vite build --mode development` を使う。
  if (!import.meta.env.DEV) return
  // 開発時は既定で有効。実 API のみで確認したいときは .env で false にする。
  if (import.meta.env.VITE_ENABLE_MSW === 'false') return

  const { worker } = await import('./mocks/browser')
  await worker.start({
    // ハンドラ未定義のリクエストは実 API へ素通しする。
    // これにより API が1本実装されるたびに handlers を消すだけで移行できる。
    onUnhandledRequest: 'bypass',
    quiet: false,
  })
}

enableMocking().then(() => {
  createApp(App).use(createPinia()).use(router).mount('#app')
})

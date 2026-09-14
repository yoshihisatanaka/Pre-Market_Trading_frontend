import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useCodesStore } from './stores/codes'
import './assets/styles/main.css'

async function enableMocking() {
  // import.meta.env.DEV は本番ビルド時に false へ静的置換されるため、
  // この分岐ごと MSW の動的 import が tree-shake され、本番バンドルに含まれない。
  // モック入りのビルドが必要な場合は `vite build --mode development` を使う。
  if (!import.meta.env.DEV) return
  // 開発時は既定で有効。実 API のみで確認したいときは .env で false にする。
  if (import.meta.env.VITE_ENABLE_MSW === 'false') return

  const { startWorker } = await import('./mocks/browser')
  await startWorker()
}

enableMocking().then(() => {
  const pinia = createPinia()
  createApp(App).use(pinia).use(router).mount('#app')

  /*
   * コードマスタは全画面のプルダウンで使うので、起動時に一度だけ読み込む。
   * マウント後に呼ぶのは初回描画を API の応答待ちにしないため（選択肢が埋まるのは
   * 応答が返ってから。それまで select は空のまま描かれる）。
   * useAsync が例外を飲んでストアの error に入れるので、ここで catch は要らない。
   */
  useCodesStore(pinia).load()
})

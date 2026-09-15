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

enableMocking()
  .then(() => {
    const pinia = createPinia()
    const app = createApp(App).use(pinia).use(router)

    /*
     * コードマスタは全画面のプルダウンで使うので、起動時に一度だけ読み込む。
     *
     * mount より前に始めるのは、最初の描画の時点で AppLoadingOverlay を出すため
     * （useAsync は loading を最初の await より前に立てるので、同期で true になる）。
     * mount の後に呼ぶと、その 1 フレームだけ覆いが無く、組み立て途中の画面が覗く。
     * await はしないので初回描画自体は止まらない。
     *
     * use(pinia) より後に呼ぶのは、ここで作ったストアを Devtools に載せるためと、
     * 将来 pinia.use(プラグイン) を足したときにこのストアだけ外れないようにするため。
     *
     * useAsync が例外を飲んでストアの error に入れるので、ここで catch は要らない
     * （理由は AppLoadingOverlay が全画面で出し、「再試行」で読み直せる）。
     */
    useCodesStore(pinia).load()

    app.mount('#app')
  })
  .catch((error) => {
    /*
     * ここに来るのは MSW の起動に失敗したときだけ。mount されないので、
     * 放っておくと index.html のスプラッシュが回り続けて「まだ読み込み中」に見える。
     * 回転を止めて理由を出す。
     */
    console.error(error)
    const root = document.getElementById('app')
    if (root) root.textContent = '起動に失敗しました。ページを再読み込みしてください。'
  })

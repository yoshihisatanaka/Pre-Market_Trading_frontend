import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useCodesStore } from './stores/codes'
import { useCurrentOperatorStore } from './stores/currentOperator'
import { useMarketStatusStore } from './stores/marketStatus'
/*
 * 本文の書体（tokens.css の --font-family-base の先頭 'Noto Sans JP'）。画面モックは同じ書体を
 * Web フォントで同梱しているので、端末に入っていなくても同じ見た目になるよう合わせる。
 * 使うウェイトだけを読む（src/ の font-weight は 400 / 500 / 600 / 700）。文字の範囲ごとに分割された
 * woff2 なので、ブラウザは画面に出た文字の分だけを取りに行く。
 *
 * 自動操作のブラウザ（Playwright の E2E・MCP。navigator.webdriver が true）では読まない。
 * E2E はテストごとにキャッシュの無いブラウザで開くので、1 画面あたり数十本のフォントを毎回
 * dev サーバから取り直し、全件が 13 分 → 19 分に延びて揺れも増えた（2026-10-08 実測）。
 * 書体は文言・要素の判定に効かないので、E2E では端末の書体にフォールバックさせる
 */
if (!navigator.webdriver) {
  import('@fontsource/noto-sans-jp/400.css')
  import('@fontsource/noto-sans-jp/500.css')
  import('@fontsource/noto-sans-jp/600.css')
  import('@fontsource/noto-sans-jp/700.css')
}
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
     * コードマスタは全画面のプルダウンで使うので、起動時に一度だけ読み込む
     * （/codes に加えて部店・扱者の /branches / /handlers も。中身は stores/codes.js）。
     * 画面はここ以外で読み込まない。App.vue は読み終えるまで画面（RouterView）を描かない。
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

    /*
     * 市場状況（ヘッダの取引セッションと時間帯）も起動時に一度だけ読み込む。
     * 以後の更新は composables/useMarketStatus が 5 分ごとに行う。
     *
     * **オーバーレイの判定には足さない。** ヘッダの飾りのために、/market-status の 500 で
     * システム全体を起動不能にしてはいけない。取れなければヘッダが「—」を出すだけで、
     * 業務は続けられる。
     */
    useMarketStatusStore(pinia).load()

    /*
     * ログイン中の操作者（GET /auth/me）も起動時に一度だけ読み込む。サイドメニューが
     * 権限で区分を出し分け、権限の要るルートのガード（router/permissionGuard.js）が完了を待つ。
     * オーバーレイの判定には足さない。失敗しても権限なしに倒れるだけで、他の画面は使える。
     */
    useCurrentOperatorStore(pinia).ensureLoaded()

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

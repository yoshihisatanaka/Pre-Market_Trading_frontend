import { ref } from 'vue'
import { isNavigationFailure, NavigationFailureType } from 'vue-router'

/*
 * 画面遷移の「確定待ち」を 1 か所で持つ。
 *
 * ルートの component は `() => import(...)` の遅延読込なので、vue-router はチャンクの取得
 * （dev では Vite のオンデマンド変換）が終わるまで遷移を確定しない。その間は URL も
 * aria-current もヘッダの見出しも変わらず、メニューを押しても何も起きないように見える。
 * ここで持つ状態を AppLayout（プログレスバー）と AppSidebar（押した項目の読み込み中表示）が読む。
 *
 * 状態の実体はアプリで 1 つ。router に差すのは trackRouteLoading（router/index.js）で、
 * 画面側は useRouteLoading() で読むだけ。
 *
 * 解除の条件（vue-router 4.6 の pushWithRedirect の呼び方に合わせてある）:
 *   - afterEach は 完了 / DUPLICATED / CANCELLED / ABORTED で呼ばれ、ガードのリダイレクトは
 *     行き先だけ、ローダの reject は onError だけ（afterEach は来ない）
 *   - 追い越された古い遷移の CANCELLED / ABORTED は無視する（新しい遷移の表示を途中で消さない）。
 *     古い遷移はチャンクが届いてから取り消しになるので、無視しないと遅れて表示が消える
 *   - 現在地への push（DUPLICATED）は無条件で解除する。保留中の古い遷移は必ず取り消されるし、
 *     ガードのリダイレクト先が現在地だったときは to が pendingTo と一致しないので、
 *     これが無いと立ちっぱなしになる
 */
const isLoading = ref(false)
const pendingPath = ref('')
/** beforeEach / afterEach / onError に渡る to は同一オブジェクトなので、同一性で最新の遷移を見分ける */
let pendingTo = null

function clear() {
  isLoading.value = false
  pendingPath.value = ''
  pendingTo = null
}

/**
 * router に遷移の開始・終了を差す。permissionGuard より**前**に登録すること
 * （ガードは登録順に直列で走るので、後だと /auth/me 待ちの間は読み込み中にならない）。
 *
 * @param {import('vue-router').Router} router
 * @returns {() => void} 登録を外して状態を戻す（テスト用）
 */
export function trackRouteLoading(router) {
  clear()
  const removers = [
    router.beforeEach((to) => {
      pendingTo = to
      pendingPath.value = to.path
      isLoading.value = true
    }),
    router.afterEach((to, _from, failure) => {
      if (
        !failure ||
        to === pendingTo ||
        isNavigationFailure(failure, NavigationFailureType.duplicated)
      ) {
        clear()
      }
    }),
    router.onError((_error, to) => {
      if (to === pendingTo) clear()
    }),
  ]

  return () => {
    removers.forEach((remove) => remove())
    clear()
  }
}

/**
 * 遷移の確定待ちの状態。
 * @returns {{ isLoading: import('vue').Ref<boolean>, pendingPath: import('vue').Ref<string> }}
 */
export function useRouteLoading() {
  return { isLoading, pendingPath }
}

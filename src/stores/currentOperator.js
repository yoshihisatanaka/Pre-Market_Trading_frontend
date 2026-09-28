import { defineStore } from 'pinia'
import { fetchCurrentOperator } from '@/api/auth'
import { useAsync } from '@/composables/useAsync'

/**
 * ログイン中の操作者（GET /auth/me）。サイドメニューの出し分けとルートの制限が共用する。
 *
 * 読むのは 1 回だけ（ensureLoaded）。main.js が起動時に始め、ルートのガードはその完了を待つ。
 * **失敗したら権限は全部「持っていない」扱い**にする（誤って操作を出さない側に倒す。
 * src/api/auth.js の欠けた権限の読み方と同じ方針）。失敗したときだけ次の ensureLoaded で
 * 読み直すので、一時的な失敗で運用管理に入れないまま、にはならない（画面を開き直せば戻る）。
 *
 * 権限マスタの画面（stores/permissions.js）は自前で /auth/me を読んでいる。ここへ寄せるのは別作業。
 * 1 件の形は src/api/auth.js の CurrentOperator を参照。
 */
export const useCurrentOperatorStore = defineStore('currentOperator', () => {
  const { data: operator, error, loading, execute } = useAsync(fetchCurrentOperator)

  /** 読み込み中（または読み終えた）の Promise。同時に呼ばれたら同じものを返す */
  let pending = null

  /**
   * @returns {Promise<void>} 読み終えたら解決する（失敗しても reject しない。理由は error）
   */
  function ensureLoaded() {
    pending ??= execute().then((result) => {
      if (!result) pending = null
    })
    return pending
  }

  /**
   * 権限を持っているか。読み終える前と、読めなかったときは false。
   *
   * @param {'order'|'master'|'operation'|'branchAll'} permission CurrentOperator.permissions のキー
   */
  function can(permission) {
    return Boolean(operator.value?.permissions?.[permission])
  }

  return { operator, loading, error, ensureLoaded, can }
})

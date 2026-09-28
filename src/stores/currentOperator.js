import { computed } from 'vue'
import { defineStore } from 'pinia'
import { fetchCurrentOperator } from '@/api/auth'
import { useAsync } from '@/composables/useAsync'

/**
 * ログイン中の操作者（GET /auth/me）と、その権限。
 *
 * 画面の出し分け（サイドメニューの項目・ルートのガード）が全画面で同じ答えを使うよう、
 * 取得はここで 1 回だけ行う。main.js が起動時に load し、ルートのガードは ensureLoaded で
 * その完了を待つ（読み込みの途中で判定して、権限があるのに弾くことを避ける）。
 *
 * **取得に失敗したら「権限なし」に倒す。** 誤って操作を出すより、出さないほうが安全なため
 * （api 層も欠けた権限を false と読む）。失敗の理由は error に残る。
 *
 * 認可強制（authzEnforced）が false の間はサーバが権限不足でも拒否しないが、
 * 画面の出し分けはそれに関係なく権限フラグで行う。
 */
export const useCurrentOperatorStore = defineStore('currentOperator', () => {
  const { data, error, loading, execute } = useAsync(fetchCurrentOperator)

  const operator = computed(() => data.value)

  /*
   * 読み込みを 1 本にまとめる。main.js の load とガードの ensureLoaded が重なっても 2 回叩かない。
   * **失敗したら握っている Promise を捨てる**。起動時の一時的な失敗（/auth/me の 500 など）で
   * 権限なしのまま固まらないよう、次の画面遷移（ガードの ensureLoaded）で読み直させる。
   */
  let pending = null

  function load() {
    const request = execute().then((result) => {
      if (error.value && pending === request) pending = null
      return result
    })
    pending = request
    return request
  }

  /** まだ読んでいなければ読み、読み込み中ならその完了を待つ（前回失敗していれば読み直す） */
  function ensureLoaded() {
    return pending ?? load()
  }

  /**
   * 権限を持っているか。未取得・取得失敗のあいだは false。
   *
   * @param {'order'|'master'|'operation'|'branchAll'} permission
   *   キーは src/api/auth.js の CurrentOperator.permissions と同じ
   */
  function hasPermission(permission) {
    return operator.value?.permissions?.[permission] === true
  }

  return {
    operator,
    loading,
    error,
    load,
    ensureLoaded,
    hasPermission,
  }
})

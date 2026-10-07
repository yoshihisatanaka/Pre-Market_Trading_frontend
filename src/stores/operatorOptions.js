import { computed } from 'vue'
import { defineStore } from 'pinia'
import { fetchUsers } from '@/api/users'
import { useAsync } from '@/composables/useAsync'

/**
 * 操作者の選択肢（操作ログの「操作者」プルダウン）のストア。中身は GET /masters/users（m_操作者）。
 *
 * 操作者の顔ぶれは画面を開くたびに変わるものではないので、一度取れたら読み直さない（ensureLoaded）。
 * 取得に失敗したときは次に画面を開いたときに再試行する（activityLogTargets ストアと同じ扱い）。
 */

/**
 * 1 回で取る件数。仕様の limit の上限（200）。
 * 操作者がこれを超えたら、超えた分は選択肢に出ない（URL クエリで渡した操作者コードでは絞り込める）。
 */
export const OPERATOR_OPTIONS_LIMIT = 200

export const useOperatorOptionsStore = defineStore('operatorOptions', () => {
  // 操作ログには退職・無効になった操作者の記録も残るので、無効な操作者も選択肢に含める
  const { data, error, loading, execute } = useAsync(
    () => fetchUsers({ includeInactive: true, limit: OPERATOR_OPTIONS_LIMIT }),
    { initialData: { items: [], total: 0 } },
  )

  const users = computed(() => data.value?.items ?? [])

  /** BaseSelect の options にそのまま渡せる形（画面モックの「社員コード 氏名」）。未取得の間は空配列 */
  const options = computed(() =>
    users.value.map((user) => ({
      value: user.code,
      label: user.name ? `${user.code} ${user.name}` : user.code,
    })),
  )

  /** 取得中の Promise。重ねて呼ばれたときに同じ取得を待たせる */
  let pending = null

  /** 未取得のときだけ読み込む。取得済みなら何もしない。取得中なら進行中の Promise を返す */
  function ensureLoaded() {
    if (users.value.length > 0) return undefined
    if (!pending) {
      pending = execute().finally(() => {
        pending = null
      })
    }
    return pending
  }

  return {
    users,
    options,
    error,
    loading,
    load: execute,
    ensureLoaded,
  }
})

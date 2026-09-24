import { computed } from 'vue'
import { defineStore } from 'pinia'
import { fetchActivityLogTargets } from '@/api/activityLogs'
import { useAsync } from '@/composables/useAsync'

/**
 * 操作ログの対象種別のストア。検索の「対象種別」プルダウンの選択肢をここから配る。
 *
 * 中身はバックエンドの定義（どのマスタの履歴を横断するか）で、画面を開くたびに変わるものではない。
 * そのため一度取れたら読み直さない（ensureLoaded）。取得に失敗したときは次に画面を開いたときに再試行する。
 *
 * 1 件の形は src/api/activityLogs.js の JSDoc（ActivityLogTarget）を参照。
 */
export const useActivityLogTargetsStore = defineStore('activityLogTargets', () => {
  const { data, error, loading, execute } = useAsync(fetchActivityLogTargets, {
    initialData: [],
  })

  /** BaseSelect の options にそのまま渡せる形。未取得の間は空配列 */
  const options = computed(() =>
    (data.value ?? []).map((target) => ({ value: target.code, label: target.name })),
  )

  /** 未取得のときだけ読み込む。取得中・取得済みなら何もしない */
  function ensureLoaded() {
    if (loading.value || (data.value ?? []).length > 0) return undefined
    return execute()
  }

  return {
    targets: data,
    options,
    error,
    loading,
    load: execute,
    ensureLoaded,
  }
})

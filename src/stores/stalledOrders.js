import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { fetchStalledOrders, importConfirmationCsv } from '@/api/stalledOrders'
import { useAsync } from '@/composables/useAsync'

const EMPTY = { orderErrors: [], workingOrders: [] }

/**
 * 滞留注文抽出のストア。
 *
 * ページャを持たない一覧なので useCrudList には乗せず、stores/orders.js と同じく
 * useAsync を直に使う。1 回の検索で「注文エラー」と「注文中」の 2 本が同時に埋まるため、
 * data は配列ではなく `{ orderErrors, workingOrders }` のオブジェクト。
 *
 * 検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 1 件の形は src/api/stalledOrders.js の JSDoc を参照。
 *
 * 一覧の取得とコンファメーション CSV の取込で loading / error を分ける
 * （取込に失敗しても一覧の表示は残したいため。stores/sliceCriteria.js と同じ形）。
 * CSV の出力はサーバを通さないので、ここには置かない（画面が一覧の行から組み立てる）。
 */
export const useStalledOrdersStore = defineStore('stalledOrders', () => {
  const { data, error, loading, execute } = useAsync(fetchStalledOrders, { initialData: EMPTY })

  /*
   * 直近の検索条件。reload() が「いま画面に出ている条件」で引き直せるようにするため。
   * 表示に使わないので ref のまま公開しない。
   */
  const lastParams = ref({})

  const orderErrors = computed(() => data.value?.orderErrors ?? [])
  const workingOrders = computed(() => data.value?.workingOrders ?? [])

  // 空状態はローディング中・エラー時には出さない（4 状態が二重に出るのを防ぐ）
  const settled = computed(() => !loading.value && !error.value)
  const isOrderErrorsEmpty = computed(() => settled.value && orderErrors.value.length === 0)
  const isWorkingOrdersEmpty = computed(() => settled.value && workingOrders.value.length === 0)

  function load(params = {}) {
    lastParams.value = params
    return execute(params)
  }

  function reload() {
    return execute(lastParams.value)
  }

  const {
    error: importError,
    loading: importing,
    execute: executeImport,
  } = useAsync(importConfirmationCsv)

  /**
   * コンファメーション CSV を取り込み、直前の検索条件で一覧を引き直す。
   *
   * 行エラーがあって何も反映されなかったときも 200 なので引き直す（空振りでも害は無く、
   * 「結果を見て引き直すか決める」分岐を持たずに済む）。
   *
   * @param {File} file
   * @returns {Promise<import('@/api/stalledOrders').ConfirmationImportResult|null>}
   *   取込の結果。ファイルごと拒否された・通信に失敗したときは null（理由は importError）
   */
  async function importConfirmation(file) {
    const result = await executeImport(file)
    if (!result) return null

    await reload()
    return result
  }

  function clearImportError() {
    importError.value = null
  }

  return {
    orderErrors,
    workingOrders,
    error,
    loading,
    isOrderErrorsEmpty,
    isWorkingOrdersEmpty,
    load,
    reload,
    importing,
    importError,
    importConfirmation,
    clearImportError,
  }
})

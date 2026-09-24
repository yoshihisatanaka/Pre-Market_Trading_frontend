import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { fetchStalledOrders } from '@/api/stalledOrders'
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

  return {
    orderErrors,
    workingOrders,
    error,
    loading,
    isOrderErrorsEmpty,
    isWorkingOrdersEmpty,
    load,
    reload,
  }
})

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { fetchMarketHolidays } from '@/api/marketHolidays'
import { useAsync } from '@/composables/useAsync'

/** 一覧 1 ページあたりの表示件数 */
export const MARKET_HOLIDAYS_PAGE_SIZE = 50

/**
 * 海外休場日マスタのストア。
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 */
export const useMarketHolidaysStore = defineStore('marketHolidays', () => {
  // ページャー連打やブラウザバック連打で、古い応答が新しい結果を上書きするのを防ぐ
  let latestToken = 0
  async function fetchLatest(params) {
    const token = ++latestToken
    const result = await fetchMarketHolidays(params)
    return token === latestToken ? result : data.value
  }

  const { data, error, loading, execute } = useAsync(fetchLatest, {
    initialData: { items: [], total: 0 },
  })

  // storeToRefs で取り出せるよう、定数も ref で持つ
  const limit = ref(MARKET_HOLIDAYS_PAGE_SIZE)
  const offset = ref(0)
  const dateFrom = ref('')
  const dateTo = ref('')

  const items = computed(() => data.value?.items ?? [])
  const total = computed(() => data.value?.total ?? 0)
  const isEmpty = computed(() => !loading.value && !error.value && items.value.length === 0)

  /**
   * 検索条件とページ位置を指定して読み込む。
   * 呼ぶのは URL クエリを監視している画面側の watcher だけ。
   */
  function load({ offset: nextOffset = 0, dateFrom: nextFrom = '', dateTo: nextTo = '' } = {}) {
    offset.value = nextOffset
    dateFrom.value = nextFrom
    dateTo.value = nextTo

    return execute({
      limit: limit.value,
      offset: nextOffset,
      dateFrom: nextFrom,
      dateTo: nextTo,
    })
  }

  /** いまの条件のまま読み直す（再読み込み / 再試行ボタン用。URL は変えない） */
  function reload() {
    return load({ offset: offset.value, dateFrom: dateFrom.value, dateTo: dateTo.value })
  }

  return {
    items,
    total,
    limit,
    offset,
    dateFrom,
    dateTo,
    error,
    loading,
    isEmpty,
    load,
    reload,
  }
})

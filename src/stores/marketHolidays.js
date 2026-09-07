import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createMarketHoliday, fetchMarketHolidays } from '@/api/marketHolidays'
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

  // 登録は一覧とは別の loading / error を持つ。
  // 登録中も一覧の表示はそのまま残したいので、useAsync をもう 1 つ作る
  const {
    error: createError,
    loading: creating,
    execute: executeCreate,
  } = useAsync(createMarketHoliday)

  /**
   * 海外休場日を 1 件登録し、成功したら今の条件のまま一覧を読み直す。
   *
   * @returns {Promise<{ id: string, date: string, reason: string } | null>}
   *   登録された 1 件。失敗時は null（理由は createError に入る）
   */
  async function create({ date, reason }) {
    const created = await executeCreate({ date, reason })
    if (!created) return null

    await reload()
    return created
  }

  /** 登録エラーを消す（モーダルを開き直したときに前回の失敗を残さない） */
  function clearCreateError() {
    createError.value = null
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
    creating,
    createError,
    create,
    clearCreateError,
  }
})

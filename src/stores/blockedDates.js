import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createBlockedDate, fetchBlockedDates, validateBlockedDate } from '@/api/blockedDates'
import { useAsync } from '@/composables/useAsync'

/** 一覧 1 ページあたりの表示件数 */
export const BLOCKED_DATES_PAGE_SIZE = 50

/**
 * 受注不可日マスタのストア。
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 *
 * 削除 / 編集は別コミットで足すので、いまは一覧の取得と新規追加だけを持つ。
 */
export const useBlockedDatesStore = defineStore('blockedDates', () => {
  // ページャー連打やブラウザバック連打で、古い応答が新しい結果を上書きするのを防ぐ
  let latestToken = 0
  async function fetchLatest(params) {
    const token = ++latestToken
    const result = await fetchBlockedDates(params)
    return token === latestToken ? result : data.value
  }

  const { data, error, loading, execute } = useAsync(fetchLatest, {
    initialData: { items: [], total: 0 },
  })

  // storeToRefs で取り出せるよう、定数も ref で持つ
  const limit = ref(BLOCKED_DATES_PAGE_SIZE)
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

  /*
   * 登録は「事前検証 → 登録」の 2 段で行う（API 側がその前提で分かれている）。
   * 2 段をまたぐ 1 つの操作として扱いたいので useAsync も 1 本にまとめ、
   * 検証で弾かれた場合は例外にせず { valid: false, errors } を返す。
   */
  async function validateThenCreate({ date, reason }) {
    const validation = await validateBlockedDate({ date, reason })
    if (!validation.valid) return { valid: false, errors: validation.errors }

    const created = await createBlockedDate({ date, reason })
    return { valid: true, created }
  }

  // 登録は一覧とは別の loading / error を持つ。
  // 登録中も一覧の表示はそのまま残したいので、useAsync をもう 1 つ作る
  const {
    error: createError,
    loading: creating,
    execute: executeCreate,
  } = useAsync(validateThenCreate)

  // サーバの事前検証が返した理由（通信自体は成功しているので createError とは別に持つ）
  const validationErrors = ref([])

  /**
   * 受注不可日を 1 件登録し、成功したら今の条件のまま一覧を読み直す。
   * 登録の前にサーバの事前検証を通す。
   *
   * @returns {Promise<{ id: string, date: string, market: string, reason: string } | null>}
   *   登録された 1 件。失敗時は null
   *   （通信・サーバエラーは createError、事前検証で弾かれた理由は validationErrors に入る）
   */
  async function create({ date, reason }) {
    validationErrors.value = []

    const result = await executeCreate({ date, reason })
    // 通信・サーバエラー（理由は createError）
    if (!result) return null

    if (!result.valid) {
      validationErrors.value = result.errors
      return null
    }

    await reload()
    return result.created
  }

  /** 登録の失敗理由を消す（モーダルを開き直したときに前回の失敗を残さない） */
  function clearCreateError() {
    createError.value = null
    validationErrors.value = []
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
    validationErrors,
    create,
    clearCreateError,
  }
})

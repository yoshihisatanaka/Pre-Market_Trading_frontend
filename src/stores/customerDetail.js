import { computed } from 'vue'
import { defineStore } from 'pinia'
import { fetchCustomer } from '@/api/customers'
import { fetchHoldings } from '@/api/holdings'
import { useAsync } from '@/composables/useAsync'

/**
 * 1 顧客の預りを読む件数（`GET /holdings` の limit の上限）。
 * ページャーは持たず 1 回で読む。1 顧客の保有がこれを超えたら、評価額の合計は出さない（下の valuation）。
 */
export const CUSTOMER_HOLDINGS_LIMIT = 200

/**
 * 顧客詳細（/customers/:customerId/summary・/customers/:customerId/orders）のストア。
 * 顧客カード（顧客の属性と資産状況）と、外株預りの一覧を持つ。
 *
 * 読み込みは 2 段。顧客（`GET /masters/customers/{account_id}`）を読み、その部店コードと口座番号で
 * 預り（`GET /holdings`）を読む。顧客カードの「米国株評価額」「評価損益」は預りの合計なので、
 * 外株預りタブ以外（注文照会タブ）でも預りを読む。
 *
 * 処理ごとに useAsync を分ける（顧客 / 預り）。預りが失敗しても顧客カードは出す
 * （評価額が「—」になるだけ。理由は外株預りタブの一覧に出る）。
 *
 * 別の顧客を開いたら、前の顧客の値は捨ててから読む（Pinia は画面をまたいで残るので、
 * 読み終えるまで前の顧客のカードが出てしまう）。応答の順が入れ替わったときに古い顧客の結果で
 * 上書きしないよう、最後に出した読み込みの結果だけを採る（stores/orderEntry.js の照会と同じ）。
 */
export const useCustomerDetailStore = defineStore('customerDetail', () => {
  let latestToken = 0

  async function fetchLatestCustomer(customerId, token) {
    try {
      const result = await fetchCustomer(customerId)
      return token === latestToken ? result : customer.value
    } catch (e) {
      if (token === latestToken) throw e
      return customer.value
    }
  }

  async function fetchLatestHoldings({ branchCode, accountNumber }, token) {
    try {
      const result = await fetchHoldings({
        branchCode,
        accountNumber,
        limit: CUSTOMER_HOLDINGS_LIMIT,
      })
      return token === latestToken ? result : holdingsPage.value
    } catch (e) {
      if (token === latestToken) throw e
      return holdingsPage.value
    }
  }

  const {
    data: customer,
    error: customerError,
    loading: customerLoading,
    execute: executeCustomer,
  } = useAsync(fetchLatestCustomer)

  const {
    data: holdingsPage,
    error: holdingsError,
    loading: holdingsLoading,
    execute: executeHoldings,
  } = useAsync(fetchLatestHoldings)

  /** 404（顧客が居ない・削除済み）。画面は「見つからない」を出す（通信障害とは分ける） */
  const customerNotFound = computed(() => customerError.value?.status === 404)

  const holdings = computed(() => holdingsPage.value?.items ?? [])
  const holdingsTotal = computed(() => holdingsPage.value?.total ?? 0)

  /**
   * 預りを読み終えていない（読み込み中、またはまだ読み始めていない）。
   * 顧客を読み終えてから預りを読み始めるまでの間も含めるので、画面は loading の代わりにこれを使う
   * （その間に「データあり・0 件」の表が一瞬出るのを避ける）。
   */
  const holdingsPending = computed(
    () => holdingsLoading.value || (holdingsPage.value === null && !holdingsError.value),
  )

  /** 4 状態の「空」。読み終えて 1 件も無い（読む前・失敗は空ではない） */
  const holdingsEmpty = computed(
    () =>
      !holdingsLoading.value &&
      !holdingsError.value &&
      holdingsPage.value !== null &&
      holdings.value.length === 0,
  )

  /** CA（コーポレートアクション）発生中の銘柄があるか。一覧の上に警告を出す */
  const hasCorporateAction = computed(() =>
    holdings.value.some((holding) => Boolean(holding.corporateAction)),
  )

  /**
   * 顧客カードの「米国株評価額」「評価損益」（円）。預りの評価額_JPY と評価損益を足したもの。
   *
   * 出せないときは null（画面は「—」）。
   *   - 預りを読み終えていない・読めなかった
   *   - 上限（CUSTOMER_HOLDINGS_LIMIT）を超えて読み切れていない（一部だけの合計を出さない）
   * 保有が 0 件なら 0 円。評価額の無い明細（前日終値なし）は合計に入れない。
   */
  const valuation = computed(() => {
    if (holdingsPending.value || holdingsError.value) return null
    if (holdingsTotal.value > holdings.value.length) return null
    return {
      valueJpy: sum(holdings.value.map((holding) => holding.valueJpy)),
      profitLossJpy: sum(holdings.value.map((holding) => holding.profitLossJpy)),
    }
  })

  /**
   * 顧客と、その預りを読む。
   *
   * @param {string} customerId 顧客マスタの行 ID（ルートの :customerId）
   * @returns {Promise<void>} 失敗は customerError / holdingsError に入る（例外にしない）
   */
  async function load(customerId) {
    const token = ++latestToken
    if (customer.value?.id !== customerId) {
      customer.value = null
      holdingsPage.value = null
      holdingsError.value = null
    }

    const loaded = await executeCustomer(customerId, token)
    if (!loaded || token !== latestToken) return
    await executeHoldings(loaded, token)
  }

  /** 預りだけを読み直す（外株預りタブの「再試行」）。顧客を読めていなければ何もしない */
  function reloadHoldings() {
    if (!customer.value) return null
    return executeHoldings(customer.value, latestToken)
  }

  return {
    customer,
    customerError,
    customerLoading,
    customerNotFound,
    holdings,
    holdingsTotal,
    holdingsError,
    holdingsLoading,
    holdingsPending,
    holdingsEmpty,
    hasCorporateAction,
    valuation,
    load,
    reloadHoldings,
  }
})

/** 数値だけを足す（null は値なしとして飛ばす） */
function sum(values) {
  return values.reduce((total, value) => (typeof value === 'number' ? total + value : total), 0)
}

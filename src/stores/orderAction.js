import { defineStore } from 'pinia'
import { ref } from 'vue'
import { amendOrder, cancelOrder, fetchOrderDetail } from '@/api/orderInquiry'
import { useAsync } from '@/composables/useAsync'

/**
 * 注文 1 件への操作（訂正・取消）のストア。訂正画面（OrderAmendView）と取消画面
 * （OrderCancelView）が共用する。一覧（stores/orderInquiry.js）とは持つものが違うので分けてある。
 *
 * 持つのは 3 系統で、loading / error をそれぞれ別に持つ（訂正の送信中も対象注文の表示は残す）。
 *   対象注文 … order / loading / error / load(id)
 *   訂正     … amendResult / amending / amendError / amend(payload)
 *   取消     … cancelResult / canceling / cancelError / cancel()
 *
 * 結果（amendResult / cancelResult）が入ったら、画面は完了表示に切り替える。
 * 操作が済んでも対象注文は読み直さない（完了表示は結果だけを出し、注文照会へ戻れば一覧が読み直す）。
 *
 * 1 件の形は src/api/orderInquiry.js の OrderDetail / AmendResult / CancelResult を参照。
 */
export const useOrderActionStore = defineStore('orderAction', () => {
  /*
   * 画面を開き直したり、ブラウザバックで別の注文へ移ったりして load が重なったとき、
   * 古い応答が新しい注文を上書きしないようにする（useCrudList の fetchLatest と同じ考えかた）
   */
  let latestToken = 0
  async function fetchLatest(id) {
    const token = ++latestToken
    const result = await fetchOrderDetail(id)
    return token === latestToken ? result : order.value
  }

  const { data: order, error, loading, execute } = useAsync(fetchLatest)

  const {
    data: amendResult,
    error: amendError,
    loading: amending,
    execute: executeAmend,
  } = useAsync(amendOrder)

  const {
    data: cancelResult,
    error: cancelError,
    loading: canceling,
    execute: executeCancel,
  } = useAsync(cancelOrder)

  /** いま画面が開いている注文の ID。訂正・取消はこの注文に対して行う */
  const orderId = ref('')

  /**
   * 注文を読み込む。前の注文の内容・結果・失敗は先に消す
   * （別の注文を開いたときに、前の注文の完了表示やエラーを持ち越さない）。
   *
   * @param {string} id 注文 ID（ルートの :orderId）
   */
  function load(id) {
    orderId.value = id
    order.value = null
    clearResults()
    return execute(id)
  }

  /** いまの注文を読み直す（読み込み失敗の再試行用） */
  function reload() {
    return execute(orderId.value)
  }

  /**
   * いまの注文を訂正する。
   *
   * @param {{ quantity?: number, orderType?: string, limitPrice?: number,
   *   marketScope?: string, reason?: string }} changes 変えた項目だけ（api 層の amendOrder と同じ）
   * @returns {Promise<object|null>} 結果（AmendResult）。失敗は null で、理由は amendError
   */
  function amend(changes) {
    return executeAmend({ id: orderId.value, ...changes })
  }

  /**
   * いまの注文を取り消す。
   *
   * @returns {Promise<object|null>} 結果（CancelResult）。失敗は null で、理由は cancelError
   */
  function cancel() {
    return executeCancel({ id: orderId.value })
  }

  function clearResults() {
    amendResult.value = null
    amendError.value = null
    cancelResult.value = null
    cancelError.value = null
  }

  return {
    orderId,
    order,
    loading,
    error,
    load,
    reload,
    amendResult,
    amending,
    amendError,
    amend,
    cancelResult,
    canceling,
    cancelError,
    cancel,
  }
})

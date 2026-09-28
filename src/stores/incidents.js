import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  fetchSuspensionHistories,
  fetchSuspensionStatus,
  resumeOrders,
  suspendOrders,
} from '@/api/incidents'
import { useAsync } from '@/composables/useAsync'
import { DEFAULT_PAGE_SIZE } from '@/utils/pagination'

/**
 * 履歴の 1 ページの件数（既定は utils/pagination.js の DEFAULT_PAGE_SIZE）。
 * この画面だけ変えるときはここを数値で上書きする（limit として送る）。
 */
export const INCIDENT_HISTORY_PAGE_SIZE = DEFAULT_PAGE_SIZE

/**
 * 障害管理（停止対象ごとの発注停止状態 + 停止・再開の操作履歴）。
 *
 * 状態と履歴の先頭ページは 1 画面に同時に出すので、最初の取得は 1 回にまとめる。
 * 取得口を 2 つに割ると、画面の 4 状態が状態側と履歴側でねじれる。
 * 片方が落ちたら error は 1 本だけ立つ（どちらが落ちたかは利用者の関心ではない）。
 *
 * 履歴のページ送りだけは別の取得にする（historyLoading / historyError）。
 * ページ送りに失敗しても、停止対象の表と操作は使えるままにしたい（障害対応の最中のため）。
 * ページ位置は URL クエリに載せず historyOffset で持つ（stores/announcements.js と同じ。
 * 画面内の従属的な表で、useListQuery の対象ではないため）。
 *
 * Promise.all を api/ ではなくここに置くのは、api 層が「1 エンドポイント = 1 関数」だから。
 * ストアは axios もバックエンドの生の形も知らないので、レイヤ規約には抵触しない。
 *
 * 取得と操作（停止・再開）で loading / error を分ける（stores/sliceCriteria.js と同じ）。
 * 操作に失敗しても現在の状態の表示は残したい。障害対応の最中に画面が消えると困るため。
 */
export const useIncidentsStore = defineStore('incidents', () => {
  const historyOffset = ref(0)

  /*
   * 履歴の取得は並びうる（ページ送りの応答待ちに再読み込みや停止・再開の取り直しが重なる）。
   * 追い越された応答で表を上書きしないよう、最後に出した要求の結果だけを採る。
   */
  let latestHistoryRequest = 0

  async function fetchAll(offset) {
    ++latestHistoryRequest
    const [status, historyPage] = await Promise.all([
      fetchSuspensionStatus(),
      fetchHistoryPage(offset),
    ])
    return { status, historyPage }
  }

  const { data, error, loading, execute } = useAsync(fetchAll)

  const status = computed(() => data.value?.status ?? null)
  const targets = computed(() => status.value?.targets ?? [])
  const histories = computed(() => data.value?.historyPage.items ?? [])
  const historyTotal = computed(() => data.value?.historyPage.total ?? 0)

  /*
   * 「空」は停止状態が読めないこと。
   * 履歴 0 件は空ではない（停止対象の表は出るので、データあり側の内訳になる）。
   */
  const isEmpty = computed(() => !loading.value && !error.value && !status.value)
  const hasHistories = computed(() => histories.value.length > 0)

  // 最後に出したページ送りの要求。追い越された要求はこれが終わるのを待ってから戻る
  let latestHistoryPromise = Promise.resolve()

  /*
   * 古い要求の結果と失敗は、いまの表をそのまま返して捨てる。
   * 捨てる側もすぐには戻らない。historyLoading は useAsync の 1 本を共有しているので、
   * 古い要求が先に戻ると、最新の要求の応答待ちなのにページャーが押せる状態に戻ってしまう。
   */
  async function fetchLatestHistoryPage(offset) {
    const request = ++latestHistoryRequest
    const pending = fetchHistoryPage(offset)
    latestHistoryPromise = pending
    try {
      const page = await pending
      if (request === latestHistoryRequest) {
        if (data.value) data.value = { ...data.value, historyPage: page }
        return page
      }
    } catch (e) {
      if (request === latestHistoryRequest) throw e
    }
    // 最新の要求の成否はそちらの execute が error に出す。ここは待つだけ
    await latestHistoryPromise.catch(() => {})
    return data.value?.historyPage ?? null
  }

  const {
    error: historyError,
    loading: historyLoading,
    execute: executeHistory,
  } = useAsync(fetchLatestHistoryPage)

  /*
   * 操作 → 状態と履歴の取り直し を 1 本の useAsync の中で続ける（useCrudList の 2 段と同じ）。
   * 操作の応答は操作した 1 対象しか返さず、総合フラグも履歴も含まないので、取り直さないと
   * 画面の他の部分が古いままになる。取り直しは取得側の loading を立てない（表を消さない）。
   * どちらの段で落ちても saveError に出る。
   * 新しい履歴は先頭に積まれるので、2 ページ目を見ていても先頭ページへ戻す。
   */
  const {
    error: saveError,
    loading: saving,
    execute: executeControl,
  } = useAsync(async (control, params) => {
    const result = await control(params)
    historyOffset.value = 0
    historyError.value = null
    data.value = await fetchAll(0)
    return result
  })

  /** 楽観的ロックの合札。表に無い対象なら送らない（null）。サーバが対象不正で弾く */
  function updatedAtOf(target) {
    return targets.value.find((row) => row.target === target)?.updatedAt ?? null
  }

  /**
   * 発注を停止する。成功すれば操作の応答（message を画面が出す）、失敗すれば null。
   * @param {{ target: string, reason: string }} params
   */
  function suspend({ target, reason }) {
    return executeControl(suspendOrders, { target, reason, updatedAt: updatedAtOf(target) })
  }

  /**
   * 発注を再開する。戻り値は suspend と同じ。
   * @param {{ target: string }} params
   */
  function resume({ target }) {
    return executeControl(resumeOrders, { target, updatedAt: updatedAtOf(target) })
  }

  function clearSaveError() {
    saveError.value = null
  }

  /**
   * 停止状態と履歴をまとめて読む。履歴は offset のページ（省けば先頭ページ）。
   * 再読み込みでいまのページを保ちたいときは historyOffset を渡す。
   */
  function load(offset = 0) {
    historyOffset.value = offset
    historyError.value = null
    return execute(offset)
  }

  /**
   * 履歴だけを読む（ページャー / 履歴の再試行用）。offset を省けば今のページを読み直す。
   * ページ位置は取得の成否にかかわらず先に動かす（ページャーの表示と再試行の対象をそろえる）。
   */
  function loadHistory(offset = historyOffset.value) {
    historyOffset.value = offset
    return executeHistory(offset)
  }

  return {
    status,
    targets,
    histories,
    historyTotal,
    historyOffset,
    historyLoading,
    historyError,
    loading,
    error,
    isEmpty,
    hasHistories,
    saving,
    saveError,
    load,
    loadHistory,
    suspend,
    resume,
    clearSaveError,
  }
})

function fetchHistoryPage(offset) {
  return fetchSuspensionHistories({ limit: INCIDENT_HISTORY_PAGE_SIZE, offset })
}

import { computed } from 'vue'
import { defineStore } from 'pinia'
import { closeMizuhoOrders, fetchMizuhoClosingStatus, reopenMizuhoOrders } from '@/api/closing'
import { exportMizuhoOrderSheet } from '@/api/mizuho'
import { useAsync } from '@/composables/useAsync'

/**
 * 注文ファイルを作る順。実 API は 1 回で 1 冊（買い / 売り）しか出さないので、この順に続けて作る。
 * 値は api/mizuho.js の exportMizuhoOrderSheet の side。
 */
export const ORDER_FILE_SIDES = ['buy', 'sell']

/**
 * みずほ注文締の締め状態（受付中 / 締め済）と、締めカードの操作（締め・締め解除・注文ファイル作成）のストア。
 *
 * 約定一覧（stores/mizuhoExecutions.js）とは取得を分ける。締め状態が読めなくても約定一覧は
 * 見られるままにしたい（逆も同じ）ので、画面の 4 状態もカードごとに別々に出す。
 * 1 件の形は src/api/closing.js の JSDoc を参照。
 *
 * 取得と操作で loading / error を分ける（stores/incidents.js と同じ）。操作に失敗しても
 * 締めカードの表示は消さない。3 つの操作は同じ確認ダイアログから 1 つずつしか出ないので、
 * saving / saveError は共用する。
 */
export const useMizuhoClosingStore = defineStore('mizuhoClosing', () => {
  const { data: status, error, loading, execute } = useAsync(fetchMizuhoClosingStatus)

  /** 「空」は締め状態が読めないこと（本文なしの応答） */
  const isEmpty = computed(() => !loading.value && !error.value && !status.value)

  const {
    error: saveError,
    loading: saving,
    execute: executeAction,
  } = useAsync((action, params) => action(params))

  /** 締め状態を読む（初回と再試行の入口） */
  function load() {
    return execute()
  }

  /*
   * 締め・締め解除の応答は操作後の ClosingStatusResponse そのものなので、取り直さずに差し替える。
   * 照会（GET）は 更新日時 / 実行者 を返さないため、取り直すと状態変更履歴の 1 行が消えてしまう。
   */
  async function changeStatus(action) {
    const next = await executeAction(action)
    if (next) status.value = next
    return next
  }

  /** みずほ注文を締める。成功すれば操作後の状態、失敗すれば null（理由は saveError） */
  function close() {
    return changeStatus(closeMizuhoOrders)
  }

  /** 締めを解除して受付中に戻す。戻り値は close と同じ */
  function reopen() {
    return changeStatus(reopenMizuhoOrders)
  }

  /**
   * 注文ファイルを買い → 売りの順に作る。ダウンロード（DOM の副作用）は画面が行う。
   *
   * 途中で失敗したら、そこで止める（残りも同じ理由で落ちることが多い）。作れた分はサーバ側で
   * 発注済へ進んでいるので捨てずに返す。作り直しは同じ内容を返し状態を変えないので、
   * 失敗したあと全部を作り直しても害は無い。
   *
   * @returns {Promise<{
   *   files: Array<{ side: 'buy'|'sell' } & import('@/api/mizuho').MizuhoOrderSheet>,
   *   failedSide: 'buy'|'sell'|null,
   * }>} failedSide は作れなかった側（理由は saveError）。全部作れたら null
   */
  async function createOrderFiles() {
    const files = []
    for (const side of ORDER_FILE_SIDES) {
      const sheet = await executeAction(exportMizuhoOrderSheet, { side })
      if (!sheet) return { files, failedSide: side }
      files.push({ side, ...sheet })
    }
    return { files, failedSide: null }
  }

  function clearSaveError() {
    saveError.value = null
  }

  return {
    status,
    loading,
    error,
    isEmpty,
    saving,
    saveError,
    load,
    close,
    reopen,
    createOrderFiles,
    clearSaveError,
  }
})

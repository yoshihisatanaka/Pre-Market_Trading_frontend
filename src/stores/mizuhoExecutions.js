import { shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { exportMizuhoExecutionsCsv, fetchMizuhoExecutions } from '@/api/mizuhoExecutions'
import { useAsync } from '@/composables/useAsync'
import { useCrudList } from '@/composables/useCrudList'
import { DEFAULT_PAGE_SIZE } from '@/utils/pagination'

/**
 * 一覧 1 ページあたりの表示件数（既定は utils/pagination.js の DEFAULT_PAGE_SIZE）。
 *
 * 実 API（`GET /executions`）の limit は 1〜200。
 * この画面だけ変えるときはここを数値で上書きする（api 層が limit として送る）。
 */
export const MIZUHO_EXECUTIONS_PAGE_SIZE = DEFAULT_PAGE_SIZE

const FILTER_KEYS = ['branchCode', 'symbol', 'side', 'fillStatus', 'dateFrom', 'dateTo']

/**
 * みずほ注文締の約定一覧のストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/mizuhoExecutions.js の JSDoc を参照。読むだけの一覧なので更新系は渡さない。
 *
 * useCrudList が公開しない件数カードの集計（summary）と CSV 出力をここで足す。
 * 集計は同じ応答に載ってくるので、一覧と同じく**最後に出した要求の結果だけ**を採る
 * （ページ送りの連打で、古い条件の集計が新しい一覧の上に残らないようにする）。
 * CSV 出力は一覧と loading / error を分ける（stores/executions.js と同じ形）。
 * ファイルを保存させる DOM の操作は画面が行う。
 */
export const useMizuhoExecutionsStore = defineStore('mizuhoExecutions', () => {
  /** 件数カードの集計。まだ一度も取れていなければ null */
  const summary = shallowRef(null)

  let latestRequest = 0
  async function fetchPage(params) {
    const request = ++latestRequest
    const result = await fetchMizuhoExecutions(params)
    if (request === latestRequest) summary.value = result.summary
    return result
  }

  const list = useCrudList({
    pageSize: MIZUHO_EXECUTIONS_PAGE_SIZE,
    filterKeys: FILTER_KEYS,
    fetchPage,
  })

  const {
    error: exportError,
    loading: exporting,
    execute: executeExport,
  } = useAsync(exportMizuhoExecutionsCsv)

  /**
   * 最後に読み込んだ一覧と同じ検索条件で、みずほの約定を CSV として取得する。
   *
   * 条件は検索欄の入力ではなく load に渡された値（= URL クエリ）を使う。
   * 入力しただけで検索していない条件が、画面に出ている一覧と食い違って出力されないようにするため。
   *
   * @returns {Promise<{ blob: Blob, filename: string }|null>} 失敗したら null（理由は exportError）
   */
  function exportCsv() {
    return executeExport(Object.fromEntries(FILTER_KEYS.map((key) => [key, list[key].value])))
  }

  function clearExportError() {
    exportError.value = null
  }

  return { ...list, summary, exporting, exportError, exportCsv, clearExportError }
})

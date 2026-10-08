import { defineStore } from 'pinia'
import {
  createSymbol,
  deleteSymbol,
  disableAllVwapTargets,
  fetchSymbols,
  previewDisableAllVwapTargets,
  updateSymbol,
  validateSymbol,
} from '@/api/symbols'
import { useAsync } from '@/composables/useAsync'
import { useCrudList } from '@/composables/useCrudList'
import { DEFAULT_PAGE_SIZE } from '@/utils/pagination'

/**
 * 一覧 1 ページあたりの表示件数（既定は utils/pagination.js の DEFAULT_PAGE_SIZE）。
 *
 * 実 API（`GET /masters/symbols`）の limit は 1〜200 で、こちらから指定できる。
 * この画面だけ変えるときはここを数値で上書きする（api 層が limit として送る）。
 */
export const SYMBOLS_PAGE_SIZE = DEFAULT_PAGE_SIZE

/**
 * 銘柄マスタのストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/symbols.js の JSDoc を参照。
 *
 * **取得・登録・更新・削除の CRUD 一式を持つ。**
 *
 * 登録も編集も「サーバの事前検証（validateItem）→ 登録・更新」の 2 段。
 * 不合格は validationErrors / updateValidationErrors、通信・サーバ障害は
 * createError / updateError と、入れ物が 4 つに分かれる。楽観的ロックの競合（409）は
 * 事前検証の不合格ではなく updateError に入る。
 *
 * **削除だけは 1 段。** 実 API の DELETE は本文を取らないので事前検証を通さず、
 * 楽観的ロックも無い（競合の 409 が起きない）。拒否の理由はすべて deleteError に入る。
 *
 * **VWAP対象の一括対象外化**（画面モックのヘッダボタン「VWAP対象を一括で対象外へ」）は
 * 行単位の CRUD と別系統なので useCrudList の外に持つ。「事前確認（dry-run）→ 本実行」の 2 段で、
 * 事前確認は確認ダイアログを開いた時点で呼び、件数と対象の一覧を見せる。
 * 入れ物は 2 段で分ける（確認が失敗したときと実行が失敗したときで、画面が出す場所が違う）:
 *   vwapBulkPreview / vwapBulkPreviewing / vwapBulkPreviewError … 事前確認の結果・実行中・失敗
 *   vwapBulkUpdating / vwapBulkError                            … 本実行の実行中・失敗
 * 本実行が成功したら、今の条件のまま一覧を読み直す（変わった行の色と区分が一覧に出る）。
 *
 * 並べ替えはサーバの責務で、ここでは触らない。
 */
export const useSymbolsStore = defineStore('symbols', () => {
  const list = useCrudList({
    pageSize: SYMBOLS_PAGE_SIZE,
    filterKeys: ['symbolCode', 'symbolName', 'regulation', 'orderRoute', 'vwapTarget'],
    fetchPage: fetchSymbols,
    createItem: createSymbol,
    validateItem: validateSymbol,
    updateItem: updateSymbol,
    deleteItem: deleteSymbol,
  })

  const {
    data: vwapBulkPreview,
    error: vwapBulkPreviewError,
    loading: vwapBulkPreviewing,
    execute: executePreview,
  } = useAsync(previewDisableAllVwapTargets)

  const {
    error: vwapBulkError,
    loading: vwapBulkUpdating,
    execute: executeDisableAll,
  } = useAsync(disableAllVwapTargets)

  /**
   * 一括対象外化の事前確認（dry-run）。確認ダイアログを開くときに呼ぶ。
   * 前回の結果と失敗はここで消してから取り直す（古い件数を一瞬でも見せない）。
   *
   * @returns {Promise<import('@/api/symbols').VwapTargetBulkResult|null>} 失敗時は null
   *   （理由は vwapBulkPreviewError に入る）
   */
  function previewDisableAllVwap() {
    clearVwapBulkError()
    return executePreview()
  }

  /**
   * VWAP対象の銘柄をすべて対象外にし、成功したら今の条件のまま一覧を読み直す。
   *
   * @param {{ onSuccess?: (result: import('@/api/symbols').VwapTargetBulkResult) => void }} [options]
   *   onSuccess は create / update / remove と同じく、サーバが受理した時点で一覧の読み直しを
   *   待たずに呼ぶ（ダイアログを閉じるのに使う）
   * @returns {Promise<import('@/api/symbols').VwapTargetBulkResult|null>} 失敗時は null
   *   （理由は vwapBulkError に入る）
   */
  async function disableAllVwap({ onSuccess } = {}) {
    const result = await executeDisableAll()
    if (!result) return null

    onSuccess?.(result)

    await list.reload()
    return result
  }

  /** 一括対象外化の失敗理由と前回の確認結果を消す（ダイアログを閉じたときに次回へ持ち越さない） */
  function clearVwapBulkError() {
    vwapBulkPreview.value = null
    vwapBulkPreviewError.value = null
    vwapBulkError.value = null
  }

  return {
    ...list,
    vwapBulkPreview,
    vwapBulkPreviewing,
    vwapBulkPreviewError,
    vwapBulkUpdating,
    vwapBulkError,
    previewDisableAllVwap,
    disableAllVwap,
    clearVwapBulkError,
  }
})

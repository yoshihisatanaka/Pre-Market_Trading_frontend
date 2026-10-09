import { defineStore } from 'pinia'
import { computed } from 'vue'
import { changeDreamStatus, fetchDreamOrders, fetchDreamStatusCodes } from '@/api/dreamStatus'
import { useAsync } from '@/composables/useAsync'
import { useCrudList } from '@/composables/useCrudList'
import { DEFAULT_PAGE_SIZE } from '@/utils/pagination'
import { useNavBadgesStore } from './navBadges'

/**
 * 一覧 1 ページあたりの表示件数（既定は utils/pagination.js の DEFAULT_PAGE_SIZE）。
 *
 * 実 API（`GET /orders/dream-status`）の limit は 1〜200。
 * この画面だけ変えるときはここを数値で上書きする（api 層が limit として送る）。
 */
export const DREAM_STATUS_PAGE_SIZE = DEFAULT_PAGE_SIZE

/**
 * Dream登録状況のストア。
 *
 * ページ位置・検索条件は URL クエリが正で、ここはその写しを持つだけ（画面側が load で渡す）。
 * 取得・競合防止の足回りは useCrudList が持つ（公開される名前もそちらの JSDoc）。
 * 1 件の形は src/api/dreamStatus.js の JSDoc を参照。
 *
 * 書き込みは STS変更（`PUT /orders/dream-status/{order_id}`）だけで、useCrudList には渡さず
 * ここに専用の操作（changeStatus）として持つ。useCrudList の updateItem は「フォームで 1 行を
 * 編集する」前提の形で、遷移先を選んで状況だけを変えるこの操作とは入出力が合わないため。
 *
 * 検索のプルダウン（Dream状況のコード一覧）もここで持つ。一覧とは別の useAsync にするのは、
 * 選択肢の取得中も一覧の表示と検索は止めたくないため。
 */
export const useDreamStatusStore = defineStore('dreamStatus', () => {
  const list = useCrudList({
    pageSize: DREAM_STATUS_PAGE_SIZE,
    filterKeys: [
      'branchCode',
      'accountNumber',
      'symbol',
      'status',
      'dateFrom',
      'dateTo',
      'receiptNumber',
    ],
    fetchPage: fetchDreamOrders,
  })

  const navBadges = useNavBadgesStore()

  const {
    data: statusCodes,
    loading: statusCodesLoading,
    // 取れなかった理由（ApiError）。画面がプルダウンの下に出す（一覧の取得とは独立）
    error: statusCodesError,
    execute: loadStatusCodes,
  } = useAsync(fetchDreamStatusCodes, { initialData: [] })

  /** 検索のプルダウンに渡す形（BaseSelect の `{ value, label }`） */
  const statusOptions = computed(() =>
    statusCodes.value.map((status) => ({ value: status.code, label: status.name })),
  )

  const {
    loading: changing,
    // 弾かれた理由（ApiError）。400 / 409 もここに入り、画面は確認ダイアログの中に出す
    error: changeError,
    execute: executeChange,
  } = useAsync(changeDreamStatus)

  /**
   * 1 行の Dream状況を変更し、成功したらいまの条件とページ位置のまま一覧を読み直す。
   *
   * 行を応答で差し替えずに読み直すのは、変更後の行が検索条件（Dream登録状況 など）から
   * 外れうるため。useCrudList の update と同じく、onSuccess（ダイアログを閉じる）を読み直しより先に呼ぶ。
   * 失敗したときは読み直さない（409 でも同じ。ダイアログが持つ行の合札は読み直しても新しくならない）。
   * 成功したらサイドメニューの件数（Dream登録エラー）も取り直す。画面を移らないので AppSidebar は取り直さない。
   * 件数の取り直しは await しない（一覧の読み直しを件数の取得に引きずらせない）。
   *
   * @param {{
   *   order: import('@/api/dreamStatus').DreamOrder,
   *   status: string,
   *   receiptNumber?: string,
   *   reason?: string,
   * }} params
   *   order は変える行（items の 1 行）。合札の updatedAt はここから取る
   * @param {{ onSuccess?: (result: { order: object, message: string }) => void }} [options]
   * @returns {Promise<{ order: object, message: string } | null>} 失敗したときは null
   */
  async function changeStatus({ order, status, receiptNumber, reason }, { onSuccess } = {}) {
    const result = await executeChange({
      id: order.id,
      status,
      receiptNumber,
      reason,
      updatedAt: order.updatedAt,
    })
    if (!result) return null

    onSuccess?.(result)

    navBadges.load()
    await list.reload()
    return result
  }

  function clearChangeError() {
    changeError.value = null
  }

  return {
    ...list,
    statusCodes,
    statusCodesLoading,
    statusCodesError,
    statusOptions,
    loadStatusCodes,
    changing,
    changeError,
    changeStatus,
    clearChangeError,
  }
})

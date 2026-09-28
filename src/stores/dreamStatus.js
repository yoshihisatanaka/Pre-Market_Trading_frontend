import { defineStore } from 'pinia'
import { computed } from 'vue'
import { fetchDreamOrders, fetchDreamStatusCodes } from '@/api/dreamStatus'
import { useAsync } from '@/composables/useAsync'
import { useCrudList } from '@/composables/useCrudList'
import { DEFAULT_PAGE_SIZE } from '@/utils/pagination'

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
 * **いまは読むだけ。** STS変更（`PUT /orders/dream-status/{order_id}`）は画面の UI だけが先にあり、
 * 送信はまだ繋いでいない。useCrudList の updateItem は「フォームで 1 行を編集する」前提の形なので、
 * 入れるときは useCrudList に渡さず、ここに専用の操作として足す。
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

  return {
    ...list,
    statusCodes,
    statusCodesLoading,
    statusCodesError,
    statusOptions,
    loadStatusCodes,
  }
})

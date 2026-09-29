import { computed } from 'vue'
import { defineStore } from 'pinia'
import { fetchOrderCsvSpec } from '@/api/orderCsv'
import { useAsync } from '@/composables/useAsync'

/**
 * CSV一括注文のストア。
 *
 * いま持つのは columns … CSV の列の仕様（全 22 列）だけ。取込み画面の「CSVフォーマット」表に出す。
 * 1 件の形は src/api/orderCsv.js の JSDoc を参照。
 *
 * TODO(処理実装): 事前検証（`POST /orders/validate-csv`）と一括受付（`POST /orders/bulk-create`）。
 *   結果はプレビュー・受付完了の画面へ持ち越すので、足すときはこのストアに置く
 *   （URL クエリに載る大きさではない）。
 */
export const useOrderCsvStore = defineStore('orderCsv', () => {
  const {
    data: columns,
    error: columnsError,
    loading: columnsLoading,
    execute: executeColumns,
  } = useAsync(fetchOrderCsvSpec, { initialData: [] })

  // 空状態はローディング中・エラー時には出さない（4 状態が二重に出るのを防ぐ）
  const isColumnsEmpty = computed(
    () => !columnsLoading.value && !columnsError.value && columns.value.length === 0,
  )

  /** CSV の列の仕様を読む（初回と再試行の入口） */
  function loadColumns() {
    return executeColumns()
  }

  return {
    columns,
    columnsError,
    columnsLoading,
    isColumnsEmpty,
    loadColumns,
  }
})

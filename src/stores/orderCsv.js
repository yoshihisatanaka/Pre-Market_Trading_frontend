import { computed, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import {
  bulkCreateOrders,
  fetchOrderCsvSpec,
  fetchOrderCsvTemplate,
  validateOrderCsv,
} from '@/api/orderCsv'
import { useAsync } from '@/composables/useAsync'
import { useCurrentOperatorStore } from './currentOperator'

/**
 * CSV一括注文のストア。取込み → プレビュー → 受付完了の 3 画面が共有する。
 *
 * 持つもの:
 *   columns    … CSV の列の仕様（全 22 列）。取込み画面の「CSVフォーマット」表に出す
 *   validation … 事前検証の結果。プレビュー画面が出す（URL クエリに載る大きさではないのでここに置く）
 *   completion … 一括受付の結果。受付完了画面が出す
 * 形は src/api/orderCsv.js の JSDoc を参照。
 *
 * validation / completion は画面をまたいで残る。URL を直接開いた・再読み込みしたときは空で、
 * そのときプレビューと受付完了は空状態を出す。
 */
export const useOrderCsvStore = defineStore('orderCsv', () => {
  const currentOperator = useCurrentOperatorStore()

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

  const {
    error: templateError,
    loading: templateLoading,
    execute: executeTemplate,
  } = useAsync(fetchOrderCsvTemplate)

  /**
   * テンプレートを取得する。保存させる（DOM に触る）のは画面の役目。
   * @returns {Promise<{ blob: Blob, filename: string }|null>} 失敗したら null（理由は templateError）
   */
  function downloadTemplate() {
    return executeTemplate()
  }

  const {
    data: validation,
    error: validationError,
    loading: validating,
    execute: executeValidation,
  } = useAsync(validateOrderCsv)

  const {
    error: submitError,
    loading: submitting,
    execute: executeSubmit,
  } = useAsync(async (orders) => {
    // 作成者はサーバが操作者コードで上書きするが、OrderRequest の必須なので送る。読めなければ空文字
    await currentOperator.ensureLoaded()
    return bulkCreateOrders(orders, { createdBy: currentOperator.operator?.operatorCode ?? '' })
  })

  const completion = shallowRef(null)

  /** 全行が正常で、受付の最中でない */
  const canSubmit = computed(() => validation.value?.allValid === true && !submitting.value)

  /**
   * CSV を事前検証する。行に NG があっても成功（validation に入る）で、失敗はファイルそのものの不備と通信の失敗。
   * @param {File} file
   * @returns {Promise<object|null>} 検証の結果。失敗したら null（理由は validationError）
   */
  function validateFile(file) {
    // useAsync は失敗しても前回の値を残す。別のファイルの結果がプレビューに出ないよう先に空にする
    validation.value = null
    submitError.value = null
    return executeValidation(file)
  }

  /**
   * いまの検証結果の全行を一括受付する。
   *
   * 成功したら completion に結果（行ごとに採番された注文 ID）を置き、validation を空にする。
   * ブラウザの「戻る」でプレビューへ戻って、同じ注文をもう一度受け付けられないようにするため。
   *
   * @returns {Promise<boolean>} 受け付けたら true（失敗の理由は submitError）
   */
  async function submitOrders() {
    const current = validation.value
    if (!current?.allValid || submitting.value) return false

    const result = await executeSubmit(current.rows.map((row) => row.order))
    if (!result) return false

    completion.value = {
      totalOrders: result.totalOrders,
      message: result.message,
      // order_ids は送った並びで返る。応答に行ごとの詳細は無いので、送った行と位置で突き合わせる
      rows: current.rows.map((row, index) => ({ ...row, orderId: result.orderIds[index] ?? '' })),
    }
    validation.value = null
    return true
  }

  /** 取込み画面を開き直したときに、前回のエラーを消す */
  function clearUploadErrors() {
    templateError.value = null
    validationError.value = null
  }

  /** プレビュー画面を開き直したときに、前回の受付のエラーを消す */
  function clearSubmitError() {
    submitError.value = null
  }

  /** 受付完了から取込みへ戻るときに、前回の結果を消す */
  function clearCompletion() {
    completion.value = null
  }

  return {
    columns,
    columnsError,
    columnsLoading,
    isColumnsEmpty,
    loadColumns,
    templateError,
    templateLoading,
    downloadTemplate,
    validation,
    validationError,
    validating,
    validateFile,
    submitError,
    submitting,
    canSubmit,
    submitOrders,
    completion,
    clearUploadErrors,
    clearSubmitError,
    clearCompletion,
  }
})

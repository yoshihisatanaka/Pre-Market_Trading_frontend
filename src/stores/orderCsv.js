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
 *   forcedRowNumbers … プレビューで強制を指定した NG の行（行番号の Set）。CSV に強制区分の列は無いので、
 *                      強制は画面で行ごとに決める（2026-10-13 の方針変更。docs/api/requests.md #58）
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

  // Set は中身を変えても反応しないので、変えるたびに作り直して入れ替える
  const forcedRowNumbers = shallowRef(new Set())

  /** その行に強制が指定されているか */
  function isForced(row) {
    return forcedRowNumbers.value.has(row.rowNumber)
  }

  /**
   * NG の行に強制を指定する / 外す。強制で救えない行（forceable でない）は指定させない。
   * @param {object} row 事前検証の行（CsvOrderRow）
   * @param {boolean} forced
   */
  function setForced(row, forced) {
    if (forced && !row.forceable) return
    const next = new Set(forcedRowNumbers.value)
    if (forced) next.add(row.rowNumber)
    else next.delete(row.rowNumber)
    forcedRowNumbers.value = next
  }

  /** 受付で強制区分=1 にする行の数（正常の行に指定は残らないので、指定の数と同じ） */
  const forcedCount = computed(
    () => validation.value?.rows.filter((row) => !row.valid && isForced(row)).length ?? 0,
  )

  /** 強制を指定しても受け付けられない、または強制がまだ指定されていない NG の行の数 */
  const unresolvedCount = computed(
    () => validation.value?.rows.filter((row) => !row.valid && !isForced(row)).length ?? 0,
  )

  /** 1 行以上あり、NG の行がすべて強制で救われていて、受付の最中でない */
  const canSubmit = computed(
    () =>
      (validation.value?.rows.length ?? 0) > 0 && unresolvedCount.value === 0 && !submitting.value,
  )

  /**
   * CSV を事前検証する。行に NG があっても成功（validation に入る）で、失敗はファイルそのものの不備と通信の失敗。
   * @param {File} file
   * @returns {Promise<object|null>} 検証の結果。失敗したら null（理由は validationError）
   */
  function validateFile(file) {
    // useAsync は失敗しても前回の値を残す。別のファイルの結果がプレビューに出ないよう先に空にする
    validation.value = null
    submitError.value = null
    // 強制は行番号で覚えている。別のファイルの同じ行番号へ持ち越さない
    forcedRowNumbers.value = new Set()
    return executeValidation(file)
  }

  /**
   * いまの検証結果の全行を一括受付する。強制を指定した行は強制区分=1 で送る。
   *
   * 成功したら completion に結果（行ごとに採番された注文 ID と登録時の警告）を置き、validation を空にする。
   * ブラウザの「戻る」でプレビューへ戻って、同じ注文をもう一度受け付けられないようにするため。
   *
   * @returns {Promise<boolean>} 受け付けたら true（失敗の理由は submitError）
   */
  async function submitOrders() {
    const current = validation.value
    if (!canSubmit.value) return false

    const rows = current.rows.map((row) => ({
      ...row,
      order: { ...row.order, forced: !row.valid && isForced(row) },
    }))
    const result = await executeSubmit(rows.map((row) => row.order))
    if (!result) return false

    completion.value = {
      totalOrders: result.totalOrders,
      message: result.message,
      // 警告の位置は送った並びの index。画面は CSV の行番号で出すので引き直す（引けなければ null）
      warnings: result.warnings.map((warning) => ({
        rowNumber: rows[warning.index]?.rowNumber ?? null,
        message: warning.message,
      })),
      // order_ids は送った並びで返る。応答に行ごとの詳細は無いので、送った行と位置で突き合わせる
      rows: rows.map((row, index) => ({ ...row, orderId: result.orderIds[index] ?? '' })),
    }
    validation.value = null
    forcedRowNumbers.value = new Set()
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
    forcedRowNumbers,
    isForced,
    setForced,
    forcedCount,
    unresolvedCount,
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
